# Flujo de importación

## Alcance actual

`/importaciones` demuestra el recorrido completo con `MockDriveProvider`. No usa OAuth, no descarga archivos reales y no modifica Google Drive ni Supabase.

## Etapas

1. Conectar fuente.
2. Seleccionar carpeta.
3. Inventariar documentos.
4. Procesar documentos.
5. Analizar carpetas.
6. Revisar resultados.
7. Confirmar importación.

La interfaz muestra ejemplos de documento pendiente, analizado, escaneado, con error y pendiente de revisión.

## Contrato de Drive

`DriveProvider` ofrece operaciones para listar carpetas, listar archivos, consultar metadatos, descargar y exportar documentos de Google. `GoogleDriveProvider` existe como límite arquitectónico, pero no contiene credenciales ni llamadas reales.

## Persistencia futura

- Crear un registro en `import_jobs`.
- Inventariar carpetas en `import_folders`.
- Registrar documentos sin duplicar binarios hasta definir la política de almacenamiento.
- Procesar cada documento en una tarea independiente.
- Consolidar por carpeta después de completar sus documentos.
- Enviar los hallazgos a revisión humana.
- Crear o actualizar entidades únicamente al confirmar.

## Segundo plano

`BackgroundJobDispatcher` define el envío de unidades de trabajo. La implementación futura puede usar Cloudflare Queues; `ImportWorkflowRunner` puede usar Cloudflare Workflows para coordinar etapas y reintentos. Ninguna petición web debe esperar el análisis completo de una carpeta.

## Integración real pendiente

- Crear OAuth de Google con consentimiento y mínimos permisos de lectura.
- Guardar tokens cifrados fuera del frontend.
- Implementar paginación, límites de cuota y reintentos.
- Calcular checksum antes de descargar o duplicar.
- Registrar errores por documento sin detener todo el trabajo.
- Probar primero con una carpeta ficticia controlada.
