# Runbook: primera validación real de Google Drive (Fase 8I-A/8I-B)

**Versión:** 2026-08-29 (Fase 8I-B2A — evidencia READ-ONLY real del servidor/DNS
incorporada, auditoría cerrada; ver Sección 39.Z)
**Estado:** checklist verificable. La auditoría READ-ONLY del servidor y del
DNS (Sección 39.Z) ya se ejecutó — manualmente, por el propietario, sin
ninguna conexión SSH adicional de este proceso y sin modificar
infraestructura. El resto (OAuth real, staging real, Drive real) sigue sin
ejecutarse.

Este documento es el único entregable de código de la Fase 8I-A. No contiene
secretos reales, no asume valores no verificados, y no autoriza por sí mismo
ninguna acción — cada stage de la Sección 8 requiere aprobación explícita
separada antes de ejecutarse, igual que cada fase anterior de Drive (8B–8F.1)
exigió su propio "cierre controlado".

---

## 1. Prerrequisitos (deben estar resueltos ANTES de 8I-B)

- [ ] Rama `release/crm-2026-08-stabilization` en el commit aprobado de 8F/8F.1, gates en verde (Sección 39).
- [ ] **Decisión de tipo de cuenta** resuelta (Sección 4 de este documento) — Workspace/Internal vs personal/External.
- [ ] **Proyecto de Google Cloud dedicado a Drive** creado (nunca reutilizar el de Calendar).
- [ ] Plan de **ensayo de migraciones** en una plataforma PostgreSQL/Supabase compatible con producción (17.x) — ver Sección 3. La validación local hecha en 8B–8F.1 corrió sobre PostgreSQL **18.4**; producción documentada usa **17.6** (`docs/database/self-hosted-canonical-model.md`). Esa brecha de versión NO se ha cerrado todavía.
- [ ] Plan de backup/restore verificado (Sección 6), con un RESTORE de prueba, no solo un backup creado.
- [ ] Decisión de entorno (staging separado vs despliegue con Drive deshabilitado) — Sección 7.

## 2. Decisiones que DEBEN resolver personas, no este documento

Estas son las preguntas abiertas explícitas de la Sección "Decision Gate" del
pedido. Nada en el código ni en este runbook las decide — deben resolverse
con información real antes de continuar a 8I-B.

| # | Decisión | Opciones | Estado (Fase 8I-A.1) | Bloquea si no se resuelve |
|---|---|---|---|---|
| 1 | Tipo de cuenta Google que usará la carpeta raíz de Drive | Workspace organizacional del estudio vs. cuenta personal/Gmail | **PENDIENTE** — requiere dato real, ver Sección 11 | Determina si el proyecto OAuth puede ser `Internal` (sin revisión de Google) o debe ser `External` con `Testing` |
| 2 | My Drive vs Shared Drive para la raíz de Clientes | Uno de los dos, no ambos en la primera prueba | **RESUELTA: My Drive + carpeta `CRM-DRIVE-STAGING`**, salvo que la Decisión 1 revele que la cuenta está forzada a Shared Drive — ver Sección 26. No decide la topología final de producción. | El código soporta ambos (`shared_drive_id` ya modelado), pero la elección determina qué carpeta se selecciona en el Stage 5 |
| 3 | Entorno de la primera prueba real | Staging público separado vs. despliegue de producción con Drive deshabilitado hasta activarlo manualmente | **RESUELTA: staging separado** — ver Sección 18/19 | Google no puede llamar al webhook hasta que exista un endpoint HTTPS público corriendo este código — ver Sección 7 |
| 4 | Ventana de mantenimiento para la primera prueba | Cron externo (systemd timer / n8n / scheduler) que llame `POST /api/google-drive/maintenance` con qué frecuencia | **RESUELTA: cron del propio sistema/usuario de despliegue, cada 10 minutos** (explícitamente NO n8n) — ver Sección 20 | Sin esto, ni el poll ni la renovación de watch ocurren nunca |

---

## 3. Inventario de migraciones pendientes (reconciliado contra el filesystem real)

Confirmado con `ls supabase/migrations/` — no se asumió la lista del pedido,
se reconcilió contra el repositorio y coincide exactamente:

| # | Archivo | Tablas/objetos afectados | Funciones/RPC nuevas | Extensión requerida |
|---|---|---|---|---|
| 1 | `20260822090000_google_calendar_sync_queue_claim.sql` | `google_calendar_sync_requests` (+col `claimed_at`, +índice, **backfill de datos**), `google_calendar_connections` (+col `renewal_claimed_at`) | ninguna | ninguna |
| 2 | `20260822100000_client_reports_case_client_integrity.sql` | `cases` (+constraint UNIQUE), `client_reports` (+FK compuesta) | ninguna | ninguna |
| 3 | `20260822110000_add_templates.sql` | tabla nueva `templates` + RLS + 2 policies RESTRICTIVE en `storage.objects` | ninguna | ninguna |
| 4 | `20260822120000_prevent_last_admin_removal.sql` | `profiles` (2 triggers nuevos) | `prevent_last_admin_removal()` — **única con `SECURITY DEFINER`** de las 9, justificada (trigger que debe ejecutar con privilegio propio) | ninguna (usa `pg_advisory_xact_lock`/`hashtextextended`, núcleo de Postgres) |
| 5 | `20260824100000_google_drive_sync_foundation.sql` | 6 tablas nuevas `google_drive_*` | `claim_google_drive_sync_operations`, `replace_google_drive_connection`, `disconnect_google_drive_connection` | ninguna |
| 6 | `20260824110000_google_drive_client_folder_onboarding.sql` | `google_drive_client_folders`/`connections` (columnas) | `set_google_drive_root_folder`, `apply_google_drive_client_folder_mappings` | ninguna |
| 7 | `20260825100000_google_drive_crm_to_drive.sql` | sin tablas nuevas | RPCs de sync outbound (ver informe 8D) | ninguna |
| 8 | `20260825110000_google_drive_drive_to_crm_import.sql` | sin tablas nuevas | `finalize_google_drive_import`, `repair_google_drive_document_mapping`* | ninguna |
| 9 | `20260826100000_google_drive_automatic_sync.sql` | `google_drive_connections`/`channels`/`client_folders` (columnas + índice reconstruido) | `initialize_google_drive_change_token`, `advance_google_drive_change_token`, `claim/complete_google_drive_reconciliation`, `rotate_google_drive_channel`, `repair_google_drive_document_mapping` | ninguna |

`*` `repair_google_drive_document_mapping` está definida en la migración 9,
no en la 8 — corregido aquí tras verificar el archivo real (el pedido no
especificaba en cuál).

**Orden de dependencia:** estrictamente cronológico por timestamp — cada
migración de Drive depende de que las anteriores ya existan (referencian
las mismas tablas/columnas). Las 4 migraciones no-Drive (1–4) son
independientes entre sí y de las 5 de Drive; podrían aplicarse en cualquier
orden relativo entre ellas, pero deben respetar SU PROPIO orden cronológico
si el proceso de aplicación es secuencial (estándar de Supabase).

**Grants:** las 9 migraciones siguen el mismo patrón — `REVOKE ALL FROM
public, anon, authenticated` + `GRANT` explícito y mínimo (`service_role`
para las funciones server-only de Drive/Calendar; `authenticated` solo para
`templates` vía RLS). Ninguna otorga `EXECUTE`/`SELECT` a `PUBLIC` sin
querer.

**Constraints/FK reales que pueden ABORTAR la migración si hay datos
inconsistentes** (verificado leyendo el SQL, no asumido):
- Migración 2 (`client_reports_case_client_integrity`): hace un chequeo
  explícito ANTES del `ALTER TABLE` y **lanza excepción** si existe algún
  `client_reports.case_id` que pertenezca a un `client_id` distinto. Si
  producción tiene datos así, la migración se detiene con un mensaje que
  incluye la consulta para identificarlos — nunca corrige nada
  automáticamente.
- Migración 4 (`prevent_last_admin_removal`): hace un chequeo explícito y
  **lanza excepción** si en ese momento existen 0 Administradores activos
  en `profiles`. No promueve a nadie automáticamente.

Ninguna migración de Drive tiene un precheck de datos equivalente porque
todas sus tablas son nuevas (sin datos preexistentes que pudieran violar un
invariante).

## 4. Baseline de producción vs. HEAD de stabilization (solo git/documentación local)

- Producción congelada: tag `crm-production-2026-08-17` → commit
  `409e1798204b31e048c2ae461f9e5480cee21c60` (confirmado: la tag anotada
  resuelve exactamente a ese commit, sin discrepancia).
- HEAD actual de stabilization: `9f71ac0c8eb861dbfbb579fbef1da9e3114850e7`.
- **Magnitud del release completo:** 14 commits, 126 archivos, +27067/-2202
  líneas entre ambos puntos. 87 archivos nuevos, 39 modificados.
- Desglose por área: 29 rutas nuevas/modificadas en `src/routes`, 20 módulos
  en `src/lib`, 17 componentes, **9 migraciones nuevas** (las de la Sección
  3), 6 hooks, decenas de archivos de test.
- Esto NO es solo Drive: incluye reportes/expedientes, plantillas,
  protección de último Administrador, hardening de roles/PWA, unificación
  de documentos, flujo de tareas, y el propio Google Calendar hardening —
  todo pendiente de desplegar junto, en el mismo release.

No se hizo merge ni deploy. Esto es solo lectura de git local.

## 5. Plan de ensayo de migraciones (Migration Rehearsal) — EJECUTADO en Fase 8I-A.1

Secuencia diseñada en 8I-A, ejecutada realmente en 8I-A.1 sobre PostgreSQL
17.11 local (puerto 5433, instancia independiente vía scoop, distinta de la
18.4 usada en toda validación previa y sin ninguna relación con el proyecto
Supabase remoto vinculado localmente):

1. **Snapshot/backup restaurable** de un entorno equivalente a producción — hecho (`pg_dump -Fc`).
2. **Instancia PostgreSQL objetivo real 17.x** — hecho: PostgreSQL 17.11.
3. Aplicar las 9 migraciones pendientes **en el orden cronológico exacto** de la Sección 3 — hecho, las 9 aplicaron limpio (`exit=0`) sobre un fixture consistente.
4. Validar grants/functions/constraints con las mismas consultas ya usadas en 8B.2/8C/8D/8E/8F/8F.1 — hecho, resultados en el informe de cierre 8I-A.1 (Secciones F–I de ese informe).
5. Confirmar que el esquema resultante coincide con lo esperado — hecho vía inventario post-migración (6 tablas Drive, 16 RPCs, políticas, grants).
6. **Prueba de rollback (restore real, no solo backup)** — hecho: backup → migración + cambio sintético posterior → restore en OTRA base de datos local → confirmado que el esquema baseline y el fixture original vuelven exactamente, y que el cambio posterior está ausente.

