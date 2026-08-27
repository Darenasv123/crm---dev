# Runbook: primera validación real de Google Drive (Fase 8I-A/8I-B)

**Versión:** 2026-08-27 (Fase 8I-A — preflight, sin tocar Google ni Supabase remoto)
**Estado:** checklist verificable, NADA de esto se ha ejecutado todavía.

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

---

## 36. Contenido de este runbook

Este documento es el entregable principal de la Fase 8I-A, ampliado en
8I-A.1 (rehearsal real PG17 + hardening del validador, Secciones 5/32) y en
8I-B1 (staging readiness completo, Sección 39): prerrequisitos, decision
gates, setup de Google Cloud, checklist de variables, requisitos de
staging, orden de migraciones, backup/rollback, secuencia E2E por bloques
(Sección 39.M), resultados esperados, criterios de aborto (Sección 37),
evidencia a recolectar, limpieza posterior a la prueba (Sección 38), y el
diseño completo de staging (topología, dominio, aislamiento Supabase,
inventario de variables, Google Cloud testing project, rollback y limpieza
— Sección 39). Se mantiene como fuente de verdad única — no se crea un
runbook complementario. No incluye secretos.

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

Objetivo de esta sección: dejar el staging completamente diseñado y
verificable ANTES de tocar Google Cloud, OAuth, Supabase staging remoto,
DNS, Virtualmin, Apache, Cloudflare, servidor real o Drive real. Nada de
lo que sigue se ejecutó en esta fase.

### 39.A — Auditoría de deployment real (hallazgo)

`DEPLOY.md` (raíz del repo) describe un flujo de **Cloudflare Workers**
(`npm run deploy` → `wrangler deploy`) que referencia directamente el
proyecto Supabase legacy `pnqdgwpxcxngeueosmnh` en texto plano. Confirmado
por auditoría: **este NO es el mecanismo de despliegue real actual.** El
mecanismo real, documentado en `server-release/docs/VIRTUALMIN_DEPLOYMENT.md`
y consistente con `server-release/docs/ADMIN_SERVER_MESSAGE.md` y el ZIP de
release ya presente en el repo (`advocate-nest-virtualmin-release-2026-08-01.zip`), es:

```
Internet → https://abogado.consoldi.com
  → [capa DNS/proxy: PENDING VERIFICACIÓN OPERATIVA — ver 39.W]
    → Apache/Virtualmin (reverse proxy)
      → http://127.0.0.1:3000 (Node interno)
        → .output/server/index.mjs (TanStack Start + Nitro, preset "node")
          → Supabase externo (Auth, PostgreSQL, RLS, RPC, Storage)
```

Build real: `npm run build:node` (`BUILD_TARGET=node`, ver `vite.config.ts`
líneas 9-31), que fuerza el preset Nitro `"node"` — distinto del preset
`"cloudflare-module"` que usa `npm run build`/`npm run deploy` (el que
`DEPLOY.md` documenta). Estructura de release:
`/home/abogado/apps/advocate-nest/{releases/<fecha>/,current→symlink,shared/.env.production}`.
Servidor real: `144.126.140.178`, SFTP puerto `2705`, usuario `abogado`.

**`DEPLOY.md` queda confirmado como documentación obsoleta** (Cloudflare, no
el target real) — no se modifica en esta fase por estar fuera del scope
autorizado (auditoría, no limpieza de docs no relacionadas con Drive), pero
queda registrado aquí para no repetir la confusión en 8I-B2.

