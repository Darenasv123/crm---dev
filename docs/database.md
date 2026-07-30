# Base de datos esperada

## Migraciones locales de la fase final

Aplicar en staging, en este orden:

1. `20260729210000_simplify_clients_and_cases.sql`
2. `20260729211000_task_claim_workflow.sql`
3. `20260729212000_google_calendar_sync.sql`
4. `20260729213000_drop_deprecated_client_case_fields.sql`

La cuarta migración es destructiva y permanece bloqueada salvo que la sesión confirme
`BACKUP_VERIFIED`. Antes de ejecutarla se requiere respaldo restaurado, prueba en staging,
inventario de consumidores externos y aprobación del responsable de datos.

## Modelo funcional

- `clients`: nombre, teléfono, correo opcional, estado, registro y metadatos técnicos.
- `cases`: cliente, número, materia, estado, prioridad, resumen y próximas acciones.
- `case_tasks`: cola operativa, responsable, estado, prioridad y auditoría de toma.
- `agenda_events`: única fuente local del calendario y estado de sincronización.
- `google_calendar_connections`: conexión cifrada administrada en servidor.
- `google_calendar_channels`: canales webhook y su expiración.
- `google_calendar_sync_requests`: cola deduplicada de notificaciones.
- `google_calendar_sync_log`: trazabilidad de sincronización.

La tabla histórica de personas vinculadas al expediente no se elimina en esta fase. Se conserva
para evitar una pérdida de datos hasta que staging confirme que no existen consumidores externos.

`src/lib/database.types.ts` representa manualmente el esquema esperado. Debe regenerarse desde
staging después de aplicar y verificar las migraciones.
