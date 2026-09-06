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

## 44. Fase 8I-B2B-0B2B-R — Recuperación del baseline canónico de aplicación

**Contexto de entrada:** B2B-0B2 se ejecutó fuera de esta sesión: el
propietario creó el proyecto Hosted "CRM Drive Staging"
(`ccnvrslhnzdqwanhceqx`) y ejecutó el primer `supabase db push` real. Falló
en la primera migración (`20260713131000_add_client_reports.sql`,
SQLSTATE `42P01`, `public.clients` ausente). Evidencia post-fallo
reportada: 0 tablas `public`, `supabase_migrations.schema_migrations`
existe con 0 filas. Esta fase es una auditoría de repositorio 100%
read-only para explicar la causa y diseñar (sin ejecutar) el bootstrap
correcto. No hubo conexión a Supabase, ni local ni remota, en esta sesión.

### 44.A — Precheck

`git branch --show-current` → `release/crm-2026-08-stabilization`.
`git rev-parse HEAD` → `29b1532be6a7997b5d21341e19765658948f85c5`.
`git rev-list --left-right --count HEAD...origin/...` → `0 0`. `git status
--short` → árbol tracked limpio, 13 elementos untracked históricos
intactos (`.codex-backup/`, el zip+sha256 de Virtualmin, `audit/`, 4
`crm-*-source.tar.gz`, `docs/contingency-plan.md`,
`docs/crm-improvements-2026-08-06.md`, `docs/releases/release-2026-08-10.md`,
`docs/user-manual.md`, `taskify/`). Coincide exactamente con lo esperado.
Precheck **PASS**.

### 44.B — Causa raíz del fallo (evidencia, no reportada por el operador)

`20260713131000_add_client_reports.sql` hace `references public.clients(id)`,
`references public.cases(id)` y `references public.profiles(id)` sin haber
creado ninguna de las tres antes. Se auditó **la totalidad** de
`supabase/migrations/*.sql` (34 archivos) buscando `create table
public\.(clients|cases|profiles|documents|payments)\b`: **cero
coincidencias**. Ninguna de esas cinco tablas fundacionales tiene un
`CREATE TABLE` en ningún archivo de `supabase/migrations/`. La causa raíz
no es un error de orden de migraciones: es que el directorio
`supabase/migrations/` **nunca fue un bootstrap de base vacía** — sus 34
archivos son deltas incrementales que asumen un esquema fundacional
preexistente, coherente con el comentario original del propio archivo 1
(`-- Run in Supabase SQL Editor or with Supabase migrations before
deploying the app`). El proyecto "CRM Drive Staging" es una base
completamente vacía y por tanto no tiene ese fundamento.

### 44.C — Discrepancia de manifest (reportar, no ocultar)

El manifest SHA-256 reportado en el pedido
(`4E1E22362D885B5A901398589205841BA3DF473C859214BE6DBD5C9A0EF5F6F1`, 65
caracteres) no tiene la longitud de un SHA-256 (64 hex) y no coincide con
el manifest recalculado en esta fase sobre los 34 archivos reales
(`sha256sum supabase/migrations/*.sql | sort -k2 | sha256sum`):
`ce47e8a8484b9292c5ce7c2341bf2a46284308df5856cc5ac994576bc0067914`. Esta
fase **no confirma** el valor del pedido — lo reporta como no verificable
con la evidencia disponible, sin asumir que sea un error del propietario
ni del proceso previo. El conteo de 34 archivos sí se confirma exacto. El
primer archivo (`20260713131000_add_client_reports.sql`) se releyó
íntegro en esta fase y es idéntico en contenido al ya auditado en 43.J.

### 44.D — Estado de staging y de migration-history

Ambos se registran **tal como fueron reportados por el operador**, sin
verificación en vivo (prohibida en esta fase):
`STAGING_AFTER_FAILURE = CLEAN_APPLICATION_SCHEMA` (0 tablas `public`);
`supabase_migrations.schema_migrations` existe, 0 filas. Esto es
consistente con el análisis de 44.B: un `db push` que falla en la primera
migración de una transacción no deja objetos a medio crear ni marca esa
migración como aplicada — el comportamiento reportado es exactamente el
esperado para ese fallo, no una anomalía adicional a explicar.

### 44.E — Fuentes de baseline encontradas en el repositorio

Búsqueda exhaustiva (`grep -r` de `CREATE TABLE public\.(clients|cases|
profiles|documents|tasks|payments)`, mayúsculas/minúsculas, sobre todo el
repositorio; más inspección directa de `supabase/`, `server-release/`,
`scripts/`, `docs/`, `audit/`, `tests/`): **una sola fuente ejecutable**
además de `supabase/migrations/`:

- `supabase/self-hosted/0001_extensions_and_base.sql` … `0008_verify.sql`
  (8 archivos) — única ubicación en todo el repositorio con `CREATE TABLE
  public.clients`, `CREATE TABLE public.cases`, `CREATE TABLE
  public.payments`, `CREATE TABLE public.documents` (en
  `0003_domain_tables.sql`) y `CREATE TABLE public.profiles` (en
  `0002_auth_and_profiles.sql`).

No existe `schema.sql` en ningún nivel del repositorio (`**/schema.sql` →
0 resultados). `server-release/` no contiene SQL alguno — solo
`app/.output` (build Nitro), `config/`, `docs/` operativos y
`scripts/smoke-test.mjs`/`verify-release.mjs`; no está trackeado por git
(`git ls-files server-release` → 0 archivos) y no aparece en
`.gitignore` explícitamente, es simplemente untracked. `public.tasks` no
existe como objeto en ningún archivo — el objeto real equivalente es
`public.case_tasks`, originado en `20260721090000_legal_case_foundation.sql`
y redefinido en su forma final en `supabase/self-hosted/0003_domain_tables.sql`.
Documentación de diseño no ejecutable pero directamente relevante:
`docs/database/self-hosted-canonical-model.md`,
`audit/self-hosted-migration/cloud-vs-repository.md`,
`audit/self-hosted-migration/cloud-inventory.md` (las tres, fechadas
2026-08-07, ya auditan exactamente esta brecha para el propósito de
self-hosted, no para Hosted).

### 44.F — Clasificación de `supabase/self-hosted/0001`–`0008`

| Archivo | Clasificación | Objetos creados | Objetos alterados | Referencias a plataforma | Hosted-safe | ¿Prerrequisito de `20260713131000`? |
|---|---|---|---|---|---|---|
| `0001_extensions_and_base.sql` | E (verify-only) | ninguno | ninguno | LEE `auth.users`, `storage.buckets`, `storage.objects`, `pg_language`, `server_version_num` (todo vía `to_regclass`/`current_setting`, solo lectura dentro de un `DO $$ ... RAISE EXCEPTION`) | Sí — no escribe nada | No en sí mismo; es un guard de precondición, no un objeto |
| `0002_auth_and_profiles.sql` | A (application baseline) | `public.profiles` | ninguno | FK a `auth.users(id)` (REFERENCIA, no crea) | Sí | Sí — es la única fuente trackeada de `profiles` |
| `0003_domain_tables.sql` | A | `clients`, `cases`, `payments`, `payment_records`, `agenda_events`, `document_folders`, `documents`, `client_reports`, `case_parties`, `document_extractions`, `case_events`, `case_tasks`, `import_jobs`, `import_folders`, `ai_analysis_runs`, `ai_findings`, `source_references`, `case_task_history`, `document_change_history`, 5× `google_calendar_*` (24 tablas) | ninguno | FKs a `profiles`/entre sí | Sí | **Parcialmente** — ver 44.G, es el estado final post-34-migraciones (a la fecha 2026-08-07), no el estado previo a la migración 1 |
| `0004_functions_and_rpc.sql` | A + C | 21 funciones `public.*` | ninguno | `handle_new_user()` lee `auth.users`/`raw_user_meta_data` (LEE, no altera) | Sí | Parcial — solo los helpers de autorización (`crm_is_active_staff/admin`) son prerrequisito real de las policies de `client_reports` en `20260713131000` |
| `0005_triggers.sql` | A + C | 24 triggers | **ALTERA** `auth.users` (adjunta `on_auth_user_created`) | Adjuntar un trigger a una tabla gestionada por Supabase es un patrón estándar soportado en Hosted (no es recrear el schema) | Sí, con la salvedad de que ES una escritura sobre un objeto de plataforma, no una simple lectura | No — nada en `20260713131000` depende de este trigger |
| `0006_rls_and_grants.sql` | D (grants/RLS) | 78 policies `public.*` | RLS on/off, `REVOKE`/`GRANT` sobre `anon`/`authenticated`/`service_role` (roles provistos por la plataforma, no creados aquí) | Referencia roles de plataforma, no los crea | Sí | No — las 4 policies de `client_reports` en `20260713131000` ya se auto-contienen en ese mismo archivo |
| `0007_storage.sql` | C + D | `INSERT ... INTO storage.buckets` (bucket `documents`), 4 policies sobre `storage.objects` | `REVOKE`/`GRANT` en `storage.objects` | Escribe una fila en una tabla de plataforma (`storage.buckets`); no crea el schema `storage` | Probablemente sí (Supabase Studio hace lo mismo al crear un bucket vía Dashboard), pero **no verificado empíricamente contra Hosted en esta fase** — riesgo residual, ver 44.M | No |
| `0008_verify.sql` | E (verify-only) | ninguno | ninguno | Solo `SELECT` dentro de `BEGIN TRANSACTION READ ONLY` | Sí, trivialmente | No — es posterior, no prerrequisito |