**Corrección (Fase 8I-B1.1) — proceso permanente:** `VIRTUALMIN_DEPLOYMENT.md`
(el único documento de deployment de este repo que describe el proceso
permanente) lista PM2 como "Opción 1 (recomendada)" y systemd como "Opción
2" — ambas presentadas como alternativas igualmente válidas, sin indicar
cuál está realmente en uso. Según información operativa aportada
directamente por el propietario del CRM (procedimiento
`deploy-advocate-nest-root.sh`, **no localizado en este repositorio** —
no se pudo verificar su contenido por auditoría propia, se toma como dato
operativo del propietario, no como hallazgo de código), el procedimiento
canónico real define `/etc/systemd/system/advocate-nest.service`
(`ExecStart=/usr/bin/node .output/server/index.mjs`) como el mecanismo
permanente, y **limpia explícitamente PM2 legacy** (proceso, daemon, y el
cron de `pm2 resurrect`) como parte de su ejecución. Esto contradice
directamente la recomendación de `VIRTUALMIN_DEPLOYMENT.md` — ese documento
queda marcado como desactualizado en cuanto a cuál opción es la vigente
(no se corrige su contenido en esta subfase, solo se anota aquí la
discrepancia; corregirlo pertenece a mantenimiento de docs de despliegue,
fuera del scope Drive). Ver modelo corregido en 39.O/39.Q.

### 39.B — Topología de staging

Staging vive en el MISMO servidor físico que producción, pero como entorno
lógicamente aislado, sin ningún recurso compartido con producción salvo el
hardware:

| Recurso | Producción | Staging |
|---|---|---|
| vhost/dominio | `abogado.consoldi.com` | `abogado-staging.consoldi.com` (PENDING, ver 39.C) |
| Directorio app | `/home/abogado/apps/advocate-nest/` | directorio independiente, ej. `/home/abogado/apps/advocate-nest-staging/` |
| Proceso Node | `systemd advocate-nest.service` en `:3000` (canónico corregido, ver 39.A) | `systemd advocate-nest-staging.service` independiente, en puerto distinto (ver 39.P) |
| Variables | `shared/.env.production` | archivo separado, nunca el mismo `.env.production` |
| Logs | `/home/abogado/logs/advocate-nest.*` | ruta de logs separada |
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

### 39.C — Dominio de staging (PENDING)

**Propuesto:** `abogado-staging.consoldi.com`. Estado: **PENDING** — no se
crea ningún registro DNS en esta fase, y el dominio se trata como no
confirmado hasta verificar que no colisiona con configuración existente en
Virtualmin/Cloudflare para `consoldi.com`. Si hay conflicto, alternativa
propuesta: `staging-abogado.consoldi.com` o un subdominio bajo un dominio
de pruebas separado si el estudio lo prefiere — decisión pendiente de
confirmación externa, no de este documento.

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

**CURRENT CANONICAL DEPLOYMENT MODEL: systemd + Node.** PM2 es un proceso
legacy que el procedimiento de despliegue vigente limpia explícitamente
(ver corrección en 39.A) — no se usa PM2 en ningún ejemplo de esta
sección. **Esto debe reconfirmarse contra el servidor real mediante una
auditoría read-only antes de crear el unit de staging** (ver 39.W/Sección
8 de esta fase) — no se asume que el servidor sigue exactamente igual sin
observarlo primero; el procedimiento pudo cambiar entre el momento en que
se documentó y el momento real de 8I-B2.

```
/home/abogado/apps/advocate-nest-staging/
├── releases/<fecha>/app/.output/server/index.mjs
├── current → releases/<fecha>/
└── shared/.env.staging
```

Unit conceptual (**no se crea en esta fase**):

```ini
# /etc/systemd/system/advocate-nest-staging.service
[Unit]
Description=CRM Jurídico Estudio Arenas — STAGING
After=network.target

[Service]
Type=simple
User=abogado
WorkingDirectory=/home/abogado/apps/advocate-nest-staging/current/app
EnvironmentFile=/home/abogado/apps/advocate-nest-staging/shared/.env.staging
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=advocate-nest-staging
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` y `EnvironmentFile` completamente separados de
producción — nunca el mismo directorio ni el mismo archivo de entorno.
`HOST=127.0.0.1`, `PORT` pendiente de auditoría (ver 39.P).

### 39.P — Puerto de staging

