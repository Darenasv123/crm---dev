# Simplificación final del CRM y sincronización de Agenda

## Alcance local

Esta implementación simplifica Clientes y Expedientes, elimina el panel visual de personas del
expediente, convierte Tareas en una cola voluntaria y separa por completo Tareas de Agenda.
Reportes conserva un único formulario canónico.

## Configuración de Google Calendar

Variables exclusivas de servidor requeridas:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_STATE_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_WEBHOOK_URL`
- `GOOGLE_SHARED_CALENDAR_ID` (opcional si se introduce en la interfaz)

Cloudflare ejecuta mantenimiento cada seis horas. La función consume notificaciones pendientes y
renueva canales con menos de 24 horas de vigencia. No se debe activar el trigger hasta configurar
bindings, URL HTTPS pública, credenciales OAuth y el calendario ficticio de staging.

## Staging

1. Crear y restaurar un respaldo en un entorno aislado.
2. Aplicar sólo las tres migraciones aditivas.
3. Regenerar tipos desde staging y comparar el resultado.
4. Ejecutar pruebas por rol y concurrencia de toma.
5. Configurar OAuth con credenciales de staging y un calendario sin datos reales.
6. Verificar sincronización completa, incremental, webhook, conflictos, borrado y renovación.
7. Auditar consumidores de campos retirados y de la tabla histórica.
8. Autorizar explícitamente la migración destructiva.

## Estado de verificación

La arquitectura y el código son verificables localmente sin credenciales. La conexión real,
entrega de webhooks, rotación de canal y comportamiento remoto sólo pueden confirmarse en staging
autorizado. En esta fase no se ejecutó ninguna operación remota.
