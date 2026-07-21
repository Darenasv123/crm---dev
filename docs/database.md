# Base de datos

## Migración de esta fase

`supabase/migrations/20260721090000_legal_case_foundation.sql` es aditiva y autosuficiente respecto a las funciones de rol. Debe ejecutarse sobre una base que ya contenga el esquema principal del CRM.

Antes de producción:

1. Crear un respaldo de la base desde Supabase.
2. Verificar que `profiles`, `clients`, `cases`, `documents` y `payments` existen.
3. Ejecutar las migraciones en orden.
4. Revisar que RLS esté habilitado en las tablas nuevas.
5. Probar con una cuenta `Personal` y otra `Administrador`.

## Tablas ampliadas

- `clients`: tipo/número de documento, WhatsApp, ocupación, observaciones, autor y actualización.
- `cases`: código interno, materia, área, etapa, órgano jurisdiccional, número, año, responsable, resumen, última y próxima acción.
- `documents`: nombres, tipo documental, fuente, referencia externa, tamaño, estado de procesamiento, verificación y confidencialidad.
- `payments`: relación opcional con expediente.

## Tablas nuevas

- `case_parties`: personas y roles del expediente.
- `document_extractions`: texto y estructura extraídos de un documento.
- `case_events`: línea de tiempo procesal con fuente y verificación.
- `case_tasks`: próximas acciones, responsables y vencimientos.
- `import_jobs`: estado agregado de una importación.
- `import_folders`: carpetas inventariadas y coincidencias probables.
- `ai_analysis_runs`: ejecución, proveedor, versión, salida y coste estimado.
- `ai_findings`: propuestas individuales pendientes de decisión humana.
- `source_references`: trazabilidad de un campo hasta documento, página y fragmento.

## RLS

Las tablas nuevas permiten lectura, inserción y actualización a perfiles activos con rol `Administrador` o `Personal`. La eliminación se reserva al administrador. La migración recrea `is_staff()` e `is_admin()` antes de declarar políticas para evitar fallos de orden.

## Índices

Se indexan documentos de identidad, teléfonos, números de expediente, responsables, estados, fechas, relaciones con expedientes y colas de revisión. No se añade todavía búsqueda semántica ni `pgvector`.

## Reversión

No se incluye una reversión automática porque podría eliminar información incorporada después de la puesta en marcha. Una reversión segura debe:

1. Exportar las tablas nuevas.
2. Desactivar temporalmente los módulos nuevos.
3. Eliminar primero claves foráneas e índices de la ampliación.
4. Eliminar tablas nuevas solo después de validar el respaldo.
5. Conservar las columnas heredadas y los archivos del bucket.

El rollback debe prepararse para el estado concreto de producción y nunca ejecutarse a ciegas.