**STAGING_PORT = PENDING.** No se fija un puerto específico en este
documento. Antes de elegirlo en 8I-B2: auditar el servidor real con `ss
-ltnp` (no `netstat`, no instalado por defecto en todas las distribuciones
modernas) y revisar qué servicios ya escuchan. **No asumir `3100`**: según
información operativa del propietario, el script de despliegue productivo
ya utilizó históricamente el puerto `3100` como puerto temporal de release
testing — reutilizarlo como puerto PERMANENTE de staging podría colisionar
con ese uso temporal si ambos coincidieran en el tiempo. La elección final
del puerto es un paso de 8I-B2, condicionado al resultado de la auditoría
read-only, no de esta fase.

### 39.Q — Apache/Virtualmin (plan futuro, NO ejecutar)

```
https://abogado-staging.consoldi.com
        ↓
[capa DNS/proxy: PENDING VERIFICACIÓN OPERATIVA — ver 39.W]
        ↓
Apache reverse proxy (nuevo vhost, análogo al de producción en
VIRTUALMIN_DEPLOYMENT.md, mismos módulos: proxy proxy_http proxy_wstunnel ssl rewrite headers)
        ↓
http://127.0.0.1:<staging-port PENDING, ver 39.P>
        ↓
advocate-nest-staging.service (systemd, ver 39.O)
```

Nunca editar el vhost de producción (`abogado.consoldi.com`) al crear el
de staging. **Antes de crear cualquier vhost de staging, reconfirmar por
auditoría read-only (ver 39.W, Sección 8 de esta fase) la configuración
exacta del vhost de producción** — no asumir que el Apache config
documentado en `VIRTUALMIN_DEPLOYMENT.md` sigue siendo textualmente exacto
sin observarlo. Rollback: deshabilitar/eliminar el vhost de staging
(`a2dissite` o el mecanismo equivalente de Virtualmin) sin ningún reinicio
que afecte al vhost productivo — Apache soporta recargar solo la
configuración nueva sin downtime del vhost existente si se usa
`systemctl reload` en vez de `restart`, a confirmar en el servidor real.

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
- Deshabilitar el proceso Node de staging (`systemctl stop advocate-nest-staging`).
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

### 39.W — Cloudflare/DNS (estado corregido — PENDING VERIFICACIÓN OPERATIVA)

**Corrección (Fase 8I-B1.1):** la versión anterior de esta sección
afirmaba "producción NO usa Cloudflare" como hecho confirmado, basado en
que `VIRTUALMIN_DEPLOYMENT.md`, `ROLLBACK.md` y `UPDATE.md` no lo
mencionan. Esa inferencia es inválida: **la ausencia de una mención en la
documentación no demuestra la ausencia de una capa DNS/CDN/proxy externa
real** — un proxy Cloudflare (u otro) podría estar activo en el dominio
sin que ningún documento interno del repo lo registre, especialmente si
fue configurado directamente en el panel DNS del dominio, fuera del
alcance de lo que Virtualmin gestiona. El propio procedimiento de
despliegue (`deploy-advocate-nest-root.sh`, ver 39.A) tampoco modifica
Cloudflare ni DNS ni Apache — solo remite a revisarlos por separado cuando
falla la ruta pública, lo cual es consistente con que esa capa exista y
simplemente no esté bajo su control, no con que no exista.

**Estado correcto: `Production DNS/CDN layer: PENDING OPERATIONAL
VERIFICATION.`** Lo único confirmado por auditoría de este repositorio:

```
Internet
  → dominio abogado.consoldi.com
    → [capa DNS/proxy: todavía por verificar]
      → Apache/Virtualmin
        → 127.0.0.1:3000
          → advocate-nest.service (systemd, ver 39.A)
            → Node
```

No se inserta Cloudflare en el diagrama como hecho confirmado. Tampoco se
declara "DNS directo" como hecho todavía — ambas serían afirmaciones no
demostradas por igual.

**Auditoría futura obligatoria en 8I-B2, antes de crear el dominio de
staging** (estrictamente read-only, sin modificaciones durante la
auditoría inicial):