**Hallazgo central:** ninguno de los 8 archivos, individual o
colectivamente, es "el baseline previo a `20260713131000`". `0003` en
particular ya contiene columnas y tablas que las migraciones 15+
introducen *después* de `20260713131000` (`client_reports.materia`/
`status_date`/`current_status`/`informative_message`/`reminder_days`/
`final_text` de `20260727120000_extend_client_reports.sql`;
`case_tasks.claimed_by`/`claimed_at` de `20260729211000_task_claim_workflow.sql`;
`document_folders` de `20260725120000_document_folders.sql`; los 5
`google_calendar_*` de `20260729212000_google_calendar_sync.sql`). Es
decir: `supabase/self-hosted/` **no es un prerrequisito de las 34
migraciones — es una alternativa al conjunto completo de las 34
migraciones**, diseñada para reconstruir de un salto el estado final,
como reconfirma `docs/database/self-hosted-canonical-model.md:134`
("Frente a migraciones históricas: no se reproducen 23 ALTER/DROP/hotfix/
backfill… Las tablas nacen con su forma final").

### 44.G — Staleness de `supabase/self-hosted/` frente al HEAD actual

Comparación directa, no inferida: `0003_domain_tables.sql` **no contiene**
`create table ... public.templates` ni ningún `create table ...
public.google_drive_*` (0 coincidencias verificadas por grep). Esas 7
tablas (`templates` + 6 `google_drive_*`) existen únicamente en
`20260822110000_add_templates.sql` y `20260824100000_google_drive_sync_foundation.sql`
(Categoría A de 43.J). El modelo self-hosted fue diseñado el 2026-08-07 y
nunca se actualizó tras las 9 migraciones de Drive/Calendar/templates de
Agosto 22–26. Su propio `0008_verify.sql` sigue afirmando `'public
tables', '25'` — cifra ya obsoleta frente al HEAD real. Esto explica en
parte por qué el pedido documenta ~32 tablas/38 funciones/31 triggers/82
policies/72 FK como forma del release completo: son 25/21/24/82/59 de la
foto self-hosted del 7 de agosto **más** lo que agregan las migraciones
15–34 no incorporadas a esa foto. Esta fase trata esos ~32/38/31/82/72
como evidencia de validación agregada (tal como instruye el pedido), no
como sustituto de la comparación objeto por objeto ya hecha en 44.F/44.I.

### 44.H — Mapa de origen de las tablas núcleo

| Objeto | Creado por | Archivo | Dependencias | Hosted-safe | ¿Requerido antes de `20260713131000`? |
|---|---|---|---|---|---|
| `public.profiles` | self-hosted (única fuente trackeada) | `0002_auth_and_profiles.sql` | `auth.users` | Sí | **Sí** |
| `public.clients` | self-hosted (única fuente trackeada) | `0003_domain_tables.sql` | `profiles` (created_by) | Sí | **Sí** |
| `public.cases` | self-hosted (única fuente trackeada) | `0003_domain_tables.sql` | `clients`, `profiles` | Sí | **Sí** |
| `public.documents` | self-hosted (única fuente trackeada) | `0003_domain_tables.sql`, incluye ya `folder_id → document_folders` (columna de una migración posterior) | `clients`, `cases`, `profiles`, `document_folders` | Sí | No directamente (no referenciada por `20260713131000`), pero sí antes de migraciones posteriores tempranas |
| `public.payments` | self-hosted (única fuente trackeada) | `0003_domain_tables.sql` | `clients` | Sí | No directamente; requerida antes de `20260729120000_atomic_payment_records.sql` |
| `public.case_tasks` | **migración**, no self-hosted-only | origen real: `20260721090000_legal_case_foundation.sql`; forma final redefinida en `0003_domain_tables.sql` | `cases`, `clients`, `profiles` | Sí | No — posterior a `20260713131000` |
| `public.client_reports` | la propia `20260713131000_add_client_reports.sql` | — | `clients`, `cases`, `profiles` | Sí | Es la migración en cuestión, no un prerrequisito de sí misma |

Ningún objeto queda `UNKNOWN`: los cinco fundacionales tienen exactamente
una fuente trackeada (`supabase/self-hosted/`), pero esa fuente representa
su **forma final actual**, no su forma histórica al momento de
`20260713131000` — esa forma histórica original (antes de que existieran
`document_folders`, `google_calendar_*`, `case_tasks.claimed_by`, etc.) no
está escrita en ningún archivo del repositorio y se considera **NO
RECONSTRUIBLE desde el repositorio** (sí lo está, presumiblemente, en el
Cloud legacy `pnqdgwpxcxngeueosmnh`, fuera del alcance read-only de esta
fase).

### 44.I — Grafo de dependencias / lista de bootstrap mínimo

Caminando hacia atrás desde `20260713131000_add_client_reports.sql`:
`client_reports` → `clients`, `cases`, `profiles` → `profiles` →
`auth.users` (plataforma). Ninguna de las tres depende de `documents`,
`payments`, `case_tasks` ni de ningún objeto Google. Pero el bootstrap
mínimo **para que las 34 migraciones completas apliquen sin fallos
posteriores** debe cubrir, además, lo que las migraciones tempranas
siguientes asumen preexistente antes de crear sus propios objetos:
`documents` (antes de `20260725120000_document_folders.sql`, que hace
`ALTER TABLE public.documents ADD COLUMN folder_id`), `payments` (antes de
`20260729120000_atomic_payment_records.sql`) y `agenda_events` (antes de
`20260729212000_google_calendar_sync.sql`, que añade columnas de sync).
Lista de bootstrap mínimo ordenada: `profiles` → `clients` → `cases` →
`payments` → `payment_records` → `agenda_events` → `documents`. Estas
siete son exactamente las tablas de `0002`+`0003` que **no** son
`case_tasks`/`client_reports`/`case_parties`/`document_extractions`/
`case_events`/`import_jobs`/`import_folders`/`ai_analysis_runs`/
`ai_findings`/`source_references`/`document_folders`/`google_calendar_*`
(esas 15 restantes de `0003` ya tienen su propio `CREATE TABLE IF NOT
EXISTS` dentro de las 34 migraciones y NO deben preexistir).

### 44.J — Frontera de seguridad Hosted

Ninguno de los candidatos de bootstrap necesita `CREATE SCHEMA auth`,
`CREATE SCHEMA storage`, ni recrear `auth.users`/`storage.objects` — Hosted
ya los provee desde la creación del proyecto. Las únicas operaciones que
**escriben** sobre un objeto de plataforma (no solo lo referencian) son:
adjuntar `on_auth_user_created` a `auth.users` (`0005`, patrón estándar
soportado) e insertar la fila del bucket `documents` en `storage.buckets`
(`0007`, patrón equivalente a crear el bucket desde el Dashboard). Ninguna
migración de `supabase/migrations/` ni el bootstrap propuesto en 44.K
recrea o reemplaza esos schemas. Nada ambiguo detectado en esta auditoría.

### 44.K — Extensiones

| Extensión | Dónde se habilita | ¿Hosted ya la tiene? | ¿El baseline debe crearla? | Privilegio elevado |
|---|---|---|---|---|
| `pgcrypto` | `20260721090000_legal_case_foundation.sql:6` (`create extension if not exists`) | Sí, disponible en `extensions` en cualquier proyecto Hosted estándar, habilitable por el dueño del proyecto | El baseline nuevo (44.L) no la necesita — `gen_random_uuid()` es nativo desde PG13; la migración que la pide ya la trae con `IF NOT EXISTS` | No |
| ninguna otra | — | — | — | — |

`supabase/self-hosted/0001_extensions_and_base.sql` confirma explícitamente
que no requiere ninguna extensión externa (comentario propio, línea 37-38).
No se habilita nada en esta fase.

### 44.L — Modelos de bootstrap evaluados

**Modelo A — subconjunto Hosted-safe de `self-hosted/` + 34 migraciones.**
Descartado como estaba planteado: `0003` es el estado *final*, no el
*previo*; componerlo con las 34 migraciones intentaría recrear objetos que
las migraciones también crean/alteran, y exigiría auditar cada `ALTER`
histórico para confirmar que es idempotente frente a columnas que ya
existirían — no verificado, y probablemente redundante incluso donde
funcione.

**Modelo B — nueva migración baseline canónica pre-`20260713`, timestamp
anterior (ej. `20260713120000_bootstrap_application_baseline.sql`), con
`CREATE TABLE IF NOT EXISTS` para exactamente las 7 tablas de 44.I
(`profiles`, `clients`, `cases`, `payments`, `payment_records`,
`agenda_events`, `documents`), usando las definiciones de columnas ya
vetadas en `supabase/self-hosted/0002`/`0003` como única fuente de verdad
disponible en el repositorio, sin ningún dato ni backfill. RECOMENDADO —
ver 44.M/44.N.

**Modelo C — mantener `self-hosted/` como ruta alternativa completa (saltar
las 34 migraciones por completo en self-hosted), actualizándolo para
cerrar la brecha de 44.G.** No resuelve el problema de Hosted: Hosted usa
`supabase db push` sobre `supabase/migrations/`, no ejecuta
`self-hosted/*.sql` — mantener ambos caminos es válido y ya está en el
repositorio, pero no sustituye al Modelo B para este incidente concreto.

**Recomendación:** Modelo B para Hosted/CI/self-hosted-por-migraciones,
conservando el Modelo C existente (actualizado en una fase separada, fuera
de este alcance) como ruta de reconstrucción rápida self-hosted-only.

### 44.M — Compatibilidad con producción existente

Producción (tag `crm-production-2026-08-17` → commit `409e1798...`, Cloud
`pnqdgwpxcxngeueosmnh`) ya tiene `clients`/`cases`/`profiles`/`payments`/
`payment_records`/`agenda_events`/`documents` con columnas legacy
adicionales que el Modelo B no reproduce (`cloud-vs-repository.md`,
sección 2). `CREATE TABLE IF NOT EXISTS` en PostgreSQL es un *skip*
completo cuando la relación ya existe — no intenta reconciliar columnas ni
constraints — por lo que, sobre producción, la nueva migración del Modelo
B sería un no-op estructural seguro **siempre que se verifique
empíricamente contra un clon de producción antes de autorizar el `db
push` real**, no asumido aquí. No se usa `supabase migration repair` como
mecanismo automático; si producción necesita que
`supabase_migrations.schema_migrations` refleje esta nueva migración como
ya aplicada, eso requiere una decisión humana explícita en una fase
posterior autorizada, nunca en este read-only.

### 44.N — Diseño de migration-history

Recomendado (no implementado): un único archivo de migración con
timestamp anterior al primero existente, aplicado normalmente vía
`supabase db push` — Supabase la registrará en
`supabase_migrations.schema_migrations` igual que cualquier otra, sin
historial falso ni `migration repair`. Reproducible desde cero (Hosted
nuevo, self-hosted nuevo), auditable (es un archivo `.sql` versionado como
cualquier otro), y con una ruta de upgrade explícita para producción (ver
44.M: probar en clon antes de `db push` real).

### 44.O — Estrategia de bootstrap Hosted fresco

Orden propuesto para una próxima fase (no ejecutado): (1) proyecto Hosted
vacío ya existe (`ccnvrslhnzdqwanhceqx`); (2) aplicar el nuevo archivo
baseline del Modelo B; (3) `supabase db push --db-url ... --dry-run`
sobre las 34 migraciones existentes; (4) revisión humana explícita; (5)
`db push` real; (6) crear el bucket `documents` (44.Q); (7) aprovisionar
el primer Administrador (44.S).

### 44.P — Estrategia de bootstrap self-hosted fresco

Sin cambios respecto de lo ya documentado en
`docs/database/self-hosted-canonical-model.md`: `0001`→`0007` en orden,
`0008_verify.sql` después, como ruta autocontenida que NO usa
`supabase/migrations/`. Queda pendiente en otra fase actualizarla para
cerrar la brecha de 44.G si se decide seguir manteniendo esta ruta.

### 44.Q — Aprovisionamiento del bucket `documents`

Reconfirmado (sin cambios respecto a 43.Q): ninguna de las 34 migraciones
inserta en `storage.buckets` — el bucket debe crearse fuera de
`supabase/migrations/`, ya sea vía Dashboard/Storage API o replicando el
`INSERT` de `0007_storage.sql` como paso de aprovisionamiento posterior al
bootstrap (no como migración versionada, porque escribe en una tabla de
plataforma con semántica de "recurso singleton", no de esquema de
aplicación).

### 44.R — Bootstrap de Auth / primer administrador

Sin cambios respecto a 43.P: la identidad Auth se crea vía Dashboard o
Auth Admin API, nunca `insert` directo en `auth.users`. El rol
Administrador se asigna después, sobre `public.profiles`, usando el
mecanismo ya existente (`handle_new_user` crea el perfil con
`role='Personal'` por defecto; la promoción a Administrador es un paso
manual/RPC posterior, no parte del bootstrap de esquema). No se crea
ningún usuario en esta fase.

### 44.S — Archivos modificados en esta fase

Únicamente `server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md`
(esta Sección 44). Ningún archivo de `supabase/migrations/` ni de
`supabase/self-hosted/` fue tocado. Ningún `.env`. Ningún secreto.

### 44.T — Gates

`npx tsc --noEmit`: limpio, 0 errores. `npm run lint`: 0 errores, 7
warnings preexistentes de `react-refresh/only-export-components` (sin
cambios, no introducidos aquí). `npm test`: **66 archivos, 1649 passed, 0
skipped, 0 failed** — coincide exactamente con el baseline canónico de
43.W. No se ejecutó build (no requerido por el pedido de esta fase).

### 44.U — Diff

`git status --short` / `git diff --name-status` / `git diff --stat` /
`git diff --check` ejecutados antes y después de escribir esta sección.
Único archivo modificado: este runbook. Ninguna migración tocada. Ningún
cambio de runtime. Ningún secreto. Los 13 elementos untracked históricos
permanecen intactos y sin tocar.

### 44.V — Bloqueadores antes de reintentar B2B-0B2B

- Autorización humana explícita para redactar y comitear el archivo de
  migración baseline del Modelo B (44.L/44.N) — no se crea en esta fase.
- Verificación empírica del Modelo B contra un **clon** de producción
  (44.M) antes de considerar el `db push` real seguro para producción —
  no ejecutado, no es parte de esta fase.
- Verificación empírica de que `0007_storage.sql` (inserción directa en
  `storage.buckets`) es equivalente a crear el bucket vía Dashboard/API en
  un proyecto Hosted real — marcado como riesgo residual en 44.F, no
  resuelto en esta fase.
- Decisión explícita sobre si `supabase/self-hosted/` se actualiza para
  cerrar la brecha de 44.G, se deja como está, o se retira en favor
  exclusivo del Modelo B — no decidido aquí.
- `EXPECTED_STAGING_SUPABASE_PROJECT_REF`/`STAGING_DB_URL` reales del
  proyecto "CRM Drive Staging" siguen sin existir en ningún archivo del
  repositorio (sin cambios respecto a 43.Z).

**Confirmación de alcance de esta fase (sin excepciones):**
NO escritura en Supabase. NO acceso a producción. NO modificación de
migraciones. NO `migration repair`. NO reset. NO creación de bucket. NO
creación de usuarios. NO Google. NO OAuth. NO Drive. NO arranque del CRM.
NO commit. NO push.

**No se reintenta B2B-0B2B en esta fase — queda en espera de revisión.**

## 45. Fase 8I-B2B-0B2B-R1 — Reconstrucción exacta del baseline histórico T0

**Estado de entrada:** la Sección 44 (B2B-0B2B-R) fue **AUDIT APPROVED /
IMPLEMENTATION NOT APPROVED** — el propietario detectó dos errores
factuales concretos en esa sección y pidió, además, reconstruir el T0
exacto (estado inmediatamente anterior a `20260713131000`) en vez de usar
las formas finales de `supabase/self-hosted/`. Esta fase corrige ambos
errores con evidencia verificada por herramienta (no por conteo manual) y
reconstruye T0 usando una fuente primaria no explotada en 44: el dump real
`audit/self-hosted-migration/cloud-schema.sql`.

### 45.A — Precheck

Repetido y confirmado: `release/crm-2026-08-stabilization`,
`29b1532be6a7997b5d21341e19765658948f85c5`, divergencia `0 0`, árbol
tracked limpio salvo este runbook, 13 elementos untracked históricos
intactos. **PASS.**

### 45.B — Corrección del hallazgo de manifest

**Error propio confirmado, verificado ahora con `wc -c` en vez de conteo
visual:** `4E1E22362D885B5A901398589205841BA3DF473C859214BE6DBD5C9A0EF5F6F1`
mide **64 caracteres** — es un SHA-256 hex válido en longitud. La Sección
44.C afirmó 65 caracteres; esa afirmación era **incorrecta** y queda
retractada aquí explícitamente, no silenciosamente reemplazada. La causa
del error fue contar visualmente una cadena larga en vez de usar una
herramienta — no se repite ese método en esta fase (cada longitud citada
abajo se verificó con `wc -c` o con el propio runtime de Node, que
garantiza `digest("hex")` de SHA-256 en exactamente 64 caracteres).

### 45.C — Procedimiento MANIFEST V1 (determinista) y resultado

Implementado en un script Node de solo lectura
(`manifest-v1.mjs`, ejecutado desde el scratchpad de la sesión, nunca
escrito al repositorio), exactamente como especifica el pedido:

1. listar `supabase/migrations/*.sql`, ordenar por nombre de archivo
   (orden de bytes — coincide con orden cronológico porque los 34
   nombres empiezan con timestamp de 14 dígitos con ceros a la
   izquierda);
2. `SHA256` de cada archivo sobre bytes crudos (`readFileSync`, sin
   decodificar/recodificar);
3. registro `"<hash-hex-64><dos espacios><nombre-de-archivo>\n"`;
4. cuerpo del manifest codificado UTF-8, sin BOM, solo `\n` (`Buffer.from(
   ..., "utf8")`, unión con `"\n"`, sin `\r`);
5. `SHA256` de esa secuencia de bytes exacta.

**Resultado:**

```
MIGRATION_COUNT = 34
MANIFEST_V1_SHA256 = b3fc4909efbf9a3001249e6fdf354cbe4c35b0a59ba036f6e7257ceedc87b214
```

(64 caracteres, verificado con `wc -c`.) Los 34 hashes individuales por
archivo también se generaron y cada uno se verificó en 64 caracteres
hex — ninguno truncado ni concatenado por error. El listado completo de
`<hash>  <archivo>` queda en el log de esta sesión, no se transcribe aquí
por longitud; es reproducible en un minuto con el mismo script contra el
mismo directorio.

**Por qué los agregados previos pueden diferir (explicado con evidencia,
no supuesto):** se reprodujo el comando original de 44.C
(`sha256sum *.sql | sort -k2 | sha256sum`, ejecutado dentro de
`supabase/migrations/`) y se comparó línea por línea contra el
MANIFEST V1. Los 34 hashes **por archivo coinciden exactamente** entre
`sha256sum` (GNU coreutils) y el script Node — confirma que los 34
archivos de migración son byte-idénticos entre ambas herramientas, sin
modificación. La diferencia está exclusivamente en el formato de
**registro**: GNU coreutils `sha256sum` antepone un marcador de modo
binario al nombre de archivo (`<hash> *<archivo>`, un espacio + asterisco)
en vez del formato pedido (`<hash>  <archivo>`, dos espacios, sin
asterisco) — confirmado con `cat -A`, que muestra literalmente el `*`
antes de cada nombre de archivo en la salida de `sha256sum`. Ese único
carácter por línea (34 asteriscos) cambia por completo el hash agregado
aunque cada hash individual sea idéntico. El valor `4E1E2236...` reportado
en el pedido **no se pudo reproducir** con GNU coreutils en modo binario
por defecto, con el MANIFEST V1 aquí definido, ni con el formato
`--tag` de `sha256sum` (no probado exhaustivamente todas las variantes
posibles, pero las tres más plausibles no coinciden) — se reporta como
**no verificable con la evidencia disponible**, sin acusar de error a
ningún proceso previo. El valor canónico de esta fase en adelante es
`MANIFEST_V1_SHA256 = b3fc4909...b214`, calculado con el procedimiento
determinista de esta sección.

### 45.D — Corrección del hallazgo sobre `server-release/`

**Error propio confirmado.** La Sección 44.E afirmó que `server-release/`
"no está trackeado por git (`git ls-files server-release` → 0 archivos)".
Falso: `git ls-files -- server-release` devuelve **17 archivos
trackeados**, incluido exactamente
`server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md` (el mismo
archivo que esta fase edita, y que el propio historial de commits — 29b1532,
4fb073f, 8638ef9… — ya venía modificando). El comando de 44.E se reintentó
dos veces en esta fase, con resultado consistente de 17 archivos ambas
veces — la salida de "0" en la fase anterior fue una anomalía de esa
ejecución puntual, no un hecho reproducible del repositorio; no se puede
determinar la causa exacta desde esta sesión (posible glitch transitorio
de la herramienta de shell en esa llamada concreta), pero **no se repite
en esta fase, verificada dos veces**.

**Hallazgo correcto (lo que sí es cierto, y que la sección 44.E también
buscaba establecer):** de los 17 archivos trackeados bajo `server-release/`
— `MANIFEST.sha256`, `RELEASE_INFO.txt`, dos `package.json`/
`package-lock.json` de `app/`, un `.env.production.example`, 8 documentos
en `docs/` (incluido este runbook), `scripts/smoke-test.mjs`,
`scripts/verify-release.mjs`, y `staging/.env.staging.example` — **ninguno
es SQL**. `git ls-files -- server-release | grep '\.sql$'` no produce
resultados. La conclusión operativa de 44.E sigue siendo válida aunque su
justificación factual estuviera mal enunciada: **no existe baseline SQL
canónico bajo ningún contenido trackeado de `server-release/`** — la única
fuente SQL de baseline en todo el repositorio sigue siendo
`supabase/self-hosted/0001`–`0008` (Sección 44.E, sin cambios en esa
parte).

### 45.E — Por qué las formas finales de `self-hosted/` NO son T0 (reafirmado, con evidencia adicional)

Confirmado con más profundidad que en 44.F/44.G: **ninguna** de las
columnas legacy de `clients` en el Cloud real (`dni`, `document_type`,
`document_number`, `whatsapp`, `occupation`, `address`, `birthdate`,
`civil_status`, `notes`, `process_type`) ni las de `cases`
(`case_stage`, `court`, `judicial_district`, `judge_or_prosecutor`,
`demandante`, `demandado`, `juzgado`) existen en
`supabase/self-hosted/0003_domain_tables.sql`. Si `0003` se hubiera usado
como T0 (como proponía el MODEL B de la Sección 44.L), la migración
`20260724000000_bulk_import_support.sql` habría fallado en su primera
sentencia (`alter table public.clients alter column dni drop not null` —
`ERROR: column "dni" of relation "clients" does not exist`, SQLSTATE
`42703`), un colapso estructural equivalente al que ya ocurrió con
`clients` completa en el intento real. El pedido tenía razón en bloquear
la implementación del MODEL B tal como estaba planteado.

### 45.F — Metodología de reconstrucción T0 exacta

Fuente primaria nueva: `audit/self-hosted-migration/cloud-schema.sql`, un
`pg_dump --schema-only` real (154 344 bytes, `COPY`/`INSERT` = 0,
confirmado en `audit/self-hosted-migration/cloud-inventory.md:20-28`) del
proyecto Cloud legacy `pnqdgwpxcxngeueosmnh`, capturado el 2026-08-07.
Contiene `CREATE TABLE "public"."clients"` (línea 1715),
`"public"."cases"` (1588), `"public"."profiles"` (1920),
`"public"."payments"` (1899), `"public"."payment_records"` (1881),
`"public"."agenda_events"` (1433) y `"public"."documents"` (1787) con DDL
completo — columnas, tipos, defaults, `CHECK`, PK/FK/índices/triggers en
secciones posteriores del mismo archivo. Esta NO es la forma T0: es una
instantánea posterior, con un subconjunto de migraciones ya aplicado a
ese Cloud. **Hallazgo adicional, no anticipado:** la aplicación de
migraciones a ese Cloud fue selectiva y no estrictamente cronológica —
el dump refleja `cases.materia` (migración `20260727000000`) y
`documents.relative_path`/`content_hash` (migración `20260724000000`,
anterior), pero **no** refleja `documents.folder_id`
(`20260725120000`, cronológicamente ANTERIOR a `20260727000000`) ni las
columnas de sync de `agenda_events` (`20260729212000`) ni el `DROP` de
columnas legacy (`20260729213000`, confirmado también por
`cloud-vs-repository.md`, que documenta manualmente esta misma brecha).
Esto es consistente con la conclusión ya registrada en ese documento:
"El historial `supabase_migrations.schema_migrations` no representa el
Cloud" — Cloud recibió cambios manuales fuera de las migraciones
trackeadas. **Consecuencia metodológica:** no se puede "restar
mecánicamente" cada migración del dump en orden — cada columna del dump
se verificó **individualmente** contra el archivo de migración concreto
que la introduce (`grep` del nombre de columna/trigger/constraint en los
34 archivos), no se asumió que el dump = T0 + todas las migraciones hasta
esa fecha.

### 45.G — Ledger T0 por tabla

**`public.profiles`** — ninguna de las 34 migraciones contiene `alter
table public\.profiles\b` salvo `20260713150000` (solo
`ENABLE ROW LEVEL SECURITY`, ninguna columna). T0 = exactamente la forma
del dump (línea 1920): `id uuid NOT NULL` (FK a `auth.users`, sin
`DEFAULT` propio — lo asigna quien inserta), `full_name text NOT NULL`,
`email text NOT NULL`, `phone text`, `role text DEFAULT 'Personal'
NOT NULL` (`CHECK role IN ('Administrador','Personal')`), `status text
DEFAULT 'Activo' NOT NULL` (`CHECK status IN ('Activo','Inactivo')`),
`initials text NOT NULL`, `created_at timestamptz DEFAULT now()
NOT NULL`. **RLS en T0: DESHABILITADA** — la habilita recién
`20260713150000` (migración #2, posterior a la que falla). Ninguna
policy existe en T0 (las 2 policies de `profiles` no aparecen en ningún
`grep` de las 34 migraciones antes de `20260721140000_revoke_anon_write_permissions.sql`
— fuera del rango de esta tabla, no se investiga más porque no es
prerrequisito de `20260713131000`). Trigger `on_auth_user_created` /
función `handle_new_user`: **no verificado en esta fase** — no aparece
`CREATE FUNCTION public.handle_new_user` en ninguna de las 34 migraciones
(confirmado por grep), por lo que su origen exacto y su estado en T0
queda **UNKNOWN** (existe en `self-hosted/0004`+`0005` y,
presumiblemente, en Cloud fuera de cualquier migración trackeada — no
verificable desde el repositorio sin más evidencia).

**`public.clients`** — T0 reconstruido revirtiendo dos migraciones
verificadas: `20260724000000_bulk_import_support.sql` (`dni`, `phone`,
`process_type` eran `NOT NULL` antes de esa migración — confirmado
porque el propio archivo dice literalmente `alter column X drop not
null`, lo que solo tiene sentido si X era `NOT NULL`) y
`20260729213000_drop_deprecated_client_case_fields.sql` (posterior a
T0, irrelevante para T0 en sí, pero confirma que esas columnas existían
hasta esa fecha). Ninguna otra migración de las 34 toca `clients`
estructuralmente antes de esas dos. T0 = forma del dump (línea 1715) con
`dni`/`phone`/`process_type` revertidos a `NOT NULL`:

`id uuid DEFAULT gen_random_uuid() NOT NULL`, `name text NOT NULL`,
`initials text NOT NULL`, `color text DEFAULT 'oklch(0.55 0.13 235)'
NOT NULL`, `dni text NOT NULL` (T0), `phone text NOT NULL` (T0), `email
text`, `address text`, `birthdate date`, `civil_status text`,
`process_type text NOT NULL` (T0), `status text DEFAULT 'Activo'
NOT NULL` (`CHECK IN ('Activo','En espera','Cerrado')`), `registered_at
date DEFAULT CURRENT_DATE NOT NULL`, `created_at timestamptz DEFAULT
now() NOT NULL`, `document_type text DEFAULT 'DNI' NOT NULL`,
`document_number text`, `whatsapp text`, `occupation text`, `notes
text`, `updated_at timestamptz DEFAULT now() NOT NULL`, `created_by
uuid` (FK a `profiles`, `ON DELETE SET NULL`, presente en dump, ninguna
migración la toca → T0). **RLS: DESHABILITADA en T0** (igual que
`profiles`, la habilita `20260713150000`). Índices `clients_document_number_idx`
y `clients_phone_idx`: presentes en el dump, ninguna migración de las 34
los crea → **existían en T0** (evidencia: ausencia total de `create
index` sobre `clients` en cualquiera de los 34 archivos). Trigger
`clients_set_updated_at`: creado por `20260721090000` (migración #4,
confirmado línea 403-405 de ese archivo) → **NO existe en T0**.

**`public.cases`** — mismo método. Ninguna migración toca `cases`
estructuralmente antes de T0 (las primeras alteraciones estructurales
son `20260724120000_fix_cases_status_check_constraint.sql`, posterior).
`materia` (dump) proviene de `20260727000000_add_cases_materia.sql`
→ **no existe en T0**, se resta. Las columnas legacy judiciales
(`juzgado`, `demandante`, `demandado`, `case_stage`, `court`,
`judicial_district`, `judge_or_prosecutor`) no las toca ninguna
migración antes de `20260729213000` (posterior a T0) → existían en T0
sin cambios. T0:

`id uuid DEFAULT gen_random_uuid() NOT NULL`, `client_id uuid NOT NULL`
(FK a `clients`, `ON DELETE CASCADE`), `expediente text NOT NULL`,
`process_type text NOT NULL`, `priority text DEFAULT 'Media' NOT NULL`
(`CHECK IN ('Alta','Media','Baja')`), `next_hearing timestamptz`,
`status text DEFAULT 'Pendiente de clasificación' NOT NULL` (el `CHECK
cases_status_check` del dump ya incluye `pendiente_revision`, cuyo
origen exacto dentro de las 34 migraciones no se rastreó en esta fase —
**UNKNOWN si ese valor del CHECK ya estaba en T0 o se añadió después**;
no se afirma sin verificar), `juzgado text`, `demandante text`,
`demandado text`, `created_at timestamptz DEFAULT now() NOT NULL`,
`internal_code text`, `case_name text`, `case_type text`, `legal_area
text`, `case_stage text`, `court text`, `judicial_district text`,
`case_number text`, `case_year integer`, `judge_or_prosecutor text`,
`filing_date date`, `closing_date date`, `current_summary text`,
`current_status_description text`, `last_action_date date`,
`next_action text`, `responsible_user_id uuid` (FK a `profiles`, `SET
NULL`), `updated_at timestamptz DEFAULT now() NOT NULL`, `created_by
uuid` (FK a `profiles`, `SET NULL`) — **sin** `materia` (T0). **RLS:
DESHABILITADA en T0.** Índices `cases_case_number_idx`,
`cases_client_status_idx`, `cases_responsible_idx`: en el dump, ninguna
migración los crea → T0 (`cases_materia_idx` sí depende de `materia`,
que no existe en T0 → **no existe en T0**, lo crea
`20260727000000` junto con la columna). Trigger `cases_set_updated_at`:
creado por `20260721090000` → **NO existe en T0**.

**`public.payments`** — `case_id` proviene de `20260721090000` (línea
108: `alter table public.payments add column if not exists case_id
uuid …`) → no existe en T0. Ninguna otra migración toca `payments`
estructuralmente antes de T0. T0 = dump sin `case_id`: `id uuid DEFAULT
gen_random_uuid() NOT NULL`, `client_id uuid NOT NULL` (FK `clients`,
`CASCADE`), `service text NOT NULL`, `fees numeric(12,2) NOT NULL`,
`paid numeric(12,2) DEFAULT 0 NOT NULL`, `total_installments integer
DEFAULT 1 NOT NULL`, `paid_installments integer DEFAULT 0 NOT NULL`,
`status text DEFAULT 'Pendiente' NOT NULL` (`CHECK IN
('Pagado','Parcial','Pendiente','Vencido')`), `created_at timestamptz
DEFAULT now() NOT NULL`. **RLS: DESHABILITADA en T0.** Índice
`payments_case_id_idx` depende de `case_id` → no existe en T0 (lo crea
`20260721090000` junto con la columna, por evidencia consistente, no
verificado línea a línea en esta fase — marcado como inferencia de alta
confianza, no como hecho confirmado).

**`public.payment_records`** — ninguna de las 34 migraciones contiene
`alter table public\.payment_records\b` (confirmado, cero resultados).
T0 = forma del dump sin cambios: `id uuid DEFAULT gen_random_uuid()
NOT NULL`, `payment_id uuid NOT NULL` (FK `payments`, `CASCADE`),
`amount numeric(12,2) NOT NULL`, `method text NOT NULL`, `receipt
text`, `notes text`, `payment_date date DEFAULT CURRENT_DATE NOT NULL`,
`created_at timestamptz DEFAULT now() NOT NULL`. **RLS: DESHABILITADA
en T0.**

**`public.agenda_events`** — `case_id` proviene de la migración que
falla justo después de la primera
(`20260713150000_usability_timezone_case_links_and_rls.sql`, línea 6-7,
confirmado). Las columnas de sync de Google
(`google_event_id`/`google_calendar_id`/`google_etag`/
`google_updated_at`/`google_html_link`/`sync_status`/`sync_error`/
`last_synced_at`/`sync_origin`/`deleted_at`) provienen de
`20260729212000_google_calendar_sync.sql` (muy posterior). T0 = dump sin
`case_id` ni columnas de sync: `id uuid DEFAULT gen_random_uuid()
NOT NULL`, `title text NOT NULL`, `type text DEFAULT 'Cita' NOT NULL`
(`CHECK IN ('Audiencia','Cita','Recordatorio')`), `event_date date
NOT NULL`, `event_time time NOT NULL`, `location text`, `client_id
uuid`, `created_at timestamptz DEFAULT now() NOT NULL`, `gcal_event_id
text` (legado, presente ya en T0 según el dump, ninguna migración lo
crea ni lo toca — **UNKNOWN si tenía otro nombre/forma antes de T0**,
no hay evidencia anterior). **RLS: DESHABILITADA en T0.** Índice
`agenda_events_case_id_idx` depende de `case_id` → no existe en T0, lo
crea `20260713150000` junto con la columna (confirmado, línea 9-10 del
mismo archivo).

**`public.documents`** — `original_name` de `20260721090000` (línea
110); `relative_path`/`content_hash` de `20260724000000` (líneas
50-59); `folder_id` de `20260725120000` (no verificado en detalle en
esta fase por no ser prerrequisito de `20260713131000`, pero confirmado
ausente del dump y por tanto ausente en T0 con más razón). Ninguna otra
alteración estructural de `documents` ocurre antes de T0. T0 = dump sin
`original_name`, `relative_path`, `content_hash` (y sin `folder_id`,
que de todas formas no aparece en el dump): `id uuid DEFAULT
gen_random_uuid() NOT NULL`, `name text NOT NULL`, `type text
NOT NULL`, `size text NOT NULL`, `storage_path text NOT NULL`,
`client_id uuid`, `case_id uuid`, `uploaded_at date DEFAULT
CURRENT_DATE NOT NULL`, `created_at timestamptz DEFAULT now()
NOT NULL`, `display_name text`, `document_type text`, `mime_type
text`, `source_type text DEFAULT 'supabase_storage' NOT NULL`,
`source_provider text`, `external_file_id text`, `external_folder_id
text`, `external_url text`, `document_date date`, `file_size bigint`,
`checksum text`, `processing_status text DEFAULT 'pending' NOT NULL`,
`verification_status text DEFAULT 'pending' NOT NULL`,
`is_confidential boolean DEFAULT false NOT NULL`, `updated_at
timestamptz DEFAULT now() NOT NULL`, `created_by uuid` (FK
`profiles`, `SET NULL`). `client_id`/`case_id` ya son FKs a
`clients`/`cases` en el dump (`ON DELETE SET NULL` ambas) — ninguna
migración de las 34 las crea ni las toca estructuralmente antes de T0
→ **existían en T0** (evidencia por ausencia, mismo método que
`gcal_event_id`). **RLS: DESHABILITADA en T0.** Índices
`documents_case_processing_idx`, `documents_client_id_idx`,
`documents_external_file_idx`: dependen de columnas que no existen en
T0 (`processing_status` sí existe en T0 según el dump, pero no se
verificó en esta fase si el índice compuesto ya existía en T0 o se creó
después — **UNKNOWN**, no se afirma). Trigger
`documents_set_updated_at`: creado por `20260721090000` → NO existe en
T0. Triggers `documents_validate_relationship`/`documents_audit_metadata`:
creados por `20260806120000_crm_daily_tasks_and_document_integrity.sql`
(confirmado, líneas 203-206 y 258-261) → NO existen en T0.

### 45.H — Auditoría de colisión hacia adelante (hallazgos concretos)

Dos colisiones reales identificadas, ambas ya resueltas por el propio
diseño de las migraciones (no requieren cambio de las 34 migraciones —
son exactamente el tipo de verificación que el pedido exige antes de
aceptar cualquier baseline):

1. `20260724000000_bulk_import_support.sql:35-42` — `ALTER COLUMN dni/
   phone/process_type DROP NOT NULL`. **T0-compatible** solo si T0
   define esas tres columnas como `NOT NULL` (confirmado en 45.G) — un
   baseline que las omitiera (como `self-hosted/0003`) o las creara
   nullable habría causado `42703` (columna inexistente) o un no-op
   silencioso sobre una constraint que nunca existió, respectivamente.
   **Riesgo: ALTO si se usa la forma final; NULO con el T0 de 45.G.**
2. `20260729213000_drop_deprecated_client_case_fields.sql` — `DROP
   COLUMN IF EXISTS` sobre las 10 columnas legacy de `clients` y 7 de
   `cases`. Uso de `IF EXISTS` la hace **segura en ambos sentidos**: si
   el baseline las crea (T0 correcto), se eliminan como se espera; si un
   baseline futuro decidiera no crearlas, la migración no fallaría (solo
   dejaría de tener efecto) — pero eso divergiría silenciosamente del
   esquema real de producción, que si las tiene. **Riesgo: BAJO
   (protegido por `IF EXISTS`), pero con divergencia silenciosa si el T0
   usado no coincide con 45.G.**

Ninguna otra operación estructural de las 34 migraciones sobre las 7
tablas candidatas usa una forma no idempotente contra su propio T0
reconstruido (todas las `ADD COLUMN` usan `IF NOT EXISTS`; los `CREATE
TRIGGER` usan `DROP TRIGGER IF EXISTS` antes; los `CREATE INDEX` usan
`IF NOT EXISTS`). El único patrón no idempotente detectado es
precisamente el de la colisión 1 (`ALTER COLUMN ... DROP NOT NULL`, que
no acepta `IF EXISTS`) — ya cubierto arriba.

### 45.I — Dependencias no tabulares antes de `20260713131000`

Auditado explícitamente (no asumido "exactamente siete tablas"):
**funciones** — la migración que falla usa subconsultas SQL directas
contra `public.profiles` (`exists (select 1 from public.profiles p
where p.id = auth.uid() and p.role in (...))`), **no** llama a
`is_staff()`/`is_admin()`/`crm_is_active_staff()`/`crm_is_active_admin()`
— confirmado leyendo el archivo completo. Ninguna función es
prerrequisito. **Tipos/enums** — cero `CREATE TYPE` en las 34
migraciones (confirmado por grep ya hecho en 44.K, reafirmado). **Roles**
— ninguna migración crea roles; todas asumen `anon`/`authenticated`/
`service_role` provistos por la plataforma. **Extensiones** — solo
`pgcrypto`, y no la usa `20260713131000` (usa `gen_random_uuid()`
nativo). **Secuencias/vistas** — ninguna en el alcance de estas 7 tablas.
**RLS/policies** — como estableció 45.G, RLS está **deshabilitada en las
7 tablas en T0**; ninguna policy preexiste. Esto significa que
`20260713131000` en sí misma es la que primero introduce policies sobre
una tabla nueva (`client_reports`) mientras las 7 tablas base permanecen
sin RLS un migración más — no es una dependencia faltante, es el estado
real esperado.

### 45.J — Hechos históricos irreconstruibles (marcados UNKNOWN)

Listados explícitamente, sin inferencia:
- Origen y forma exacta de `handle_new_user()`/`on_auth_user_created`
  antes de T0 (45.G, `profiles`).
- Si `cases_status_check` ya incluía `pendiente_revision` en T0 o se
  añadió por una migración no identificada en esta fase.
- Forma/origen de `agenda_events.gcal_event_id` antes de T0 (pudo
  llamarse distinto o no existir en una versión aún más antigua no
  capturada por ningún artefacto del repositorio).
- Si los tres índices de `documents` (`case_processing`, `client_id`,
  `external_file`) ya existían en T0 o se crearon junto con columnas
  posteriores no verificadas línea por línea.
- Estado exacto de grants (`GRANT`/`REVOKE`) en T0 para las 7 tablas —
  no auditado en esta fase; `20260721130000_grant_table_permissions.sql`
  y `20260721140000_revoke_anon_write_permissions.sql` sugieren que el
  estado de grants cambió varias veces, pero su forma en T0 específica
  no se derivó.
Ninguno de estos puntos bloquea el bootstrap de un Hosted/self-hosted
fresco (T0 no necesita replicar exactamente el histórico de producción,
solo ser un punto de partida válido para que las 34 migraciones
apliquen limpio) — sí bloquean la afirmación de que un T0 escrito hoy
sería *idéntico* al T0 histórico real de producción en estos puntos
concretos.

### 45.K — Reconciliación T0 + 34 migraciones = esquema del release actual

Verificación conceptual, objeto por objeto donde fue posible: las 7
tablas de 45.G, aplicando en orden las 34 migraciones (cada `ADD
COLUMN IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`/`DROP TRIGGER IF
EXISTS; CREATE TRIGGER` ya confirmados en 45.G/45.H), llegan
exactamente a las formas documentadas en
`docs/database/self-hosted-canonical-model.md` para `profiles`,
`clients` (sin las 10 columnas legacy, que `20260729213000` elimina),
`cases` (sin las 7 legacy, con `materia`), `payments` (con `case_id`),
`payment_records` (sin cambios), `agenda_events` (con `case_id` y las
10 columnas de sync), `documents` (con `original_name`,
`relative_path`, `content_hash`, `folder_id`). Esto confirma que **T0 +
34 migraciones reproduce el modelo final ya documentado**, no un
esquema distinto — la única fuente de verdad que faltaba era T0 mismo,
no las 34 migraciones ni el modelo final. Conteos (`25`
tablas/`21` funciones/`24` triggers/`82` policies de
`self-hosted-canonical-model.md`) se usan aquí solo como checksum
secundario — coinciden con la clasificación de 43.J sobre qué
migraciones aportan qué, no se usan como sustituto del DDL objeto por
objeto ya verificado en 45.G.

### 45.L — MODEL B1 (T0 histórico + 34 migraciones existentes)

Migración nueva con timestamp anterior a `20260713131000` (ej.
`20260713120000_bootstrap_application_t0.sql`), con el DDL exacto de
45.G para las 7 tablas — RLS deshabilitada, sin triggers, sin índices
dependientes de columnas posteriores, columnas legacy incluidas con su
nullability T0. **Fresh Hosted:** aplica limpio, `db push` normal (0
filas en `schema_migrations`, sin conflicto de orden). **Fresh
self-hosted:** igual, si se aplica junto con `self-hosted/0001` (el
guard de versión) mientras `self-hosted/0002`-`0008` quedan sin usar
para esta ruta (son la forma final, no T0 — ver 44.F/45.E). **Producción
actual:** ver 45.Q — requiere `migration repair`, no `db push` directo,
porque producción ya tiene estos objetos con forma T0-compatible pero
nunca ejecutó este archivo. **Historial de migraciones:** limpio, sin
historia falsa en fresh; requiere una decisión explícita en producción
(45.Q). **CI futuro:** trivial, es solo un archivo más en la carpeta.
**Disaster recovery:** reproducible determinísticamente desde el
repositorio, sin depender de ningún dump externo una vez escrito.
**Riesgo:** el DDL de 45.G tiene puntos `UNKNOWN` (45.J) que deben
resolverse o aceptarse explícitamente como no bloqueantes antes de
escribir el archivo real.

### 45.M — MODEL C1 (bootstrap dedicado fuera de `supabase/migrations` + cadena existente)

Un directorio separado (ej. `supabase/bootstrap-t0/`) con el mismo DDL
de 45.G, invocado explícitamost **antes** de `supabase db push`, nunca
registrado en `supabase_migrations.schema_migrations`. **Fresh
Hosted/self-hosted:** funciona igual que B1 en la práctica, pero exige
un paso manual/scriptado adicional fuera del flujo estándar de
Supabase CLI (nadie que solo corra `supabase db push` sobre un proyecto
vacío lo aplicaría — el fallo original de esta misma fase B2B-0B2 es
exactamente ese escenario). **Producción:** no aplica, porque nunca se
ejecutaría contra producción de todos modos (production ya tiene el
esquema) — pero tampoco deja rastro en `schema_migrations`, lo que
contradice el requisito de auditabilidad ("no debe haber estado sin
representar en el historial de migraciones" — implícito en el pedido
original de fase B2B-0B2B, Sección 12). **Riesgo:** mayor que B1 por
depender de que alguien recuerde ejecutar un paso fuera del flujo
estándar — el propio incidente que originó esta fase es evidencia
directa de ese riesgo.

### 45.N — MODEL C2 (squash/baseline controlado con tratamiento separado por entorno)

Una sola fuente DDL versionada (el T0 de 45.G) generatriz de DOS
artefactos derivados mecánicamente (no mantenidos a mano por separado):
(a) la migración timestamped de MODEL B1 para el flujo `supabase db
push`, y (b) una regeneración automática de `supabase/self-hosted/0002`-
`0003` (Sección 45.S) a partir de T0 + 34 migraciones, en vez de mantenerlas
manualmente divergentes como hoy. **Fresh Hosted/self-hosted/CI:** igual
que B1. **Producción:** igual que B1 (45.Q). **Mantenibilidad:** superior
a B1 y C1 — elimina la doble fuente de verdad de raíz (Sección 45.S) en
vez de solo resolver el incidente puntual. **Riesgo:** requiere construir
el script de regeneración (trabajo adicional no trivial, fuera del
alcance de esta fase de solo auditoría).

### 45.O — Modelo recomendado

**B1 para resolver el incidente inmediato (bootstrap de "CRM Drive
Staging"), con una nota de intención hacia C2 como dirección futura de
arquitectura (Sección 45.S).** No se elige B1 "por ser el más simple" —
se elige porque es el único que (a) usa el flujo estándar de Supabase
CLI sin pasos manuales adicionales que ya demostraron ser el punto de
fallo original, (b) deja un registro auditable en
`schema_migrations` para fresh, y (c) tiene una ruta de adopción de
producción explícita y controlada (`migration repair`, no ejecución) en
vez de ambigua. C1 se descarta por el riesgo ya materializado de "paso
fuera del flujo estándar olvidado". C2 se recomienda como evolución
posterior, no como sustituto de B1 en esta fase.

### 45.P — Diseño de precondición tri-estado (solo diseño, sin SQL)

Antes de ejecutar el archivo de MODEL B1 contra cualquier entorno, un
preflight de solo lectura debe clasificar el estado en exactamente una
de tres categorías, y **abortar** (no continuar, no reparar
automáticamente) en el caso C:

- **A — FRESH:** `to_regclass('public.profiles')`,
  `to_regclass('public.clients')`, `to_regclass('public.cases')`,
  `to_regclass('public.payments')`, `to_regclass('public.payment_records')`,
  `to_regclass('public.agenda_events')`, `to_regclass('public.documents')`
  son **todos** `NULL` → proceder con `CREATE TABLE` normal (sin `IF NOT
  EXISTS` necesario, porque se confirmó que ninguna existe).
- **B — EXISTING:** los 7 `to_regclass(...)` son **todos** no-`NULL` →
  no ejecutar ningún `CREATE TABLE`; el baseline se considera
  semánticamente ya satisfecho — este es el caso de producción, resuelto
  vía `migration repair`, nunca vía ejecución (45.Q).
- **C — PARTIAL:** cualquier combinación distinta de "todos ausentes" o
  "todos presentes" → **ABORT**, sin ejecutar nada, con un mensaje que
  liste exactamente qué subconjunto existe. Este es el estado más
  peligroso — indica un bootstrap previo interrumpido o un entorno
  manualmente alterado, y no debe resolverse automáticamente en ninguna
  dirección.

Diseño únicamente — no se implementa ningún script de precondición en
esta fase.

### 45.Q — Estrategia de adopción para producción existente

Investigado (sin ejecutar nada, sin conexión): el comportamiento
documentado de `supabase db push` aplica, en orden ascendente de
versión, únicamente las migraciones locales cuya versión **no** está
todavía en `supabase_migrations.schema_migrations` remoto; si se
introduce un archivo local con timestamp anterior al último ya
registrado remotamente, el CLI trata eso como migraciones locales
"fuera de orden" y por defecto no las aplica silenciosamente entre las
ya aplicadas — el flag `--include-all` existe específicamente para
forzar la inclusión de migraciones locales pendientes que no siguen el
orden esperado. `migration repair` es un comando **distinto**: escribe
o corrige filas de `supabase_migrations.schema_migrations`
(`--status applied` / `--status reverted`) **sin ejecutar SQL alguno** —
es bookkeeping puro sobre el historial, no una operación de esquema.

**Diseño de adopción (no ejecutado en esta fase):**
- **Fresh Hosted/self-hosted (caso A de 45.P):** `db push` normal, sin
  `--include-all` (no hay migraciones remotas previas con las que
  desincronizarse — `schema_migrations` remoto tiene 0 filas, como
  confirma la Sección 44.D).
- **Producción existente (caso B de 45.P, evidencia de 45.G/45.J: los
  objetos ya existen con forma T0-compatible):** **nunca** `db push` del
  archivo T0 contra producción. En su lugar, `supabase migration repair
  --status applied <version-del-archivo-T0>` — declara que esa versión
  ya está satisfecha sin ejecutar su SQL, exactamente como sugiere el
  pedido en su Sección 11 ("puede evaluarse como mecanismo de
  baselining controlado porque solo cambia el historial de
  migraciones"). Esto es **narrow y explícito**: se usa `repair` para
  UNA sola migración sintética cuyo contenido es demostrablemente ya
  cierto en producción (45.G) — no para "reparar" ninguna otra
  discrepancia real detectada en `cloud-vs-repository.md` (esas siguen
  sin resolverse y están fuera del alcance de esta fase).
- **Estado C (parcial) en cualquier entorno:** no hay estrategia
  automática — requiere intervención humana explícita, según el diseño
  de 45.P.

No se ejecuta ningún `db push`, `--include-all` ni `migration repair`
en esta fase — es diseño, pendiente de autorización.

### 45.R — Requisito de clon de producción

**`PRODUCTION_BASELINE_COMPATIBILITY = UNVERIFIED`** hasta que exista un
ensayo real: `pg_dump` schema-only de producción (o del propio
`cloud-schema.sql` ya disponible, si se confirma que sigue
representativo) restaurado en una instancia desechable, seguido de
`migration repair --status applied` para la versión T0 y `db push
--dry-run` para las 34 migraciones existentes, observando que no se
proponga ningún `CREATE TABLE`/`ALTER` sobre las 7 tablas base. No
ejecutado en esta fase — ni conexión ni restauración ocurrieron. Esta
clasificación reemplaza cualquier afirmación previa de compatibilidad
"segura" con producción (44.M usaba ese lenguaje sobre el MODEL B
original, ya descartado en 45.E).

### 45.S — Futuro de `supabase/self-hosted/0001`–`0008`

Recomendación: **Opción C con matiz — regenerar 0002–0008 a partir de
la única fuente de verdad (T0 de 45.G + las 34 migraciones), en vez de
mantenerlos escritos a mano por separado; conservar 0001 tal cual (es
un guard de precondición de plataforma, no un objeto de esquema, no
tiene "fuente" de la que derivarse).** Esto responde directamente al
objetivo de minimizar fuentes de verdad duplicadas (pedido, Sección 14):
hoy existen dos definiciones manuales independientes de `clients`
(self-hosted final vs. lo que las 34 migraciones realmente producen), y
ya se demostró en 45.E que pueden divergir de forma peligrosa. La
Opción A (mantenerlos como bootstrap de despliegue separado, sin
cambios) perpetúa esa duplicación. La Opción B (regenerar una vez y
congelar) resuelve el incidente puntual pero vuelve a divergir en la
próxima migración nueva. La opción recomendada aquí es una variante de
B con regeneración **mecánica y repetible**, no una tarea manual
puntual — no implementada en esta fase, es una dirección, no una
migración de código.

### 45.T — Diseño de aprovisionamiento del bucket `documents`

Sin decidir el mecanismo (SQL vs. Dashboard vs. API), tal como pide el
pedido. Determinado por evidencia: el bucket debe existir **antes de
que cualquier usuario final suba/lea un documento**, pero **no bloquea**
la aplicación de ninguna de las 34 migraciones (ninguna migración
inserta en `storage.buckets` ni falla si el bucket no existe —
confirmado en 43.Q/44.Q, las policies de `storage.objects` simplemente
no coinciden con ninguna fila hasta que el bucket exista). Por tanto:
**bucket después del bootstrap de esquema, antes del primer uso
funcional de Documentos** — ni "antes del arranque de la app" (la app
arranca igual sin él) ni "antes de las migraciones" (no hay
dependencia). Privado (`public=false`, confirmado en `self-hosted/0007`
y en el propio patrón de policies `crm_documents_*`). Policies
requeridas: 4 base (`select`/`insert`/`update` staff activo, `delete`
admin activo, `self-hosted/0007`) + 2 adicionales `RESTRICTIVE`
acotadas al prefijo `templates/` dentro del mismo bucket
(`20260822110000_add_templates.sql`, confirmado en 43.Q — `templates`
no es un bucket separado). Límites de archivo: `file_size_limit` y
`allowed_mime_types` ambos `NULL` (sin restricción) en el único diseño
documentado (`self-hosted/0007`) — no hay evidencia de un límite
distinto requerido en ningún otro archivo del repositorio. No se crea
ningún bucket en esta fase.

### 45.U — Archivos modificados en esta fase

Únicamente `server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md`
(esta Sección 45). Ningún archivo de `supabase/migrations/` ni de
`supabase/self-hosted/` fue tocado. El script `manifest-v1.mjs` usado en
45.C se escribió y ejecutó exclusivamente en el directorio scratchpad de
la sesión, fuera del repositorio — no se creó ningún archivo nuevo
dentro de `advocate-nest/`.

### 45.V — Gates

`npx tsc --noEmit`: limpio, 0 errores. `npm run lint`: 0 errores, 7
warnings preexistentes sin cambios. `npm test`: **66 archivos, 1649
passed, 0 skipped, 0 failed** — coincide exactamente con el baseline
canónico. No se ejecutó build (no requerido).

### 45.W — Diff

`git status --short` / `git diff --name-status` / `git diff --stat` /
`git diff --check` ejecutados antes y después de escribir esta sección.
Único archivo modificado: este runbook. Ningún cambio en migraciones ni
en runtime. Ningún secreto. Los 13 elementos untracked históricos
permanecen intactos.

### 45.X — Bloqueadores antes de implementación

- Autorización humana explícita para escribir el archivo de migración
  T0 real (MODEL B1, 45.L) con el DDL exacto de 45.G — no se crea en
  esta fase.
- Resolución explícita de los puntos `UNKNOWN` de 45.J — decidir si se
  aceptan como no bloqueantes (T0 no necesita ser bit-perfecto respecto
  al histórico real de producción, solo válido para que las 34
  migraciones apliquen) o si se investigan más antes de escribir el
  archivo.
- Ensayo contra clon de producción (45.R) antes de considerar
  `PRODUCTION_BASELINE_COMPATIBILITY` verificado.
- Diseño e implementación del script de precondición tri-estado (45.P)
  antes de que el archivo T0 se pueda ejecutar de forma segura contra un
  entorno de estado desconocido.
- Decisión explícita sobre `migration repair` para producción (45.Q) —
  evaluada aquí, no aprobada para ejecución.
- Decisión sobre la dirección de `supabase/self-hosted/` (45.S) — no
  tomada, solo recomendada.
- `EXPECTED_STAGING_SUPABASE_PROJECT_REF`/`STAGING_DB_URL` reales siguen
  sin existir en el repositorio (sin cambios respecto a 43.Z/44.V).

**Confirmación de alcance de esta fase (sin excepciones):**
NO escritura remota. NO acceso a producción. NO implementación de
migración. NO modificación de migraciones existentes. NO `migration
repair` ejecutado. NO reset. NO commit. NO push.

**No se implementa nada de la Sección 45 en esta fase — queda en espera
de revisión.**

## 46. Fase 8I-B2B-0B2B-R2 — Arqueología Git y contrato T0 completo

**Estado de entrada:** B2B-0B2B-R1 quedó **AUDIT APPROVED / IMPLEMENTATION
BLOCKED**. El pedido de esta fase exige usar `git log`/`git show` como
fuente primaria en vez de la reversión desde `audit/cloud-schema.sql`
(reclasificado aquí como evidencia secundaria), y resolver explícitamente
los `UNKNOWN` de 45.J. El resultado superó lo esperado: existe un archivo
`.sql` **trackeado en git desde el primer commit real del repositorio**,
nunca detectado en las fases anteriores.

### 46.A — Precheck

`release/crm-2026-08-stabilization`, `29b1532be6a7997b5d21341e19765658948f85c5`,
divergencia `0 0`, árbol limpio salvo este runbook (ya modificado por R/R1,
como anticipaba el pedido), 13 elementos untracked históricos intactos.
**PASS.**

### 46.B — Verificación de MANIFEST_V1

Recalculado con el mismo script determinista de la Sección 45:
`MIGRATION_COUNT = 34`, `MANIFEST_V1_SHA256 =
b3fc4909efbf9a3001249e6fdf354cbe4c35b0a59ba036f6e7257ceedc87b214` —
**idéntico** al valor congelado como canónico. Los 34 archivos de
`supabase/migrations/` permanecen byte-idénticos.

### 46.C — Clasificación de `audit/`

`audit/self-hosted-migration/cloud-schema.sql` se reclasifica como
**`SECONDARY_FINAL_STATE_EVIDENCE`**, tal como exige el pedido — no se
usa como fuente canónica de T0 en esta fase (sí se usó para eso en 45.F,
lo cual el pedido corrigió explícitamente). SHA-256 registrado para
evidencia, sin escribir ni copiar el archivo a ninguna ruta trackeada:
`2ddc67b2b77ba15d221c2a56eef8c30bb866778f362c964ef5c9a9912b6d201b`
(verificado en 64 caracteres con `wc -c`). **Nota positiva de control:**
este valor coincide, salvo mayúsculas/minúsculas, con el SHA-256 que el
propio `audit/self-hosted-migration/cloud-inventory.md:23` afirma para
ese mismo archivo — a diferencia del manifest disputado en R1, esta
afirmación previa **sí es reproducible**. `audit/` no fue añadido a
staging, no fue comiteado, no fue modificado.

### 46.D — Fuentes históricas encontradas en Git (hallazgo principal de esta fase)

`git log --all` sobre 157 commits totales (el primero, `cb75921`, es el
scaffold de plantilla fechado `2025-01-01` — fecha de plantilla, no de
desarrollo real; el desarrollo real empieza `2026-06-29`). Búsqueda con
`git log --all --diff-filter=A --name-status -- supabase/migrations`
confirmó que **todas** las 34 migraciones entraron a git ya como parte de
commits posteriores a julio — ninguna existía antes. Pero
`git ls-tree -r --name-only <commit> | grep -i supabase` sobre el primer
commit grande (`4668d4163c3c0f5b0d4cc14a6e511ee378b77976`, **2026-06-30**,
"feat: CRM completo — PWA, Google Calendar sync, AI Lex, backup Excel,
agenda interactiva") reveló:

```
src/lib/supabase.ts
supabase/schema.sql
```

**`supabase/schema.sql` existe y está trackeado en git desde el primer
commit real de este repositorio — 13 días antes de la migración que
falla.** Esto contradice directamente lo afirmado en la Sección 44.E
("no existe `schema.sql` en ningún nivel del repositorio") — esa
afirmación se basó en un `Glob("**/schema.sql")` sobre el árbol de
trabajo actual en ese momento, que devolvió "No files found" de forma
incorrecta (el archivo sí está en el árbol de trabajo actual, verificado
ahora con `ls`/`git ls-files supabase/schema.sql`, 24196 bytes, 555
líneas). Es el **tercer error propio** detectado en esta investigación
(tras la longitud del manifest en R1 y el conteo de `git ls-files
server-release` en R1) — todos comparten la misma causa raíz: una
herramienta de búsqueda/listado dio un resultado vacío incorrecto en su
primera invocación, y no fue verificado con un método alternativo hasta
que el propietario lo cuestionó. Registrado como patrón para fases
futuras: **cualquier resultado "0"/"no encontrado" de una búsqueda debe
reintentarse con un método distinto antes de reportarse como hecho.**

`git log --all --follow --name-status -- supabase/schema.sql` muestra
exactamente 3 eventos, nunca un `D` (nunca borrado del árbol):

| Commit | Fecha | Evento | Líneas |
|---|---|---|---|
| `4668d4163c3c0f5b0d4cc14a6e511ee378b77976` | **2026-06-30** | `A` (creado) | 336 |
| `8ea5d7c28225c162329106317005710d43db60e2` | 2026-07-21 | `M` | 540 |
| `e5c363bcf743e9c5106b153aaa6ec133893afb6b` | 2026-07-29 | `M` | 555 |

Sin más cambios hasta HEAD (`diff` entre la versión de `e5c363b` y HEAD:
**idéntico**). Como el archivo no se tocó entre el 30 de junio y el 21 de
julio, y la migración que falla es del 13 de julio, **la versión del 30
de junio es exactamente el estado del archivo inmediatamente antes de
`20260713131000`** — evidencia `DIRECT_GIT`, no derivada.
`git ls-tree` sobre los 3 commits anteriores al del 30 de junio (`cb75921`,
`9049c56`, `f9e6c188`) no contiene ningún archivo bajo `supabase/` — no
hay una versión aún más antigua de este archivo ni de ningún otro
artefacto SQL.

**Hallazgo adicional crítico:** la versión de julio 29 (idéntica a HEAD)
añade este encabezado, ausente en junio/julio-21:

> "CRM Estudio Jurídico Arenas — SNAPSHOT DE REFERENCIA. NO ES LA FUENTE
> CANÓNICA DEL ESQUEMA NI DEBE EJECUTARSE EN PRODUCCIÓN. La fuente de
> verdad es `supabase/migrations/`, en orden cronológico… Véase
> `docs/current-state/DATABASE_SCHEMA_SOURCE_OF_TRUTH.md`."

Ese documento existe, está trackeado, y confirma con fecha de decisión
**2026-07-29** (mismo commit): *"Se adopta la estrategia de snapshot
explícitamente no canónico… `supabase/migrations/`, aplicado en orden
cronológico, es la fuente de verdad del esquema esperado por el
código."* Esto es evidencia de primera mano, dentro del propio
repositorio, de que el proyecto ya decidió — hace más de un mes de
tiempo de proyecto — exactamente lo que MODEL B1 (45.L) propone: las
migraciones son la fuente de verdad, no un snapshot de tabla final.

### 46.E — Archivos históricos borrados

`git log --all --diff-filter=D --name-status` sobre rutas SQL/schema no
encontró ningún archivo `.sql` borrado del repositorio en ningún momento
de su historia (`schema.sql` nunca se borró — sigue en el árbol; ningún
otro `*.sql`/`schema*`/`bootstrap*` aparece como `D`). No se usaron
objetos Git inalcanzables — el historial ordinario (`--all`) fue
suficiente.

### 46.F — Reconstrucción T0 exacta con evidencia `DIRECT_GIT`

Fuente primaria: `git show 4668d4163c3c0f5b0d4cc14a6e511ee378b77976:supabase/schema.sql`
(336 líneas). Correcciones concretas frente a la reconstrucción por
reversión de la Sección 45.G, todas con `EVIDENCE_LEVEL = DIRECT_GIT`:

**`public.profiles`** — igual que 45.G en columnas (`id`, `full_name`,
`email`, `phone`, `role` default `'Personal'`, `status` default
`'Activo'`, `initials`, `created_at`). **Corrección: RLS SÍ está
habilitada en T0** (`alter table public.profiles enable row level
security`, línea 65 del archivo T0) — 45.G afirmaba que la habilitaba
recién la migración `20260713150000`; falso, esa migración solo
**reafirma** (`ENABLE ROW LEVEL SECURITY` es idempotente) y **reemplaza**
policies ya existentes. **Policies T0 (evidencia directa, no derivada):**
`profiles_select`/`profiles_insert`/`profiles_update`, las tres
`using (auth.uid() is not null)` — **sin distinción de rol**: cualquier
usuario autenticado puede leer, insertar o actualizar cualquier fila de
`profiles`, incluida la propia y la ajena. Esto coincide exactamente con
el riesgo de elevación de privilegios ya documentado en
`cloud-vs-repository.md:196-200` para el Cloud real — confirma que ese
riesgo **existía desde T0**, no fue introducido después. Función
`handle_new_user()`: **RESUELTA (UNKNOWN A de 45.J)** — definida en este
mismo archivo (líneas 14-40): inserta el perfil leyendo
`role = coalesce(new.raw_user_meta_data->>'role', 'Personal')` — **lee
el rol directamente de metadata controlada por el usuario**, la misma
vulnerabilidad de escalamiento documentada para el Cloud. Trigger
`on_auth_user_created`: `after insert on auth.users` (sin `or update of
email, raw_user_meta_data` como en `self-hosted/0005`) — forma más
simple en T0. Ninguna de las 34 migraciones toca `handle_new_user` ni
este trigger — la versión vulnerable de T0 nunca fue corregida por
ninguna migración trackeada; solo existe una versión corregida en
`self-hosted/0004`/`0005` (diseño paralelo, nunca aplicado sobre el
historial de migraciones real).

**`public.clients`** — confirma exactamente la reversión de 45.G:
`dni text not null`, `phone text not null`, `process_type text not
null` (coincide con que `20260724000000` los vuelve nullable — evidencia
directa en vez de derivada). **Corrección de alcance:** T0 **no** tiene
`document_type`, `document_number`, `whatsapp`, `occupation`, ni `notes`
— estas 5 columnas, que sí existen en el dump de Cloud (`SECONDARY_FINAL_
STATE_EVIDENCE`, Sección 45) y que `20260729213000_drop_deprecated_
client_case_fields.sql` intenta eliminar con `DROP COLUMN IF EXISTS`,
**no se originan en T0 ni en ninguna de las 34 migraciones trackeadas**
— fueron añadidas a Cloud por un cambio manual fuera de todo control de
versiones (consistente con `cloud-vs-repository.md` y con el commit
`40c43d91f4ecdd4e00f5aeee998ecad674bbf0fc` "reconcile manually applied
CRM hotfixes", 2026-07-31). RLS: habilitada en T0. Policies T0:
`clients_select/insert/update/delete`, las cuatro `using (auth.uid() is
not null)` — igual de permisivas que `profiles`. Extensión `pgcrypto`:
**corrección** — está en T0 (línea 9 del archivo, `create extension if
not exists "pgcrypto"`), no se introduce recién en la migración
`20260721090000` como afirmaban 44.K/45.I; esa migración solo la
re-declara defensivamente ("para que la migración sea autosuficiente").

**`public.cases`** — **RESUELTO (UNKNOWN B de 45.J), con doble
confirmación.** T0 `status` tiene el CHECK
`('Consulta','Documentación','Demanda presentada','En proceso',
'Audiencia','Sentencia','Archivado')`, default `'Consulta'` — `juzgado
text not null` (no nullable, corrección frente a 45.G), `demandante`/
`demandado`/`notes` nullable. `pendiente_revision` **no existe en T0** —
lo introduce `20260724120000_fix_cases_status_check_constraint.sql`, que
en su propio comentario (líneas 6-11) **cita textualmente** el mismo
conjunto legacy encontrado en `schema.sql` T0 como "the original schema"
— confirmación cruzada independiente entre dos artefactos Git distintos.
Esa misma migración documenta el mapeo completo de migración de valores
(`'Consulta' → 'Pendiente de clasificación'`, etc.) y cambia el default a
`'Pendiente de clasificación'`. **Divergencia sin resolver:** `cases.notes`
existe en T0 (parche final del propio archivo T0, líneas 327-329) pero
**no aparece en el dump de Cloud de agosto** (`grep '"notes"'` sobre
`cloud-schema.sql` no produce ningún resultado dentro del bloque
`public.cases`, confirmado línea por línea) — ninguna de las 34
migraciones elimina esa columna. **UNKNOWN, sin resolver**: no hay
evidencia Git de cuándo o cómo desapareció; posiblemente el parche de T0
nunca se ejecutó realmente contra el Cloud real, o se eliminó
manualmente fuera de todo control de versiones. No bloquea el bootstrap
(la columna, si se incluye, no rompe ninguna de las 34 migraciones —
ninguna la referencia), pero si se omite, un T0 escrito hoy **no sería
bit-perfecto** frente al T0 histórico real.

**`public.payments`** — confirma 45.G (`case_id` no existe en T0, lo
añade `20260721090000`). Policies T0: solo `payments_select/insert/
update` — **sin `delete`** (la política `payments_delete` no existe en
T0; aparece por primera vez en la evolución de `schema.sql` v2→v3,
julio 29, fuera del rango de las 34 migraciones trackeadas relevantes
para T0).

**`public.payment_records`** — confirma 45.G, sin cambios estructurales
en ninguna de las 34 migraciones. Policies T0: solo `select`/`insert` —
**sin `update` ni `delete`** en T0.

**`public.agenda_events`** — **RESUELTO (UNKNOWN C de 45.J).** T0 exacto:
`id`, `title`, `type` (CHECK `'Audiencia'|'Cita'|'Recordatorio'`),
`event_date`, `event_time`, `location`, `client_id` (nullable, `on
delete set null`), `created_at`, **`gcal_event_id`** (presente en T0 —
parche final del propio archivo, líneas 331-336). **Sin `case_id`**
(confirmado, lo añade `20260713150000`, migración #2, línea 6-7 de ese
archivo) y **sin ninguna columna de sincronización Google** (las añade
`20260729212000`, muy posterior). El origen y la forma de
`gcal_event_id` antes de este mismo archivo T0 sigue siendo `UNKNOWN` —
no hay artefacto Git anterior al 30 de junio.

**`public.documents`** — **RESUELTO (UNKNOWN D de 45.J).** T0: `id`,
`name`, `type`, `size`, `storage_path`, `client_id` (nullable, `set
null`), `case_id` (nullable, `set null` — **ya presente en T0**, no
añadido después, corrección menor frente a 45.G que no lo marcaba
explícito), `uploaded_at`, `created_at`. **Cero índices** — el archivo
T0 no contiene ningún `CREATE INDEX` sobre `documents`; los tres índices
de la Sección 45.J (`documents_case_processing_idx`,
`documents_client_id_idx`, `documents_external_file_idx`) **no existían
en T0**, quedan resueltos como "no en T0" en vez de `UNKNOWN`. **Policies
T0: solo `select`/`insert`/`delete` — sin `update`** (ningún camino RLS
para modificar un documento existente en T0).

**Grants (`GRANT`/`REVOKE`) en T0:** el archivo T0 **no contiene ningún
`GRANT`/`REVOKE` explícito** sobre las 7 tablas base — la única línea de
ese tipo en todo el archivo es `revoke execute on function
public.handle_new_user() from public, anon, authenticated`. El resto
depende de los privilegios por defecto de Supabase (`cloud-inventory.md`
Sección 8: objetos creados por el rol `postgres` conceden `ALL` a
`authenticated`/`service_role`, no a `anon`, por configuración de
plataforma). **`EVIDENCE_LEVEL = SECONDARY_AUDIT`** para esta conclusión
— no hay una sentencia `GRANT` explícita que leer para T0, se infiere de
un documento de auditoría distinto, no de Git directo.

### 46.G — Resolución explícita de los UNKNOWN de R1 (Sección 45.J)

| # | Punto | Estado | Evidencia |
|---|---|---|---|
| A | Origen/forma de `handle_new_user` | **RESOLVED** | `git show 4668d416:supabase/schema.sql:14-47` — `DIRECT_GIT` |
| B | `pendiente_revision` en T0 | **RESOLVED — NO estaba en T0** | mismo archivo (ausente) + `20260724120000` (lo introduce, cita el set legacy textualmente) — `DIRECT_GIT` |
| C | Forma T0 de `agenda_events` | **RESOLVED** | `git show 4668d416:supabase/schema.sql:235-245,335-336` — `DIRECT_GIT` |
| D | Índices de `documents` en T0 | **RESOLVED — ninguno existía** | mismo archivo, ausencia total de `CREATE INDEX` sobre `documents` — `DIRECT_GIT` |
| E1 | Origen de `gcal_event_id` antes de T0 | **UNRESOLVED** | sin artefacto Git anterior al 2026-06-30 |
| E2 | `cases.notes` presente en T0, ausente en el dump de Cloud (agosto) | **UNRESOLVED** | divergencia confirmada, sin migración que la explique |
| E3 | Estado exacto de `GRANT`/`REVOKE` en T0 | **UNRESOLVED como `DIRECT_GIT`** (resuelto solo como `SECONDARY_AUDIT`) | sin sentencia explícita en el archivo T0 |

**Ninguno de los tres puntos `UNRESOLVED` (E1-E3) bloquea el bootstrap
funcional** — ninguno es referenciado por ninguna de las 34 migraciones
de forma que una ausencia o un valor distinto cause una colisión (E1 y
E2 son columnas sin CHECK ni FK que dependan de su historia previa; E3
se cubre igualmente por los privilegios por defecto de la plataforma).
Se documentan como deuda de fidelidad histórica, no como bloqueo de
`IMPLEMENTATION`.

### 46.H — Objetos funcionales no tabulares requeridos por el runtime

Hallazgo central de esta sección, **no cubierto en su totalidad por R1**:
`handle_new_user()` + el trigger `on_auth_user_created` sobre
`auth.users` son **necesarios para que un usuario nuevo autenticado
obtenga una fila en `public.profiles`** — sin ellos, un usuario que se
registra vía Supabase Auth queda sin perfil, y el resto de la aplicación
(que depende de `profiles.role`/`status` para toda decisión de
autorización) lo trata como si no tuviera permisos. **Ninguna de las 34
migraciones crea esta función ni este trigger** (confirmado por grep
exhaustivo, ya reportado en 45.I). Existen exactamente dos fuentes en
todo el repositorio: la versión T0/original (vulnerable, `schema.sql`,
esta sección) y la versión endurecida de `supabase/self-hosted/0004`-
`0005` (que ignora `raw_user_meta_data.role`/`.status` y solo toma
`full_name`/`phone`). **Ninguna de las dos está en el camino de las 34
migraciones.** Por tanto:

| Objeto | Tipo | ¿En T0? | ¿Creado por las 34? | ¿Requerido por runtime? | Fuente | ¿Baseline requerido? |
|---|---|---|---|---|---|---|
| `handle_new_user()` | función + trigger auth | Sí (vulnerable) | No | **Sí — sin ella, signup no provisiona perfil** | `schema.sql` T0 (vulnerable) / `self-hosted/0004-0005` (endurecida) | **Sí, con decisión humana explícita sobre cuál versión usar — ver 46.M** |
| `is_admin()`/`is_staff()` | funciones | No | Sí (`20260721090000`, autosuficiente) | Indirectamente (policies posteriores) | migración #4 | No — se autoprovee |
| `crm_is_active_staff/admin()` | funciones | No | No (solo en `self-hosted/0004`) | No, para el camino de las 34 migraciones (usan `is_staff`/`is_admin` o subconsultas inline) | `self-hosted/0004` únicamente | No |
| Índices de `documents`/`clients`/`cases` | índices | Parcial (ninguno en T0, se agregan en migraciones puntuales con `IF NOT EXISTS`) | Sí | Sí, para rendimiento, no para corrección | migraciones puntuales | No — cubierto por 45.L |
| Grants por defecto (`authenticated`/`service_role`) | privilegios | Implícito (plataforma) | Parcialmente reafirmados (`20260721130000`/`140000`) | Sí | plataforma Supabase (`postgres`-owned objects) | No — no requiere DDL explícito en T0 |

No se detectaron vistas, secuencias propias (aparte de las `bigint
generated always as identity` de las tablas de Google Calendar, todas
posteriores a T0) ni tipos/enum adicionales requeridos.

### 46.I — Inventario completo T0_BOOTSTRAP_OBJECTS

**TABLAS (7):** `profiles`, `clients`, `cases`, `payments`,
`payment_records`, `agenda_events`, `documents` — DDL completo en 46.F.

**FUNCIONES (2, condicionales — ver 46.M):** `handle_new_user()` (T0 o
endurecida), `set_updated_at()` — **corrección:** `set_updated_at()` NO
está en T0 (`schema.sql` T0 no la define; las 7 tablas T0 no tienen
triggers de `updated_at` porque, salvo `clients`/`cases`/`documents`
—que sí tienen la *columna* `updated_at` en el dump pero **no en el
archivo T0**, contradicción a investigar: el archivo T0 no declara
`updated_at` en ninguna de las 7 tablas—, ninguna tabla T0 tiene esa
columna. **Esto reabre una pregunta de 45.G**: se había asumido
`updated_at` preexistente en T0 para `clients`/`cases`/`documents`
porque ninguna migración la agrega explícitamente; la evidencia directa
de `schema.sql` T0 muestra que esas tablas **no tienen `updated_at` en
absoluto en T0** — debe haberse añadido por un cambio manual no
trackeado, igual que `document_type`/`whatsapp`/etc. de `clients`.
Marcado `UNRESOLVED`, mismo patrón que 46.G/E2.

**TRIGGERS (1):** `on_auth_user_created` sobre `auth.users` (condicional,
ver `handle_new_user` arriba). Ninguno sobre las 7 tablas propias en T0.

**ÍNDICES (0 explícitos):** solo las PK automáticas (`uuid primary key`)
de las 7 tablas. Confirmado por ausencia total de `CREATE INDEX` en el
archivo T0.

**CONSTRAINTS:** 7 PK, 4 FK (`cases.client_id→clients`,
`payments.client_id→clients`, `payment_records.payment_id→payments`,
`documents.client_id→clients` + `documents.case_id→cases` — 5 FK en
total), 5 CHECK (`profiles.role`, `profiles.status`, `clients.status`,
`cases.priority`, `cases.status`, `payments.status`, `agenda_events.type`
— 7 CHECK en total, recontar: profiles×2 + clients×1 + cases×2 +
payments×1 + agenda_events×1 = 7).

**POLICIES (27):** `profiles`×3, `clients`×4, `cases`×4, `payments`×3
(sin delete), `payment_records`×2 (sin update/delete), `agenda_events`×4,
`documents`×3 (sin update) = 23 sobre tablas `public` + 3 sobre
`storage.objects` (`storage_insert`/`storage_select`/`storage_delete`,
ver 46.J) = **26 policies totales en T0**, todas con la misma condición
permisiva `auth.uid() is not null`, ninguna basada en rol.

**GRANTS:** ninguno explícito (privilegios por defecto de plataforma,
`SECONDARY_AUDIT`, 46.F).

**VISTAS:** 0. **SECUENCIAS propias:** 0. **EXTENSIONES:** `pgcrypto`
(`IF NOT EXISTS`, en T0 desde el inicio — corrección de 46.F).

**STORAGE (fuera del esquema `public`, pero parte de T0 según el propio
archivo):** bucket `documents` (`insert into storage.buckets (id, name,
public) values ('documents','documents', false) on conflict do
nothing`) + 3 policies sobre `storage.objects`. Esto es evidencia
directa de que el patrón "crear el bucket con `INSERT` crudo en
`storage.buckets`" (el mismo que usa `self-hosted/0007`, marcado como
riesgo residual no verificado en 44.F) **ya era el mecanismo real usado
por este proyecto desde T0** contra el Cloud real — no es un patrón
nuevo ni hipotético, atenúa (sin eliminar del todo, porque sigue sin
haber una prueba directa contra un proyecto Hosted específico) ese
riesgo residual.

### 46.J — Matriz de colisión de la repetición hacia adelante

Simulación estática T0 (46.F/46.I, no la forma final) + 34 migraciones en
orden, para cada operación DDL identificada en 45.H más las nuevas de
esta fase:

| Migración | Operación | Objeto | Pre-estado esperado | Estado T0 candidato | Resultado |
|---|---|---|---|---|---|
| `20260713131000` | `CREATE TABLE IF NOT EXISTS` | `client_reports` | `clients`/`cases`/`profiles` existen | Existen (T0) | **PASS** |
| `20260713150000` | `ADD COLUMN IF NOT EXISTS` | `agenda_events.case_id` | columna ausente | Ausente (T0) | **PASS** |
| `20260713150000` | `ENABLE ROW LEVEL SECURITY` ×7 | 7 tablas base | ya habilitado o no (idempotente ambos casos) | Ya habilitado (T0) | **PASS** (no-op) |
| `20260713150000` | `DROP POLICY IF EXISTS` + `CREATE POLICY` | 7 tablas + storage | policies permisivas existentes | Existen exactamente como se derivan (T0) | **PASS** |
| `20260721090000` | 9× `CREATE TABLE IF NOT EXISTS` | tablas nuevas | ausentes | Ausentes (T0) | **PASS** |
| `20260721090000` | `ADD COLUMN IF NOT EXISTS` | `payments.case_id`, `documents.original_name` | ausentes | Ausentes (T0) | **PASS** |
| `20260721090000` | `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` | `clients/cases/documents_set_updated_at` | trigger ausente, **columna `updated_at` debe existir** | Trigger ausente (T0) — **columna `updated_at` NO confirmada en T0 (46.I)** | **UNKNOWN — ver nota** |
| `20260724000000` | `ALTER COLUMN ... DROP NOT NULL` | `clients.dni/phone/process_type` | `NOT NULL` | `NOT NULL` (T0, confirmado) | **PASS** |
| `20260724000000` | `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` | `documents.relative_path/content_hash` | ausentes | Ausentes (T0) | **PASS** |
| `20260724120000` | `DROP CONSTRAINT IF EXISTS` + backfill + `ADD CONSTRAINT` | `cases.status`/`cases_status_check` | valores legacy exactos de T0 | Coinciden exactamente (T0, doble confirmación 46.F) | **PASS** |
| `20260725120000` | `ADD COLUMN` | `documents.folder_id` | requiere `set_updated_at()` (para su propio trigger de `document_folders`) | `set_updated_at()` no está en T0 — la crea `20260721090000` primero, antes de esta migración | **PASS** (orden cronológico ya resuelve la dependencia) |
| `20260729213000` | `DROP COLUMN IF EXISTS` ×10/×7 | columnas legacy de `clients`/`cases` | pueden existir o no (`IF EXISTS`) | 5 de las 10 de `clients` (`document_type`, `document_number`, `whatsapp`, `occupation`, `notes`) **no están en T0** (46.F) | **PASS (no-op parcial)** — sin colisión, pero diverge silenciosamente de la forma histórica real de Cloud si el T0 escrito no las incluye |

**Único punto no resuelto a `PASS` limpio:** la operación de
`20260721090000` que crea `clients_set_updated_at`/`cases_set_updated_at`/
`documents_set_updated_at` asume que la columna `updated_at` ya existe en
esas tres tablas (un trigger `BEFORE UPDATE` que hace `new.updated_at :=
now()` fallaría con `42703` si la columna no existe). El archivo T0
(`schema.sql`, 2026-06-30) **no declara `updated_at`** en ninguna de las
7 tablas base — pero el dump de Cloud (agosto) sí la tiene. Como en el
caso de `cases.notes`, esto apunta a un cambio manual no trackeado entre
el 30 de junio y el 21 de julio. **Un T0 escrito hoy DEBE incluir
`updated_at timestamptz not null default now()` en `clients`/`cases`/
`documents` — no por evidencia `DIRECT_GIT` de T0, sino porque su
ausencia causaría una colisión real y verificada (`42703`) en
`20260721090000`.** Esta es la única adición al DDL de T0 que el propio
análisis de colisión obliga a hacer más allá de lo que dice
`schema.sql`. **Cero colisiones sin resolver quedan pendientes** tras
esta corrección — el requisito del pedido ("Zero COLLISION, zero UNKNOWN
antes de aprobar implementación") queda satisfecho con esta única
adición explícita y justificada.

### 46.K — Reconciliación funcional final

`T0 (46.F, con la corrección de `updated_at` de 46.J) + 34 migraciones`
reproduce, objeto por objeto, la forma documentada en
`docs/database/self-hosted-canonical-model.md` para las 7 tablas base —
ya verificado en 45.K, reafirmado aquí sin cambios porque ninguna
corrección de esta fase altera el estado *final*, solo el estado *T0*.
**`FINAL_SCHEMA_COVERAGE = COMPLETE`** para las 7 tablas base y sus
objetos dependientes directos. Fuera de esa cobertura quedan, sin
cambios respecto a 44.G: el `handle_new_user` endurecido (decisión
pendiente, 46.M), y las divergencias históricas no explicadas de 46.G
(E1/E2/E3) — ninguna de las tres impide que `FINAL_SCHEMA_COVERAGE` sea
`COMPLETE` para el propósito de que las 34 migraciones apliquen y
produzcan el esquema final correcto.

### 46.L — Staleness de `supabase/self-hosted/0002`-`0008` (confirmación exacta)

Reafirmado con precisión de nombres (no solo conteos, según exige el
pedido): ausentes de `self-hosted/0003_domain_tables.sql`: tabla
`templates`; las 6 tablas `google_drive_*`
(`google_drive_oauth_states`, `google_drive_connections`,
`google_drive_client_folders`, `google_drive_document_files`,
`google_drive_channels`, `google_drive_sync_queue`); la columna
`google_calendar_sync_requests.claimed_at` y
`google_calendar_connections.renewal_claimed_at` (de
`20260822090000_google_calendar_sync_queue_claim.sql`); el FK compuesto
de integridad `client_reports`↔`cases` (de
`20260822100000_client_reports_case_client_integrity.sql`); los dos
triggers/función de `prevent_last_admin_removal` sobre `profiles` (de
`20260822120000`). `self-hosted/0006_rls_and_grants.sql` tampoco tiene
las 2 policies `RESTRICTIVE` de `templates/` sobre `storage.objects`.
**Conclusión sin cambios respecto a 44.G/45.S:** `self-hosted/` quedó
congelado el 2026-08-07 y no se ha vuelto a sincronizar contra 9
migraciones posteriores — no puede usarse hoy como snapshot fiel del
esquema final sin regenerarlo primero.

### 46.M — Modelo canónico recomendado (reafirmado con evidencia reforzada)

**MODEL B1, sin cambios en la elección, con dos refuerzos de evidencia:**
(1) el propio repositorio ya declaró en `docs/current-state/DATABASE_
SCHEMA_SOURCE_OF_TRUTH.md` (2026-07-29) que `supabase/migrations/` es la
fuente de verdad y que `schema.sql` no debe usarse como bootstrap — B1 es
la única opción de las tres consistente con esa decisión ya tomada por
el proyecto; (2) el patrón de creación de bucket vía `INSERT` crudo
(46.I) tiene precedente histórico real desde T0, no es una inferencia de
diseño nueva. **Decisión pendiente que el pedido exige señalar
explícitamente, no resolver aquí:** el archivo T0 de MODEL B1 debe
decidir entre reproducir `handle_new_user()` **tal como era en T0**
(vulnerable a escalamiento de rol vía metadata, evidencia `DIRECT_GIT`
fiel al historial real) o sustituirlo por la versión endurecida de
`self-hosted/0004` (seguro, pero **no** es lo que T0 realmente tenía).
Esta fase no elige — lo deja como bloqueador explícito en 46.S, porque
es exactamente el tipo de decisión de seguridad que un asistente no debe
tomar unilateralmente.

### 46.N — Diseño de rehearsal para timestamp antiguo (no ejecutado)

Diseño de un experimento aislado para una fase futura, sobre un clon
desechable — no ejecutado en R2:

1. Restaurar un clon con las 34 migraciones ya marcadas `applied` en
   `supabase_migrations.schema_migrations` (simulando producción o un
   Hosted ya migrado una vez).
2. Añadir localmente el archivo T0 con timestamp anterior a todas las
   existentes.
3. Ejecutar `supabase migration list` y observar cómo reporta el archivo
   nuevo (pendiente/fuera de orden) sin aplicar nada.
4. Ejecutar `supabase db push --dry-run` (sin flag) y registrar si omite
   el archivo fuera de orden o lo señala como conflicto.
5. Ejecutar `supabase db push --include-all --dry-run` y registrar si
   ahora lo incluye en el plan.
6. **En ningún caso ejecutar el `push` real dentro de este experimento**
   — el objetivo es observar el comportamiento de planificación, no
   aplicar nada, ni siquiera en el clon.
Diseño únicamente. Ningún comando de este punto se ejecutó en R2.

### 46.O — Contrato de adopción de `migration repair`

Refinamiento del diseño narrow de 45.Q en un contrato explícito de 6
condiciones, todas obligatorias antes de marcar la migración T0 como
`applied` en cualquier entorno que ya contenga el esquema
(producción):

1. El precheck de equivalencia de esquema (46.P) da `EXISTING`, no
   `PARTIAL` ni `FRESH`.
2. Los 7 objetos T0 requeridos (46.I) existen con forma compatible —
   no solo existencia de tabla, ver 46.P para la definición de
   "compatible".
3. Ningún subconjunto parcial detectado.
4. El rehearsal contra un clon de producción (45.R) dio `PASS`.
5. El hash del archivo de migración T0 realmente escrito coincide con el
   que fue revisado/aprobado por el propietario (evita un repair contra
   una versión distinta a la auditada).
6. Autorización humana explícita, por escrito, para ESA ejecución
   concreta de `repair` — no una autorización general permanente.
Sin las 6, no se ejecuta `repair`. No se ejecuta ninguna en esta fase.

### 46.P — Contrato de precondición tri-estado (refinado)

"Forma compatible" definida más allá de la existencia de tabla, tal como
exige el pedido: para cada una de las 7 tablas T0, EXISTING requiere que
existan (a) la tabla; (b) todas las columnas `NOT NULL` sin default
listadas en 46.F (fallar si faltan, para no insertar luego con una
constraint que el código no espera); (c) el trigger `on_auth_user_created`
sobre `auth.users` apuntando a alguna función `handle_new_user`
(cualquiera de las dos versiones — la comprobación no distingue cuál,
eso es una decisión de 46.M, no del precondition check); (d) RLS
habilitada en las 7 tablas (no se exige que las policies sean
byte-idénticas a T0, porque las migraciones las reemplazan de todas
formas). FRESH exige que **ninguno** de (a)-(d) exista. Cualquier otra
combinación → PARTIAL → ABORT. Diseño únicamente, sin SQL implementado.

### 46.Q — Cadena de primer-administrador (confirmada con evidencia T0)

Cadena confirmada, sin cambios de fondo respecto a 43.P/44.R pero ahora
con el origen exacto de cada eslabón: Supabase Auth crea el usuario
(`auth.users`, plataforma) → trigger `on_auth_user_created` (T0 o
endurecido, decisión pendiente en 46.M) ejecuta `handle_new_user()` →
inserta `public.profiles` con `role='Personal'` (ambas versiones
coinciden en el default) → promoción a `Administrador` es un paso manual
posterior sobre `profiles.role`, nunca parte del trigger. No se crea
ningún usuario en esta fase.

### 46.R — Contrato de aprovisionamiento de Storage (confirmado)

Sin cambios de conclusión respecto a 45.T: bucket después del bootstrap
de esquema, antes del primer uso funcional de Documentos; privado; 4
policies base + 2 `RESTRICTIVE` de `templates/`; límites `NULL`. Reforzado
por 46.I: el patrón de `INSERT` crudo en `storage.buckets` tiene
precedente histórico real desde T0 sobre el Cloud real de este mismo
proyecto.

### 46.S — UNKNOWN restantes (lista final de esta fase)

- **E1** — origen/forma de `agenda_events.gcal_event_id` antes de
  2026-06-30 (sin artefacto Git anterior).
- **E2** — `cases.notes` en T0, ausente del dump de agosto; y (nuevo en
  esta fase) `clients/cases/documents.updated_at`, requerida por
  colisión (46.J) pero ausente del archivo T0 — ambas apuntan a cambios
  manuales no trackeados entre 2026-06-30 y 2026-07-21/agosto.
- **E3** — estado exacto de `GRANT`/`REVOKE` en T0 (solo `SECONDARY_
  AUDIT`, no `DIRECT_GIT`).
- **Decisión de seguridad pendiente (46.M):** `handle_new_user` T0
  (fiel, vulnerable) vs. endurecida (segura, no fiel a T0) — requiere
  autorización humana explícita, no una elección técnica.

Ninguna de las cuatro bloquea que las 34 migraciones apliquen
correctamente sobre el T0 corregido (46.J); todas quedan como huecos de
fidelidad histórica o decisiones de seguridad pendientes de autorización
explícita.

### 46.T — Preparación para implementación

**READY**, con la salvedad explícita de 46.M (`handle_new_user`) como
única decisión bloqueante de contenido antes de escribir el archivo
real — no de auditoría. Todo lo demás (DDL de las 7 tablas, orden,
`updated_at` corregido, precondición tri-estado, contrato de `repair`)
está completamente especificado y listo para implementación en cuanto
esa decisión se tome. **No se marca `READY` sin condiciones** porque el
pedido exige que ninguna decisión de seguridad quede tomada
silenciosamente.

### 46.U — Archivos modificados en esta fase

Únicamente `server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md`
(esta Sección 46). `audit/` no fue tocado, no fue añadido a staging.
Ningún archivo de `supabase/migrations/` ni `supabase/self-hosted/`
tocado. Los archivos temporales de esta investigación
(`v1_20260630.sql`…`v4_HEAD.sql`, copias de solo lectura vía `git show`)
se escribieron exclusivamente en el scratchpad de la sesión y en `/tmp`,
fuera del repositorio.

### 46.V — Gates

`npx tsc --noEmit`: limpio. `npm run lint`: 0 errores, 7 warnings
preexistentes sin cambios. `npm test`: **66 archivos, 1649 passed, 0
skipped, 0 failed**. Build no requerido.

### 46.W — Diff

`git status --short` / `git diff --name-status` / `git diff --stat` /
`git diff --check` ejecutados antes y después. Único archivo modificado:
este runbook. `audit/` permanece `??` (untracked), no tocado. Los 13
elementos untracked históricos permanecen intactos.

### 46.X — Bloqueadores antes de implementación

- **Decisión humana explícita sobre `handle_new_user`** (46.M/46.S) —
  T0 fiel y vulnerable, o endurecida y no-fiel. Sin esto, no se escribe
  el archivo de migración T0.
- Autorización para escribir el archivo T0 real con el DDL de 46.F +
  la corrección de `updated_at` de 46.J.
- Implementación del script de precondición tri-estado (46.P) antes de
  ejecutar el archivo T0 contra cualquier entorno de estado desconocido.
- Rehearsal de timestamp antiguo (46.N) y rehearsal contra clon de
  producción (45.R) — ninguno ejecutado.
- Las 3 divergencias `UNRESOLVED` (46.G/46.S) deben aceptarse
  explícitamente como no bloqueantes o investigarse más — no se asumen
  resueltas por defecto.
- `EXPECTED_STAGING_SUPABASE_PROJECT_REF`/`STAGING_DB_URL` reales del
  proyecto "CRM Drive Staging" siguen sin existir en el repositorio.

**Confirmación de alcance de esta fase (sin excepciones):**
NO escritura remota. NO acceso a producción. NO implementación de
migración. NO modificación de migraciones existentes. NO `migration
repair`. NO reset. NO commit. NO push.

**No se implementa nada de la Sección 46 en esta fase — queda en espera
de revisión.**

### 46.Y — Cierre controlado: decisiones aprobadas por el propietario

El propietario revisó la Sección 46 completa y aprobó explícitamente lo
siguiente (documentación de la decisión, **sin implementación de SQL en
este cierre**):

1. **`MANIFEST_V1` congelado como referencia de las 34 migraciones
   históricas:** `MIGRATION_COUNT = 34`,
   `MANIFEST_V1_SHA256 = b3fc4909efbf9a3001249e6fdf354cbe4c35b0a59ba036f6e7257ceedc87b214`
   (46.B). Cualquier archivo futuro de baseline se añade **junto a**
   estas 34, nunca las reemplaza ni las modifica.
2. **MODEL B1 seleccionado como arquitectura canónica** (45.L/46.M): una
   migración T0 con timestamp anterior a las 34 existentes, aplicada por
   el flujo estándar `supabase db push` en entornos frescos, y por
   `migration repair` narrow (46.O) en producción existente.
3. **Concepto `T0-CANONICAL` definido:** el contenido del futuro archivo
   de baseline **no es una réplica byte-perfecta del T0 histórico de git**
   (46.F) — es el T0 histórico **con una sustitución deliberada**: la
   implementación endurecida de `handle_new_user()`/
   `on_auth_user_created` (equivalente a `supabase/self-hosted/0004`-
   `0005`, que ignora `raw_user_meta_data.role`/`.status`) en vez de la
   versión original de T0 (`supabase/schema.sql` en el commit
   `4668d4163c3c0f5b0d4cc14a6e511ee378b77976`, 2026-06-30), que lee
   `role` directamente de metadata controlada por el usuario. Esta es la
   única desviación deliberada de T0 aprobada — todo lo demás del DDL de
   T0-CANONICAL sigue el T0 histórico exacto de 46.F, incluida la
   corrección de `updated_at` en `clients`/`cases`/`documents` que el
   propio análisis de colisión de 46.J exige.
4. **Prohibición explícita:** el archivo de baseline que se escriba en
   una fase de implementación futura **no debe reproducir** la versión
   vulnerable de `handle_new_user()` que confía en `role` proveniente de
   metadata controlada por el usuario final. Cualquier implementación que
   reintroduzca esa lectura de metadata para `role`/`status` se considera
   no conforme con esta decisión, sin importar que sea "fiel a T0".
5. **Los `UNKNOWN` residuales de 46.G/46.S se aceptan como no
   bloqueantes**, exclusivamente porque R2 demostró — con la matriz de
   colisión de 46.J y la reconciliación de 46.K — que ninguno es
   necesario para que la repetición hacia adelante o la cobertura final
   funcional del esquema sean correctas. Esta aceptación no equivale a
   declarar el T0 histórico completamente reconstruido; los tres puntos
   (`E1` origen de `gcal_event_id`, `E2` `cases.notes` y el estado
   histórico de `updated_at` antes del cambio manual no trackeado, `E3`
   grants exactos) siguen documentados como deuda de fidelidad histórica
   en 46.G/46.S, no como resueltos.
6. **Timestamp aprobado para el futuro archivo de baseline:**
   `20260713120000_crm_application_baseline.sql` (anterior a
   `20260713131000_add_client_reports.sql`, la primera migración
   existente).

**Lo que este cierre NO hace:** no crea `supabase/migrations/
20260713120000_crm_application_baseline.sql` ni ningún otro archivo SQL;
no ejecuta `db push`, `migration repair`, ni ningún DDL/DML; no cambia
`PRODUCTION_BASELINE_COMPATIBILITY`, que permanece `UNVERIFIED` (45.R) —
ningún rehearsal contra clon de producción se ejecutó en esta ni en
ninguna fase anterior; no realiza ninguna adopción de producción. La
implementación del archivo de baseline (con el DDL exacto de T0-CANONICAL
tal como queda definido en este punto) queda para una fase posterior,
explícitamente fuera del alcance de este cierre.

**Confirmación de alcance de este cierre (sin excepciones):**
NO escritura en Supabase. NO acceso a producción. NO implementación de
migración. NO `migration repair`. NO reset. NO Google. NO arranque del
CRM.

## 47. Fase 8I-B2B-0B2B-I1 — Implementación local del T0-CANONICAL

**Alcance:** LOCAL ONLY. Ningún comando de Supabase (`db push`,
`migration list --linked`, `migration repair`, `db reset`) se ejecutó.
Ninguna escritura contra `ccnvrslhnzdqwanhceqx` ni ningún otro proyecto
Supabase. El staging permanece exactamente como en el cierre de R2: 0
tablas `public`, 0 filas en `supabase_migrations.schema_migrations` — no
tocado en esta fase.

### 47.A — Archivo de baseline creado

`supabase/migrations/20260713120000_crm_application_baseline.sql` —
único archivo de migración nuevo, exactamente el nombre aprobado en el
cierre de R2 (Sección 46.Y, punto 6). Ningún otro archivo de
`supabase/migrations/` fue tocado.

### 47.B — Distinción T0-CANONICAL vs. T0 histórico puro

El archivo implementa exactamente la definición aprobada en 46.Y: el T0
histórico de `git show 4668d4163c3c0f5b0d4cc14a6e511ee378b77976:
supabase/schema.sql` (Sección 46.F), con dos desviaciones deliberadas,
ambas señaladas en comentarios SQL dentro del propio archivo (no
silenciosas):

1. **`handle_new_user()` + `on_auth_user_created`**: copiados
   verbatim de `supabase/self-hosted/0004_functions_and_rpc.sql` (la
   función) y `supabase/self-hosted/0005_triggers.sql` (el trigger) —
   no reescritos de memoria. La versión histórica de T0 (que lee `role`
   de `raw_user_meta_data`) **no aparece en ningún lugar del archivo**,
   ni siquiera citada — el comentario que explica la decisión evita
   deliberadamente reproducir el patrón vulnerable como texto (para que
   ni siquiera una búsqueda ingenua sobre el archivo lo encuentre como
   "presente").
2. **Campos de compatibilidad de repetición** (`updated_at` en
   `clients`, `cases`, `documents`): ausentes del snapshot T0 de
   2026-06-30, añadidos porque el análisis de colisión de la Sección
   46.J demostró que `20260721090000_legal_case_foundation.sql` crea
   `clients_set_updated_at`/`cases_set_updated_at`/
   `documents_set_updated_at` (triggers `BEFORE UPDATE` que asignan
   `NEW.updated_at`) y fallaría con `42703` sin esa columna. Cada
   declaración lleva el comentario literal "T0-CANONICAL replay
   compatibility field", distinguiéndola explícitamente de un hecho
   histórico de T0.

Todo lo demás — las 7 tablas, sus columnas/tipos/defaults/constraints,
RLS habilitada, y las 23 policies permisivas (`auth.uid() is not null`,
sin distinción de rol) — reproduce el T0 histórico de git tal cual,
sin ninguna forma final de `self-hosted/0003` ni del dump de
`audit/cloud-schema.sql`.

### 47.C — Precondición tri-estado

Implementada como un bloque `do $$ ... $$;` al inicio de la transacción,
antes de cualquier `CREATE TABLE` de aplicación: cuenta cuántas de las 7
tablas núcleo existen vía `to_regclass`. `0` → continúa (FRESH). `7` →
`RAISE EXCEPTION` con `errcode '55000'` y mensaje explícito, sin fugar
secretos (solo nombra el hecho estructural, ningún valor de
configuración). `1..6` → `RAISE EXCEPTION` igual, incluyendo el conteo
exacto encontrado. No se usa `CREATE TABLE IF NOT EXISTS` como mecanismo
de seguridad en ningún punto del archivo — la precondición explícita es
el único mecanismo, tal como exigía el pedido.

### 47.D — Las siete tablas núcleo

`profiles`, `clients`, `cases`, `payments`, `payment_records`,
`agenda_events`, `documents` — DDL exacto documentado columna por
columna en la Sección 46.F de este runbook; el archivo SQL referencia
esa sección y la línea exacta de `schema.sql` para cada tabla. Ningún
objeto de las 34 migraciones existentes se recrea aquí (no
`document_folders`, no `case_tasks`, no `client_reports`, no
`google_calendar_*`, no `google_drive_*`, no `templates`) — esos siguen
siendo responsabilidad exclusiva de sus propias migraciones.

### 47.E — Grants

Sin `GRANT`/`REVOKE` explícitos sobre las 7 tablas (Sección 46.F: la
única evidencia T0 de ese tipo es el `REVOKE EXECUTE` de
`handle_new_user`, reproducido). Documentado en un comentario dentro del
propio archivo por qué se omiten los demás: la evidencia disponible es
`SECONDARY_AUDIT`, no `DIRECT_GIT`, y las dos migraciones que sí
establecen grants explícitos (`20260721130000`/`20260721140000`) corren
después en la cadena y los fijan por sí mismas.

### 47.F — `pgcrypto`

`create extension if not exists "pgcrypto";` — presente en el T0
histórico mismo (línea 9 de `schema.sql`), no introducida como novedad.
No se crea ni recrea ningún schema de plataforma.

### 47.G — Auditoría de repetición estática (repetida sobre el archivo real)

Repetida la matriz de la Sección 46.J contra el archivo efectivamente
escrito (no solo el diseño): **0 colisiones, 0 `UNKNOWN` bloqueantes.**
El punto que en 46.J quedaba como única incógnita — el trigger
`*_set_updated_at` de `20260721090000` — queda resuelto por la adición
explícita de `updated_at` (47.B, punto 2). Verificado adicionalmente que
ningún nombre de constraint auto-generado por PostgreSQL colisiona: el
único caso relevante, `cases_status_check`
(`20260724120000_fix_cases_status_check_constraint.sql`), antecede su
`ADD CONSTRAINT` con `DROP CONSTRAINT IF EXISTS` sobre el mismo nombre
auto-generado (`<tabla>_<columna>_check`), así que el resultado es
idéntico exista o no colisión de nombre previa.

### 47.H — Validador estático

`scripts/validate-crm-baseline.mjs` (nuevo, con declaraciones de tipos
en `scripts/validate-crm-baseline.d.mts` siguiendo el mismo patrón ya
usado por `scripts/validate-drive-local-env.mjs`/`.d.mts`). Nunca se
conecta a una base de datos ni ejecuta SQL — lee únicamente los archivos
de `supabase/migrations/` y `supabase/self-hosted/` desde disco.
Implementa las 14 comprobaciones pedidas (expandidas a 25 entradas
individuales, porque varios requisitos —p. ej. "no crear objetos de
plataforma"— se verifican como un patrón prohibido por objeto, no como
una sola comprobación monolítica). Ejecutado directamente
(`node scripts/validate-crm-baseline.mjs`): **25/25 comprobaciones
pasan.**

### 47.I — Pruebas del validador

`tests/crm-baseline-validator.test.ts` (nuevo, 42 pruebas): confirma las
25 comprobaciones contra el archivo real, más pruebas unitarias de las
funciones puras (`extractFunctionSource`, `normalizeSql`,
`stripSqlComments`) y, específicamente para la Sección 17 del pedido,
una prueba de equivalencia estricta entre `handle_new_user()` del
baseline y de `supabase/self-hosted/0004_functions_and_rpc.sql` que
además demuestra **no ser demasiado laxa** (una copia sintética con la
vulnerabilidad histórica reintroducida falla la comparación de
equivalencia y activa `ROLE_METADATA_ESCALATION_PATTERN`) ni
**demasiado estricta** (una reformateada solo en espacios en blanco sigue
pasando como equivalente).

### 47.J — Integridad de las 34 migraciones históricas

`MANIFEST_V1` recalculado sobre los 34 archivos históricos (excluyendo
el nuevo baseline): `MIGRATION_COUNT = 34`,
`MANIFEST_V1_SHA256 = b3fc4909efbf9a3001249e6fdf354cbe4c35b0a59ba036f6e7257ceedc87b214`
— **idéntico** al valor congelado en R1/R2. Ninguno de los 34 archivos
fue modificado.

### 47.K — MANIFEST_V2

Sobre las 35 migraciones (34 históricas + el nuevo baseline), mismo
algoritmo determinista:

```
MIGRATION_COUNT_V2 = 35
MANIFEST_V2_SHA256 = 422cd62f34404d0f58eb571f722f1b1aabf2ed224b7619f95130c7e8c1d64029
```

(64 caracteres, verificado con `wc -c`.) `MANIFEST_V1` (sobre las 34) y
`MANIFEST_V2` (sobre las 35) son necesariamente distintos — ambos se
reportan por separado, ninguno sustituye al otro.

### 47.L — Storage

Confirmado por el propio validador (`no-storage-provisioning:INSERT INTO
storage.buckets`, 47.H): el baseline no inserta en `storage.buckets`, no
crea policies sobre `storage.objects`, no crea el bucket `documents`.
El aprovisionamiento de Storage permanece un paso posterior separado
(Sección 46.R), sin cambios de diseño.

### 47.M — Requisitos de rehearsal pendientes (sin cambios de estado)

Ninguno de los rehearsals diseñados en fases anteriores se ejecutó en
esta fase (I1 es implementación local, no ejecución):
`PRODUCTION_BASELINE_COMPATIBILITY` permanece `UNVERIFIED` (Sección
45.R); el rehearsal de timestamp antiguo contra un clon desechable
(Sección 46.N) no se ejecutó; el contrato de 6 condiciones para
`migration repair` (Sección 46.O) sigue sin cumplirse porque ninguna de
sus condiciones (que incluyen el propio rehearsal) se satisfizo aquí.

### 47.N — Archivos modificados en esta fase

- `supabase/migrations/20260713120000_crm_application_baseline.sql`
  (nuevo).
- `scripts/validate-crm-baseline.mjs` (nuevo).
- `scripts/validate-crm-baseline.d.mts` (nuevo).
- `tests/crm-baseline-validator.test.ts` (nuevo).
- `server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md` (esta
  Sección 47).

Ninguno de los 34 archivos de `supabase/migrations/` existentes fue
tocado. `audit/` no fue tocado. Ningún `.env`. Ningún secreto.

### 47.O — Gates

`npx tsc --noEmit`: limpio, 0 errores. `npm run lint`: 0 errores tras
`eslint --fix` sobre los dos archivos nuevos con problemas de formato
(11 correcciones de `prettier/prettier`, ningún cambio de lógica —
verificado re-ejecutando el validador después del fix, mismo resultado
25/25); 7 warnings preexistentes sin cambios. `npm test`: **67 archivos,
1691 passed, 0 skipped, 0 failed** (baseline anterior 66/1649 + 1 archivo
nuevo/42 tests nuevos = 67/1691, exacto). Build no ejecutado
(`BUILD = NOT REQUIRED / DEFERRED FOR ENV SAFETY`, sin cambios de
código runtime).

### 47.P — Diff

Cambios reales, confirmados con `git status --short` / `git diff
--name-status` / `git diff --stat` / `git diff --check`: exactamente 4
archivos nuevos (`supabase/migrations/20260713120000_crm_application_
baseline.sql`, `scripts/validate-crm-baseline.mjs`,
`scripts/validate-crm-baseline.d.mts`,
`tests/crm-baseline-validator.test.ts`) más la modificación de este
runbook — 5 rutas en total. Ninguna de las 34 migraciones existentes
aparece en el diff. Ningún `.env`. `audit/` permanece `??`, sin tocar.
Los 13 elementos untracked históricos permanecen intactos. Sin
conflictos de espacio en blanco.

### 47.Q — Bloqueadores antes de B2B-0B2B-I2

- Autorización humana explícita para el siguiente paso (probablemente el
  rehearsal de timestamp antiguo de la Sección 46.N, o directamente el
  `db push --dry-run` contra el proyecto Hosted "CRM Drive Staging" ya
  creado).
- Ningún rehearsal contra clon de producción se ha ejecutado — sigue
  siendo un bloqueador para cualquier adopción sobre producción real
  (no sobre staging fresco, que no lo requiere).
- El contrato de precondición "forma compatible" (Sección 46.P) sigue
  sin implementarse como script — solo el tri-estado del propio archivo
  de baseline existe hoy, no un preflight externo reutilizable.

**Confirmación de alcance de esta fase (sin excepciones):**
NO escritura en Supabase. NO acceso a producción. NO `migration
repair`. NO reset. NO creación de bucket. NO creación de usuarios. NO
Google/OAuth/Drive. NO arranque del CRM. NO commit. NO push.

## 48. Fase 8I-B2B-0B2B-I2-R2/R3/I3 — Auditoría de excepciones de fresh bootstrap + herramientas locales

Consolida tres turnos posteriores al rehearsal real contra CRM Drive
Staging (I2): R2 (auditoría exhaustiva de las 12 migraciones restantes
tras el primer fallo real), R3 (diseño de orquestación + primer-admin,
sin ejecución), e I3 (implementación LOCAL de las herramientas
reutilizables que R3 diseñó, sin ninguna escritura remota).

### 48.A — Contexto empírico de partida

El rehearsal real (I2) aplicó baseline + históricas hasta
`20260729212000` en un solo pase, requirió una intervención manual para
`20260729213000` (guard destructivo vía `SET LOCAL`, ya
history-adoptado), continuó exitosamente hasta `20260730210000`, y
falló en `20260806120000_crm_daily_tasks_and_document_integrity.sql`
por una aserción que exige una fila histórica real (`case_tasks` con
`created_at = 2026-08-06 02:02:30.149561+00`) inexistente en staging
fresco.

### 48.B — Hallazgo R2: tres excepciones finitas, no una

Auditoría completa de las 12 migraciones restantes
(`20260806120000` → `20260826100000`) confirmó **solo dos bloqueadores
nuevos** además del ya resuelto `20260729213000`:

- **#24** `20260806120000` — `LEGACY_DATA_COUPLED`, pero **solo en una
  sentencia** (la 40 de 41): una aserción de regresión sobre una fila
  histórica real, clasificada `HISTORICAL_ROW_REQUIREMENT =
  LEGACY_DATA_PROTECTION_ONLY` (ninguna migración crea esa fila; el
  esquema que produce el resto del archivo es 100% independiente de
  ella).
- **#30** `20260822120000_prevent_last_admin_removal.sql` — precheck
  exige `count(role='Administrador' AND status='Activo') >= 1` antes de
  activar la protección; en una base de datos fresca y sin usuarios esto
  es 0 por construcción. Es un problema de **secuenciación**
  (primer-admin debe existir antes de este punto), no de contenido.

Las 10 migraciones restantes de ese rango son `PURE_SCHEMA` /
`GENERIC_DATA_MIGRATION` — seguras en fresco sin intervención.

**Matriz completa de 35** (versión/categoría/excepción) registrada en
el informe de R2 de esta sesión — 3 de 35 requieren intervención: #20
(ya resuelta), #24, #30.

### 48.C — Corrección de estado R3

`HOSTED_CONTROLLED_BOOTSTRAP_COMPATIBILITY` se corrigió de "READY" a
**`DESIGN_READY_EXECUTION_UNVERIFIED`** — un diseño completo no es lo
mismo que una ejecución confirmada. Se mantiene así hasta que #24, el
primer-admin, y el resto de la secuencia se ejecuten y verifiquen
empíricamente al menos una vez.

Corrección adicional (R3, ratificada en I3): un bootstrap "squash"
(Modelo C2) SÍ evita los tres bloqueadores #20/#24/#30 en fresco, porque
nunca reejecuta los cuerpos históricos que los contienen — corrección
explícita de una afirmación anterior incorrecta. Aun así, comparado
contra un B1-B **automatizado** (no manual), B1-B sigue ganando: los
tres bloqueadores ya están completamente enumerados y acotados (no son
un riesgo abierto), mientras que C2 introduce una segunda fuente de
verdad del esquema que debe mantenerse sincronizada indefinidamente.
**Modelo canónico confirmado: `B1_WITH_ADOPTION_EXCEPTIONS`.**

### 48.D — Mecanismo de primer-admin (R3, evidenciado)

Auditoría de `src/lib/profiles.functions.ts::registerStaffFn` confirmó
que el CRM ya usa, para toda alta de personal, el patrón: Admin API
`createUser` (service_role) → trigger `handle_new_user` endurecido crea
`profiles` como `Personal`/`Activo` → un `UPDATE` de service_role
promueve exactamente ese `id`. `registerStaffFn` no puede usarse
directamente para el primer admin porque exige que quien llama ya sea
Administrador — imposible antes de que exista ninguno. La herramienta
de bootstrap reutiliza el mismo patrón fuera de esa puerta, sin tocarla
ni debilitarla.

### 48.E — Herramientas implementadas en I3 (LOCAL, sin escritura remota)

- **`scripts/build-crm-fresh-migration-projection.mjs`** (+
  `.d.mts`) — construye, en memoria y solo bajo `os.tmpdir()`, una
  proyección de `20260806120000` que preserva las sentencias 1-39 y 41
  byte a byte y omite únicamente la sentencia 40, usando anclas de texto
  exactas (no números de línea) con fallo cerrado ante cualquier
  desviación (hash de origen, ancla duplicada/ausente, contenido de la
  aserción mutado, sentencia siguiente desplazada). Nunca escribe bajo
  `supabase/migrations/`. Verificado end-to-end contra el archivo real:
  hash de origen `2c3ef16d...4ef`, proyección de 12427 bytes (976 bytes
  removidos), hash de proyección `d997d7a6...1513`.
- **`scripts/sql/verify-20260806120000-fresh-poststate.sql`** —
  contrato de postcondiciones de #24, solo lectura, con `ON_ERROR_STOP`
  y `RAISE EXCEPTION` por cada chequeo fallido (columnas, índice, tablas
  nuevas, RLS, políticas, grants, 7 funciones, 4 triggers habilitados,
  privilegios de `normalize_document_types`, filas de negocio en cero,
  ausencia de `20260806120000` en el historial).
- **`scripts/sql/verify-crm-bootstrap-pre-20260806120000.sql`** —
  verificación empírica de rollback completo del intento fallido previo
  (columnas/tablas/funciones/triggers exclusivos de `20260806120000`
  deben estar ausentes) más conteos de filas de negocio en cero, para
  que el owner la ejecute antes de cualquier proyección manual.
- **`scripts/bootstrap-staging-first-admin.mjs`** (+ `.d.mts`) —
  herramienta de bootstrap del primer Administrador, con guard de
  destino fijo a `ccnvrslhnzdqwanhceqx.supabase.co` (sin override, sin
  `--force-production`), contraseña vía
  `STAGING_BOOTSTRAP_ADMIN_PASSWORD` (nunca CLI, nunca logueada), email
  vía `STAGING_BOOTSTRAP_ADMIN_EMAIL` (debe contener `staging`),
  precondición de `profiles` vacío (aborta si no), payload de
  `createUser` sin `role`/`status`, verificación de la fila creada por
  el trigger (`Personal`/`Activo`) antes de promover, promoción por ID
  exacto, y verificación del predicado global
  (`count(Administrador,Activo)=1`). Diseño de compensación: si falla
  algo entre `createUser` y la promoción confirmada, borra el usuario
  Auth creado — probado seguro porque `public.profiles.id references
  auth.users(id) on delete cascade` (línea 110 del baseline) y la
  precondición de `profiles` vacío garantiza que nada más puede
  referenciar ese id nuevo. Si el propio borrado de compensación falla,
  NO se reintenta ni se adivina: devuelve
  `BOOTSTRAP_PARTIAL_USER_CREATED` con el UUID y pasos de recuperación
  manual, nunca la contraseña. Este script **no se ejecutó** durante
  I3 — solo se probó contra un cliente Admin completamente simulado.

### 48.F — Ciclo de vida del admin sintético (R3)

Una vez activo `20260822120000`, el sistema nunca puede volver a 0
Administradores activos vía `UPDATE`/`DELETE` normal — nunca bloquea
tener 2. Recomendación: mantener el admin sintético de staging de forma
permanente (sin necesidad de reemplazo); si algún día se reemplaza,
crear el segundo admin primero y confirmarlo activo antes de tocar el
primero.

### 48.G — Gates

`npx tsc --noEmit`: limpio, 0 errores. `npm run lint`: 0 errores (12
correcciones de `prettier/prettier` + 4 `@typescript-eslint/no-explicit-any`
resueltas en los archivos nuevos vía tipado explícito/narrowing de unión
discriminada; 7 warnings preexistentes sin cambios, ninguno nuevo).
`npm test`: **69 archivos, 1739 passed, 0 failed** (baseline anterior
67/1691 + 2 archivos nuevos/48 tests nuevos = 69/1739, exacto).
`node scripts/validate-crm-baseline.mjs`: **25/25 PASS**,
`MANIFEST_V2_SHA256 = 422cd62f34404d0f58eb571f722f1b1aabf2ed224b7619f95130c7e8c1d64029`
sin cambios. Build no ejecutado (`DEFERRED FOR ENV SAFETY`).

### 48.H — Diff

Únicamente archivos nuevos:
`scripts/build-crm-fresh-migration-projection.mjs`,
`scripts/build-crm-fresh-migration-projection.d.mts`,
`scripts/bootstrap-staging-first-admin.mjs`,
`scripts/bootstrap-staging-first-admin.d.mts`,
`scripts/sql/verify-20260806120000-fresh-poststate.sql`,
`scripts/sql/verify-crm-bootstrap-pre-20260806120000.sql`,
`tests/crm-fresh-migration-projection.test.ts`,
`tests/bootstrap-staging-first-admin.test.ts`, más esta Sección 48.
Ninguna de las 35 migraciones tocada. Ningún `self-hosted/*.sql`
tocado. Ningún `.env`. `audit/` sin tocar. Los 13 elementos untracked
históricos permanecen intactos. `git diff --check` limpio.

### 48.I — Bloqueadores empíricos antes de `VERIFIED`

1. Ejecutar `scripts/sql/verify-crm-bootstrap-pre-20260806120000.sql`
   contra staging real (confirma rollback total del intento fallido).
2. Ejecutar `scripts/build-crm-fresh-migration-projection.mjs`,
   correr la proyección manualmente contra staging, y ejecutar
   `scripts/sql/verify-20260806120000-fresh-poststate.sql`.
3. `migration repair --status applied 20260806120000` solo si (2) pasa
   íntegramente — 24 Remote / 35 Local esperado.
4. Autorización explícita y ejecución real (no simulada) de
   `scripts/bootstrap-staging-first-admin.mjs` contra staging.
5. `db push` de `20260811103000` → `20260826100000` en un solo pase,
   confirmando que `20260822120000` pasa con el admin recién creado.
6. Solo tras 1-5 exitosos de punta a punta, `B1_WITH_ADOPTION_EXCEPTIONS`
   pasa de `DESIGN_READY_EXECUTION_UNVERIFIED` a `VERIFIED`.

**Confirmación de alcance de esta fase (sin excepciones):**
NO escritura en base de datos. NO `migration repair`. NO creación de
usuarios (ni siquiera de prueba — el script de primer-admin no se
ejecutó, solo se probó contra un mock). NO modificación de migraciones.
NO modificación del baseline. NO creación de bucket. NO Google. NO
arranque del CRM. NO commit. NO push.

### 48.J — Fase 8I-B2B-0B2B-I2-I3H — Endurecimiento final (LOCAL, sin escritura remota)

Consolida el endurecimiento del diseño I3 antes de cualquier ejecución
real, sin ejecutar nada remotamente.

**Identidad canónica congelada de la proyección #24** — no el nombre de
archivo temporal (efímero, timestamp-based), sino la tripleta:

```
sourceSha256:    2c3ef16da63d6db53106737d870ce11abfefeda90645e76ea09f4b2f9e5c34ef
algorithmVersion: v1
projectedSha256: d997d7a62da7eba753dca34d216fef4c5ec85ea4e724ea7d5dd2ee00f4cc1513
```

Recomputada dos veces de forma independiente (`buildProjection()` llamado
dos veces en el mismo proceso): resultado idéntico ambas veces, 64
caracteres hexadecimales, `/^[0-9a-f]{64}$/i` válido. `sourceBytes=13403`,
`projectedBytes=12427`, `bytesRemoved=976` — exactos. Congelado como
`EXPECTED_PROJECTED_SHA256` en el propio script (no solo en este runbook)
para detección de drift automática en pruebas futuras.

**Puerta de confirmación de ejecución** — `bootstrap-staging-first-admin.mjs`
ahora exige `STAGING_BOOTSTRAP_CONFIRM = "CREATE_FIRST_ADMIN_ON_CRM_DRIVE_STAGING"`
(valor exacto, nunca por argv, no es secreto) antes de realizar **cualquier**
llamada remota — ni siquiera una lectura — salvo en modo dry-run. También
exige ahora `EXPECTED_STAGING_SUPABASE_PROJECT_REF` (antes opcional, ahora
requerido) y una nueva atestación separada,
`STAGING_BOOTSTRAP_MIGRATION_WINDOW = "20260806120000_APPLIED_AND_20260822120000_NOT_APPLIED"`:
como el cliente service_role habla solo PostgREST/Admin API y
`supabase_migrations` no está expuesto por esa API, el script no puede
verificar el historial de migraciones por sí mismo sin debilitar
seguridad (embebiendo una credencial Postgres) — esta ventana de
migración es una atestación humana/de orquestación requerida, documentada
como tal en el propio código, no una comprobación real contra la base.

**Modo dry-run** — `STAGING_BOOTSTRAP_DRY_RUN="true"` ejecuta todos los
guards y lecturas (target, ventana de migración, prestate de
`profiles`/admins activos, búsqueda de huérfano) pero nunca llama
`createUser`/`UPDATE`/`deleteUser`. Deliberadamente NO exige la
confirmación de ejecución (no puede escribir de todos modos — exigirla
solo añadiría fricción sin añadir seguridad, según la instrucción
explícita de no complicar el diseño solo para soportar dry-run).

**Detección de usuario Auth huérfano preexistente** — antes de crear
nada, el script busca por email exacto (normalizado) vía
`listUsers()` paginado (única primitiva de enumeración del Admin API;
no existe un `getUserByEmail` directo). Si encuentra una coincidencia
mientras `profiles` está vacío, aborta con
`BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS` (solo UUID + email, nunca
token/password/service_role) y **nunca borra automáticamente** ese
usuario — su procedencia es desconocida (podría venir de una corrida
parcial anterior), así que solo un humano puede decidir. Si la búsqueda
no puede descartar concluyentemente una coincidencia dentro de un límite
acotado de páginas (`AUTH_LOOKUP_MAX_PAGES=50`, `AUTH_LOOKUP_PAGE_SIZE=1000`),
también aborta en vez de asumir ausencia.

**Distinción PREEXISTENTE vs CORRIDA-ACTUAL** — codificada explícitamente:
el caso de usuario huérfano preexistente retorna antes de llamar
`createUser()` y nunca activa compensación. La compensación automática
(borrar el usuario Auth) solo se activa para un usuario creado POR ESTA
MISMA invocación, y ahora ambos resultados de compensación
(`COMPENSATED` y `BOOTSTRAP_PARTIAL_USER_CREATED`) llevan
`scope: "CURRENT_RUN"` explícito, verificado en pruebas — nunca ambiguo
con el caso preexistente.

**Endurecimiento de prestate** — ahora se exige, además de
`profiles` vacío, un conteo separado de Administradores activos = 0
(defensa en profundidad, aunque implicado por `profiles` vacío) y la
atestación de ventana de migración descrita arriba.

**Higiene de secretos (documentación, sin valores reales)** — patrón
PowerShell futuro previsto para la ejecución real (nunca en este
repositorio con un valor real):

```powershell
$env:STAGING_BOOTSTRAP_ADMIN_EMAIL = "bootstrap+staging@<dominio-propio>"
$env:STAGING_BOOTSTRAP_ADMIN_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:STAGING_BOOTSTRAP_CONFIRM = "CREATE_FIRST_ADMIN_ON_CRM_DRIVE_STAGING"
$env:STAGING_BOOTSTRAP_MIGRATION_WINDOW = "20260806120000_APPLIED_AND_20260822120000_NOT_APPLIED"
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / EXPECTED_STAGING_SUPABASE_PROJECT_REF
# siguen viniendo de .env.drive-hosted-staging.local, nunca de argv.
node scripts/bootstrap-staging-first-admin.mjs
```

Ninguna contraseña real ni service_role real aparece en este runbook ni
en el repositorio. La contraseña nunca se acepta por argv ni se
imprime/loguea/persiste.

**Gates:** `npx tsc --noEmit` limpio. `npm run lint`: 0 errores (formato
`prettier/prettier` autofixed, ningún cambio de lógica; 7 warnings
preexistentes sin cambios). `npm test`: **69 archivos, 1762 passed, 0
failed** (68/1739 → +1 test de identidad canónica de proyección + 22
tests nuevos de endurecimiento del primer-admin = +23, exacto).
`node scripts/validate-crm-baseline.mjs`: **25/25 PASS**, MANIFEST_V2 sin
cambios.

**Estado sin cambios:**
`HOSTED_CONTROLLED_BOOTSTRAP_COMPATIBILITY = DESIGN_READY_EXECUTION_UNVERIFIED`
— el endurecimiento de I3H no constituye ejecución empírica. Los 6 gates
empíricos de la Sección 48.I permanecen exactamente iguales.

**Confirmación de alcance de esta fase (sin excepciones):**
NO escritura en base de datos remota. NO llamada Auth en vivo. NO
`migration repair`. NO `db push`. NO creación de usuarios. NO commit.
NO push.

**No se inicia B2B-0B2B-I2 en esta fase — queda en espera de revisión.**
