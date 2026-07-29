# Fuente de verdad del esquema de base de datos

Fecha de decisión: 2026-07-29.

## Estrategia adoptada

Se adopta la estrategia de **snapshot explícitamente no canónico**.

El estado remoto de Supabase no fue consultado durante la estabilización y
`supabase/schema.sql` no incorporaba de forma completa las migraciones más
recientes. Por ello:

- `supabase/migrations/`, aplicado en orden cronológico, es la fuente de verdad
  del esquema esperado por el código;
- `supabase/schema.sql` es una referencia histórica y no debe utilizarse para
  producción;
- el snapshot debe regenerarse desde un entorno validado después de comprobar el
  historial remoto;
- ninguna migración se considera aplicada por el hecho de existir localmente.

## Orden y dependencias relevantes

| Migración | Propósito | Dependencia |
| --- | --- | --- |
| `20260724200000_restrict_payments_to_admin.sql` | Restringe pagos y abonos a Administrador activo | `profiles`, `payments`, `payment_records` |
| `20260725120000_document_folders.sql` | Carpetas lógicas y `documents.folder_id` | `clients`, `profiles`, `documents`, `set_updated_at` |
| `20260727000000_add_cases_materia.sql` | Añade `cases.materia` | `cases` |
| `20260727120000_extend_client_reports.sql` | Añade campos de reportes estructurados | `client_reports` |
| `20260729120000_atomic_payment_records.sql` | Registra abonos y actualiza pagos atómicamente | políticas de pagos y tablas financieras |

Las migraciones aditivas usan guardas `if not exists` cuando PostgreSQL lo
permite. Las migraciones que reemplazan políticas usan `drop policy if exists` y
se ejecutan dentro de una transacción para evitar un estado parcial.

La migración de carpetas produce el estado esperado en una instalación nueva,
pero no debe asumirse que volver a ejecutar un archivo ya registrado en el
historial remoto convergerá cambios posteriores de constraints. En particular,
si Supabase ya registró una versión anterior de esa migración, debe compararse el
constraint de `documents.folder_id` y preparar una migración correctiva nueva;
no se debe alterar ni marcar manualmente el historial remoto.

## Correspondencia con el frontend

- `cases.materia` es usado por validaciones, formularios, filtros y reportes.
- Los campos extendidos de `client_reports` son usados por el formulario de
  reporte y el hook de persistencia.
- `document_folders` y `documents.folder_id` son usados por el navegador y la
  herramienta de migración documental.
- La RPC de abonos sustituye la secuencia cliente de dos escrituras.
- `src/lib/database.types.ts` representa el esquema esperado después de aplicar
  las migraciones locales, no una confirmación del esquema remoto.

## Regla de pagos

`payments` y `payment_records` son exclusivos de usuarios con perfil
`Administrador` y estado `Activo`. Esta regla debe mantenerse simultáneamente
en políticas RLS, funciones RPC y consultas del frontend.

## Regeneración futura

Después de verificar Supabase en staging:

1. comparar el historial remoto con las migraciones locales;
2. aplicar únicamente migraciones pendientes en staging;
3. ejecutar verificaciones de RLS con Administrador y Personal;
4. regenerar tipos y snapshot desde ese entorno;
5. revisar el diff antes de sustituir `schema.sql`;
6. repetir las validaciones antes de producción.