- DNS actual del dominio de producción (nameservers, registros A/CNAME).
- Respuesta pública real (`curl -I https://abogado.consoldi.com`) y sus headers HTTP.
- VirtualHost Apache exacto tal como está hoy en el servidor (no el documentado, el real).
- Certificado TLS real: emisor, mecanismo de renovación.
- `ProxyPass`/`ProxyPassReverse` reales.
- Servicio systemd real corriendo (nombre exacto, estado, puertos).

El resultado de esa auditoría determina si staging seguirá un patrón de
DNS directo o necesitará replicar un Cloudflare/proxy equivalente — **no
se decide en esta fase.** Igualmente, **no se afirma todavía "staging
usará Let's Encrypt" como decisión definitiva**: el TLS de staging requiere
un certificado público válido, y el mecanismo exacto queda como `PENDING
INFRASTRUCTURE AUDIT` — si la auditoría confirma que Virtualmin ya
administra Let's Encrypt para el dominio real, se reutilizará ese mismo
mecanismo para staging; no se inventa un mecanismo alternativo sin haber
observado primero el real.

Si la auditoría confirmara la presencia de un proxy tipo Cloudflare, el
callback/webhook de OAuth deberían probarse explícitamente contra: un WAF
challenge, un Cloudflare Access, o un bot challenge — cualquiera de los
tres podría bloquear las llamadas de Google a `/api/google-drive/webhook`
o el propio flujo de callback. Esto queda documentado como una prueba
futura condicionada al resultado real de la auditoría, no como algo
descartado de antemano.

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

### 39.Y — Resumen estructurado (Fase 8I-B1.1)

**Verificado desde repo/documentación:**
- Node artifact: `.output/server/index.mjs` (build real: `npm run build:node`, preset Nitro `"node"`).
- Production internal port históricamente documentado: `3000`.
- Bucket de Storage: `documents` (único, privado, sin límites de tamaño/MIME).
- Migraciones pendientes reconciliadas: 9, ya validadas sobre PostgreSQL 17 real (Fase 8I-A.1).
- Staging debe ser independiente (topología, 39.B).
- Supabase staging independiente (39.D).
- Google project independiente (39.J).

**Pendiente de auditoría real (ninguno se convierte en hecho sin observar el servidor):**
- **Process manager realmente activo hoy** — `VIRTUALMIN_DEPLOYMENT.md` (repo) documenta PM2 como "recomendada"; información operativa del propietario (procedimiento `deploy-advocate-nest-root.sh`, no localizado en este repositorio) indica systemd y limpieza explícita de PM2 legacy — ninguna de las dos fuentes es una observación en vivo del servidor. **Ambas versiones permanecen sin confirmar** hasta la auditoría read-only de 8I-B2.
- Unit systemd actual (si existe) — nombre exacto, estado.
- PM2 legacy presente o no.
- Puerto de staging disponible (`ss -ltnp`, nunca asumir `3100`).
- Configuración exacta del VirtualHost Apache real.
- `ProxyPass`/`ProxyPassReverse` reales.
- DNS/nameservers reales del dominio.
- Presencia o ausencia de Cloudflare u otro proxy — ni confirmado ni descartado.
- Mecanismo real de aprovisionamiento de certificado TLS.
- Configuración Virtualmin actual.

**Staging planned (diseño, no ejecutado):**
- Dominio: `abogado-staging.consoldi.com` — PENDING disponibilidad/confirmación.
- Supabase: proyecto staging independiente, aislado de `pnqdgwpxcxngeueosmnh`.
- Proceso: `systemd advocate-nest-staging.service` independiente como diseño de staging (39.O) — esto es una decisión de diseño para el entorno NUEVO, independiente de qué gestor esté realmente activo hoy en producción.
- Google: proyecto de testing independiente (`CRM Drive — Testing`), separado de Calendar.
- Admin: identidad Auth real vía Supabase Auth Admin API o Dashboard — nunca `INSERT` directo en `auth.users` en un proyecto real.