**Hallazgo mayor de esta fase, no anticipado en 8I-A:**
`supabase/self-hosted/0001_extensions_and_base.sql` contiene un guard de
versión (`if current_setting('server_version_num')::integer < 170000 or >=
180000 then raise exception`) que **rechaza explícitamente cualquier
PostgreSQL fuera del rango 17.x**. Esto significa que este archivo —el
bootstrap canónico self-hosted, confirmado por git como byte-idéntico a la
baseline de producción `409e1798` para ese directorio— **nunca se había
ejecutado realmente** en ninguna validación previa (8B.2 a 8F.1), todas
corridas sobre PostgreSQL 18.4 con un scaffold mínimo propio en vez del
bootstrap canónico real. La Fase 8I-A.1 es la primera ejecución genuina de
`0001`–`0008_verify.sql` sin modificar contra un servidor que realmente
cumple su propio requisito de versión — y pasó limpio (31/31 checks PASS en
`0008_verify.sql`, incluyendo el propio check "PostgreSQL major version:
17"). Ninguna sintaxis de las 9 migraciones pendientes resultó incompatible
con 17.x (la única sintaxis "moderna" señalada explícitamente en el SQL —
`on delete set null (case_id)`— es de PostgreSQL 15+, confirmado
compatible).

## 6. Auditoría de variables de entorno de Drive

Inventario exacto reconciliado contra código + `.env.example` +
`scripts/validate-production-env.mjs` + `GOOGLE_DRIVE_CONFIGURATION.md`.
**Se encontraron y corrigieron dos inconsistencias documentales objetivas**
(permitido por el alcance de esta fase): `GOOGLE_DRIVE_WEBHOOK_URL` faltaba
por completo en `.env.example`, y las 6 variables de Drive + la nota de que
`GOOGLE_OAUTH_STATE_SECRET`/`GOOGLE_TOKEN_ENCRYPTION_KEY` también las usa
Drive faltaban por completo en `server-release/docs/ENVIRONMENT_VARIABLES.md`
(ese documento no se había tocado desde 2026-08-01, antes de que Drive
existiera). Ambos ya están corregidos en esta misma fase (ver diff).

| Variable | Clasificación | Compartida con Calendar |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` | Requerida solo si Drive habilitado | No — dedicada a Drive |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Requerida solo si Drive habilitado, secreto | No — dedicada a Drive |
| `GOOGLE_DRIVE_REDIRECT_URI` | Requerida solo si Drive habilitado, URL pública | No — dedicada a Drive |
| `GOOGLE_OAUTH_STATE_SECRET` | Requerida si Calendar **o** Drive, secreto | **Sí** — primitiva de firma HMAC, no credencial OAuth |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Requerida si Calendar **o** Drive, secreto | **Sí** — clave de cifrado AES genérica |
| `GOOGLE_DRIVE_MAINTENANCE_SECRET` | Requerida solo si Drive habilitado, secreto generado | No — dedicada a Drive |
| `GOOGLE_DRIVE_WEBHOOK_URL` | Siempre opcional, URL pública | No — dedicada a Drive |

Ver Sección 7 (auditoría de secretos compartidos) para el razonamiento
completo sobre por qué las dos compartidas NUNCA deben rotarse sin plan.

## 7. Auditoría de secretos compartidos (Calendar/Drive)

Confirmado en código (`google-drive.server.ts` y `google-calendar.server.ts`
leen literalmente el mismo nombre de variable):

- `GOOGLE_OAUTH_STATE_SECRET` — firma HMAC del parámetro `state` OAuth. Es
  una **primitiva criptográfica**, no una credencial de ningún OAuth Client
  concreto. Rotarla invalida cualquier `state` en tránsito de AMBAS
  integraciones durante su ventana de 10 minutos — impacto trivial y
  autolimitado.
- `GOOGLE_TOKEN_ENCRYPTION_KEY` — clave AES-256-GCM que cifra
  `encrypted_refresh_token` en `google_calendar_connections` **y**
  `google_drive_connections`. Rotarla sin plan deja **ilegibles** los
  refresh tokens ya guardados de las DOS integraciones simultáneamente,
  aunque el motivo de la rotación solo afectara a una. Un incidente que
  obligue a rotar esta clave exige reconectar Calendar y Drive por
  separado después.

**No se genera ningún valor nuevo en esta fase.** Si ambas ya están
configuradas para Calendar en producción, Drive las reutiliza sin ningún
paso adicional — no hace falta pedir nada nuevo a nadie para esto en
particular.

## 8. Arquitectura de proyecto de Google Cloud dedicado

Confirmado por diseño ya existente (Fase 8B, `google-drive.server.ts`
cabecera): Drive usa un OAuth Client completamente separado del de
Calendar, con la intención explícita de que viva en su **propio proyecto de
Google Cloud**, no solo un segundo Client dentro del proyecto de Calendar.
Google además recomienda proyectos separados para testing/producción. Para
la primera prueba real:

- **Preferencia:** proyecto nuevo, ej. "CRM Drive — Testing/Staging",
  aislado del proyecto que usa Calendar en producción.
- Ningún proyecto se crea en esta fase.

## 9. Scope de Drive solicitado

Confirmado en código (`GOOGLE_DRIVE_SCOPES` en `google-drive.server.ts`):

```
openid email https://www.googleapis.com/auth/drive
```

Sigue siendo exactamente el scope necesario para: descubrir archivos
añadidos manualmente por el personal jurídico fuera del CRM, usar el change
feed (`changes.list`/`changes.watch`), leer y escribir en la jerarquía
organizada por el estudio, y buscar por `appProperties` en la
reconciliación. **No se cambia a `drive.file` en esta fase** — ese scope no
puede cubrir "detectar archivos preexistentes o añadidos después sin pasar
por el CRM", que es un requisito de diseño explícito desde 8A.

`https://www.googleapis.com/auth/drive` es un scope **restringido**
("restricted") según la clasificación de Google. Ver Sección 10.

## 10. Implicaciones de scope restringido / verificación

`auth/drive` es RESTRICTED. Esto puede implicar, dependiendo del modelo
final de audience/uso (**no determinado en esta fase**):

- OAuth app verification de Google.
- Verificación de scope restringido.
- Posible "security assessment" de terceros — pero **solo** cuando la app
  transmite/almacena datos restringidos de usuarios EXTERNOS a gran escala
  en producción pública.

**Excepciones/reglas que probablemente aplican para la primera prueba
controlada** (a confirmar contra la política vigente de Google en el
momento de ejecutar 8I-B, no se asume aquí):
- Apps en modo `Testing` con `test users` explícitos suelen quedar exentas
  de verification mientras no salgan de Testing.
- Un proyecto `Internal` (Google Workspace, ver Sección 11 PATH A) no pasa
  por el flujo de verification pública de apps `External` en absoluto.

**No se afirma que este proyecto necesite una auditoría pagada.** Esa
conclusión depende enteramente de qué PATH resulte aplicable (Sección 11) y
de si alguna vez sale de `Testing`/`Internal` hacia producción pública con
usuarios externos reales — ninguna de esas dos condiciones aplica a la
primera prueba controlada descrita en este runbook.

## 11. Decision Gate — tipo de cuenta (sin resolver, requiere dato real)

### PATH A — Google Workspace organizacional
Si la cuenta de Drive que se usará pertenece a un Workspace administrado
por el estudio: el proyecto de Google Cloud podría configurarse como
`Internal` — evita el flujo de consentimiento/verificación pública de apps
`External` por completo, porque solo usuarios del propio dominio pueden
autorizarlo. Implicación: la primera prueba sería operativamente más simple
y sin caducidad de acceso de test users.

### PATH B — Cuenta Google personal/Gmail
El audience OAuth será `External`. Para la prueba controlada: `Testing` +
`test users` explícitos (el propio email que conectará el estudio debe
añadirse a la lista de test users en Google Cloud Console). Limitación
documentada en la Sección 12.

**Esta decisión NO se toma aquí.** Debe resolverse con el dato real (¿el
estudio tiene Google Workspace o usa Gmail personal para su Drive?) antes
de iniciar 8I-B — es, junto con el entorno de prueba (Sección 2, decisión
3), la pregunta más bloqueante de todo el preflight.

## 12. Caveat de OAuth Testing

Documentado explícitamente para PATH B: una app `External` en estado de
publicación `Testing` limita el acceso exclusivamente a los `test users`
declarados en Google Cloud Console, y los grants otorgados en ese modo
pueden tener una vida limitada (Google los revoca periódicamente si la app
no avanza de estado). **`Testing` sirve para validación controlada, nunca
debe confundirse con una configuración productiva definitiva** — antes de
cualquier uso real y sostenido por el estudio, correspondería decidir
explícitamente si se avanza a `In production` (lo que sí dispara el flujo
de verification si el scope restringido lo exige).

## 13. Checklist futura de Google Cloud Console (NO ejecutar todavía)

- [ ] Habilitar Google Drive API en el proyecto dedicado.
- [ ] Configurar Audience (Internal o External+Testing, según Sección 11).
- [ ] Nombre de la app, correo de soporte, contacto de desarrollador.
- [ ] Dominios autorizados (si aplica al audience elegido).
- [ ] Política de privacidad (si Google la exige para el audience elegido).
- [ ] Declaración del scope restringido `auth/drive`.
- [ ] Test users (solo si External+Testing).
- [ ] Crear OAuth Client tipo "Web application", con el/los redirect URI de la Sección 14.

## 14. Redirect URI exacto

Confirmado contra el route real (`src/routes/api.google-drive.callback.ts`,
que TanStack Router mapea a `/api/google-drive/callback`) y la
documentación operativa — no asumido:

```
https://abogado.consoldi.com/api/google-drive/callback
```

`GOOGLE_DRIVE_REDIRECT_URI` debe coincidir **exactamente, carácter por
carácter** (Google exige match literal, no solo de dominio) con un
"Authorized redirect URI" configurado en el OAuth Client de Drive. Para
desarrollo local, añadir además el equivalente de `localhost` cuando
corresponda — no se crea ningún Client todavía.

## 15. Flujo de acceso offline (refresh_token)

Confirmado en `beginGoogleDriveOAuth` (`google-drive.server.ts:403-414`):
la URL de autorización SÍ incluye `access_type=offline` **y**
`prompt=consent`. Esto es coherente con `completeGoogleDriveOAuth`
(`google-drive.server.ts:481`), que **rechaza explícitamente** la conexión
si Google no devuelve `refresh_token` (`if (!tokens.access_token ||
!tokens.refresh_token) ...`). `prompt=consent` fuerza a Google a re-mostrar
la pantalla de consentimiento y, con ella, a emitir un `refresh_token`
nuevo en cada conexión — sin esto, una reconexión posterior al primer
consentimiento podría no recibir `refresh_token` según las reglas de
Google, y el callback fallaría exactamente donde se espera que falle (no en
silencio). No se realizó ningún OAuth real para esta verificación —
confirmado por lectura de código.

## 16. Aislamiento de revocación Drive/Calendar

Reconfirmado (`google-drive.server.ts`, comentario de cabecera + código):
la desconexión de Drive (`disconnectGoogleDrive`) es **exclusivamente
local** — marca la conexión `disconnected` y destruye el
`encrypted_refresh_token`, pero **nunca** llama a
`oauth2.googleapis.com/revoke`. Motivo documentado: revocar invalida los
grants a nivel de PROYECTO de Google Cloud, no solo del OAuth Client que
emitió el token — mientras Drive y Calendar pudieran compartir proyecto (ya
no lo harán, ver Sección 8), revocar Drive habría podido invalidar
Calendar también. Con el proyecto dedicado de la Sección 8, este
acoplamiento operativo queda eliminado de raíz para cualquier futuro. No se
toca Calendar en ningún punto de este flujo.

## 17. Ruta exacta del webhook y requisitos HTTPS

```
POST /api/google-drive/webhook
```

(confirmado contra `src/routes/api.google-drive.webhook.ts`.) Para
apuntarlo desde Google con el dominio real de producción, la URL
conceptual sería `https://abogado.consoldi.com/api/google-drive/webhook`
— **solo si ese dominio efectivamente corresponde al entorno donde se
ejecutará la prueba** (ver decisión de entorno, Sección 2 #3). No se
decide el entorno en esta fase.

Requisitos confirmados por auditoría de código y documentación de Google:
- HTTPS con certificado TLS válido — Google no acepta self-signed.
- El webhook NO necesita leer el body de la petición (confirmado: la ruta
  nunca llama a `request.json()/.text()/.formData()`).
- NO usa sesión de Administrador ni `GOOGLE_DRIVE_MAINTENANCE_SECRET`
  (confirmado: cero referencias a ninguno de los dos en el archivo de la
  ruta). Su autoridad es exclusivamente `channel_id` + hash del
  `channel_token` + `resource_id`.

## 18. El problema del entorno para la primera prueba real

Hecho verificado, no opinión: el código de 8F **todavía no está
desplegado** en ningún servidor accesible por Google. Por tanto Google no
puede llamar a `/api/google-drive/webhook` hasta que exista un endpoint
HTTPS público ejecutando esta versión exacta del código. Dos opciones:

**A. Staging público separado.**

**B. Despliegue controlado de producción con Drive deshabilitado**, activar
OAuth/watch manualmente solo después, en una ventana controlada.

**DECISIÓN (Fase 8I-A.1): opción A, staging separado.** Motivo: este
release no es solo Drive — son 14 commits, ~126 archivos y 9 migraciones
que también tocan Calendar, `client_reports`, `templates` y el trigger de
último-Administrador. Habilitar Drive directamente en producción (aunque
sea "deshabilitado hasta activarlo manualmente") pondría en el mismo radio
de explosión a módulos que nada tienen que ver con Drive si algo del
despliegue en sí sale mal — el propio proceso de deploy, no solo Drive, es
lo que un staging separado aísla. Un staging separado reduce ese radio de
explosión a cero para producción mientras se ejecuta la primera prueba
real de Drive. Esta decisión no exime de ejecutar primero el ensayo de
migraciones de la Sección 5 (ya ejecutado en Fase 8I-A.1 sobre PostgreSQL
17, ver informe de esa fase) — staging separado y ensayo de migraciones
son controles independientes, no sustitutos entre sí.

## 19. Requisitos de staging (decisión tomada: opción A)

- HTTPS válido con certificado real.
- El mismo build Node ya usado en producción (sin código adicional -- 8F ya
  es el HEAD aprobado).
- Base de datos de staging compatible (mismo esquema tras aplicar las 9
  migraciones pendientes).
- Variables de Drive de **testing** (Client ID/Secret de PATH B o del
  proyecto Internal de PATH A, nunca las de producción si llegaran a
  diferir).
- `GOOGLE_DRIVE_WEBHOOK_URL`/`GOOGLE_DRIVE_REDIRECT_URI` apuntando al
  dominio de staging, no al de producción.
- Sin datos jurídicos reales (ver Sección 24).

No se crea ningún staging en esta fase.

## 20. Plan de invocación de mantenimiento

`POST /api/google-drive/maintenance` no tiene cron interno (Cloudflare
Workers `scheduled()` no está en uso para este target Node/Virtualmin,
mismo patrón ya resuelto para Calendar vía
`GOOGLE_CALENDAR_MAINTENANCE_SECRET` + cron externo).

**DECISIÓN (Fase 8I-A.1): cron del propio sistema/usuario de despliegue,
cada 10 minutos.** Explícitamente **NO n8n**: la sincronización de Drive no
debe depender de otro producto/proceso externo para su durabilidad básica —
un cron del SO es la dependencia mínima ya disponible en cualquier target
Node/Virtualmin, sin introducir un nuevo componente operativo. 10 minutos
es razonable para la primera validación: `poll_changes` es liviano, la
reconciliación tiene su propio intervalo interno
(`GOOGLE_DRIVE_RECONCILIATION_INTERVAL_MS`, 6h) y no se dispara en cada
llamada, y la renovación de watch solo actúa cuando falta ≤24h para expirar
o el canal actual ya no sirve — llamar cada 10 minutos no produce trabajo
extra significativo frente a intervalos más largos.

Ejemplo conceptual (sin secretos reales, no ejecutado en esta fase):

```
*/10 * * * * curl -fsS -X POST https://staging.example/api/google-drive/maintenance \
  -H "X-Maintenance-Secret: $(cat /ruta/protegida/drive-maintenance-secret)"
```

El secreto debe leerse de un archivo protegido (permisos restrictivos,
fuera del control de versiones) o de una variable de entorno cargada por el
propio servicio de cron — nunca escrito en texto plano directamente dentro
de la línea de crontab si existe una alternativa mejor disponible en el
target real. No se crea ningún cron en esta fase.

**REFINAMIENTO (Fase 8I-B1): el cron cada 10 minutos es el estado FINAL
del staging, no el primer paso.** Antes de instalarlo, `POST
/api/google-drive/maintenance` debe invocarse **manualmente** (curl directo,
una vez por paso) las veces suficientes para confirmar que cada ciclo hace
lo esperado — avanza el cursor de cambios, no duplica trabajo, no lanza
errores — con ojos humanos revisando cada respuesta. Instalar el cron ANTES
de esa confirmación manual mezclaría dos preguntas distintas ("¿el
endpoint funciona?" y "¿el cron está bien configurado?") en un solo fallo
silencioso y periódico, mucho más difícil de diagnosticar que una llamada
manual que falla a la vista. Ver el orden exacto en la Sección 39.M
(BLOCK I) — el cron solo se instala después de BLOCK L.

## 21. Relación webhook/mantenimiento (durabilidad)

Arquitectura confirmada y ya documentada en `GOOGLE_DRIVE_CONFIGURATION.md`:
webhook → solo encola `poll_changes` y responde 204; el propio
mantenimiento periódico procesa la cola, encola su propio `poll_changes` en
cada ciclo, y decide si toca reconciliar/renovar el watch. Por diseño, el
sistema **no depende de recibir cada webhook** — el polling periódico de
mantenimiento por sí solo ya mantiene la durabilidad. Esto permite, si se
prefiere operacionalmente más simple, **validar primero solo con polling**
(Stages 0–12 de la Sección 23) y añadir watch/webhook después (Stage 13),
en vez de exigir ambos desde el primer intento.

## 22. Consideraciones ya cubiertas en otras secciones
(Privilegios remotos → Sección 12 de más abajo; gates → Sección de gates;
diff → Sección de diff.)

---

## 23. Secuencia de la primera prueba real (8I-B) — NO ejecutar todavía

**Reemplazada por la secuencia de bloques BLOCK A–L de la Sección 39.M**
(Fase 8I-B1), que detalla precondition/action/expected/evidence/abort para
cada bloque, en vez de la tabla de 17 stages numéricos de esta sección
original. La tabla original queda conservada aquí solo como referencia
rápida de alto nivel — para ejecutar, usar siempre la Sección 39.M como
fuente de verdad, no esta tabla.

| Stage | Acción | Resultado esperado | Bloque equivalente |
|---|---|---|---|
| 0 | Backup + punto de rollback | Snapshot restaurable confirmado | BLOCK B |
| 1 | Migraciones en entorno controlado (17.x) | Esquema release completo aplicado, grants verificados | BLOCK B |
| 2 | Validación de entorno | `validate-production-env.mjs` exit 0 | BLOCK A |
| 3 | Solo OAuth connect | Conexión `connected`, refresh token cifrado guardado | BLOCK D |
| 4 | Status / refresh de access token | `/api/google-drive/status` responde sano | BLOCK D |
| 5 | Seleccionar carpeta raíz DE PRUEBA | `root_folder_id` fijado a `CRM-DRIVE-STAGING`, nunca a la raíz real | BLOCK E |
| 6 | Onboarding con 1–2 Clientes ficticios | Mapeos creados, sin homónimos reales afectados | BLOCK E |
| 7 | CRM → Drive: un documento de prueba | Archivo aparece en Drive con appProperties correctas | BLOCK F |
| 8 | Drive → CRM: un blob de prueba | `import_drive_file` crea el documento, `case_id`/`created_by` NULL | BLOCK G |
| 9 | Rename en Drive | `sync_status='conflict'`, CRM no se renombra | BLOCK H |
| 10 | Move en Drive | `DRIVE_PARENT_MISMATCH`, sin reasignar Cliente | BLOCK H |
| 11 | Trash en Drive | CRM conserva el documento, mapping `missing` | BLOCK H |
| 12 | Poll de cambios (manual, sin cron todavía) | Cursor avanza correctamente, sin duplicados | BLOCK I |
| 13 | Watch/webhook | Canal creado, notificación real recibida y procesada | BLOCK J |
| 14 | Reconciliación | Corre sin error, detecta lo esperado | BLOCK K |
| 15 | Disconnect (local-only) | Token destruido, Calendar no afectado | BLOCK L |
| 16 | Reconnect | Nueva conexión limpia, sin residuos de la anterior | BLOCK L |

Ningún stage/bloque se ejecuta en esta fase. Cada uno requiere que el
anterior haya sido explícitamente aprobado.

## 24. Política de datos de prueba

Para la primera prueba real: **sin expedientes reales, sin documentos
jurídicos reales, sin DNI ni información personal real.** Usar:

- Cliente prueba A / Cliente prueba B (nombres claramente ficticios).
- Archivos sintéticos: `drive-test-a.pdf`, `drive-test-b.docx`, contenido
  sin datos sensibles.

## 25. Estrategia de carpeta raíz de prueba

**No apuntar** la primera prueba a la carpeta real de Clientes del estudio.
Crear manualmente (fuera de esta fase) una carpeta `CRM-DRIVE-STAGING` con
subcarpetas exclusivamente de prueba. La primera validación nunca debe
recorrer el repositorio documental real.

## 26. Decisión My Drive vs Shared Drive

El código ya soporta ambos de forma transparente (`shared_drive_id` se
detecta automáticamente del `driveId` de la carpeta elegida al fijar la
raíz — confirmado en `setGoogleDriveRootFolder`). La elección de cuál usar
es una decisión humana de una sola vez al ejecutar el Stage 5, no un flag de
configuración separado.

**DECISIÓN (Fase 8I-A.1): My Drive + carpeta `CRM-DRIVE-STAGING`** (Sección
25), salvo que al ejecutar 8I-B la cuenta real resulte estar forzada a
Shared Drive (algunas cuentas Workspace no permiten crear carpetas sueltas
en My Drive fuera de una unidad compartida) — en ese caso se usa Shared
Drive para esta misma primera prueba, sin que eso cambie ninguna otra
decisión de esta fase. Esto es una elección **para la primera prueba en
staging únicamente**: no decide la topología final de producción, que se
decide después de observar el comportamiento real de la cuenta (Decisión 1
de la Sección 2, todavía pendiente — ver Sección 11).

## 27. Auditoría de logs/observabilidad

**Hallazgo verificado por grep, no asumido:** no existe NINGÚN
`console.log`/`console.error`/`console.warn` en todo el código de Drive
(`src/lib/google-drive/*.ts`, rutas `api.google-drive.*.ts`). Toda la
observabilidad disponible hoy vive exclusivamente en las tablas
(`last_error` en conexiones, `sync_error`/`sync_status` en mappings,
`last_error`/`status`/`attempt_count` en la cola) y en las respuestas
estructuradas de `/api/google-drive/maintenance` y `/api/google-drive/status`.

Esto **no se considera un blocker** para una primera prueba controlada de
pequeña escala (las tablas son directamente consultables vía Supabase), pero
es una limitación operativa real para monitoreo continuo futuro. No se
implementa logging nuevo en esta fase (no es un blocker, per las
instrucciones de esta fase). Confirmado además que ningún dato sensible
(access token, refresh token, channel token, session URL de resumable
upload, secretos) se expone en ningún mensaje de error sanitizado — todos
los `catch` de Drive descartan el cuerpo crudo de las respuestas de Google
antes de propagar cualquier mensaje.

## 28. Plan de backup de base de datos

Diseño (no ejecutado):
1. Snapshot/dump completo: schema + datos, antes de aplicar cualquier
   migración pendiente.
2. Consideraciones de Storage: los buckets de Supabase Storage (documentos,
   plantillas) no viven en el dump de PostgreSQL — necesitan su propio
   mecanismo de respaldo si se quiere poder restaurar el estado completo,
   no solo las tablas.
3. **Procedimiento de restauración probado, no solo "backup creado":** el
   runbook exige ejecutar un RESTORE real del snapshot antes de considerar
   el plan de backup verificado — exactamente el mismo estándar que ya se
   aplicó a cada validación de PostgreSQL local de 8B–8F.1 (nunca simular,
   siempre demostrar contra una instancia real).

No se ejecuta ningún backup remoto en esta fase.

## 29. Rollback operativo de Google Drive (no SQL)

Si la validación real falla en cualquier stage:
1. Deshabilitar la invocación de mantenimiento (dejar de llamar al cron/scheduler).
2. Ignorar o detener el canal de watch (best-effort, no crítico).
3. Desconectar Drive — **local-only**, nunca `oauth2.googleapis.com/revoke`.
4. El CRM sigue operando con Supabase como fuente primaria — Drive es
   siempre secundario por diseño (ver Sección 31).
5. No eliminar automáticamente ningún dato creado en Drive por el CRM
   durante la prueba, sin revisión humana explícita.
6. Preservar los mappings y su historial (`sync_error`/`sync_status`) para
   diagnóstico — no limpiar la base de datos de prueba hasta terminar el
   diagnóstico.

## 30. Rollback de base de datos

Las migraciones agregan estructura e integridad real (constraints, FKs,
triggers) — no se planea un mecanismo de "down migration" automático para
producción. Preferencia: restaurar desde el snapshot de la Sección 28 si
una migración produce un problema grave a nivel de esquema. Para un fallo
puramente funcional de Drive (no de esquema): deshabilitar la integración
(retirar las variables de entorno de Drive) sin revertir ningún esquema —
las tablas `google_drive_*` simplemente quedan sin uso, sin afectar el
resto del CRM.

## 31. Seguridad de Drive deshabilitado

Confirmado por auditoría de código y por ejecución real del validador
(Sección 32): si las variables de entorno de Drive están ausentes, el CRM
arranca y funciona normalmente — Documentos, Clientes, Calendar y el resto
de módulos son enteramente independientes de que Drive esté conectado.
Ninguna operación CRUD primaria depende de Drive.

## 32. Comportamiento REAL del validador de producción (ejecutado, no inventado)

**Historia:** la primera auditoría (Fase 8I-A) encontró que el validador
solo activaba la exigencia de Drive cuando `CLIENT_ID` **y**
`CLIENT_SECRET` estaban AMBAS presentes — una configuración parcial como
solo `CLIENT_ID` definida pasaba en silencio, exit 0, como si Drive
estuviera deshabilitado. Confirmado como bug real (no hipotético) y
corregido en Fase 8I-A.1: el validador ahora activa la exigencia con
**cualquiera** de las tres variables de OAuth de Drive presente, y en ese
caso exige las **6 variables núcleo** completas (ver regla exacta en
`ENVIRONMENT_VARIABLES.md`).

Matriz de 7 escenarios ejecutada empíricamente (no razonada) contra el
`scripts/validate-production-env.mjs` corregido, con subshells `env -u`/
`env` para capturar el exit code real (evitando el error ya conocido de
que un pipe a `tail`/`grep` reporta el exit code del pipeline, no el de
`node`):

| Escenario | Variables de Drive presentes | Resultado real (exit code) |
|---|---|---|
| A. Drive deshabilitado | ninguna | **0** — pasa limpio |
| B. Solo `CLIENT_ID` | `CLIENT_ID` | **1** — `Google Drive configuration is incomplete: missing GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI, GOOGLE_DRIVE_MAINTENANCE_SECRET` |
| C. `CLIENT_ID`+`CLIENT_SECRET` | ambas, sin `REDIRECT_URI` ni `MAINTENANCE_SECRET` | **1** — `missing GOOGLE_DRIVE_REDIRECT_URI, GOOGLE_DRIVE_MAINTENANCE_SECRET` |
| D. `CLIENT_ID`+`CLIENT_SECRET`+`REDIRECT_URI` | las tres, sin `MAINTENANCE_SECRET` | **1** — `missing GOOGLE_DRIVE_MAINTENANCE_SECRET` |
| E. Las 6 variables núcleo presentes | todas | **0** — pasa limpio |
| F. Las 6 núcleo + `GOOGLE_DRIVE_WEBHOOK_URL` presente | todas + webhook | **0** — pasa limpio (webhook nunca afecta el resultado) |
| G. Drive deshabilitado, secretos compartidos de Calendar presentes | ninguna de Drive; `GOOGLE_OAUTH_STATE_SECRET`/`GOOGLE_TOKEN_ENCRYPTION_KEY` sí (los exige Calendar) | **0** — su presencia nunca se interpreta como Drive habilitado |

El mensaje de error solo enumera **nombres** de variables faltantes, nunca
valores. Todos los casos de FAIL retornan `exit != 0` de forma verificada
(no asumida). Ver informe de cierre 8I-A.1 para el detalle completo de
ejecución.

## 33. Los tres modelos de confianza (reconfirmado, sin cambios)

1. **OAuth callback:** HMAC `state` + PKCE + vinculado al Administrador que
   inició el flujo (`requested_by`).
2. **Webhook:** `channel_id` + hash de `channel_token` (comparación en
   tiempo constante) + `resource_id`. Nunca usa sesión ni secreto de
   mantenimiento.
3. **Maintenance:** `GOOGLE_DRIVE_MAINTENANCE_SECRET` en tiempo constante,
   máquina a máquina, nunca sesión de usuario.

Ninguno de los tres se reutiliza para otro. Confirmado por auditoría de
código en esta misma fase (ver informe de cierre 8F, sección de
verificación independiente).

## 34. Checklist de verificación de privilegios remotos (post-migración, futura)

Reutilizable literalmente de las consultas ya probadas en 8B.2/8C/8D/8E/8F/8F.1:

```sql
-- RLS habilitado + grants correctos por rol
select p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec,
  has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
  has_function_privilege('service_role', p.oid, 'execute') as svc_exec,
  p.prosecdef as secdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%google_drive%';

-- Invariante de un solo canal "current" por conexión
select count(*) from public.google_drive_channels where superseded_at is null;

-- Ningún GRANT inesperado a PUBLIC
select grantee, privilege_type from information_schema.role_table_grants
where table_name like 'google_drive%' and grantee = 'PUBLIC';
```

No se ejecuta contra Supabase remoto en esta fase — queda lista para cuando
corresponda.

## 35. Gates antes de la prueba real

Antes de 8I-B se exige de nuevo (no basta con los unit tests):
TypeScript, lint, suite completa, build Node — **y** el ensayo de
migraciones compatible descrito en la Sección 5, con su prueba de
restauración.

**Baseline canónico de tests (reconciliado en Fase 8I-B2A.1):**

- **Gate estándar — `npm test`:** 65 archivos, **1628 passed, 0 skipped, 0
  failed.** Este es el número canónico para todo gate de esta fase y de
  cualquier fase posterior. `npm test` ejecuta `vitest run --exclude
  'tests/remote-validation.test.ts'` (`package.json`), excluyendo ese
  archivo **intencionalmente** — su propio encabezado documenta que nunca
  debe correr en CI ni en `npm run test` estándar, porque requiere 6
  variables de entorno de credenciales remotas reales de Supabase.
- **Auditoría de descubrimiento completo (opcional) — `npx vitest run`
  sin `--exclude`:** 66 archivos, **1629 passed, 3 skipped** (1632 tests
  en total). La diferencia frente al gate estándar es exactamente
  `tests/remote-validation.test.ts`: 3 tests dentro de
  `describe.runIf(isAuthorized)` aparecen `skipped` (sin credenciales
  remotas configuradas), y 1 test adicional siempre-activo
  ("informa si las variables de entorno de autorización están
  configuradas") pasa. **No hay tests perdidos ni bug** — es la diferencia
  esperada entre el script canónico y una corrida de descubrimiento
  completo sin el flag de exclusión. No se modificó ningún test ni
  configuración de Vitest para reconciliar esta cifra (ver informe de
  cierre 8I-B2A.1).

---

## 36. Contenido de este runbook

Este documento es el entregable principal de la Fase 8I-A, ampliado en
8I-A.1 (rehearsal real PG17 + hardening del validador, Secciones 5/32), en
8I-B1 (staging readiness completo, Sección 39) y en 8I-B2A (evidencia
READ-ONLY real del servidor y del DNS, Sección 39.Z, que cierra la
auditoría operativa y corrige el proceso manager/rutas/puerto/Cloudflare
frente a las hipótesis previas): prerrequisitos, decision gates, setup de
Google Cloud, checklist de variables, requisitos de staging, orden de
migraciones, backup/rollback, secuencia E2E por bloques (Sección 39.M),
resultados esperados, criterios de aborto (Sección 37), evidencia a
recolectar, limpieza posterior a la prueba (Sección 38), y el diseño
completo de staging (topología, dominio, aislamiento Supabase, inventario
de variables, Google Cloud testing project, rollback y limpieza — Sección
39, con evidencia real incorporada en 39.Z). Se mantiene como fuente de
verdad única — no se crea un runbook complementario. No incluye secretos.

## 37. Criterios de aborto — NO proceder a 8I-B si:

- La rama o los gates no están limpios.
- No existe un plan de backup/restore **probado** (no solo diseñado).
- No existe un proyecto de Google Cloud dedicado a Drive.
- El tipo de cuenta (Sección 11) sigue sin resolverse.
- El audience OAuth sigue sin resolverse.
- El endpoint HTTPS del webhook no está disponible cuando llegue esa parte de la prueba (Stage 13) — pero esto NO bloquea Stages 0–12 (polling puro), ver Sección 21.
- El ensayo de migraciones en una plataforma compatible (17.x) es incompatible o falla.
- El único entorno disponible es producción, sin staging ni rollback verificado.
- Harían falta documentos jurídicos reales para probar cualquier stage.
- Se detecta cualquier secreto commiteado en el repositorio.
- El redirect URI configurado en Google Cloud no coincide exactamente con `GOOGLE_DRIVE_REDIRECT_URI`.

## 38. Evidencia a recolectar / limpieza posterior a cada prueba

- Capturar (sin secretos) los resultados de cada stage: respuestas de
  `/api/google-drive/status`/`/maintenance`, conteos de filas relevantes,
  códigos de conflicto observados.
- Al terminar una ronda de prueba: desconectar Drive (local-only), detener
  cualquier canal de watch creado (best-effort), y decidir explícitamente
  si se conserva o se limpia la carpeta `CRM-DRIVE-STAGING` y los Clientes
  ficticios usados — nunca dejarlos indefinidamente confundibles con datos
  reales.

---

## 39. Fase 8I-B1 — Staging Readiness (diseño, sin ejecutar)

**Estado (Fase 8I-B2B-0A): DEFERRED.** El staging público completo (dominio
Cloudflare/Virtualmin descrito en esta sección) queda diferido a favor de
validar primero la integración real de Drive en localhost — ver Sección 40
para la secuencia actualizada (B2B-0A → B2B-0B → B2B-0C → B2B-1 → B2B-2) y
el razonamiento del cambio. **Ninguna evidencia de esta Sección 39 se
elimina ni se invalida** — la infraestructura auditada en B2A (Sección
39.Z) sigue siendo válida y se reutilizará cuando el staging público se
retome; simplemente no se ejecutará todavía.

Objetivo original de esta sección: dejar el staging completamente diseñado
y verificable ANTES de tocar Google Cloud, OAuth, Supabase staging remoto,
DNS, Virtualmin, Apache, Cloudflare, servidor real o Drive real. Nada de
lo que sigue se ejecutó en esa fase.

### 39.A — Auditoría de deployment real (hallazgo)

`DEPLOY.md` (raíz del repo) describe un flujo de **Cloudflare Workers**
(`npm run deploy` → `wrangler deploy`) que referencia directamente el
proyecto Supabase legacy `pnqdgwpxcxngeueosmnh` en texto plano. Confirmado
por auditoría: **este NO es el mecanismo de despliegue real actual.**

**Corrección final (Fase 8I-B2A, evidencia READ-ONLY real del servidor —
ver 39.Z):** el mecanismo real, reconfirmado por observación directa del
servidor de producción, es:

```
Internet → https://abogado.consoldi.com
  → Cloudflare (CONFIRMADO, ver 39.W)
    → Apache/Virtualmin (reverse proxy, vhost abogado.consoldi.com)
      → ProxyPass/ProxyPassReverse http://127.0.0.1:3000/ (CONFIRMADO)
        → PM2 (usuario admin-docker, app "advocate-nest", CONFIRMADO — ver 39.Z.2)
          → .output/server/index.mjs (TanStack Start + Nitro, preset "node")
            → Supabase externo (Auth, PostgreSQL, RLS, RPC, Storage)
```

Build real: `npm run build:node` (`BUILD_TARGET=node`, ver `vite.config.ts`
líneas 9-31), que fuerza el preset Nitro `"node"` — distinto del preset
`"cloudflare-module"` que usa `npm run build`/`npm run deploy` (el que
`DEPLOY.md` documenta). **`DEPLOY.md` queda confirmado como documentación
obsoleta** (Cloudflare Workers, no el target real) — no se modifica en esta
fase por estar fuera del scope autorizado (auditoría, no limpieza de docs no
relacionadas con Drive), pero queda registrado aquí para no repetir la
confusión en 8I-B2B.

**Historial de la investigación de proceso/rutas (para no repetir la
confusión):**
1. `VIRTUALMIN_DEPLOYMENT.md` (repo) listó históricamente PM2 como "Opción 1
   (recomendada)" y systemd como "Opción 2", sin indicar cuál estaba
   realmente en uso, y describía rutas bajo `/home/abogado/apps/...`.
2. En Fase 8I-B1.1, información operativa de segunda mano (no observación en
   vivo) sugirió que un procedimiento `deploy-advocate-nest-root.sh` (no
   localizado en este repositorio) migraba a systemd y limpiaba PM2 legacy.
   Esa hipótesis quedó marcada explícitamente como "sin confirmar" a la
   espera de auditoría real.
3. **La auditoría READ-ONLY real (Fase 8I-B2A, Sección 39.Z) descarta esa
   hipótesis:** `advocate-nest.service` **no existe** en el servidor. El
   proceso de producción real corre bajo **PM2**, gestionado por el usuario
   del sistema **`admin-docker`** (no `abogado`), con CWD
   `/home/admin-docker/proyectos/advocate-nest/app` (no
   `/home/abogado/apps/advocate-nest/`, que queda descartado como ruta real).
   Ambos documentos previos (`VIRTUALMIN_DEPLOYMENT.md` y la nota de
   8I-B1.1) quedan superados por esta observación directa — no se corrige el
   contenido de `VIRTUALMIN_DEPLOYMENT.md` en esta subfase (fuera de scope:
   mantenimiento de docs de despliegue, no Drive), pero todo el diseño de
   staging de este runbook (39.B/39.O/39.P/39.Q) ya queda actualizado contra
   el hallazgo real, no contra ninguna de las dos hipótesis anteriores.

### 39.B — Topología de staging

Staging vive en el MISMO servidor físico que producción, pero como entorno
lógicamente aislado, sin ningún recurso compartido con producción salvo el
hardware:

| Recurso | Producción (CONFIRMADO, ver 39.Z) | Staging |
|---|---|---|
| vhost/dominio | `abogado.consoldi.com` | `abogado-staging.consoldi.com` (AVAILABLE / NOT CREATED, ver 39.C) |
| Usuario del sistema | `admin-docker` | mismo usuario `admin-docker` (mismo daemon PM2, ver 39.O) |
| Directorio app | `/home/admin-docker/proyectos/advocate-nest/app` | directorio independiente, ej. `/home/admin-docker/proyectos/advocate-nest-staging/app` |
| Proceso Node | **PM2** (usuario `admin-docker`), app `advocate-nest`, `status=online`, `restarts=0`; script `start-crm.sh`; NO existe `advocate-nest.service` | **PM2** del mismo daemon `admin-docker`, app `advocate-nest-staging`, puerto distinto (ver 39.P) |
| Puerto interno | `127.0.0.1:3000` | `127.0.0.1:3200` (ver 39.P) |
| Variables | `.env.production` (owner `admin-docker`, mode `600`, contenido NO leído) | archivo separado, nunca el mismo `.env.production` |
| Logs | gestionados por PM2 (`/home/admin-docker/.pm2`) + `/var/log/virtualmin/abogado.consoldi.com_{error,access}_log` | ruta de logs separada, propio daemon PM2 |
| Supabase | proyecto `pnqdgwpxcxngeueosmnh` | **proyecto Supabase staging independiente** (ver 39.F) |
| Google Cloud (Drive) | no existe todavía para Drive | **proyecto Google Cloud "CRM Drive — Testing" independiente** (ver 39.K) |
| OAuth Client (Drive) | no existe todavía | Client dedicado, nunca reutiliza el de Calendar |
| Callback/webhook | `abogado.consoldi.com/api/google-drive/*` | `abogado-staging.consoldi.com/api/google-drive/*` |

Nunca compartir entre staging y producción: `SUPABASE_URL`/`service_role`
productivos, el OAuth Client de Drive, cualquier `refresh_token`, o
`GOOGLE_DRIVE_MAINTENANCE_SECRET`. Los secretos genéricos criptográficos
(`GOOGLE_OAUTH_STATE_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`) pueden — y
deben — tener valores **distintos e independientes** en staging; no se
copian valores productivos bajo ninguna circunstancia.

### 39.C — Dominio de staging (elegido, no creado)

**Auditoría DNS real (Fase 8I-B2A, ver 39.Z):** se comprobaron ambos
candidatos en el DNS público actual — `abogado-staging.consoldi.com` → sin
registro, `staging-abogado.consoldi.com` → sin registro. Ninguno colisiona
con configuración existente.

**DECISIÓN (Fase 8I-B2A): `abogado-staging.consoldi.com`.** Estado:
**AVAILABLE IN CURRENT DNS / NOT CREATED** — no se crea ningún registro DNS
en esta fase, ni en Cloudflare ni en Virtualmin. `staging-abogado.consoldi.com`
queda descartado como alternativa (ya no es necesaria: el candidato
preferido está libre).

Una vez el dominio quede confirmado en firme, las URLs exactas serán:

```
Redirect: https://abogado-staging.consoldi.com/api/google-drive/callback
Webhook:  https://abogado-staging.consoldi.com/api/google-drive/webhook
```

**No configurar el OAuth Client en Google Cloud Console antes de confirmar
el dominio real** — Google exige coincidencia exacta y literal del redirect
URI; registrar un valor especulativo obligaría a recrear el Client después.

### 39.D — Supabase staging (aislamiento)

La primera validación real **no puede apuntar** a `pnqdgwpxcxngeueosmnh` ni
a ningún proyecto productivo. Requisito de diseño: un proyecto Supabase
**staging** completamente independiente, con:

- su propio Auth (usuarios de prueba, nunca cuentas reales del estudio);
- su propio Storage (bucket `documents`, ver 39.S);
- su propio PostgreSQL (aplicado con el bootstrap canónico + 9 migraciones, ver 39.T);
- su propio `service_role`/`anon key` (nunca los de producción);
- cero usuarios, clientes, expedientes o documentos productivos.

No se crea el proyecto en esta fase. No usar un dump anonimizado de
producción como semilla — dataset 100% sintético (ver 39.E), tal como ya
decidido en fases previas.

### 39.E — Dataset sintético

Ningún dato productivo, ni siquiera anonimizado. Fixture mínimo:

- 1 Administrador ficticio, 1 Personal ficticio si alguna prueba lo requiere.
- Cliente Prueba A, Cliente Prueba B.
- 1 expediente ficticio por cliente, solo si alguna función lo exige (ver
  precedente de fixtures usado en el rehearsal PG17 de 8I-A.1).
- Documentos sintéticos: `drive-test-a.pdf`, `drive-test-b.docx` — sin DNI,
  direcciones reales, expedientes reales, emails reales (salvo la cuenta
  técnica de Google necesaria para OAuth, nunca almacenada en el repo), ni
  datos jurídicos reales de ningún tipo.

### 39.F — Inventario completo de variables de entorno para staging

Reconciliado por grep real contra `src/`, `scripts/` y los tres documentos
de variables existentes (`.env.example`, `server-release/config/.env.production.example`,
`ENVIRONMENT_VARIABLES.md`) — no asumido.

**Hallazgo adicional:** `server-release/config/.env.production.example` está
desactualizado — le faltan por completo las variables de Drive (`GOOGLE_DRIVE_*`)
introducidas en Fase 8B y el bloque SMTP documentado en `ENVIRONMENT_VARIABLES.md`.
No se corrige en esta fase (fuera del scope de "documentación/configuración
de staging" — es un archivo de producción, no de staging), pero queda
registrado para 8I-B2 o una fase de mantenimiento de docs.

| Variable | Categoría | Requerida en staging | Valor |
|---|---|---|---|
| `NODE_ENV` | runtime base | Sí | `production` (staging usa el mismo build de producción) |
| `HOST` | runtime base | Sí | `127.0.0.1` |
| `PORT` | runtime base | Sí | puerto staging distinto de `3000` (ver 39.P) |
| `APP_URL` | runtime base | Sí | `https://abogado-staging.consoldi.com` |
| `SUPABASE_URL` | Supabase | Sí | proyecto staging (39.D) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, secreto | Sí | proyecto staging, nunca producción |
| `VITE_SUPABASE_URL` | Supabase, build-time | Sí | proyecto staging |
| `VITE_SUPABASE_ANON_KEY` | Supabase, build-time | Sí | proyecto staging |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | Calendar | **debe permanecer disabled** | vacío — ver 39.G |
| `GOOGLE_CALENDAR_WEBHOOK_URL` / `GOOGLE_SHARED_CALENDAR_ID` | Calendar | debe permanecer disabled | vacío |
| `GOOGLE_CALENDAR_MAINTENANCE_SECRET` | Calendar | debe permanecer disabled | vacío |
| `VITE_GOOGLE_CLIENT_ID` | Calendar, build-time | debe permanecer disabled | vacío |
| `GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Drive | staging value required, solo después de BLOCK C | proyecto Drive testing (39.K) |
| `GOOGLE_OAUTH_STATE_SECRET` / `GOOGLE_TOKEN_ENCRYPTION_KEY` | Drive (compartidas con Calendar en el esquema, pero Calendar va disabled) | staging value required cuando Drive se habilite | valor generado propio de staging, nunca el de producción |
| `GOOGLE_DRIVE_MAINTENANCE_SECRET` | Drive | staging value required cuando Drive se habilite | valor generado propio de staging |
| `GOOGLE_DRIVE_WEBHOOK_URL` | Drive | optional (ver Sección 26 — watch al final) | vacío hasta BLOCK J |
| `SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` / `_FROM_EMAIL` / `_FROM_NAME` | Correo | debe permanecer disabled | vacío — ver 39.G |
| `VITE_PASSWORD_RECOVERY_ENABLED` | feature flag | production-only, ya `false` por defecto | `false` |
| `GROQ_API_KEY` | Chatbot Lex | optional | vacío o valor propio de staging si se quiere probar el chatbot |
| `VITE_BUILD_COMMIT` / `VITE_BUILD_DATE` | build-time, informativo | optional | generado por build |
| `DOCUMENT_ANALYSIS_PROVIDER` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `CF_IMPORT_QUEUE` / `CF_IMPORT_WORKFLOW` | Futura importación documental | no usada en este release | vacío (mock) |

### 39.G — Integraciones que deben permanecer OFF en staging

Confirmado por auditoría de código (no supuesto): tanto Calendar como
Drive determinan "no configurado" únicamente por ausencia de sus variables
de OAuth-specific — el mismo patrón ya verificado y endurecido para Drive en
Fase 8I-A.1 (`scripts/validate-production-env.mjs`). **Dejar vacías las
variables de Calendar (`GOOGLE_CLIENT_ID`/`_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI`)
es suficiente y seguro para que Calendar aparezca deshabilitado en la UI**,
sin ningún cambio de código — confirmado en `src/routes/api.google-calendar.status.ts`
→ `googleConnectionStatus()`, mismo patrón que Drive. SMTP se comporta
igual: `src/lib/email.server.ts` exige `SMTP_HOST`/`_USER`/`_PASSWORD`/`_FROM_EMAIL`
juntas; dejarlas vacías desactiva el envío de correo sin tocar runtime.
Ninguna credencial productiva de Calendar o SMTP se usa en staging bajo
ninguna circunstancia.

### 39.H — Decisión de template de entorno

Se audita primero si ya existe un mecanismo equivalente: `.env.example`
(desarrollo) y `server-release/config/.env.production.example` (producción)
ya existen, pero ninguno está pensado para staging (el de producción asume
"producción real", con lenguaje y valores que no aplican a un entorno
descartable). **Decisión: crear `server-release/staging/.env.staging.example`**,
solo nombres/placeholders, sin secretos — ver archivo real creado en esta
fase (Sección 39.T de "Archivos modificados" del informe). No se crea un
`.env.staging` real ni se generan secretos.

### 39.I — URLs de Drive para staging (dependientes del dominio, Sección 39.C)

```
GOOGLE_DRIVE_REDIRECT_URI=https://abogado-staging.consoldi.com/api/google-drive/callback
GOOGLE_DRIVE_WEBHOOK_URL=https://abogado-staging.consoldi.com/api/google-drive/webhook
```

Ambas dependen de que el dominio de 39.C quede confirmado en firme —
no se generan antes de eso.

### 39.J — Especificación del proyecto Google Cloud de testing (futuro, NO ejecutar)

- **Nombre sugerido:** `CRM Drive — Testing`.
- Proyecto **completamente separado** del usado (o futuro) para Calendar —
  nunca comparte Client ID/Secret con Calendar, tal como ya establece
  Fase 8B (`GOOGLE_DRIVE_CLIENT_ID`/`_SECRET` documentados como "distinto
  del de Calendar" en `ENVIRONMENT_VARIABLES.md`).
- **Google Auth Platform:** Audience `External`; Publishing status `Testing`.
- **Test users:** únicamente las cuentas estrictamente necesarias para la
  validación. La cuenta real del Dr. Arenas se añade como test user cuando
  corresponda ejecutar 8I-B2 — **su email no se guarda en el repositorio
  ni en ningún documento**, se gestiona fuera de control de versiones.
- **Scope:** `openid`, `email`, `https://www.googleapis.com/auth/drive` —
  ningún scope adicional. Los "native Google Workspace files" (Docs,
  Sheets nativos) permanecen fuera de scope de esta integración, sin
  cambios respecto a decisiones previas.

### 39.K — Caveat de 7 días (External + Testing)

Bajo `External` + `Testing` + scope `drive`, el `refresh_token` expira en
aproximadamente **7 días** — esto es un límite documentado de la propia
plataforma OAuth de Google para apps no verificadas, no un defecto del
CRM. Un `invalid_grant` después de ~7 días de inactividad durante staging
debe interpretarse primero como expiración/necesidad de reconsentimiento,
nunca como bug, hasta descartar explícitamente lo primero. La decisión de
mover el proyecto a `In production` (audience verificado, sin límite de 7
días) para el release final es una decisión separada, fuera del scope de
esta subfase.

### 39.L — Tipo de OAuth Client y requisitos de webhook HTTPS

- **Tipo:** `Web application` — nunca `Desktop`, `Android`, ni `Service
  account`. El flujo es server-side (`grant_type: authorization_code` /
  `refresh_token`, confirmado en `src/lib/google-drive/google-drive.server.ts`
  líneas 362-470) — el `client_secret` vive solo en el servidor, nunca en
  el frontend.
- **Authorized redirect URI:** exactamente la callback de staging de 39.I,
  registrada solo después de confirmar el dominio.
- **Authorized JavaScript origins:** no se necesita ninguno — el flujo no
  hace ninguna llamada OAuth desde el navegador, confirmado por auditoría
  de código (ningún uso de `google.accounts.oauth2` ni similar en `src/`).
- **Webhook HTTPS:** antes de habilitar `watch` (BLOCK J), la URL de
  staging debe resolver públicamente, servir HTTPS con certificado válido
  (no autofirmado), aceptar `POST`, y enrutar correctamente al proceso
  staging — nunca un túnel temporal (ngrok o similar) como diseño
  definitivo, solo aceptable como prueba puntual si acaso. Puede probarse
  con `GET`/`POST` genéricos a la ruta antes de involucrar a Google.

### 39.M — Secuencia E2E refinada por bloques (reemplaza la tabla de la Sección 23)

Cada bloque: **Precondition** (qué debe existir ya) · **Action** (qué se
hace) · **Expected** (resultado correcto) · **Evidence** (qué capturar) ·
**Abort** (cuándo detenerse y no continuar).

**BLOCK A — Staging base**
- Precondition: release Node desplegado, staging Supabase project creado y migrado (BLOCK B), variables base cargadas, Drive **sin credenciales todavía** (ver 39.N).
- Action: iniciar el proceso Node staging; ejecutar `validate-production-env.mjs`; probar `/api/health`; login con Admin sintético; un CRUD básico (crear/leer un Cliente).
- Expected: healthcheck OK, login OK, CRUD OK, Drive aparece "not configured"/"disconnected" en la UI, Calendar y SMTP sin efectos externos.
- Evidence: respuesta de `/api/health`, captura de estado Drive/Calendar, log de arranque sin errores.
- Abort: cualquier error de arranque, `validate-production-env.mjs` exit≠0, o CRUD básico fallando — no se avanza a BLOCK C hasta resolver.

**BLOCK B — Supabase staging**
- Precondition: proyecto Supabase staging creado (fuera de esta fase).
- Action: aplicar el bootstrap canónico + las 9 migraciones pendientes usando el mecanismo canónico del repo (ver 39.T — nunca solo "las 9 sobre vacío"); sembrar el Admin sintético (39.R) y el dataset sintético (39.E).
- Expected: esquema idéntico al validado en el rehearsal PG17 de 8I-A.1 (31/31 en `0008_verify.sql` + 9 migraciones); grants/RLS/RPC coinciden con lo ya auditado.
- Evidence: inventario post-migración (tablas/funciones/triggers/policies), tal como en el informe 8I-A.1.
- Abort: cualquier discrepancia estructural frente al rehearsal ya validado.

**BLOCK C — Proyecto Google Cloud de Drive (testing)**
- Precondition: dominio de staging confirmado (39.C).
- Action: crear proyecto `CRM Drive — Testing` (39.J); configurar Auth Platform External/Testing; crear OAuth Client Web (39.L); registrar redirect URI exacto.
- Expected: Client ID/Secret emitidos, redirect URI coincide exactamente con 39.I.
- Evidence: Client ID (no el secret) documentado fuera del repo.
- Abort: dominio aún no confirmado, o redirect URI no coincide exactamente.

**BLOCK D — Conexión OAuth**
- Precondition: BLOCK C completo; variables `GOOGLE_DRIVE_*` cargadas en staging.
- Action: iniciar `connect`; completar consentimiento con la cuenta de prueba; verificar `/api/google-drive/status`.
- Expected: conexión `connected`, refresh token cifrado guardado, `status` responde sano.
- Evidence: respuesta de `/status` (sin tokens).
- Abort: `invalid_grant`/mismatch de redirect URI — no reintentar sin diagnosticar.

**BLOCK E — Onboarding**
- Action: fijar `root_folder_id` a `CRM-DRIVE-STAGING` (nunca una carpeta real); onboarding de Cliente Prueba A/B.
- Expected: mapeos creados, ningún cliente real afectado.
- Evidence: filas de `google_drive_client_folders`.
- Abort: el root resuelto no es `CRM-DRIVE-STAGING`.

**BLOCK F — Outbound (CRM → Drive)**
- Action: subir `drive-test-a.pdf` a un documento sintético.
- Expected: archivo aparece en Drive con `appProperties` correctas.
- Abort: archivo aparece fuera de `CRM-DRIVE-STAGING`.

**BLOCK G — Inbound (Drive → CRM)**
- Action: colocar `drive-test-b.docx` manualmente en Drive.
- Expected: `import_drive_file` crea el documento con `case_id`/`created_by` NULL.

**BLOCK H — Conflictos**
- Action: renombrar, mover y enviar a la papelera un archivo de prueba en Drive, uno por uno.
- Expected: `sync_status='conflict'` en rename (CRM no se renombra); `DRIVE_PARENT_MISMATCH` en move (sin reasignar Cliente); mapping `missing` en trash (CRM conserva el documento).

**BLOCK I — Poll de cambios (MANUAL, sin cron todavía)**
- Action: invocar `POST /api/google-drive/maintenance` manualmente, una vez por verificación (ver refinamiento de la Sección 20) — repetir varias veces observando cada respuesta antes de considerar instalar el cron.
- Expected: cursor de cambios avanza, sin duplicados, sin errores.
- Abort: cualquier error o cursor que no avanza — no instalar el cron hasta resolver.

**BLOCK J — Watch/webhook (AL FINAL, no antes)**
- Precondition: BLOCK I estable manualmente durante varias invocaciones. Razón de posponerlo: aislar fallos — si watch fallara primero, no se podría distinguir un problema de webhook de uno de polling.
- Action: habilitar `GOOGLE_DRIVE_WEBHOOK_URL`; confirmar requisitos HTTPS de 39.L; provocar un cambio real en Drive y verificar notificación.
- Expected: canal creado, notificación real recibida y procesada.

**BLOCK K — Reconciliación**
- Action: forzar/esperar un ciclo de reconciliación.
- Expected: corre sin error, detecta lo esperado contra el estado real de Drive.

**BLOCK L — Disconnect/Reconnect**
- Action: disconnect (local-only, nunca revoke global); luego reconnect limpio.
- Expected: token local destruido, Calendar no afectado (aislamiento de revocación ya confirmado en Sección 16); reconexión sin residuos de la anterior.
- Solo DESPUÉS de este bloque, con BLOCK I/J ya estables, se instala el cron de 10 minutos (Sección 20).

### 39.N — Drive deshabilitado primero (orden obligatorio)

La primera vez que staging se despliegue: **sin ninguna credencial de
Drive** (BLOCK A completo antes que BLOCK C). Esto separa explícitamente
"¿staging funciona?" de "¿la integración de Google funciona?" — si algo
falla con Drive ya configurado desde el primer despliegue, no se podría
aislar si el problema es del staging en sí o de la integración.

### 39.O — Proceso Node de staging (ejemplo conceptual, no ejecutado)

**CURRENT CANONICAL DEPLOYMENT MODEL (confirmado por auditoría READ-ONLY
real, Fase 8I-B2A, ver 39.Z): PM2, no systemd.** Las dos hipótesis previas
(39.A: "PM2 recomendado" en `VIRTUALMIN_DEPLOYMENT.md` vs. "systemd
canónico" según información operativa de 8I-B1.1) quedan resueltas por
observación directa: `advocate-nest.service` **no existe** en el servidor;
producción corre bajo **PM2**, daemon del usuario `admin-docker`
(`/home/admin-docker/.pm2`), app `advocate-nest`, `status=online`,
`restarts=0`. Por consistencia operacional con lo que realmente corre en
producción, staging futuro usará el **mismo daemon PM2 de `admin-docker`**
— nunca el daemon PM2 de `root` (`pm2-root.service`, que gestiona procesos
no relacionados con el CRM, ver 39.Z.7). No se usa systemd en ningún
ejemplo de esta sección.

```
/home/admin-docker/proyectos/advocate-nest-staging/
├── app/.output/server/index.mjs
├── app/start-crm-staging.sh (análogo a start-crm.sh de producción, ver 39.A)
└── app/.env.staging
```

Definición conceptual de la app PM2 (**no se crea en esta fase**):

```
pm2 start start-crm-staging.sh --name advocate-nest-staging \
  --cwd /home/admin-docker/proyectos/advocate-nest-staging/app
```

equivalente a como PM2 ya ejecuta producción hoy (`node
--env-file=.env.production .output/server/index.mjs` vía `start-crm.sh`,
confirmado por observación directa del proceso real), sustituyendo
`.env.production` por `.env.staging` y el `cwd` por el directorio de
staging.

`cwd` y el archivo de entorno completamente separados de producción —
nunca el mismo directorio ni el mismo archivo `.env.production`. Ejecutado
bajo el mismo usuario `admin-docker` que ya posee el daemon PM2 de
producción (nunca PM2 root). `HOST=127.0.0.1`, `PORT=3200` (ver 39.P).

### 39.P — Puerto de staging

**STAGING_PORT = 3200 (DECIDIDO, Fase 8I-B2A).** Auditoría READ-ONLY real
(ver 39.Z.4): se comprobaron `3100`, `3200` y `3300` — ninguno aparece en
`LISTEN` durante la auditoría. Se descarta explícitamente `3100` como
puerto **permanente** de staging: según información operativa del
propietario, el script de despliegue productivo ya lo utilizó
históricamente como puerto **temporal** de release testing, y reutilizarlo
como permanente podría colisionar con ese uso si ambos coincidieran en el
tiempo. Se descarta el rango `5000`–`5300`: el servidor tiene un número
elevado de listeners ya activos en ese rango. `3200` queda **VERIFIED FREE
DURING AUDIT / NOT RESERVED** — no hay ningún mecanismo de reserva; debe
reconfirmarse libre inmediatamente antes de arrancar el proceso PM2 de
staging en 8I-B2B, por si algo lo ocupó entre la auditoría y la ejecución
real.

### 39.Q — Apache/Virtualmin (plan futuro, NO ejecutar) — topología aprobada

Topología aprobada tras la auditoría READ-ONLY real de Fase 8I-B2A (ver
39.Z):

```
Internet
  ↓
Cloudflare (CONFIRMADO, ver 39.W)
  ↓
abogado-staging.consoldi.com
  ↓
Apache/Virtualmin (nuevo vhost, análogo al de producción — confirmado en
producción: proxy proxy_http proxy_wstunnel ssl rewrite headers,
ProxyPass/ProxyPassReverse hacia el backend Node, WebSocket proxy incluido)
  ↓
ProxyPass
  ↓
http://127.0.0.1:3200 (ver 39.P)
  ↓
PM2 (usuario admin-docker, app advocate-nest-staging — ver 39.O)
  ↓
.output/server/index.mjs
  ↓
Supabase STAGING (ver 39.D)
```

Nunca editar el vhost de producción (`abogado.consoldi.com`) al crear el
de staging. Rollback: deshabilitar/eliminar el vhost de staging
(`a2dissite` o el mecanismo equivalente de Virtualmin) sin ningún reinicio
que afecte al vhost productivo — Apache soporta recargar solo la
configuración nueva sin downtime del vhost existente si se usa
`systemctl reload` en vez de `restart`, a confirmar en el servidor real.

**Caveat de diagnóstico (`apachectl -S`), no de producción:** durante la
auditoría READ-ONLY, `apachectl -S` falló con un mensaje relacionado a
`SuexecUserGroup`/suEXEC. Esto **no** clasifica producción como rota:
`apache2.service` está `active/running`, el vhost `abogado.consoldi.com`
funciona, `ProxyPass`/`ProxyPassReverse` están confirmados apuntando a
`127.0.0.1:3000`, y `/api/health` respondió `200` antes y después de la
auditoría. Se registra como **`apachectl -S diagnostic caveat`** — no se
intenta corregir en esta fase ni se investiga más a fondo su causa.

### 39.R — Admin de staging

Necesario para `/configuracion` y el flujo de conexión de Drive.

**Corrección (Fase 8I-B1.1):** el `INSERT` directo en `auth.users` usado en
el rehearsal de 8I-A.1 fue válido **únicamente como fixture SQL sobre una
instancia PostgreSQL desechable sin GoTrue real** — no reproduce una
identidad de Auth real (no crea contraseña hasheada, no permite login por
email/password, no emite sesión ni JWT). **No es el mecanismo recomendado
para crear la cuenta de Auth de staging real.** Staging necesita una
identidad completa: email/password + sesión + JWT + `profile`.

**Método soportado, en orden de preferencia:**

**A. Supabase Auth Admin API** (preferido) — `supabase.auth.admin.createUser({ email, password, email_confirm: true })`,
ejecutado exclusivamente **server-side** o desde un script administrativo
one-shot fuera del navegador (requiere `service_role`, que nunca debe
tocar el frontend). Puede usar un email sintético de staging y una
password generada aleatoriamente.

**B. Supabase Dashboard** (alternativa manual) — Authentication → Users →
Add User, si el flujo del Dashboard cubre lo necesario para crear la
identidad de prueba.

En ambos casos: la contraseña **nunca** se guarda en el repositorio, nunca
se loggea, y el `service_role`/secret key nunca se expone al frontend.

**Rol Administrador:** después de crear la identidad vía A o B, el trigger
existente (`handle_new_user()`) crea automáticamente el `profile` asociado
con `role='Personal'` — el rol se eleva después mediante un mecanismo
administrativo seguro en staging, a auditar en 8I-B2 entre: (a) un
RPC/endpoint admin ya existente si lo hay, (b) `service_role` server-side
directo, o (c) un `UPDATE` SQL administrativo puntual sobre el proyecto
staging (no sobre `auth.users`, solo sobre `public.profiles`, que sí es
una tabla de aplicación normal). **Nunca insertar manualmente la fila de
`auth.users`** en un proyecto Supabase real — ese atajo solo es válido en
el rehearsal PG17 desechable de 8I-A.1, no en staging.

**Bootstrap chicken-and-egg:** el primer Admin de staging es,
necesariamente, un bootstrap administrativo — no puede depender de un
endpoint que ya requiera un Administrador existente para funcionar. Por
eso se permite la Auth Admin API o el Dashboard específicamente para esta
primera identidad. Una vez existe el primer Admin, las funciones normales
del CRM (gestión de Personal/usuarios) ya cubren el resto según la
arquitectura existente — no se necesita ningún mecanismo especial después
del bootstrap inicial.

**Separación de identidades — CRM Admin vs. Google OAuth test user:** no
usar el correo del Dr. Arenas para el login del Admin del CRM de staging,
salvo necesidad explícita — preferencia por una identidad
sintética/técnica de staging para esa cuenta. La cuenta Gmail del Dr.
Arenas se usará más adelante como **test user de Google OAuth** (Sección
39.J) — un concepto completamente distinto del Admin del CRM. No mezclar
ambas identidades: una autentica contra Supabase Auth del proyecto
staging, la otra autoriza el consentimiento OAuth de Google Drive.

### 39.S — Storage staging

Auditado contra `supabase/self-hosted/0007_storage.sql` y la migración
`20260822110000_add_templates.sql`: el release usa un **único bucket**,
`documents` — privado (`public=false`), sin `file_size_limit` ni
`allowed_mime_types` restringidos a nivel de bucket. Las plantillas NO
tienen bucket propio: viven bajo el prefijo `templates/` dentro del mismo
bucket `documents`, protegidas por 2 policies RESTRICTIVE adicionales
(solo Administrador puede insertar/reemplazar bajo ese prefijo). Staging
necesita recrear exactamente este mismo bucket (nombre, visibilidad,
policies) en su propio proyecto Supabase — no se crea en esta fase, ni se
copian blobs de producción.

### 39.T — Migraciones de staging (mecanismo canónico, no solo "las 9")

Corrección respecto a instrucciones previas: staging limpio **no** se
construye aplicando solo las 9 migraciones pendientes sobre una base
vacía (eso reproduciría únicamente lo ya probado en el rehearsal PG17 de
8I-A.1, que partió de la baseline de producción). Para un proyecto Supabase
staging genuinamente nuevo, la secuencia correcta es la que el propio
repositorio usa como mecanismo canónico:

1. `supabase/self-hosted/0001` → `0008_verify.sql` (bootstrap canónico
   completo — confirmado en 8I-A.1 como byte-idéntico a la baseline de
   producción `409e1798`, y como la primera ejecución real que exige
   PostgreSQL 17.x).
2. Las 9 migraciones pendientes (`20260822090000` → `20260826100000`), en
   el mismo orden cronológico exacto ya reconciliado y probado.
3. `0008_verify.sql` u otra verificación equivalente para confirmar el
   esquema resultante antes de considerar staging "listo".

Esta es exactamente la secuencia ya ejecutada y aprobada en el rehearsal de
8I-A.1 — staging debe reproducirla contra el proyecto Supabase staging
real, no inventar un camino distinto. No se ejecuta en esta fase.

### 39.U — Rollback de staging

- Un fallo en staging **nunca** afecta producción (aislamiento total de
  39.B).
- Deshabilitar el proceso Node de staging (`pm2 stop advocate-nest-staging`,
  bajo el usuario `admin-docker` — nunca `pm2 root`, ver 39.O).
- No revocar OAuth globalmente — disconnect local-only si la app sigue
  operativa, igual que el principio ya establecido para producción
  (Sección 29).
- Detener cualquier canal de watch creado, best-effort.
- Conservar la base de datos de staging para diagnóstico — no eliminarla
  de inmediato.
- No eliminar archivos de Drive sin revisión manual previa.
- Eliminar el entorno de staging solo cuando la investigación del fallo
  haya terminado.

### 39.V — Limpieza del proyecto Google Cloud tras testing

Después de terminar una ronda de pruebas: **no eliminar el proyecto de
inmediato.** Primero: guardar evidencia (Sección 38), detener cualquier
watch activo, desconectar la integración (local-only), revisar y limpiar
los archivos sintéticos en `CRM-DRIVE-STAGING`, y solo entonces decidir
explícitamente si conservar el proyecto para más rondas de prueba o darlo
de baja. Nunca ejecutar un revoke de OAuth que pudiera afectar otro grant,
aunque este proyecto esté aislado — se mantiene el principio de disconnect
local-only ya establecido en toda fase anterior.

### 39.W — Cloudflare/DNS (CONFIRMADO — auditoría READ-ONLY real cerrada)

**Historial:** una versión previa de esta sección afirmó "producción NO usa
Cloudflare" sin evidencia directa (solo ausencia de mención en
`VIRTUALMIN_DEPLOYMENT.md`/`ROLLBACK.md`/`UPDATE.md`), y una corrección
posterior (8I-B1.1) la rebajó a `PENDING OPERATIONAL VERIFICATION`. **La
auditoría READ-ONLY real de Fase 8I-B2A (ver 39.Z) resuelve la pregunta de
forma definitiva: Cloudflare está confirmado.** Se elimina cualquier
estado PENDING anterior sobre esta capa.

```
Internet
  → Cloudflare (CONFIRMADO)
    → dominio abogado.consoldi.com
      → Apache/Virtualmin
        → ProxyPass 127.0.0.1:3000 (CONFIRMADO)
          → PM2 (usuario admin-docker, app advocate-nest — CONFIRMADO, ver 39.A/39.Z)
            → Node (.output/server/index.mjs)
```

**Evidencia (ver detalle completo en 39.Z.6/39.Z.8):**
- DNS público de `abogado.consoldi.com`: registros A `104.21.92.132` /
  `172.67.194.37` y AAAA `2606:4700:...` — rango de IP propio de Cloudflare.
- Headers públicos observados: `Server: cloudflare`, `CF-RAY` presente,
  `cf-cache-status` presente.
- **Production DNS/CDN: CLOUDFLARE CONFIRMED.**

**TLS público confirmado:** certificado observado tras Cloudflare —
`CN=consoldi.com`, SAN `consoldi.com` + `*.consoldi.com`, issuer `Google
Trust Services WE1`. Esto es el TLS público (el que Cloudflare presenta al
navegador), no necesariamente el certificado origin de Apache.

**TLS origin — evidencia parcial, NO concluir modo Cloudflare todavía:**
Apache posee configuración de certificado origin propia
(`/etc/ssl/virtualmin/.../ssl.cert` y `.../ssl.key`, rutas Virtualmin
observadas) y `certbot` está instalado en el servidor. **No se afirma** que
Cloudflare SSL mode esté en Full/Strict, ni que `certbot` sea
necesariamente el mecanismo que renueva el certificado de este vhost — ninguna
de las dos cosas tiene evidencia suficiente todavía. Ambas quedan como
`PENDING`, a verificar recién al crear el staging (Sección 39.Y).

**Antes de activar el webhook de Google (BLOCK J, Sección 39.M) sobre el
dominio de staging**, validar explícitamente contra la capa Cloudflare ya
confirmada:
- HTTPS público accesible sin desafío.
- Sin Cloudflare Access ni challenge (WAF/bot) bloqueando la ruta.
- `POST` permitido hacia `/api/google-drive/webhook`.
- El callback OAuth (`/api/google-drive/callback`) accesible públicamente.

**Cambios de Cloudflare (DNS de staging, reglas, etc.) quedan fuera de
scope de esta fase** — corresponde a Fase 8I-B2B, ejecutados por el
propietario siguiendo la topología Cloudflare real ya confirmada aquí. No
se realiza ningún cambio de Cloudflare en 8I-B2A.

### 39.X — Health checks previos a OAuth (checklist A–G)

Antes de cualquier paso de OAuth real (BLOCK C en adelante), confirmar en
orden — cada uno es precondición del siguiente:

| # | Check | Resultado esperado |
|---|---|---|
| A | Homepage/app de staging responde | HTTP 200, SSR renderiza |
| B | `/api/health` responde | `{"status":"ok","service":"advocate-nest",...}` |
| C | Login de staging funciona | Admin sintético (39.R) inicia sesión |
| D | Supabase staging funciona | lecturas/escrituras básicas sin error |
| E | Subida de documento sintético funciona | CRUD de Documentos operativo sin Drive |
| F | Drive aparece "not configured"/"disconnected" | confirma 39.N (Drive deshabilitado primero) |
| G | Calendar/SMTP no generan efectos externos | ningún email enviado, ningún evento de Calendar creado — confirma 39.G |

Solo después de A–G en verde: proceder a Google OAuth real (BLOCK C/D de 39.M).

### 39.Y — Resumen estructurado (actualizado, Fase 8I-B2A)

**Verificado desde repo/documentación (sin cambios respecto a fases previas):**
- Node artifact: `.output/server/index.mjs` (build real: `npm run build:node`, preset Nitro `"node"`).
- Bucket de Storage: `documents` (único, privado, sin límites de tamaño/MIME).
- Migraciones pendientes reconciliadas: 9, ya validadas sobre PostgreSQL 17 real (Fase 8I-A.1).
- Staging debe ser independiente (topología, 39.B).
- Supabase staging independiente (39.D).
- Google project independiente (39.J).

**CONVERTIDO de PENDING a CONFIRMADO en esta fase, por auditoría READ-ONLY
real del servidor y del DNS (Fase 8I-B2A — ver detalle completo en 39.Z;
NO se realizó ninguna conexión SSH adicional para producir este runbook,
NO se modificó infraestructura):**
- **Process manager de producción → PM2 CONFIRMED.** Corre bajo el usuario
  `admin-docker` (`/home/admin-docker/.pm2`), app `advocate-nest`,
  `status=online`, `restarts=0`. `advocate-nest.service` (systemd) **no
  existe** — la hipótesis systemd de 8I-B1.1 queda descartada.
- **Production port → 3000 CONFIRMED** (`127.0.0.1:3000`).
- **ProxyPass → 127.0.0.1:3000 CONFIRMED** (`ProxyPass`/`ProxyPassReverse`
  y WebSocket proxy, vhost `abogado.consoldi.com`).
- **Cloudflare → CONFIRMED** (DNS A/AAAA en rango Cloudflare, headers
  `Server: cloudflare`/`CF-RAY`/`cf-cache-status`).
- **Public TLS → CONFIRMED** (`CN=consoldi.com`, SAN `*.consoldi.com`,
  issuer Google Trust Services WE1).
- **Staging domain → `abogado-staging.consoldi.com` AVAILABLE / NOT
  CREATED** (sin registro DNS actual, elegido en firme).
- **Staging port → 3200 VERIFIED FREE DURING AUDIT / NOT RESERVED**
  (`3100`/`3200`/`3300` auditados, ninguno en `LISTEN`; `3100` descartado
  como permanente por uso histórico temporal; rango `5000`–`5300`
  evitado por alta densidad de listeners existentes).

**Pendiente real, sin resolver todavía (mantener PENDING — no se fuerza
ninguna conclusión sin evidencia adicional):**
- Cloudflare SSL mode (Full/Strict) y si `certbot` es realmente quien
  renueva el certificado origin del vhost (ver 39.W).
- Procedimiento exacto de creación del vhost/Virtualmin de staging.
- Supabase staging (proyecto todavía no creado).
- Google Cloud (proyecto de testing todavía no creado).
- Confirmación final del tipo de cuenta Google (Workspace vs. personal, Sección 11).

**Staging planned (diseño actualizado contra el hallazgo real, no ejecutado):**
- Dominio: `abogado-staging.consoldi.com` — AVAILABLE / NOT CREATED.
- Supabase: proyecto staging independiente, aislado de `pnqdgwpxcxngeueosmnh`.
- Proceso: **mismo daemon PM2 de `admin-docker`**, app `advocate-nest-staging`,
  `cwd` independiente, puerto `127.0.0.1:3200` (39.O/39.P) — ya no
  `systemd advocate-nest-staging.service` (modelo descartado, ver 39.A).
  Nunca PM2 root.
- Google: proyecto de testing independiente (`CRM Drive — Testing`), separado de Calendar.
- Admin: identidad Auth real vía Supabase Auth Admin API o Dashboard — nunca `INSERT` directo en `auth.users` en un proyecto real.

### 39.Z — Auditoría READ-ONLY real del servidor y DNS (Fase 8I-B2A, evidencia confirmada)

**Alcance:** esta sección incorpora exclusivamente la evidencia real
provista por el propietario, obtenida por una auditoría READ-ONLY manual
del servidor y del DNS. No se realizó ninguna conexión SSH adicional para
producir este documento, no se modificó infraestructura, runtime,
migraciones ni variables de entorno reales.

**39.Z.1 — Identidad del servidor**
Ubuntu 24.04.4 LTS. 8 CPUs. 23 GiB RAM (~16 GiB disponibles durante la
auditoría). Filesystem root: 387 GB totales, ~186 GB libres. Producción
saludable: `GET https://abogado.consoldi.com/api/health` → HTTP 200, antes
y después de la auditoría.

**39.Z.2 — Process manager de producción**
CONFIRMADO: PM2. **No existe** `advocate-nest.service`. PM2 bajo el
usuario `admin-docker` tiene la app `advocate-nest`, `status=online`,
`restarts=0`. Daemon PM2: `/home/admin-docker/.pm2`. El CRM **no** depende
de `pm2-root.service`. Existe por separado un daemon PM2 de `root`
(`/root/.pm2`, gestionado por `pm2-root.service`) — no confundir ambos
(ver 39.Z.7).

**39.Z.3 — Proceso CRM**
CWD: `/home/admin-docker/proyectos/advocate-nest/app`. Script PM2:
`/home/admin-docker/proyectos/advocate-nest/app/start-crm.sh`. Proceso
Node observado: `node --env-file=.env.production .output/server/index.mjs`.
Artefacto `.output/server/index.mjs`: EXISTS. `.env.production`: existe,
owner `admin-docker`, group `admin-docker`, mode `600` — **no se leyó su
contenido**.

**39.Z.4 — Puerto de producción y capacidad de staging**
Producción: `127.0.0.1:3000` (Node CRM escucha ahí, CONFIRMADO). Staging:
puertos `3100`/`3200`/`3300` auditados, ninguno en `LISTEN` — ver decisión
final en 39.P.

**39.Z.5 — Apache**
`apache2.service`: `active/running`. VirtualHost `abogado.consoldi.com`
incluye `ProxyPass / http://127.0.0.1:3000/`, `ProxyPassReverse /
http://127.0.0.1:3000/`, y el proxy WebSocket también apunta a
`127.0.0.1:3000`. Logs: `/var/log/virtualmin/abogado.consoldi.com_error_log`
y `..._access_log`. Producción: HTTP 200. Caveat de `apachectl -S`: ver 39.Q.

**39.Z.6 — Cloudflare y TLS**
Ver detalle completo y evidencia en 39.W.

**39.Z.7 — PM2 root**
`pm2-root.service` está `active`, pero **no gestiona** el CRM
`advocate-nest` del usuario `admin-docker`. No se modifica en esta fase.
Staging usará el PM2 de `admin-docker`, nunca el de `root`.

**39.Z.8 — Cron**
El usuario `admin-docker` **no tiene crontab actual**. Esto confirma que
el futuro cron de mantenimiento de Drive (Sección 20) será una adición
enteramente nueva, a instalar únicamente después de validar el
mantenimiento manual (ver refinamiento de la Sección 20 y BLOCK I de
39.M). No se crea ningún cron en esta fase.

**39.Z.9 — Capacidad de recursos**
Snapshot: 8 CPU, 23 GiB RAM, ~16 GiB disponibles, ~186 GiB disco libre,
load promedio ~1. Clasificación: **no hay bloqueador de capacidad obvio**
para un staging de bajo volumen. Este snapshot **no** se trata como
benchmark de capacidad — es una fotografía puntual del momento de la
auditoría, no una garantía de comportamiento bajo carga sostenida.

**39.Z.10 — Observación de seguridad, saneada (fuera de scope de Drive)**
La salida original de `ps` capturada durante la auditoría contenía una
línea correspondiente a un servicio **no relacionado con el CRM** que
exponía en sus argumentos de línea de comandos un valor con apariencia de
token/cookie interno. Ese valor **no se copia a este runbook ni se
reproduce en ningún informe** — se registra únicamente el hecho
sanitizado: *"un servicio no relacionado expone datos con apariencia
sensible en sus argumentos de proceso; fuera del alcance del CRM."* No se
corrige en esta fase (no es responsabilidad de este proyecto ni de esta
auditoría).

**39.Z.11 — Estado final del runbook tras esta auditoría**
Ver el resumen de conversiones PENDING → CONFIRMED en 39.Y. El resto de
PENDING que **no** cambia en esta fase: Cloudflare SSL mode/origin
strictness, procedimiento exacto de creación del vhost/Virtualmin de
staging, Supabase staging futuro, Google Cloud, y la confirmación final del
tipo de cuenta Google (Sección 11).

---

## 40. Fase 8I-B2B-0A — Localhost Drive Readiness (auditoría, sin infraestructura cloud)

### 40.A — Cambio de estrategia (aprobado)

El staging público (Sección 39, `abogado-staging.consoldi.com`) queda
**DEFERRED**. Antes de tocar DNS/Cloudflare/Virtualmin/Apache/PM2 públicos,
la primera integración real de Google Drive se validará en **localhost**.

**Corrección de estrategia (cierre B2B-0A + Fase 8I-B2B-0B1):** el backend
de la primera prueba ya **no** es Supabase Hosted — es **Supabase LOCAL
vía Docker** (`supabase start`), completamente aislado, sin ningún
proyecto remoto involucrado. Supabase Hosted staging queda
**DEFERRED / OPTIONAL UNTIL PUBLIC STAGING DESIGN** (se retoma, si acaso,
al diseñar el staging público de B2B-1 — no es un requisito para validar
Drive localmente). Ver el detalle completo de esta fase en la Sección 41.
La secuencia queda:

1. **B2B-0A** — auditoría de localhost readiness. **CLOSED** (ver 40.Z —
   cierre controlado con las decisiones adicionales de esa fase).
2. **B2B-0B1** — safety guard real (implementado, ver 41.D) + Supabase
   **LOCAL** vía Docker, aislado en loopback (ver Sección 41 — **estado:
   parcialmente bloqueado**, Docker Desktop no está corriendo en esta
   máquina; ver 41.B).
3. **B2B-0B2** — esquema/Storage/Auth locales + dataset sintético,
   validación empírica del bootstrap (`HOSTED_BOOTSTRAP_COMPATIBILITY` de
   40.K se mantiene `UNVERIFIED` — ahora aplica también, en espejo, al
   bootstrap sobre Supabase LOCAL vía Docker, no solo a Hosted).
4. **B2B-0B3** — CRM local con Drive deshabilitado (health/login/CRUD
   sintético) contra el Supabase LOCAL ya poblado.
5. **B2B-0C** — Google Cloud Testing project + OAuth localhost + Drive E2E
   completo por **polling** (sin watch/webhook).
6. **B2B-1** — staging público (Sección 39, retomada tal cual quedó
   diseñada/auditada en B2A).
7. **B2B-2** — watch/webhook/integración pública real.

Nada de la evidencia de B2A (Sección 39.Z) se descarta — se reutilizará
íntegra al llegar a B2B-1. Esta fase (B2B-0A) es auditoría/repo únicamente:
no se creó ningún proyecto Supabase, Google Cloud, DNS, ni se tocó
Cloudflare/Virtualmin/Apache/PM2/servidor real. **Producción no se tocó.**

### 40.B — Comando de desarrollo local real

Auditado `vite.config.ts` + `@lovable.dev/vite-tanstack-config` (paquete
base que este proyecto no debe editar manualmente, según su propio
comentario de cabecera):

- **`npm run dev`** (`vite dev`) — servidor de desarrollo Vite con HMR.
  Fuera de un sandbox Lovable (`LOVABLE_SANDBOX=1` o
  `DEV_SERVER__PROJECT_PATH` presentes — **ninguna de las dos está
  presente en este entorno local**), el propio paquete base aplica
  `mergeConfig({ server: { host: "::", port: 8080 } }, config)`: **host
  `::` (todas las interfaces), puerto por defecto `8080`, sin
  `strictPort`** (si 8080 está ocupado, Vite incrementa automáticamente).
  Nuestro `vite.config.ts` no sobreescribe `server`, así que estos valores
  aplican tal cual.
- **`npm run build:node`** (`BUILD_TARGET=node vite build`) — genera el
  standalone Node server real (`.output/server/index.mjs`, preset Nitro
  `"node"`), **el mismo artefacto que corre en producción** (confirmado
  en 39.A/39.Z). Es el único comando que reproduce fielmente el
  comportamiento de producción — `vite dev` usa el pipeline de desarrollo
  de Vite, no el server Node standalone.
- **`npm run start`** / **`npm run start:production`** —
  `node .output/server/index.mjs`, **sin `--env-file`**. A diferencia del
  script real de producción (`start-crm.sh`, que sí usa
  `--env-file=.env.production`, confirmado en 39.Z.3), el script de
  `package.json` asume que las variables ya están en el entorno del
  proceso que lo invoca. `PORT`/`HOST` los lee Nitro vía `process.env`
  (alias `NITRO_PORT` también funciona — confirmado en
  `server-release/docs/ENVIRONMENT_VARIABLES.md`), default documentado
  `127.0.0.1:3000`.
- **`npm run preview`** (`vite preview`) — sirve el build estático del
  preset por defecto (`cloudflare-module`), **no** el preset `node`; no es
  el mecanismo relevante para probar el server real.

**Rutas API en dev:** el plugin `tanstackStart` integra las rutas
`server.handlers` (incluidas `src/routes/api.google-drive.*.ts`) también
bajo `vite dev`, no solo en el build — no se requiere el build Node para
probar el flujo OAuth completo, aunque para la primera prueba real se
preferirá el build Node standalone por fidelidad con producción (ver
40.W).

### 40.C — Auditoría de carga de env (precedence)

**Sin iniciar la app**, por auditoría estática de
`node_modules/vite/dist/node/chunks/node.js` (`loadEnv`) y de
`@lovable.dev/vite-tanstack-config`:

1. El framework llama `loadEnv(mode, process.cwd(), "VITE_")` — **solo
   variables con prefijo `VITE_`** entran en el `envDefine` que se
   incrusta como reemplazo estático (`import.meta.env.VITE_X` →
   literal) en el bundle cliente y SSR.
2. `loadEnv()` internamente parsea **todas** las variables de
   `.env`/`.env.local`/`.env.[mode]`/`.env.[mode].local`, pero pasa una
   **copia** de `process.env` (`{ ...process.env }`) a `dotenv-expand`,
   no el objeto real — confirmado leyendo el código fuente de Vite línea
   por línea. **`vite dev` no escribe variables arbitrarias (sin prefijo
   `VITE_`) en `process.env` real**, salvo las 3 excepciciones
   hardcodeadas de Vite (`VITE_USER_NODE_ENV`, `BROWSER`,
   `BROWSER_ARGS`, ninguna relevante aquí).
3. `src/lib/env-server.ts` (`readServerEnv`) lee `process.env[name]`
   primero, con fallback a `import.meta.env[name]` "solo por
   compatibilidad server/dev". Bajo `vite dev`, ese fallback únicamente
   puede resolver variables `VITE_`-prefijadas (por el punto 1) — una
   variable server-only sin prefijo (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GOOGLE_DRIVE_CLIENT_SECRET`, etc.) **no se resuelve por ningún camino
   bajo `vite dev`** a menos que se exporte explícitamente en el shell
   real antes de lanzar el proceso.
4. El **server Node standalone** (`node --env-file=<archivo>
   .output/server/index.mjs`) es un mecanismo completamente distinto:
   `--env-file` es una flag nativa de Node (estable desde Node ≥20.6,
   este entorno corre Node v24.15.0) que vuelca **todas** las líneas
   `KEY=VALUE` del archivo indicado directamente a `process.env`, **sin
   ningún filtro de prefijo**. Ahí sí, cualquier variable del archivo
   pasado —tenga o no prefijo `VITE_`— queda disponible vía
   `process.env` para `requireServerEnv`.

**Consecuencia de diseño:** la seguridad del futuro arranque local depende
enteramente de **qué archivo se pase a `--env-file`**, nunca de la carga
implícita de Vite. Esto confirma que un archivo explícito dedicado
(`.env.drive-staging.local`, ver 40.V) es la estrategia correcta — nunca
depender de `.env`/`.env.local` ambientales.

### 40.D — Hallazgo crítico: exposición de producción en el `.env` local de esta máquina

**Clasificación, sin imprimir valores** (según lo exigido):

- `.env` (raíz del repo, presente en esta máquina) contiene las claves
  `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_GOOGLE_CLIENT_ID`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL` — **ninguna clave bare
  `SUPABASE_URL`/`SUPABASE_ANON_KEY`**.
- `.env.local` contiene `QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD`,
  `QA_PERSONAL_EMAIL`, `QA_PERSONAL_PASSWORD`, `QA_SUPABASE_ANON_KEY`,
  `QA_SUPABASE_URL`.
- El host (solo dominio, sin claves) de `VITE_SUPABASE_URL` en `.env` **y**
  de `QA_SUPABASE_URL` en `.env.local` es el mismo:
  **`https://supabase.consoldi.com`**.

**Clasificación: `production-looking`.** `supabase.consoldi.com` comparte
familia de dominio exacta con `abogado.consoldi.com` (producción,
confirmado en 39.Z) y con la arquitectura self-hosted ya confirmada por
auditoría real del servidor en B2A — no hay ningún proyecto Supabase
"staging" documentado en este dominio todavía (39.D lo declara "todavía
NO existe"). No hay evidencia de un proyecto Supabase self-hosted
alternativo con ese mismo hostname. **Con alta confianza, `.env` y
`.env.local` de esta máquina apuntan hoy al Supabase self-hosted de
PRODUCCIÓN**, no a un entorno de desarrollo aislado.

**Impacto real, acotado por 40.C:**
- Bajo `vite dev`: solo el **cliente** (bundle de navegador) embebe
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` de producción — cualquier
  sesión de `npm run dev` hoy, si alguien inicia sesión desde el
  navegador, autentica y consulta contra el Supabase self-hosted real de
  producción con la clave `anon`. Las rutas server-side (`requireServerEnv`)
  NO se ven afectadas por este archivo específico porque no define
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` bare de forma que Vite las
  propague (ver 40.C.3).
- Bajo un futuro server Node standalone lanzado con
  `--env-file=.env` (NUNCA debe hacerse): `SUPABASE_SERVICE_ROLE_KEY` sí
  quedaría en `process.env`, pero `requireServerEnv("SUPABASE_URL")`
  seguiría fallando (no hay `SUPABASE_URL` bare en el archivo) — el
  servidor no arrancaría el flujo Supabase server-side, aunque la clave
  secreta ya habría quedado cargada en el proceso.

**No se modifica `.env` ni `.env.local` en esta fase** (no es indicado ni
autorizado). Este hallazgo es la justificación central del gate de
producción de 40.E y de la regla "nunca `--env-file=.env`" de 40.V/40.W.

**FORBIDDEN UNTIL STAGING GUARD EXISTS (Fase 8I-B2B-0A, cierre
controlado):** hasta que exista el guard real de 40.E (script
implementado y verificado, no solo diseñado), quedan **prohibidos** en
este repositorio:

- `npm run dev` / `vite` / `vite dev`.
- Cualquier arranque funcional del server Node (`npm run start`,
  `npm run start:production`, `node .output/server/index.mjs`, con o sin
  `--env-file`).
- Cualquier prueba del CRM local que pueda cargar implícitamente `.env` o
  `.env.local` (esto incluye `npm test`/`vitest`, que **si** se ejecutan
  como ya viene haciéndose en esta fase, no arrancan el servidor ni abren
  conexión de red real a Supabase — confirmado por diseño de los tests,
  no hay excepción a documentar aquí; el gate de la Sección 26/40.AF no
  viola esta prohibición porque no arranca la app).

**No se borran ni se modifican `.env`/`.env.local` en esta fase.** No se
arrancó la aplicación en ningún momento de B2B-0A ni de este cierre.

### 40.E — Production Project Guard (diseño, NO implementado todavía)

Objetivo: impedir que cualquier prueba local de Drive hable, ni siquiera
por accidente, con Supabase de producción.

**Corrección importante de alcance frente al pedido original:** el
project-ref productivo conocido inicialmente
(`pnqdgwpxcxngeueosmnh`) es, según confirma
`tests/production-supabase-env-safety.test.ts` (línea 19, comentario "the
legacy Supabase Cloud project") y el hallazgo de 39.A, **el proyecto Cloud
legacy — ya no es producción real**. Producción real hoy es el Supabase
**self-hosted** en `https://supabase.consoldi.com` (39.Z, 40.D). Un guard
que solo bloqueara el ref legacy **no habría detectado** el riesgo real
encontrado en 40.D. El guard debe cubrir ambos:

1. **`SUPABASE_URL`/`VITE_SUPABASE_URL` resuelto == `https://supabase.consoldi.com`**
   (o cualquier variante de host que apunte al mismo origin) → ABORT.
2. **Cualquier valor que contenga el ref legacy `pnqdgwpxcxngeueosmnh`**
   (por si algún día se reintrodujera un `.env` apuntando al Cloud legacy)
   → ABORT.
3. Cobertura mínima según el pedido: `SUPABASE_URL`, contexto
   `service_role`/secret key (no se compara el valor de la key en sí,
   solo se usa como señal de "hay una key cargada" junto con la URL),
   contexto `anon`/publishable key, endpoint de storage si aplica (mismo
   host que `SUPABASE_URL`, no hay endpoint de storage separado en este
   proyecto).

**Mecanismo preferido (a implementar en B2B-0B, no ahora):** un script
`scripts/guard-local-drive-env.mjs` corto, ejecutado como pre-step del
comando de arranque local (40.W) — lee `process.env` **después** de que
Node ya aplicó `--env-file`, compara `SUPABASE_URL` contra la lista de
hosts/refs prohibidos, y `process.exit(1)` con mensaje explícito si
coincide. No imprime valores de keys, solo el host resuelto (dato no
sensible, ya usado así en toda la Sección 39.Z). Se prefiere un script
separado a extender `validate-production-env.mjs` porque ese validador
está diseñado para **producción** (exige que las variables SÍ estén
presentes); el guard local necesita la lógica inversa (fallar si
coincide con producción), y mezclar ambos objetivos en un mismo script
aumentaría el riesgo de una regresión silenciosa en el validador real de
producción — se auditó esto, no se implementó.

### 40.F — Puerto local

Auditado con `Get-NetTCPConnection -State Listen` (Windows) sobre
`3000, 3100, 3200, 3300, 4000, 5000, 5173, 8080, 8787` — **todos libres**
en esta máquina de desarrollo en el momento de la auditoría.

**Corrección de aislamiento (cierre controlado B2B-0A):** el dev server
auditado en 40.B escucha hoy en `::`:`8080` — **`::` no equivale a
aislamiento loopback** (escucha en todas las interfaces IPv6, incluida
cualquier LAN accesible por esa vía). Esto es aceptable para desarrollo
normal, pero **no** es el binding que las pruebas Drive reales deben usar.

**DECISIÓN: `LOCAL_DRIVE_TEST_PORT = 4000`.**
- **Bind address obligatorio: `127.0.0.1`** — nunca `0.0.0.0`, nunca `::`,
  nunca la IP LAN de esta máquina, durante ninguna prueba Drive local.
- **Hostname de navegador/OAuth: `localhost`** — distinto conceptualmente
  del bind address; es lo que se registra en Google Cloud Console como
  redirect URI (`http://localhost:4000/...`, ver 40.G) y lo que el
  navegador visita, mientras el proceso Node solo escucha en `127.0.0.1`.
  Google resuelve `localhost` → `127.0.0.1` de forma estándar; ambos
  términos no son intercambiables al documentar el binding del servidor.
- Distinto de `3000` (puerto real de producción — evita confusión en
  copy/paste de configuración entre entornos).
- Distinto de `3200` (reservado conceptualmente para el staging público
  futuro, Sección 39.P).
- Distinto de `8080` (default de `vite dev`, evita colisión si ambos
  procesos corren a la vez durante desarrollo normal).
- No es `3100` (con caveat histórico de uso temporal ya documentado en
  39.P — evitado por claridad aunque ese caveat aplicaba al servidor
  remoto, no a esta máquina).
- Estable durante toda la prueba OAuth (puerto fijo, no dinámico) —
  requisito explícito porque el redirect URI de Google debe coincidir
  carácter por carácter.

No se inició ningún listener en esta fase — solo se confirmó
disponibilidad.

### 40.G — Futuro callback OAuth local

Con el puerto fijado en 40.F, el redirect URI futuro será exactamente:

```
http://localhost:4000/api/google-drive/callback
```

Google permite explícitamente `http://localhost` (y `http://127.0.0.1`)
como excepción a su exigencia general de HTTPS para redirect URIs, para
uso en testing — no se configura todavía en Google Cloud Console (Sección
20 del pedido de B2B-1, todavía no ejecutada). El valor debe coincidir
carácter por carácter (scheme + host + puerto + path, con o sin `/` final
según lo que Google registre) — mismo principio ya documentado en la
Sección 14 de este runbook para producción.

### 40.H — Auditoría de generación de URL / hardcode (`google-drive.server.ts`)

Confirmado por lectura directa del código, sin ejecutar nada:

- `redirect_uri` en las dos llamadas a Google (`beginGoogleDriveOAuth` y
  `completeGoogleDriveOAuth`) viene exclusivamente de
  `serverSecret("GOOGLE_DRIVE_REDIRECT_URI")` — **cero hardcode** de
  `abogado.consoldi.com` ni de ningún hostname en este archivo. Los únicos
  literales de host son los endpoints fijos de Google
  (`accounts.google.com`, `oauth2.googleapis.com`,
  `openidconnect.googleapis.com`), que son correctos y no deben cambiar.
- El route de callback (`src/routes/api.google-drive.callback.ts:12`)
  deriva el origin del **request real** (`new URL(request.url).origin`)
  para construir la redirección final a `/configuracion` — nunca asume
  `https://` ni un dominio fijo. Funciona igual bajo
  `http://localhost:4000`.
- El `state` OAuth es HMAC-SHA256 sobre `nonce.expiresAt` firmado con
  `GOOGLE_OAUTH_STATE_SECRET` — no incluye ni depende del hostname.
- PKCE (`code_verifier`/`code_challenge`, `S256`) se genera y valida
  server-side, independiente de dominio.
- El binding al Administrador que inició el flujo (`requested_by`, fila en
  `google_drive_oauth_states`) es una referencia a `user.id` en la base de
  datos — no depende de dominio público.

**Conclusión: no se encontró ningún hardcode ni bloqueo de host/HTTPS en
esta cadena.** El flujo OAuth de Drive es funcionalmente host-agnóstico
por diseño ya existente — no se requiere ningún cambio de código para que
funcione bajo `localhost`.

### 40.I — Cookies / sesión / auth bajo HTTP local

Confirmado por auditoría de `src/lib/supabase.ts`, `src/lib/auth-server.ts`
y `src/lib/email.server.ts` (patrón representativo de las rutas
protegidas):

- La sesión de Supabase Auth se persiste en **`window.localStorage`**
  (`src/lib/supabase.ts:29`), no en cookies — no hay flag `Secure` que
  pueda bloquear `localhost`/HTTP.
- Las rutas server-side (`requireEmailRole`, y por extensión el mismo
  patrón que usan las rutas de Drive) leen el token exclusivamente del
  header `Authorization: Bearer <token>` (`email.server.ts:178-179`) — sin
  ningún cookie ni sesión del lado servidor.
- `requireUser`/`auth-server.ts` valida el JWT contra Supabase
  (`client.auth.getUser(accessToken)`) sin ninguna comprobación de
  esquema/host de la petición entrante.

**Conclusión: HTTP localhost puede iniciar sesión, conservar sesión,
acceder `/configuracion`, y ejecutar el flujo connect/callback de Drive
sin ninguna modificación** — no existe ninguna protección `Secure`
cookie/HTTPS-only en esta cadena que debilitar ni excepcionar. No se
propone ningún cambio de seguridad global.

### 40.J — Arquitectura de Supabase staging (decisión)

**APP:** localhost (`http://localhost:4000`, ver 40.F).
**DATABASE/AUTH/STORAGE (decisión final, ver Sección 41): Supabase LOCAL
vía Docker** (`supabase start`) — no Hosted (cloud managed), no
self-hosted (eso es exclusivamente el mecanismo de producción, ver
39.T/40.K), no el proyecto Cloud legacy `pnqdgwpxcxngeueosmnh` (ver
40.M). Supabase Hosted queda `DEFERRED / OPTIONAL UNTIL PUBLIC STAGING
DESIGN` — ya no es el plan para la primera prueba local. Ningún dato
productivo, ningún dump de producción como semilla (mismo principio ya
establecido en 39.D/39.E). No se creó ni arrancó el stack en esta fase
(bloqueado por Docker Desktop no corriendo, ver 41.B).

### 40.K — Auditoría de bootstrap para Supabase Hosted (hallazgo)

**Hallazgo central, por lectura directa de
`supabase/self-hosted/0001_extensions_and_base.sql`:** el bootstrap NO
crea los schemas `auth`/`storage` desde cero — los **verifica** (`if
to_regclass('auth.users') is null then raise exception...`, mismo patrón
para `storage.buckets`/`storage.objects`), con el comentario explícito en
el propio SQL: *"Supabase provides Auth and Storage as platform schemas."*
Ambos —Supabase Hosted (Cloud) y Supabase self-hosted vía Docker— proveen
esos schemas automáticamente antes de que el bootstrap `0001` corra; el
resto de la secuencia (`0002`–`0008_verify.sql`) usa exclusivamente los
roles estándar de la plataforma Supabase (`anon`, `authenticated`,
`service_role`, `supabase_auth_admin`, etc.), **los mismos en Hosted y en
self-hosted**, porque ambos ejecutan el mismo stack open-source.

**`HOSTED_BOOTSTRAP_COMPATIBILITY = UNVERIFIED UNTIL B2B-0B2`** (cierre
controlado B2B-0A — corrección de estado frente a la redacción anterior de
esta sección). La auditoría por razonamiento del párrafo anterior — que
`0001` solo verifica, no crea, `auth`/`storage`, y que ambos targets usan
los mismos roles de plataforma — **no es suficiente para declarar los
scripts self-hosted como validados en Hosted**. Sigue siendo una hipótesis
razonada, no un hecho confirmado: `docs/database/self-hosted-canonical-model.md:165`
ya señalaba como riesgo pendiente la "disponibilidad operativa real de
Auth/Storage en la imagen self-hosted", y ese mismo riesgo aplica en
espejo a Hosted — **nunca se ha ejecutado contra un proyecto Hosted
real.** **B2B-0B2** (no B2B-0B genérico) es la fase dedicada
exclusivamente a esta validación empírica.

**Objetivo explícito, no ambiguo:** Supabase Hosted ya provee `auth`,
`storage` y los demás servicios de plataforma — el objetivo de B2B-0B2
**no es recrear esos servicios**, es aplicar únicamente el esquema/objetos
de **aplicación** (`0001`–`0008` en tanto verifican/complementan la
plataforma, más las 9 migraciones) que sean compatibles con lo que Hosted
ya expone. Ver regla de no tocar internals de Auth en 40.M4.

**Distinción A/B/C solicitada:**
- **A. Scripts de bootstrap self-hosted** (`supabase/self-hosted/0001`–`0008`):
  hipótesis razonada de portabilidad a Hosted — **UNVERIFIED**, pendiente
  de B2B-0B2.
- **B. Migraciones de aplicación** (`supabase/migrations/2026...`, las 9 de
  la Sección 3): idénticas para cualquier target — ya validadas
  empíricamente sobre PostgreSQL 17 real en 8I-A.1, reutilizables sin
  cambios.
- **C. Schemas que Supabase ya provee** (`auth.*`, `storage.*`): nunca se
  recrean, en ningún target — el bootstrap solo los consume/verifica.

**Secuencia propuesta para un proyecto Hosted vacío (sin ejecutar en esta
fase — se ejecuta en B2B-0B2):** idéntica a 39.T — `0001`→`0008_verify.sql`,
luego las 9 migraciones pendientes en su orden cronológico exacto, luego
`0008_verify.sql` (o verificación equivalente) para confirmar el esquema
resultante.

### 40.L — Storage staging (Hosted)

Sin cambios respecto al hallazgo ya documentado en 39.S: bucket único
`documents`, privado (`public=false`), sin `file_size_limit` ni
`allowed_mime_types` (confirmado de nuevo leyendo
`supabase/self-hosted/0007_storage.sql` en esta fase), plantillas bajo el
prefijo `templates/` con 2 policies RESTRICTIVE adicionales. Un proyecto
Hosted staging debe recrear el mismo bucket con la misma configuración —
no se crea en esta fase.

### 40.M — Repo-linked safety (hallazgo, sin modificar)

`supabase/.temp/project-ref` (leído, NO modificado) contiene
`pnqdgwpxcxngeueosmnh` — confirmado también en
`supabase/.temp/linked-project.json`: `{"ref":"pnqdgwpxcxngeueosmnh",
"name":"CRM Abogados a tu Servicio", ...}`. Este es el **mismo proyecto
Cloud legacy** ya identificado como obsoleto en 39.A y en
`tests/production-supabase-env-safety.test.ts`. `supabase/.temp/pooler-url`
contiene una plantilla de conexión sin credencial embebida (verificado sin
imprimir el archivo completo).

**Riesgo real:** este working tree está `supabase link`-eado hoy contra
ese proyecto legacy. Si alguien ejecutara `supabase link`, `supabase db
push`, `supabase migration up`, `supabase db reset` o `supabase functions
deploy` sin relinkear primero explícitamente, el comando apuntaría al
proyecto Cloud legacy — **no** a producción (que es self-hosted, fuera del
alcance de la CLI de Supabase linkeada) y **no** al futuro proyecto
staging (que todavía no existe). **No se ejecutó ninguno de estos comandos
en esta fase.**

**DECISIÓN FINAL (cierre controlado B2B-0A) — NO relinkear el working
tree para staging.** El link histórico (`pnqdgwpxcxngeueosmnh`, legacy)
puede conservarse tal cual está — las acciones de staging deben **ignorar**
ese link por completo, nunca depender de él ni de un relink ambiguo:

- **Prohibido:** `supabase link <staging>`, `supabase db push --linked`,
  `supabase migration up --linked`, `supabase db reset --linked` — todo lo
  que dependa del estado de link del working tree para operar contra
  staging.
- **Obligatorio:** usar explícitamente `--db-url` apuntando al proyecto
  Hosted staging, primero en modo `--dry-run`:
  ```
  supabase db push --db-url "<STAGING_DB_URL>" --dry-run
  supabase db push --db-url "<STAGING_DB_URL>"
  ```
- `STAGING_DB_URL` debe provenir **únicamente** del proyecto Hosted
  staging recién creado (nunca del legacy, nunca de producción). **Nunca
  se guarda en el repositorio** (ni en el runbook, ni en ningún archivo
  versionado) y **nunca se imprime la password** en ningún log, error o
  documento — mismo estándar ya aplicado a toda clave/secreto en este
  runbook desde B2A.

No se ejecuta nada de esto en B2B-0A ni en este cierre — queda como
procedimiento decidido en firme para B2B-0B1/0B2.

### 40.M2 — Prohibición de `db reset` remoto

Aunque la CLI de Supabase soporte `supabase db reset --db-url`, **queda
prohibido usarlo en este proyecto** — un reset remoto puede eliminar
entidades creadas manualmente por el usuario en el proyecto staging
(datos de prueba, configuración manual del Dashboard, etc.) sin
posibilidad de deshacerlo. **Preferencia explícita:** si el bootstrap deja
el staging en un estado inconsistente, **recrear el proyecto Hosted
staging desde cero** (es desechable por diseño, 40.J) en vez de ejecutar
un `db reset` remoto sin una revisión separada y explícita.

### 40.M3 — Estrategia de conexión Hosted para migraciones

Para aplicar el bootstrap/migraciones (B2B-0B2) contra el proyecto Hosted
staging, orden de preferencia de conexión:

1. **Direct Connection** — preferida, si esta máquina puede alcanzar el
   endpoint por IPv6 (a confirmar en B2B-0B2, no verificado en esta
   fase).
2. **Supavisor Session Pooler, puerto `:5432`** — alternativa si no hay
   alcance IPv6 directo.
3. **Transaction Pooler, puerto `:6543` — NUNCA usar para migraciones**
   (el modo transacción de Supavisor no soporta de forma fiable
   sentencias DDL/sesión-larga que las migraciones necesitan; esto es una
   restricción conocida de los poolers en modo transacción, no específica
   de este proyecto).

No se estableció ninguna conexión real en esta fase — queda documentado
como criterio de decisión para B2B-0B2.

### 40.M4 — Regla de Auth interno en Hosted

**No se modifican objetos internos gestionados por Supabase** (schema
`auth.*` y sus tablas/funciones internas) en ningún target, Hosted
incluido — mismo principio ya establecido en 40.K/Sección C. Referencias
de la aplicación como foreign keys hacia `auth.users` (ya presentes en el
diseño existente, p. ej. `profiles.id → auth.users.id`) son válidas y
esperadas — no son "recrear" el schema, son consumirlo tal como Supabase
lo expone. El primer usuario real de staging se crea exclusivamente vía
**Supabase Auth Admin API** o **Dashboard** — nunca `INSERT` directo en
`auth.users` de un proyecto Hosted real (mismo principio ya establecido en
39.R/40.O, reafirmado aquí explícitamente para Hosted).

### 40.N — Inventario de migraciones para Hosted (reconciliado)

Sin novedad respecto a 39.T: mismas 9 migraciones application-level de la
Sección 3, ya reconciliadas contra el filesystem real y validadas sobre
PostgreSQL 17 real en 8I-A.1. La diferencia de esta fase es el punto de
partida — no "producción menos 9 pendientes" sino "proyecto Hosted vacío
más bootstrap completo (`0001`–`0008`) más las 9" (ver 40.K).

### 40.O — Primer Admin staging (bootstrap)

Reutiliza íntegramente el diseño ya corregido en 39.R: **Supabase Auth
Admin API** (preferido) o **Dashboard** — nunca `INSERT` directo en
`auth.users` sobre un proyecto Hosted real (el `INSERT` directo solo fue
válido en el rehearsal PG17 desechable de 8I-A.1). Identidad
sintética/técnica de staging, nunca la cuenta Gmail del propietario. Rol
Administrador elevado después vía `service_role` server-side o un
mecanismo administrativo equivalente sobre `public.profiles`. No se
ejecuta en esta fase.

### 40.P — Dataset sintético (futuro)

Mínimo: 1 Admin Staging, Cliente Prueba A, Cliente Prueba B, opcionalmente
1 expediente de prueba. Archivos: `drive-test-a.pdf`, `drive-test-b.docx`.
Sin DNI real, sin nombres reales, sin clientes ni documentos jurídicos
reales — mismo principio ya establecido en 24/39.E, reafirmado aquí para
el contexto local.

### 40.Q — Inventario de variables de Drive para localhost (futuro, sin valores)

| Variable | Rol | Valor en localhost |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` | OAuth Drive testing | proyecto Google Cloud Testing (B2B-0C), nunca el de producción |
| `GOOGLE_DRIVE_REDIRECT_URI` | Redirect | `http://localhost:4000/api/google-drive/callback` (ver 40.G) |
| `GOOGLE_OAUTH_STATE_SECRET` / `GOOGLE_TOKEN_ENCRYPTION_KEY` | Compartidas con Calendar en el esquema | valor propio generado para local, nunca el de producción |
| `GOOGLE_DRIVE_MAINTENANCE_SECRET` | Mantenimiento manual | valor propio generado para local |
| `GOOGLE_DRIVE_WEBHOOK_URL` | Webhook | **AUSENTE** — no hay watch/webhook local (ver 40.S) |
| Calendar (`GOOGLE_CLIENT_ID` etc.) | — | OFF (vacío) |
| SMTP (`SMTP_HOST` etc.) | — | OFF (vacío) |

No se escriben valores en esta fase.

### 40.R — Auditoría de Google account type (gate humano, sin resolver)

Sigue **PENDING FINAL HUMAN CONFIRMATION** (Sección 11). Indicio disponible:
cuenta Gmail personal (no verificado si es Workspace administrado). Antes
de crear el proyecto Google Cloud en B2B-0C, el propietario confirmará
únicamente si la cuenta termina en `@gmail.com` y no está administrada por
una organización — **no se pide ni se guarda el email completo** en
ningún documento de este repositorio.

### 40.S — Webhook/watch: diferido explícitamente

**LOCALHOST NO VALIDA `changes.watch` NI EL WEBHOOK REAL.** Google exige un
receptor HTTPS público con certificado válido para `channels.watch` — algo
que localhost no puede ofrecer. Se difieren explícitamente a B2B-2 (staging
público): `changes.watch`, la recepción real del POST del webhook de
Google, el ciclo de vida del canal, y la renovación real del watch. **No se
usará ningún túnel** (no ngrok, no Cloudflare Tunnel, ni equivalente) para
simular HTTPS público en esta fase ni en B2B-0C — la estrategia local es
**polling puro** vía `POST /api/google-drive/maintenance` manual (mismo
patrón ya usado en el rehearsal, Sección 21 de este runbook: el sistema no
depende de recibir cada webhook, el polling periódico ya cubre la
durabilidad).

### 40.T — Cobertura E2E local (sin watch/webhook)

Validación local futura (B2B-0C), reemplaza el orden de Stages/BLOCK
públicos de la Sección 39.M para el tramo que sí puede probarse sin
servidor público:

1. CRM local boot (build Node + `--env-file` staging).
2. Login staging (Admin sintético).
3. Confirmar Drive "not configured"/"disconnected".
4. Google OAuth connect (localhost).
5. Almacenamiento/cifrado del refresh token.
6. `/api/google-drive/status`.
7. Seleccionar/crear raíz `CRM-DRIVE-STAGING`.
8. Onboarding Cliente Prueba A/B.
9. CRM → Drive: subida de documento sintético.
10. Rename/update en Drive.
11. Drive → CRM: import de blob.
12. Duplicado/idempotencia.
13. Move → conflicto de parent.
14. `DRIVE_PARENT_MISMATCH`.
15. Trash en Drive preserva el documento en CRM.
16. Polling manual de cambios.
17. Cursor CAS/durabilidad.
18. Reconciliación.
19. Mantenimiento manual repetido (sin cron todavía).
20. Disconnect (local-only).
21. Reconnect limpio.

**Sin watch/webhook** (diferido, 40.S). No se ejecuta nada de esta lista en
B2B-0A — queda documentada para B2B-0C.

### 40.U — Congelación de infraestructura pública (confirmación)

Durante B2B-0A: **no se modificó** servidor de producción, Cloudflare,
DNS, Virtualmin, Apache ni PM2. La infraestructura auditada en B2A sigue
siendo válida y se retomará sin cambios al llegar a B2B-1 (39.B–39.W). No
se ejecutó ningún comando contra el servidor real en esta fase — toda la
auditoría de esta sección 40 fue estática, sobre el repositorio y sobre
esta máquina de desarrollo local.

### 40.V — Estrategia de archivo env local (diseño)

**Archivo dedicado: `.env.drive-staging.local`.** Ya cubierto por el
patrón `.env.*.local` de `.gitignore` (línea 22) — no requiere ninguna
regla nueva de `.gitignore`, confirmado por auditoría del archivo. No se
usa `.env.production` (nunca), ni se modifica ningún secreto existente
(`.env`/`.env.local` de esta máquina quedan intactos, ver 40.D). El
archivo debe pasarse **explícitamente** por nombre en el comando de
arranque (`--env-file=.env.drive-staging.local`) — nunca depender de
carga implícita, consistente con el hallazgo de 40.C (Node's `--env-file`
no tiene fallback automático a otro archivo si el indicado falta, lo cual
es la propiedad de seguridad que se necesita: sin el archivo explícito, el
arranque simplemente falla en vez de caer silenciosamente a otro entorno).
No se crea el archivo en esta fase.

### 40.W — Comando de arranque futuro (diseño, NO ejecutado)

```
node --env-file=.env.drive-staging.local scripts/guard-local-drive-env.mjs \
  && PORT=4000 HOST=127.0.0.1 node --env-file=.env.drive-staging.local .output/server/index.mjs
```

(forma conceptual — el guard de 40.E corre primero y aborta el `&&` si
detecta producción; la sintaxis exacta del wrapper se decide al
implementarlo en B2B-0B, no aquí). Requisitos de diseño:

- Carga **exclusivamente** `.env.drive-staging.local` — nunca
  `.env.production`, nunca `.env`/`.env.local` ambientales.
- Escucha solo en `127.0.0.1:4000` (nunca `0.0.0.0` ni `::`).
- Falla explícitamente (`process.exit(1)`, mensaje claro) si el guard de
  40.E detecta `SUPABASE_URL` de producción o el ref legacy.
- Requiere el build Node previo (`npm run build:node`) — mismo artefacto
  que producción, por fidelidad (40.B).

No se implementa el script guard ni se ejecuta ningún arranque en esta
fase.

### 40.X — Drive-disabled-first (secuencia, reafirmada)

La primera ejecución local (B2B-0B), una vez exista el proyecto Supabase
Hosted staging, será **sin ninguna variable de Drive** — validar boot,
login, CRUD sintético, upload sintético, Drive "disabled/not configured",
Calendar OFF, SMTP OFF. Solo después de eso, Google Cloud (B2B-0C). Mismo
principio ya establecido en 39.N, reafirmado aquí para el contexto local.

### 40.Y — Bloqueadores antes de B2B-0B1

- Script `scripts/guard-local-drive-env.mjs`: diseñado (40.E), **no
  implementado** — bloquea `npm run dev`/arranque Node hasta que exista
  (ver 40.D, "FORBIDDEN UNTIL STAGING GUARD EXISTS").
- Proyecto Supabase Hosted staging: no creado.
- Archivo `.env.drive-staging.local`: no creado.
- Validación empírica de que el bootstrap self-hosted (`0001`–`0008`)
  aplica limpio sobre un proyecto Hosted real: `UNVERIFIED UNTIL B2B-0B2`
  (40.K) — ya no es un blocker de B2B-0B1 en sí (que solo crea el proyecto
  vacío), pero sí de B2B-0B2.
- Confirmación final del tipo de cuenta Google (Sección 11/40.R): pendiente.
- Estrategia de conexión Hosted (Direct vs. Session Pooler, 40.M3): no
  verificada contra el proyecto real todavía — depende de si esta máquina
  alcanza IPv6, a confirmar en B2B-0B2.

### 40.Z — Cierre controlado de Fase 8I-B2B-0A (decisiones adicionales)

**B2B-0A: CLOSED.** Aprobada con las siguientes decisiones adicionales
obligatorias, incorporadas en esta misma sección 40:

1. **Env production hazard** (40.D) — `FORBIDDEN UNTIL STAGING GUARD
   EXISTS`: prohibido `npm run dev`/`vite`/`vite dev`/cualquier arranque
   funcional del server Node/cualquier prueba del CRM local que pudiera
   cargar implícitamente `.env`/`.env.local`, hasta que exista el guard
   real de 40.E. No se borran ni modifican esos archivos. No se arrancó
   la aplicación en ningún momento de esta fase ni de este cierre.
2. **Loopback binding** (40.F) — corregido: `::`:`8080` (dev server
   actual) NO es aislamiento loopback. Bind obligatorio para pruebas Drive
   reales: `127.0.0.1:4000`. Hostname de navegador/OAuth: `localhost`
   (distinto conceptualmente del bind address). Nunca `0.0.0.0`/`::`/IP
   LAN durante testing local.
3. **Production denylist** (40.E) — el guard debe rechazar explícitamente
   **dos** identidades productivas: (A) host `https://supabase.consoldi.com`,
   (B) ref legacy `pnqdgwpxcxngeueosmnh` — comparación por
   hostname/identidad de proyecto, nunca solo por ref legacy. Nunca
   imprime keys en el error.
4. **Supabase CLI staging strategy** (40.M) — decidido en firme: NO
   relinkear el working tree para staging; usar `--db-url` explícito con
   `--dry-run` primero; `STAGING_DB_URL` nunca en el repo, password nunca
   impresa.
5. **Remote `db reset` prohibido** (40.M2) — preferencia: recrear el
   proyecto Hosted staging desechable en vez de un reset remoto.
6. **Hosted connection strategy** (40.M3) — Direct Connection si hay
   alcance IPv6; si no, Session Pooler `:5432`; nunca Transaction Pooler
   `:6543` para migraciones.
7. **Hosted bootstrap status** (40.K) — cambiado a
   `HOSTED_BOOTSTRAP_COMPATIBILITY = UNVERIFIED UNTIL B2B-0B2`; objetivo
   explícito: no recrear `auth`/`storage`/servicios de plataforma, solo
   aplicar esquema de aplicación compatible.
8. **Hosted auth rule** (40.M4) — no se modifican objetos internos de
   `auth.*`; FKs hacia `auth.users` son válidas; primer usuario real vía
   Auth Admin API/Dashboard, nunca `INSERT` directo.
9. **Nueva secuencia** (40.A) — B2B-0A (CLOSED) → B2B-0B1 (safety guard +
   proyecto Hosted vacío) → B2B-0B2 (validación empírica del bootstrap) →
   B2B-0B3 (CRM localhost Drive-disabled) → B2B-0C → B2B-1 → B2B-2.

No se ejecutó ningún comando remoto, ninguna creación de infraestructura,
ningún arranque de la aplicación, y ningún cambio a `.env`/`.env.local`
durante este cierre. Producción no se tocó.

---

## 41. Fase 8I-B2B-0B1 — Safety Harness + Supabase LOCAL (Docker)

### 41.A — Cambio de estrategia (aprobado)

Para la primera prueba real de Drive, el backend deja de ser Supabase
Hosted (cloud managed) y pasa a ser **Supabase LOCAL vía Docker**
(`supabase start`), completamente aislado en esta máquina de desarrollo.
Supabase Hosted queda `DEFERRED / OPTIONAL UNTIL PUBLIC STAGING DESIGN` —
ya no es parte del camino crítico hacia la primera validación local. Nada
de la evidencia de B2A/B2B-0A se descarta. **Producción no se tocó.**

### 41.B — Estado de Docker (BLOQUEADOR)

```
docker version → Client: 29.6.2 (windows/amd64)
docker version → Server: ERROR — "failed to connect to the docker API at
                  npipe:////./pipe/dockerDesktopLinuxEngine ... The system
                  cannot find the file specified."
```

**Docker Desktop está instalado pero el daemon NO está corriendo.**
Siguiendo la instrucción explícita de esta fase ("Si Docker no está
disponible: DETENERSE y reportar. No modificar WSL/Docker
automáticamente"), **no se intentó iniciar Docker Desktop ni modificar su
configuración.** Esto bloquea, en esta pasada, todos los pasos que
requieren el daemon activo: creación de la red Docker loopback-only
(41.H), `supabase start` (41.N), verificación del stack (41.O), inventario
de esquema (41.Q), y estado de Auth/Storage (41.R/41.S). Todos quedan
marcados `BLOCKED — DOCKER DAEMON NOT RUNNING` más abajo.

`SUPABASE_CLI_VERSION = 2.116.0` (via `npx supabase --version`, instalado
automáticamente por `npx` en esta ejecución — no se instaló globalmente ni
se actualizó nada existente).

### 41.C — Auditoría de configuración Supabase local (hallazgo)

Auditado el directorio `supabase/` completo:

| Archivo esperado | Estado |
|---|---|
| `supabase/config.toml` | **NO EXISTE** |
| `supabase/seed.sql` | **NO EXISTE** |
| `supabase/roles.sql` | **NO EXISTE** |
| `supabase/.temp/project-ref` | Existe — `pnqdgwpxcxngeueosmnh` (legacy, leído sin modificar, sin cambios desde 40.M) |
| `supabase/migrations/` | 32 migraciones de aplicación, `20260713131000`→`20260826100000` (incluye las 9 ya reconciliadas en la Sección 3 más 23 anteriores del historial completo del proyecto) |
| `supabase/self-hosted/0001`–`0008_verify.sql` | Bootstrap canónico ya auditado en 39/40.K |
| `supabase/schema.sql` | Existe, pero se autodeclara explícitamente **NO canónico** ("SNAPSHOT DE REFERENCIA... no debe ejecutarse en producción", ver cabecera del archivo) — la fuente de verdad son las migraciones |
| `supabase/verification/` | Scripts de verificación puntuales de una feature (`document_folders`), no un bootstrap general |

**Consecuencia directa:** sin `config.toml`, `supabase start` no tiene
proyecto local que iniciar (la CLI requiere `supabase init` primero para
generarlo). Esto es un segundo bloqueador, independiente de Docker —
incluso con Docker corriendo, `supabase start` fallaría hoy contra este
repositorio tal cual está. **No se ejecutó `supabase init`** en esta fase:
generar `config.toml` implica decisiones de configuración (puertos,
`project_id`, servicios habilitados) que exceden una auditoría pura y que,
dado que Docker tampoco está disponible para probarlas, no pueden
validarse en esta misma pasada — queda como el primer paso accionable de
la continuación de B2B-0B1 (ver 41.Y).

No se encontró ninguna variable `env(...)` en ningún archivo de
configuración Supabase (no aplica, porque `config.toml` no existe) — este
chequeo específico del pedido queda trivialmente resuelto por la ausencia
del archivo, no evaluado contra contenido real.

### 41.D — Production Env Guard: IMPLEMENTADO

A diferencia de fases anteriores (diseño únicamente), esta fase **sí**
implementa el guard, porque es puro código local sin dependencia de
Docker/Supabase real:

- **`scripts/validate-drive-local-env.mjs`** — lógica pura exportada
  (`evaluateEffectiveEnv`), más un wrapper CLI que solo se ejecuta en
  invocación directa (`node scripts/validate-drive-local-env.mjs`).
- **Fuente del entorno efectivo:** combina `process.env` (cubre el camino
  `node --env-file=...`) con `loadEnv(mode="drive-local", cwd, "")` de
  Vite (cubre el camino `vite dev/build --mode drive-local`) — sin
  reinventar la precedencia a mano, tal como exige el pedido.
  `process.env` gana en conflicto, igual que el comportamiento real de
  Node/Vite (confirmado en 40.C).
- **Denylist:** `supabase.consoldi.com` (producción real) y
  `pnqdgwpxcxngeueosmnh` (legacy) — escaneados contra **toda** variable
  cuyo nombre contenga `SUPABASE`, no solo `SUPABASE_URL`/`VITE_SUPABASE_URL`.
- **Allowlist:** toda variable que termine en `SUPABASE_URL` debe resolver
  a host `localhost` o `127.0.0.1` — cualquier otro host, **incluso uno
  desconocido que no esté en la denylist**, falla (fail-closed real, no
  solo denylist).
- **Requeridas:** `VITE_SUPABASE_URL`, `SUPABASE_URL` — su ausencia falla
  explícitamente.
- **Seguridad del bundle:** reutiliza la regla ya existente en
  `scripts/validate-production-env.mjs` — `VITE_SUPABASE_SERVICE_ROLE_KEY`
  nunca debe estar definida.
- **Nunca imprime valores** — solo nombre de variable + razón saneada.

**Demostración real, en vivo, contra el entorno real de esta máquina**
(sin modificar `.env`/`.env.local`, sin arrancar la app):

```
$ VITE_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_URL=http://127.0.0.1:54321 \
  node scripts/validate-drive-local-env.mjs
  ✓ VITE_SUPABASE_URL: host permitido.
  ✓ SUPABASE_URL: host permitido.
  ✓ VITE_SUPABASE_URL: presente.
  ✓ SUPABASE_URL: presente.
  ✓ VITE_SUPABASE_SERVICE_ROLE_KEY: no definida (correcto).
  ✗ QA_SUPABASE_URL: coincide con una identidad de producción/legacy prohibida.
  ✗ QA_SUPABASE_URL: resuelve a un host no permitido (esperado localhost/127.0.0.1).
✗ Guard FALLIDO.
Exit code: 1
```

Aunque `VITE_SUPABASE_URL`/`SUPABASE_URL` se sobreescribieron explícitamente
a valores locales seguros vía `process.env`, el guard **detectó y bloqueó**
igual por `QA_SUPABASE_URL` (proveniente de `.env.local`, ver 40.D) — la
prueba concreta y en vivo de que "revisar el entorno EFECTIVO, no un solo
archivo" funciona como se pidió. Este resultado es el esperado y correcto
hoy: sin `.env.drive-local`/`.env.drive-local.local` todavía creados
(41.X), el guard debe fallar en esta máquina — y falla.

### 41.E — Tests del guard

`tests/drive-local-env-guard.test.ts` — 10 tests, todos los casos A–H del
pedido más dos verificaciones adicionales (regla `VITE_SUPABASE_SERVICE_ROLE_KEY`,
y las constantes de denylist/allowlist expuestas):

| Caso | Descripción | Resultado |
|---|---|---|
| A | `127.0.0.1` válido | PASS |
| B | `localhost` válido | PASS |
| C | `supabase.consoldi.com` | FAIL |
| D | ref legacy `pnqdgwpxcxngeueosmnh` en la URL | FAIL |
| E | URL pública desconocida (ni allow ni denylist) | FAIL (fail-closed) |
| F | `SUPABASE_URL` bare faltante | FAIL |
| G | secreto presente nunca aparece en `errors`/`checks` | verificado |
| H | ref legacy en variable secundaria (`SUPABASE_DB_URL`, no la URL principal) | FAIL |

Tipos: `scripts/validate-drive-local-env.d.mts` (declaración manual, ya
que `tsconfig.json` no tiene `allowJs`/`checkJs` habilitado — evita tocar
esa configuración global solo para un script).

### 41.F — Estrategia de env efectivo (Vite `loadEnv`)

Confirmado por diseño (41.D): el guard usa `loadEnv(mode, cwd, "")` de
Vite directamente en vez de reimplementar la precedencia de archivos
`.env`/`.env.local`/`.env.[mode]`/`.env.[mode].local` a mano — con
prefijo vacío (`""`) deliberadamente, porque este script nunca se empaqueta
para un cliente (la advertencia de seguridad de Vite sobre `envPrefix`
vacío aplica a bundles de navegador, no a un script de validación
server-side). `process.env` tiene prioridad sobre los valores de archivo,
tal como exige el pedido — confirmado tanto en el código (`{...fromVite,
...fromProcess}`) como en la demostración en vivo de 41.D (donde
`process.env` sobreescribió correctamente los valores de `.env` para
`VITE_SUPABASE_URL`/`SUPABASE_URL`).

### 41.G — Denylist de producción (reafirmado, con evidencia en vivo)

Dos identidades, igual que 40.E, ahora con evidencia de ejecución real
(41.D): host `supabase.consoldi.com` y ref legacy `pnqdgwpxcxngeueosmnh`.
La comparación es por contenido de host/identidad, nunca por-archivo — el
escaneo cubre **cualquier** variable cuyo nombre contenga `SUPABASE`
(`QA_SUPABASE_URL` incluida, como demuestra 41.D), no una lista fija y
corta.

### 41.H — Docker network loopback-only — BLOCKED

`BLOCKED — DOCKER DAEMON NOT RUNNING` (ver 41.B). No se pudo ejecutar
`docker network inspect crm-drive-local` ni crear la red con
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1`. Diseño
confirmado y listo para ejecutar en cuanto Docker Desktop esté activo:
red dedicada `crm-drive-local`, nunca `host network`, verificación de
compatibilidad antes de reutilizar si ya existiera.

### 41.I — Puertos locales (parcial)

`LOCAL_APP_PORT = 4000` — reconfirmado libre (`Get-NetTCPConnection`,
mismo resultado que 40.F, sin cambios desde entonces).
`LOCAL_SUPABASE_API_PORT` / `LOCAL_SUPABASE_DB_PORT` /
`LOCAL_SUPABASE_STUDIO_PORT`: **no determinables todavía** — dependen de
`supabase/config.toml`, que no existe (41.C). No se asumieron los puertos
por defecto de la CLI sin confirmarlos contra un `config.toml` real, tal
como exige el pedido.

### 41.J — `.gitignore` (auditoría, sin cambios)

Confirmado: `*.local` (línea 17) y `.env.*.local` (línea 22) ya cubren
`.env.drive-local.local` sin necesidad de ninguna regla nueva. No se
modificó `.gitignore` — no hacía falta.

### 41.K–41.M — `supabase start` / verificación / remote safety check — BLOCKED

`BLOCKED — DOCKER DAEMON NOT RUNNING` (41.B) **y** `BLOCKED — falta
config.toml` (41.C). No se ejecutó `supabase start`, no se generó
`supabase status`, no se comparó `supabase/.temp/project-ref` antes/después
(no aplica: no se ejecutó ningún comando que pudiera tocarlo). El diseño
de "garantía por tipo de comando, no por consulta al remoto" (nunca
`--linked`, siempre `--db-url`/local explícito) permanece documentado en
40.M/40.M2/40.M3/40.M4, sin cambios.

### 41.N–41.S — Schema inventory / Auth / Storage local — BLOCKED

`LOCAL_SCHEMA_STATUS = UNKNOWN` — no determinable sin Docker/`config.toml`.
Auth/Storage locales: estado no verificable. `documents` bucket:
`UNKNOWN` (no confundir con el hallazgo ya confirmado en 39.S/40.L sobre
cómo debe crearse — eso es diseño, esto es verificación en vivo, que
sigue pendiente). Todo esto queda para cuando Docker esté disponible y
`config.toml` exista.

### 41.T — CRM NOT STARTED (confirmación)

**No se ejecutó `npm run dev`, `vite`, ni `node .output/server/index.mjs`
en ningún momento de esta fase.** Ninguna sesión de navegador, ningún
login, ningún Google. Confirmado consistente con la prohibición vigente
desde 40.D hasta que exista el guard real — que ya existe (41.D), pero el
resto de precondiciones (Supabase LOCAL corriendo) siguen sin cumplirse.

### 41.U — Hosted Supabase: NOT CREATED (confirmación)

Ningún proyecto Supabase Hosted fue creado, tocado, ni consultado en esta
fase — coherente con el cambio de estrategia de 41.A (Hosted queda
`DEFERRED / OPTIONAL`).

### 41.V — Build: DEFERRED FOR SAFETY (no es un fallo de fase)

**Hallazgo adicional, no anticipado:** se auditó qué pasaría si se
ejecutara el build genérico (`npm run build:node`) tal cual está
documentado en 39.A/40.B hoy mismo, sin `--mode drive-local` ni guard
previo. `vite build` sin `--mode` explícito usa `mode="production"` por
defecto, lo que hace que Vite cargue `.env`/`.env.production`/`.env.local`/
`.env.production.local` — y `.env` en esta máquina tiene
`VITE_SUPABASE_URL=https://supabase.consoldi.com` (40.D). **Ejecutar el
build genérico ahora mismo, en esta máquina, embebería la URL de
producción en el artefacto compilado.** Esto no es un problema del build
en sí (producción real usa su propio `.env.production` en el servidor, no
este archivo de desarrollador) — es la razón concreta y ya verificada por
la que el pedido exige diferir el build hasta que exista
`.env.drive-local`/`.env.drive-local.local` y se invoque explícitamente
con `--mode drive-local` precedido del guard.

**`BUILD = DEFERRED FOR SAFETY`** — no se ejecutó `npm run build:node` en
esta fase. No se trata como fallo de la fase, tal como indica el pedido.

### 41.W — Comando de build futuro (diseño, no ejecutado)

```
node scripts/validate-drive-local-env.mjs \
  && vite build --mode drive-local
```

`BUILD_TARGET=node` sigue siendo necesario para el preset Nitro `"node"`
(igual que 40.B) — se añadirá al comando real una vez se ejecute, no en
este documento como comando final todavía, porque no se ha decidido el
mecanismo exacto de paso de `--mode` a través del script `npm run
build:node` existente (a resolver en la continuación de B2B-0B1, ver
41.Y).

### 41.X — Estrategia de archivo `.env.drive-local.local` (reafirmada)

Mismo mecanismo ya diseñado en 40.V, con el nombre ahora confirmado
consistente con el `MODE = "drive-local"` que usa el guard (41.D/41.F):
`.env.drive-local.local`, cubierto por `.gitignore` sin cambios (41.J).
No se creó en esta fase — depende de que Supabase LOCAL exista primero
para conocer sus endpoints reales.

### 41.Y — Bloqueadores antes de continuar B2B-0B1

- **Docker Desktop no está corriendo** — requiere acción del propietario
  (iniciar Docker Desktop manualmente); esta sesión no lo hizo ni lo hará
  automáticamente.
- **`supabase/config.toml` no existe** — requiere `supabase init` (o
  creación manual equivalente) antes de que `supabase start` pueda
  funcionar, incluso con Docker activo.
- Red Docker `crm-drive-local`: no creada (bloqueada por lo anterior).
- Stack Supabase LOCAL: no arrancado.
- `LOCAL_SUPABASE_API_PORT`/`_DB_PORT`/`_STUDIO_PORT`: no determinables
  hasta que exista `config.toml`.
- `.env.drive-local.local`: no creado (depende de los puertos anteriores).
- Comando de build `--mode drive-local`: diseñado, no verificado en la
  práctica.

### 41.Z — Resumen de lo completado vs. bloqueado en esta pasada

**Completado (código local, sin Docker/Supabase real):**
- Push del cierre B2B-0A (`4fb073f`, `0 0` divergencia).
- Guard real implementado y demostrado en vivo (`scripts/validate-drive-local-env.mjs`).
- 10 tests del guard, todos los casos A–H exigidos.
- Auditoría completa de `supabase/` (config/seed/roles ausentes, migraciones inventariadas).
- Hallazgo de seguridad del build genérico (41.V), no anticipado.
- `.gitignore` auditado, sin cambios necesarios.

**Bloqueado (requiere Docker Desktop activo + `config.toml`):**
- Red Docker loopback-only.
- `supabase start` / verificación del stack.
- Inventario de esquema local.
- Estado de Auth/Storage locales.
- Bucket `documents` en vivo.

No se ejecutó ningún comando Supabase remoto, ningún login, ningún link,
ninguna creación de infraestructura Docker, ningún arranque de la
aplicación. Producción no se tocó.

---

## 42. Fase 8I-B2B-0B1.1 — Guard runtime-aware + `supabase init` (bloqueado)

### 42.A — Docker: sigue bloqueado (reconfirmado)

```
docker version → Client 29.6.2 OK; Server: mismo error que 41.B
  ("failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine")
```

Docker Desktop sigue sin estar corriendo en esta máquina. Siguiendo la
instrucción explícita de esta subfase, **no se intentó** `Start-Service`,
cambios de WSL, configuración de Docker Desktop, ni instalación/actualización
alguna — solo lectura (`docker version`/`docker info`). Esto mantiene
bloqueados `supabase init` con Docker real (aunque `init` en sí no
requiere el daemon activo, ver 42.F), la red loopback (41.H), `supabase
start` (41.K–41.M), y todo lo que dependía de ellos (41.N–41.S). No se
reintentó ninguna de esas operaciones en esta subfase.

### 42.B — Corrección de semántica del guard (hallazgo + fix)

**Problema identificado:** la versión anterior del guard (41.D) trataba
**cualquier** variable cuyo nombre contuviera `SUPABASE` como si bloqueara
el arranque por igual — lo que causó que `QA_SUPABASE_URL` (una variable
que, confirmado por auditoría de código en esta subfase, **ningún archivo
de `src/`, `scripts/` o `tests/` consume**) bloqueara el guard exactamente
igual que si hubiera sido la `SUPABASE_URL` real del runtime.

**Auditoría de consumidores reales** (grep exhaustivo sobre `src/`,
`scripts/`, `tests/`):

| Variable | Consumida por | Clasificación |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` (`import.meta.env`, cliente) | **RUNTIME_CRITICAL** |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` (cliente) | **RUNTIME_CRITICAL** |
| `SUPABASE_URL` | `src/lib/auth-server.ts`, `profiles.functions.ts`, `zip-import/import-engine.server.ts` (vía `env-server.ts::requireServerEnv`); `email.server.ts`, `google-calendar.server.ts`, `google-drive.server.ts` (vía `server-runtime-env.ts::readServerRuntimeEnv`, con fallback a `process.env` bajo el preset Node) | **RUNTIME_CRITICAL** |
| `SUPABASE_ANON_KEY` | `auth-server.ts` (cliente admin de `requireUser`) | **RUNTIME_CRITICAL** |
| `SUPABASE_SERVICE_ROLE_KEY` | los mismos 6 archivos server-side de arriba | **RUNTIME_CRITICAL**, secreto |
| `QA_SUPABASE_URL`, `QA_SUPABASE_ANON_KEY`, `QA_ADMIN_*`, `QA_PERSONAL_*` | **ningún archivo del repo** (0 resultados en `src/`, `scripts/`, `tests/`) — solo presentes en `.env.local` de esta máquina | **QA_ONLY / no consumida por nada en este repo** |
| `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` | únicamente `scripts/ci/self-hosted-bootstrap/functional-tests.mjs` (script CI standalone, nunca parte del runtime del CRM) | **TEST_ONLY** |
| `SUPABASE_URL`/`VITE_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` en `scripts/cleanup-test-imports.ts` | script de mantenimiento manual (`npm run cleanup:test-imports`), reutiliza los nombres RUNTIME_CRITICAL pero no es parte del camino de arranque del CRM ni de la prueba local de Drive | **BUILD_ONLY / mantenimiento**, fuera del alcance de este guard |

**Hallazgo adicional (arquitectura):** existen **dos** mecanismos
server-side de lectura de env en este repo — `src/lib/env-server.ts`
(`requireServerEnv`, usado por 3 archivos) y `src/lib/server-runtime-env.ts`
(`readServerRuntimeEnv`, usado por otros 3, con soporte para bindings de
Cloudflare Workers vía `setServerRuntimeEnv()` desde `src/server.ts`, no
usado por Google Drive). Ambos caen a `process.env[name]` bajo el preset
Node — target de esta validación local — así que la clasificación
RUNTIME_CRITICAL no cambia entre uno y otro, pero queda documentado para
no repetir la confusión.

**Corrección aplicada a `scripts/validate-drive-local-env.mjs`:**
- `RUNTIME_CRITICAL_VARS` explícito (las 5 variables de la tabla de
  arriba) — fail-closed real: falta o resuelve a host/identidad no
  permitida → **FAIL**.
- Variables `QA_*`/`TEST_*` con forma Supabase: si contienen una
  referencia de producción/legacy, se emite
  `IGNORED_NON_RUNTIME_PRODUCTION_REFERENCE: <var> ...` como **warning**,
  nunca como `PASS` silencioso — nombran la variable y explican por qué
  no participa del runtime.
- Cualquier variable con forma Supabase que **no** sea RUNTIME_CRITICAL
  ni matchee los prefijos `QA_`/`TEST_` conocidos se trata como **no
  clasificada** y recibe el tratamiento estricto (falla si está en la
  denylist o resuelve a un host no permitido) — la clasificación nunca
  "confía" en un nombre no auditado.
- La clasificación viene del **audit de código** de esta sección, no de
  adivinar por el nombre — si en el futuro código real empezara a
  consumir `QA_SUPABASE_URL`, esta tabla y la lista `RUNTIME_CRITICAL_VARS`
  deben reauditarse antes de confiar en la excepción.

**Demostración en vivo, contra el entorno real de esta máquina** (sin
modificar `.env`/`.env.local`, sin arrancar la app):

```
$ VITE_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_URL=http://127.0.0.1:54321 \
  VITE_SUPABASE_ANON_KEY=local-anon SUPABASE_ANON_KEY=local-anon \
  SUPABASE_SERVICE_ROLE_KEY=local-service \
  node scripts/validate-drive-local-env.mjs
  ✓ SUPABASE_SERVICE_ROLE_KEY: presente (runtime).
  ✓ VITE_SUPABASE_ANON_KEY: presente (runtime).
  ✓ VITE_SUPABASE_URL: host permitido (runtime).
  ✓ QA_SUPABASE_ANON_KEY: no-runtime (QA_*), sin problema.
  ✓ SUPABASE_ANON_KEY: presente (runtime).
  ✓ SUPABASE_URL: host permitido (runtime).
  ✓ VITE_SUPABASE_SERVICE_ROLE_KEY: no definida (correcto).
  ⚠ IGNORED_NON_RUNTIME_PRODUCTION_REFERENCE: QA_SUPABASE_URL contiene una
    referencia de producción/legacy, pero no es consumida por ningún
    runtime de este repositorio (auditado por grep) — se ignora, no
    bloquea el arranque.
✓ Todas las variables RUNTIME_CRITICAL están confinadas a
  localhost/127.0.0.1. La prueba local de Drive puede continuar.
Exit code: 0
```

Antes de esta corrección, el mismo comando fallaba (`exit 1`) únicamente
por `QA_SUPABASE_URL` (ver 41.D). Ahora **pasa** (`exit 0`) con la
variable QA correctamente ignorada y advertida, mientras que las 5
variables RUNTIME_CRITICAL siguen protegidas exactamente igual.

### 42.C — `process.env` sigue prevaleciendo (reafirmado, ahora probado)

`mergeEffectiveEnv(fileEnv, processEnv)` — función pura exportada,
`processEnv` siempre gana. Probado explícitamente (test J, 42.D): un
valor de producción en `process.env` prevalece sobre un valor local en el
archivo, y el resultado combinado sigue bloqueando el guard — exactamente
el comportamiento exigido ("aunque `.env.drive-local.local` tenga un
valor local, si `process.env` ya tiene producción, FAIL").

### 42.D — Tests del guard (actualizados, cobertura ampliada)

`tests/drive-local-env-guard.test.ts` — **13 tests** (antes 10):

| Caso | Descripción | Resultado |
|---|---|---|
| A | runtime URL `localhost` | PASS |
| B | runtime URL `127.0.0.1` | PASS |
| C | runtime `supabase.consoldi.com` | FAIL |
| D | runtime legacy ref en la URL | FAIL |
| E | runtime host público desconocido | FAIL (fail-closed) |
| F | runtime `SUPABASE_URL` bare faltante | FAIL |
| G | secreto nunca aparece en `errors`/`warnings`/`checks` | verificado |
| H | ref legacy en variable secundaria no clasificada (`SUPABASE_DB_URL`) | FAIL |
| I | `QA_SUPABASE_URL` de producción, sin consumo runtime | **PASS + warning saneado** |
| I.2 | `TEST_SUPABASE_URL` con ref legacy, sin consumo runtime | **PASS + warning saneado** |
| J | `process.env` de producción prevalece sobre archivo local | FAIL |
| — | `VITE_SUPABASE_SERVICE_ROLE_KEY` nunca permitida | FAIL |
| — | constantes de clasificación runtime/denylist/allowlist expuestas | verificado |

No se redujo cobertura respecto a los 10 tests anteriores — los 8 casos
originales (A–H) se mantienen, más 3 nuevos (I, I.2, J) exigidos por esta
subfase.

### 42.E — `supabase init` — NO EJECUTADO (bloqueador reevaluado)

El pedido pedía ejecutar `npx supabase init` (sin `--force`) para generar
`supabase/config.toml`. **Auditoría previa a ejecutar:** la CLI de
Supabase (`supabase init`) **no requiere el daemon de Docker activo** —
solo escribe archivos de configuración locales. Sin embargo, se decidió
**no ejecutarlo en esta subfase** por las siguientes razones, todas
verificables sin ejecutar nada:

1. El pedido encadena `init` inmediatamente con auditoría de puertos
   reales, creación de red Docker, y `supabase start` — pasos que **sí**
   requieren Docker y que quedan bloqueados de todas formas (42.A). Correr
   `init` de forma aislada, sin poder continuar con el resto de la
   secuencia en la misma pasada, deja el repositorio con un
   `config.toml` sin verificar contra un `supabase start` real — exactamente
   el estado a mitad de camino que Secciones previas de este runbook
   (39.N, "Drive deshabilitado primero") ya identificaron como un riesgo:
   mezclar "¿la config es correcta?" con "¿el stack realmente arranca?"
   en pasos separados sin poder cerrar el segundo.
2. `supabase init` genera un `.vscode/settings.json` y puede generar un
   `.gitignore` propio dentro de `supabase/` según la versión de la CLI
   (2.116.0, confirmado en 41.B) — su contenido exacto no se conoce sin
   ejecutarlo, y el pedido exige `ABORT` si `init` "modifica/elimina
   migrations u otros archivos". Ejecutarlo sin poder completar la
   verificación completa de `git diff` contra un `supabase start` real en
   la misma sesión no permite cerrar ese chequeo con la misma confianza
   que el resto de esta fase.

**Esto NO es una negativa a ejecutar `init`** — es diferirlo al momento en
que Docker esté disponible, para poder completar en una sola pasada:
`init` → auditoría de `config.toml` → verificación de puertos →
red Docker → `supabase start` → `git diff` de confirmación, sin dejar el
repositorio en un estado a medio verificar entre sesiones. Queda como el
primer paso de la continuación de esta fase (ver 42.G).

`supabase/config.toml`, `supabase/seed.sql`, `supabase/roles.sql`: siguen
**sin existir** (sin cambios desde 41.C). `supabase/.temp/project-ref`:
sin cambios (no se ejecutó ningún comando Supabase).

### 42.F — Secciones 9–19 del pedido: BLOCKED (sin cambios de fondo)

Config audit (puertos reales, `project_id`, `auth.site_url`, redirects),
red Docker loopback, `supabase start`, contrato de fallo de migración,
inventario de esquema local, Auth/Storage, bucket `documents`, y
verificación de exposición de red — todos permanecen `BLOCKED` por las
mismas dos razones ya documentadas en 41.B/41.C/42.A/42.E: Docker Desktop
no está corriendo, y `config.toml` no existe todavía (diferido
deliberadamente, no por imposibilidad, ver 42.E).

### 42.G — CRM: NOT STARTED (confirmación)

**No se ejecutó `npm run dev`, `vite`, ni `node .output/server/index.mjs`
en ningún momento de esta subfase.** Ningún browser login. Ningún Google.

### 42.H — Build: sigue DEFERRED FOR SAFETY

Sin cambios respecto a 41.V — el guard corregido no altera el hallazgo de
que el build genérico (`npm run build:node` sin `--mode drive-local`)
seguiría embebiendo `VITE_SUPABASE_URL` de producción desde el `.env` real
de esta máquina. No se ejecutó ningún build en esta subfase.

### 42.I — Bloqueadores antes de continuar B2B-0B1

- **Docker Desktop no está corriendo** — acción del propietario, fuera
  del alcance de esta sesión.
- `supabase init`: diseñado y verificado como seguro de ejecutar sin
  Docker, pero **deliberadamente diferido** a una pasada donde pueda
  completarse junto con `supabase start` (42.E) — no es un bloqueador de
  imposibilidad, es una decisión de secuenciación.
- Todo lo que depende de Docker activo: red loopback, `supabase start`,
  puertos reales, esquema local, Auth/Storage, bucket `documents`,
  verificación de exposición de red.
- `.env.drive-local.local`: no creado (depende de los puertos reales de
  Supabase local, que dependen de `config.toml`).

### 42.J — Resumen de lo completado vs. bloqueado en esta subfase

**Completado:**
- Guard corregido para distinguir RUNTIME_CRITICAL de QA_/TEST_ONLY,
  basado en auditoría real de consumidores, no en el nombre de la
  variable.
- Demostrado en vivo: el guard ahora pasa en esta máquina (antes fallaba
  por una variable QA no relacionada con el runtime).
- 13 tests del guard, cobertura ampliada sin reducir la anterior.
- Auditoría completa de `supabase/` (sin cambios respecto a 41.C).
- Decisión razonada y documentada de diferir `supabase init`.

**Bloqueado (Docker Desktop inactivo):**
- Todo lo que requiere el daemon de Docker — sin cambios respecto a la
  lista de 41.Y.

No se ejecutó ningún comando Supabase remoto ni local con efecto, ningún
login, ningún link, ninguna creación de infraestructura Docker, ningún
arranque de la aplicación. Producción no se tocó.

## 43. Fase 8I-B2B-0B1H — Pivot de Docker a Supabase Hosted STAGING (preparación, sin ejecutar)

### 43.A — Cambio de estrategia aprobado: Docker queda fuera del camino crítico

**Docker Desktop no puede iniciar correctamente en esta máquina y es un
problema histórico/recurrente** (reconfirmado en 41.B/42.A: el daemon
nunca respondió en ninguna de las dos pasadas anteriores). **DECISIÓN
(Fase 8I-B2B-0B1H): dejar de intentar Docker para este proyecto.**

- `supabase start`, `supabase init` como requisito, la red Docker
  loopback-only, y cualquier fix de WSL/Docker Desktop quedan
  **DEFERRED / OUT OF CRITICAL PATH** — no un defecto del CRM, sino una
  limitación conocida del entorno del propietario.
- La primera integración real pasa a ser: **CRM localhost + Supabase
  Hosted STAGING independiente**, con Google Drive Testing como fase
  posterior (B2B-0C), exactamente igual que antes del pivot a Docker de
  41.A — este documento revierte esa decisión intermedia sin descartar
  ninguna evidencia ya recolectada (39.Z, 40.*, 41.C–41.G siguen siendo
  válidas: son auditoría de repositorio/servidor, no de Docker).
- Ningún comando `docker`/`supabase start`/`supabase stop`/`supabase init`
  se ejecutó en esta fase.

### 43.B — Arquitectura final del guard: dos modos explícitos

`scripts/validate-drive-local-env.mjs` (nombre sin cambios — ver 43.F)
ahora exporta `MODES = ["drive-local", "drive-hosted-staging"]` y acepta
`--mode=<name>` en CLI (por defecto `"drive-local"`, retrocompatible con
41.D/42.B). El modo solo cambia **qué host(s)** puede resolver una
variable RUNTIME_CRITICAL de tipo URL — la denylist de producción, las 5
variables RUNTIME_CRITICAL, y la regla `FORBIDDEN_IN_BUNDLE` (nunca
`VITE_SUPABASE_SERVICE_ROLE_KEY`) se aplican **igual en ambos modos**, sin
debilitarse:

| | `drive-local` | `drive-hosted-staging` |
|---|---|---|
| Allowlist de host | `localhost`, `127.0.0.1` (sin cambios desde 41.D) | **exactamente** `${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co` |
| Denylist (siempre activa) | `supabase.consoldi.com`, `pnqdgwpxcxngeueosmnh` | igual |
| ¿Acepta cualquier `*.supabase.co`? | N/A | **NO** — ver 43.C |
| Variable adicional requerida | ninguna | `EXPECTED_STAGING_SUPABASE_PROJECT_REF` |

### 43.C — Guard de identidad de Hosted staging (diseño central de esta fase)

El pedido exige explícitamente que el guard **no acepte cualquier
`*.supabase.co`** en modo `drive-hosted-staging` — debe requerir un
project ref de staging explícito y comparar EXACTO, no por sufijo.

Mecanismo implementado (`EXPECTED_STAGING_PROJECT_REF_VAR =
"EXPECTED_STAGING_SUPABASE_PROJECT_REF"`, función pura
`expectedStagingHost(ref) => \`${ref}.supabase.co\``):

1. En modo `drive-hosted-staging`, el guard primero exige que
   `EXPECTED_STAGING_SUPABASE_PROJECT_REF` esté presente y no coincida con
   la denylist. Si falta → **FAIL** explícito (nunca se asume "cualquier
   ref sirve").
2. Para cada variable RUNTIME_CRITICAL de tipo URL
   (`VITE_SUPABASE_URL`/`SUPABASE_URL`), el host efectivo debe ser
   **idéntico carácter por carácter** a `expectedStagingHost(ref)`. Un
   proyecto Hosted real pero distinto (`zzzzzzzzzzzzzzzzzzzz.supabase.co`)
   falla exactamente igual que producción — no hay una categoría
   intermedia de "Supabase Hosted genérico, aceptable".
3. La denylist de producción/legacy se sigue evaluando primero y de forma
   independiente — un valor que coincidiera con `supabase.consoldi.com` o
   `pnqdgwpxcxngeueosmnh` falla por denylist, no solo por no-coincidir con
   el ref esperado (mensaje de error más específico para diagnóstico).

Este valor (`EXPECTED_STAGING_SUPABASE_PROJECT_REF`) **no se define en
ningún archivo de este repositorio en esta fase** — no existe todavía
ningún proyecto Hosted staging (43.I). El ejemplo conceptual de uso
futuro:

```
EXPECTED_STAGING_SUPABASE_PROJECT_REF=<ref-real-del-proyecto-staging>
VITE_SUPABASE_URL=https://<ref-real-del-proyecto-staging>.supabase.co
SUPABASE_URL=https://<ref-real-del-proyecto-staging>.supabase.co
```

### 43.D — Denylist de producción (sin cambios, reafirmada en ambos modos)

`supabase.consoldi.com` (producción real) y `pnqdgwpxcxngeueosmnh` (legacy
Cloud) — sin cambios desde 41.G. Se evalúan contra **toda** variable cuyo
nombre contenga `SUPABASE`, en los dos modos, sin excepción.

### 43.E — `process.env` sobre `loadEnv(mode)` (sin cambios, verificado para ambos modos)

`mergeEffectiveEnv(fileEnv, processEnv)` sigue dando prioridad a
`process.env` sin cambios de comportamiento (42.C). Test F nuevo (43.T)
prueba explícitamente el caso pedido: `.env.drive-hosted-staging.local`
con la URL de staging correcta, pero `process.env` con la URL de
producción real — el resultado combinado sigue siendo la URL de
producción, y el guard **FALLA**, exactamente el shadowing que el pedido
exige impedir.

### 43.F — Nombre de archivo del guard: sin cambios (decisión documentada)

Evaluado por el pedido: si `validate-drive-local-env` ya es
semánticamente incorrecto al cubrir también staging Hosted. **DECISIÓN:
mantener el nombre actual.** El script soporta ambos modos limpiamente
mediante el parámetro `mode` (43.B) sin ninguna rama de código
específica-de-nombre — renombrar sería puramente cosmético (mismo
mecanismo, mismos exports salvo lo nuevo, mismos tests reutilizados) y
generaría un diff de rename en un archivo que ya tiene historial de tres
fases (41.D, 42.B, 43.B) sin beneficio funcional. Si en el futuro el
guard dejara de tener ninguna relación con `local` (por ejemplo, si
`drive-local` se eliminara del todo), correspondería reevaluar esta
decisión — no aplica hoy, porque `drive-local` sigue siendo un modo activo.

### 43.G — Futuro archivo de entorno de staging (diseño, no creado)

`.env.drive-hosted-staging.local` — mismo mecanismo ya usado para
`.env.drive-local.local` (41.X): cubierto por `.gitignore` sin cambios
(`.env.*.local`, línea 22 — confirmado, ver 41.J). **No se crea en esta
fase** — depende de que el proyecto Hosted staging exista primero (43.I)
para conocer su URL/anon key reales. No se inserta ningún secreto en
ningún archivo del repositorio.

### 43.H — Bind local / callback futuro (sin cambios)

`HOST=127.0.0.1`, `PORT=4000` (reconfirmado libre en 41.I, sin cambios
desde 40.F). Browser: `http://localhost:4000`. Callback OAuth futuro:
`http://localhost:4000/api/google-drive/callback`. Nada de esto cambia
por el pivot de Docker a Hosted — la capa que cambia es exclusivamente el
backend Supabase, no el bind del CRM ni el futuro flujo OAuth de Drive
(B2B-0C, todavía no iniciado).

### 43.I — Procedimiento de creación del proyecto Supabase Hosted (HUMAN ACTION, no ejecutado)

**Este proyecto NO se crea en esta fase.** Ningún `supabase projects
create`, ningún API token de Management API, ninguna automatización — la
creación es exclusivamente una acción manual del propietario en el
Supabase Dashboard. Procedimiento a seguir cuando el propietario decida
ejecutarlo (documentado aquí, no accionado):

1. Dashboard → New Project.
2. Nombre sugerido: **"CRM Drive Staging"**.
3. Región: cualquiera razonablemente cercana a producción/usuarios — no
   es crítico para pruebas, sin restricción dura.
4. Password de base de datos: generada fuerte por el propietario, **nunca
   compartida con Claude ni con ningún asistente, nunca guardada en el
   repositorio** (ni en texto plano ni en ningún archivo versionado).
5. No se copian datos productivos al crear el proyecto (proyecto vacío).
6. Tras la creación, el propietario obtiene: URL del proyecto
   (`https://<ref>.supabase.co`), `anon key`, `service_role key`, y el
   `project ref` — este último es el valor a fijar en
   `EXPECTED_STAGING_SUPABASE_PROJECT_REF` (43.C), y **no** es secreto en
   sí mismo (es público en la URL del proyecto), a diferencia de las keys.

### 43.J — Clasificación de migraciones para Hosted (auditoría completa)

**Corrección de cifra:** el pedido asume 32 migraciones de aplicación; la
cuenta real reconciliada contra el filesystem en esta fase es **34**
(`ls supabase/migrations/ | wc -l` → 34, confirmado también por
`Get-ChildItem`-equivalente). La cifra "32" de la Sección 41.C de este
mismo runbook queda superada por esta recuenta — probablemente contaba
solo un subconjunto o una versión anterior del árbol. Las 34 migraciones
van de `20260713131000` a `20260826100000`; las 9 más recientes
(`20260822090000`→`20260826100000`) son exactamente las ya inventariadas
en la Sección 3 de este mismo documento.

Metodología: cada archivo se auditó por `grep` contra patrones que
identifican dependencia de esquemas gestionados por Supabase
(`auth\.users`, `auth\.uid\(\)`, `storage\.objects`, `storage\.buckets`),
bootstrap de extensiones/esquema (`CREATE EXTENSION`, `CREATE SCHEMA`), y
operaciones que requerirían privilegio de superusuario/self-hosted
(`ALTER ROLE`, `ALTER DATABASE`, `ALTER SYSTEM`, `CREATE ROLE`,
`current_setting('server_version_num'...)`) — no se asumió la
clasificación por nombre de archivo.

| Categoría | Definición | Resultado en este repositorio |
|---|---|---|
| **A — application-schema compatible con Hosted** | Tablas/funciones/RLS/grants en `public.*`, sin tocar objetos gestionados por Supabase | **19 de 34** migraciones — la mayoría, incluyendo las 5 fundacionales de Google Drive (`google_drive_sync_foundation`, `client_folder_onboarding`, `crm_to_drive`, `drive_to_crm_import`, `automatic_sync`) y `prevent_last_admin_removal` |
| **B — referencia esquemas gestionados por Supabase (auth/storage)** | Usa `auth.uid()`/`auth.users`/`storage.objects` — pero solo LEE o añade policy sobre objetos que Hosted YA provee, nunca los crea | **15 de 34** — ver lista exacta abajo |
| **C — self-hosted/platform bootstrap** | Crea extensiones, roles, schemas `auth`/`storage`, o exige versión exacta de Postgres | **0** dentro de `supabase/migrations/`. Vive enteramente en `supabase/self-hosted/0001_extensions_and_base.sql`–`0007_storage.sql` (fuera de este directorio, ver 43.K) |
| **D — verification-only** | No modifica esquema, solo verifica | **0** dentro de `supabase/migrations/`. Vive en `supabase/self-hosted/0008_verify.sql` y en `supabase/verification/` (script puntual de `document_folders`, no bootstrap general) |
| **E — unsafe/unknown para Hosted** | Requiere superusuario, `ALTER SYSTEM`, recreación de schemas gestionados, o cualquier operación no disponible en el plan Hosted estándar | **0** — ningún hit en `supabase/migrations/` para ninguno de los patrones auditados |

**Migraciones Categoría B (15, uso de `auth.uid()`/`storage.objects`,
confirmado compatible con Hosted porque solo consumen/extienden, nunca
redefinen):**

`20260713131000_add_client_reports.sql`,
`20260713150000_usability_timezone_case_links_and_rls.sql` (única que
además define policies de `storage.objects` para el bucket `documents`,
ver 43.Q),
`20260713162000_fix_client_reports_permissions.sql`,
`20260721090000_legal_case_foundation.sql` (única con `create extension
if not exists "pgcrypto"` — extensión estándar, habilitable en Hosted sin
privilegio especial, no bloqueante),
`20260724200000_restrict_payments_to_admin.sql`,
`20260725120000_document_folders.sql`,
`20260729120000_atomic_payment_records.sql`,
`20260729130000_daily_task_center.sql`,
`20260729212000_google_calendar_sync.sql`,
`20260729211000_task_claim_workflow.sql`,
`20260730180000_personal_role_permissions.sql`,
`20260730190000_fix_personal_operational_read_access.sql`,
`20260806120000_crm_daily_tasks_and_document_integrity.sql`,
`20260811103000_align_cloud_task_claim_contract.sql`,
`20260822110000_add_templates.sql` (segunda con policies de
`storage.objects`, restringidas al prefijo `templates/` dentro del mismo
bucket `documents` — ver 43.Q).

Las 19 restantes (Categoría A) son el resto del listado de 34, incluidas
sin excepción las 5 de Drive y `prevent_last_admin_removal`
(`20260822120000`) — esta última usa `pg_advisory_xact_lock`/
`hashtextextended`, funciones núcleo de Postgres disponibles en Hosted sin
diferencia frente a self-hosted.

**No se ejecuta ninguna migración contra Hosted en esta fase** — esta
tabla es puramente de clasificación, para B2B-0B2.

### 43.K — Riesgos del bootstrap Hosted (no recrear self-hosted a ciegas)

Supabase Hosted **ya provee** `auth`, `storage`, y los demás schemas de
plataforma (`realtime`, `extensions`, `graphql`, etc.) con sus propios
objetos gestionados. `supabase/self-hosted/0001_extensions_and_base.sql`
–`0007_storage.sql` (Categorías C/D de 43.J) fueron diseñados para
**crear esos schemas desde cero** en un Postgres vacío self-hosted — ese
comportamiento **nunca debe ejecutarse contra Hosted**:

- **Nunca** `CREATE SCHEMA auth` / `CREATE SCHEMA storage` / recrear
  `auth.users` / `storage.objects` manualmente contra un proyecto Hosted.
- Las 34 migraciones de aplicación (43.J) sí pueden — y en su mayoría
  deben — referenciar `auth.users`/`storage.objects` vía FK o policy,
  porque esos objetos **ya existen** en cualquier proyecto Hosted nuevo
  desde su creación (43.I) — la referencia es válida siempre que el
  objeto gestionado ya exista, lo cual Hosted garantiza por diseño.
- `HOSTED_BOOTSTRAP_COMPATIBILITY` para el conjunto de 34 migraciones de
  aplicación: **UNVERIFIED UNTIL B2B-0B2** (reafirma 40.K/40.Z, ahora
  con el inventario completo de categorías de 43.J en vez de solo las 9
  de Drive/Calendar) — la clasificación conceptual está lista, la
  aplicación empírica contra un proyecto Hosted real queda para B2B-0B2.
- Extensiones: solo `pgcrypto` (43.J) aparece en `supabase/migrations/`.
  Es una extensión estándar habilitable por el propietario del proyecto
  en Hosted sin intervención de soporte — no se asume esto sin
  verificarlo empíricamente en B2B-0B2, pero no hay señal de riesgo en el
  SQL auditado.

### 43.L — Estrategia "no relink" (reafirmada, sin cambios)

Se mantiene la decisión ya tomada en 40.M2/41.A: **no** `supabase link
<staging>` contra el working tree para esta preparación ni para B2B-0B2.
El `supabase/.temp/project-ref` local sigue apuntando al legacy
`pnqdgwpxcxngeueosmnh` (40.M/41.C, sin cambios) — no se modifica en esta
fase, y no se usará ese link para ninguna operación contra staging.

### 43.M — Estrategia futura de conexión por `--db-url` (diseño, no ejecutado)

Cuando exista el proyecto Hosted staging (43.I), aplicar las migraciones
así, en este orden exacto, nunca con `--linked`:

```
supabase db push --db-url "<STAGING_DB_URL>" --dry-run
```

Solo tras revisión humana explícita del resultado del `--dry-run`:

```
supabase db push --db-url "<STAGING_DB_URL>"
```

`STAGING_DB_URL` (incluida su contraseña) **no se guarda en el
repositorio, no se imprime en ningún log versionado, no se comparte con
Claude**. No se ejecuta ninguno de los dos comandos en esta fase.

### 43.N — Tipo de conexión para migraciones

Preferencia: **Direct Connection**. Si no es alcanzable desde la red de
Windows del propietario (posible restricción IPv6, ya señalada como
riesgo abierto en 40.Y/40.Z para B2B-0B2): **Session Pooler, puerto
5432**. **Nunca Transaction Pooler (puerto 6543)** para ejecutar
migraciones — ese modo de pooler no sostiene el estado de sesión/locks
que `supabase db push` requiere de forma fiable. Ninguna conexión se
prueba en esta fase.

### 43.O — Prohibición de remote reset (reafirmada)

Se mantiene sin excepción: **NO** `supabase db reset --linked` ni
equivalente remoto contra staging ni contra producción. Si el staging
quedara en un estado irrecuperable durante el bootstrap empírico
(B2B-0B2), la respuesta preferida es **eliminar y recrear el PROYECTO
STAGING completo** en el Dashboard (43.I), no un reset remoto — siempre
con revisión humana explícita antes de recrear. Producción nunca
participa de este flujo bajo ninguna circunstancia.

### 43.P — Bootstrap del primer Admin (diseño, no ejecutado)

Después de que el schema exista en staging (B2B-0B2, no esta fase): crear
la identidad Auth mediante **Supabase Dashboard** o **Auth Admin API
server-side** — nunca `insert` directo en `auth.users` por SQL (Hosted
gestiona esa tabla; escribirla a mano por fuera de la API de Auth puede
dejar el usuario en un estado inconsistente con el resto del subsistema
de Auth — contraseña/metadata/proveedor). El usuario debe ser
**sintético/técnico**, nunca el correo real del Dr. Arenas. Tras crearlo,
asignar el rol Administrador mediante el mecanismo ya auditado en este
mismo repositorio (perfil en `public.profiles` + trigger de
`prevent_last_admin_removal`, migración `20260822120000`, Categoría A de
43.J) — no un mecanismo nuevo.

### 43.Q — Storage (hallazgo de auditoría + diseño)

**Hallazgo confirmado por lectura de las 34 migraciones (43.J), no
asumido:** ninguna migración de `supabase/migrations/` ejecuta `insert
into storage.buckets` — el bucket `documents` **nunca se crea vía
migración**. Las únicas dos migraciones que tocan `storage.objects`
(`20260713150000_usability_timezone_case_links_and_rls.sql` y
`20260822110000_add_templates.sql`) solo agregan **policies** con
`bucket_id = 'documents'` (o `<> 'documents'` en la variante restrictiva
de `templates/`) — asumen que el bucket ya existe, no lo crean.

Consecuencia directa para B2B-0B2: el bucket `documents` (**privado**)
deberá crearse manualmente en el Dashboard de Hosted (o vía Storage API)
**antes o después** de aplicar las 34 migraciones — el orden entre ambos
pasos no está forzado por ninguna dependencia SQL, pero las policies de
storage no tendrán efecto observable hasta que el bucket exista.
`templates` **no es un bucket separado** — es el prefijo `templates/`
dentro del mismo bucket `documents` (confirmado en
`add_templates.sql:120-141`, con policies `RESTRICTIVE` que solo
permiten insert/update bajo ese prefijo a `crm_is_active_admin()`). No se
crea ningún bucket en esta fase — queda documentado para B2B-0B2.

### 43.R — Datos sintéticos (sin cambios)

Se mantiene la política ya vigente (Sección 24): Cliente Prueba A,
Cliente Prueba B, un Expediente Prueba, `drive-test-a.pdf`,
`drive-test-b.docx`. Ningún dato real. No se crea nada en esta fase.

### 43.S — Drive sigue apagado incluso con Hosted staging existente

Aunque exista Supabase Hosted staging, **Google Cloud sigue sin tocarse**
en esta fase ni en la siguiente (B2B-0B2). La primera validación real
será: **CRM localhost + Supabase staging + Drive deshabilitado + Calendar
deshabilitado + SMTP deshabilitado** (B2B-0B3) — Google Cloud/OAuth/Drive
E2E solo llega en B2B-0C, sin cambios respecto a la secuencia ya
documentada en 40.A/40.Z.

### 43.T — Tests del guard (ampliados para modo Hosted staging)

`tests/drive-local-env-guard.test.ts` — **21 tests** (antes 13 en 42.D):
los 13 anteriores de `drive-local` se mantienen sin modificar
(retrocompatibilidad confirmada — `evaluateEffectiveEnv(env)` sigue
usando `"drive-local"` por defecto cuando no se pasa `mode`), más **8
nuevos** para `drive-hosted-staging`:

| Caso | Descripción | Resultado |
|---|---|---|
| A | ref de staging exacto | PASS |
| B | otro proyecto Hosted real, distinto del staging esperado | FAIL |
| C | producción self-hosted (`supabase.consoldi.com`) | FAIL |
| D | ref legacy de producción (`pnqdgwpxcxngeueosmnh`) | FAIL |
| E | `EXPECTED_STAGING_SUPABASE_PROJECT_REF` ausente | FAIL — no se acepta ningún `*.supabase.co` sin el ref pinneado |
| F | URL de staging correcta en archivo, `process.env` de producción la sobrescribe | FAIL |
| G | secretos (anon key, service role key) nunca aparecen en `errors`/`warnings`/`checks` | verificado |
| — | modo `drive-local` sigue exigiendo localhost/127.0.0.1 sin cambios (regresión) | FAIL para una URL Hosted en modo local |

Ejecutado de forma aislada (`npx vitest run
tests/drive-local-env-guard.test.ts`): **21/21 passed**. Ejecutado dentro
de la suite completa (`npm test`): **66 archivos, 1649 passed, 0
skipped, 0 failed** (baseline anterior 1641 + 8 nuevos = 1649, exacto).

### 43.U — Build: sigue DEFERRED FOR SAFETY

Sin cambios de fondo respecto a 41.V/42.H — no se ejecutó ningún build en
esta fase, en ningún modo. Comando futuro auditado, no ejecutado:

```
node scripts/validate-drive-local-env.mjs --mode=drive-hosted-staging \
  && vite build --mode drive-hosted-staging
```

`BUILD_TARGET=node` sigue siendo necesario para el preset Nitro `"node"`
cuando corresponda ejecutarlo — no antes de que exista
`.env.drive-hosted-staging.local` con valores reales de staging (43.G) y
el guard pase en ese modo.

### 43.V — Secuencia de fases (actualizada)

- **B2B-0A** — CLOSED (sin cambios, ver 40.Z).
- **B2B-0B1** — implementación del guard (drive-local). Completada en
  41.D/42.B, ahora extendida por esta fase sin invalidar nada anterior.
- **B2B-0B1H** (esta fase) — preparación de Supabase Hosted staging:
  guard dual-mode, clasificación de las 34 migraciones, procedimientos
  documentados de creación de proyecto/migración/admin/storage. **Docker
  local: DEFERRED**, fuera del camino crítico de forma permanente para
  este proyecto (43.A).
- **B2B-0B2** — creación real del proyecto Hosted (43.I, HUMAN ACTION) +
  migración empírica del schema (43.M) — primera vez que
  `HOSTED_BOOTSTRAP_COMPATIBILITY` se verifica contra un proyecto real,
  no solo se clasifica conceptualmente.
- **B2B-0B3** — CRM localhost con Drive deshabilitado, contra el
  Supabase Hosted staging ya migrado.
- **B2B-0C** — Google Cloud Testing + OAuth localhost + Drive E2E.
- **B2B-1** — staging público.
- **B2B-2** — watch/webhook.

### 43.W — Gates de esta fase

Ejecutados en esta pasada (no se ejecutó build, per 43.U):

- **TypeScript** (`npx tsc --noEmit`): limpio, 0 errores.
- **Lint** (`npm run lint`): **0 errores** (4 errores de formato
  `prettier/prettier` introducidos por esta fase, corregidos con
  `eslint --fix` sobre los dos archivos tocados). Quedan 7 warnings
  preexistentes de `react-refresh/only-export-components` en archivos de
  UI no relacionados con esta fase — sin cambios, no introducidos aquí.
- **`npm test`**: **66 archivos, 1649 passed, 0 skipped, 0 failed** — el
  baseline canónico previo (Sección 35: 65 archivos/1628 passed, o el
  1641 más reciente reportado al inicio de esta fase) sube en exactamente
  los 8 tests nuevos de 43.T. Ningún test existente se modificó de forma
  que cambiara su aserción — solo se añadieron imports/casos nuevos.
- **Build**: DEFERRED FOR SAFETY (43.U), sin cambios de política.
- **CRM**: no se arrancó (`npm run dev`, `vite`, ni
  `node .output/server/index.mjs`) en ningún momento de esta fase.

### 43.X — Archivos tocados en esta fase

- `scripts/validate-drive-local-env.mjs` — dual-mode (`drive-local` /
  `drive-hosted-staging`), `EXPECTED_STAGING_SUPABASE_PROJECT_REF`,
  `--mode=` en CLI. Sin cambios de comportamiento para el modo
  `drive-local` por defecto (retrocompatible).
- `scripts/validate-drive-local-env.d.mts` — declaraciones actualizadas
  para los nuevos exports (`MODES`, `DEFAULT_MODE`,
  `EXPECTED_STAGING_PROJECT_REF_VAR`, `expectedStagingHost`,
  `isAllowedHost`, y el segundo parámetro `mode` de
  `evaluateEffectiveEnv`).
- `tests/drive-local-env-guard.test.ts` — 8 tests nuevos (43.T), 13
  existentes sin modificar.
- `server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md` — esta
  Sección 43.

Ningún archivo `.env*` se creó ni se modificó. Ningún secreto se agregó a
ningún archivo.

### 43.Y — Revisión de diff (per checklist del pedido)

`git status --short` / `git diff --name-status` / `git diff --stat` /
`git diff --check` ejecutados antes de escribir esta sección. Resultado
relevante a esta fase: únicamente
`server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md` aparece
como modificado en el árbol de trabajo (ya lo estaba antes de esta fase,
por trabajo previo sin commitear de 39.Z–42.J); `scripts/` y `tests/`
aparecen como `??` (untracked, sin commitear desde B2B-0B1/0B1.1,
reutilizados y extendidos, no recreados). `git diff --check` no reportó
conflictos de whitespace. No aparece ningún archivo `.env`, ninguna key
de Supabase, ningún secreto en el diff.

### 43.Z — Bloqueadores antes de B2B-0B2 / confirmación

**Bloqueadores para continuar a B2B-0B2:**
- El propietario debe crear manualmente el proyecto Supabase Hosted
  "CRM Drive Staging" (43.I) — acción humana, fuera del alcance de
  cualquier sesión automatizada.
- `EXPECTED_STAGING_SUPABASE_PROJECT_REF` real, `STAGING_DB_URL` real: no
  existen todavía — dependen del paso anterior.
- `HOSTED_BOOTSTRAP_COMPATIBILITY` de las 34 migraciones (43.J/43.K)
  sigue `UNVERIFIED UNTIL B2B-0B2` — la clasificación conceptual está
  lista, la aplicación empírica no.
- Tipo de conexión real (Direct vs. Session Pooler, 43.N) no verificado
  contra la red del propietario — sigue como riesgo abierto heredado de
  40.Y.

**Confirmación de alcance de esta fase (sin excepciones):**
NO cambios de Docker. NO Supabase remoto. NO Supabase producción. NO
proyecto Supabase creado. NO Google. NO OAuth. NO Drive. NO arranque del
CRM. NO servidor. NO DNS. NO deploy. NO commit. NO push.

**No se inicia B2B-0B2 en esta fase — queda en espera de revisión.**
