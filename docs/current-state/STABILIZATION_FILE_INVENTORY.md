# Inventario de archivos nuevos durante la estabilización

Fecha de clasificación: 2026-07-29.

El inventario inicial contenía 43 archivos no rastreados. Todos fueron incluidos
en el respaldo externo antes de su clasificación. Ningún valor sensible se
reproduce aquí.

## Clasificación primaria de los 43 archivos

Cada archivo aparece una sola vez en esta tabla, aunque algunos podrían encajar
en más de un grupo funcional.

| Grupo solicitado | Archivos | Acción tomada | Motivo |
| --- | ---: | --- | --- |
| Reportes y WhatsApp | 5 | Versionar 4; ignorar 1 informe local | Dos archivos fuente y dos pruebas forman el flujo real; el informe raíz es un resultado de sesión |
| Migraciones SQL | 2 | Versionar | Crean `cases.materia` y extienden `client_reports` |
| Expedientes y campo `materia` | 1 | Versionar | Prueba de payloads y regresiones del campo |
| Carpetas documentales | 5 | Versionar | Herramienta, analizador, checklist y verificadores SQL |
| Importaciones | 0 | Sin acción | No había archivos nuevos cuya función primaria fuera importar datos |
| Pruebas | 2 | Versionar | Regresión de migración documental y comprobación acumulada de esquema |
| Scripts de verificación | 8 | Ignorar | Consultas y resultados locales bajo `.analysis/`; no son parte del producto |
| Scripts de rollback | 1 | Versionar | Reversión manual documentada para carpetas |
| Documentación | 14 | Ignorar | Informes de auditoría, planificación y guías locales ya reflejadas por código o por este inventario |
| Temporales, resultados o artefactos | 5 | Ignorar | Mensaje de commit, automatizaciones locales y copia alternativa de tipos |
| **Total** | **43** | **15 versionados; 28 ignorados** | Todos cuentan con respaldo externo previo |

## Archivos que forman parte del producto

| Grupo | Archivos | Referencia o prueba | Acción |
| --- | ---: | --- | --- |
| Reportes y WhatsApp | 5 | Formulario y librería usados por `/reportes`; 43 pruebas | Versionar |
| Expedientes y `materia` | 2 | Migración y pruebas de payloads | Versionar |
| Carpetas documentales | 7 | Herramienta, analizador, verificación, rollback y pruebas | Versionar |
| Validación de esquema | 1 | Pruebas del diagnóstico de migración | Versionar |

Archivos versionables:

- `src/components/client-report-form.tsx`
- `src/components/migration-tool.tsx`
- `src/lib/analyze-relative-paths.ts`
- `src/lib/client-reports.ts`
- `supabase/migrations/20260727000000_add_cases_materia.sql`
- `supabase/migrations/20260727120000_extend_client_reports.sql`
- `supabase/verification/CHECKLIST_APLICACION.md`
- `supabase/verification/rollback_document_folders.sql`
- `supabase/verification/test_document_folders_rules.sql`
- `supabase/verification/verify_document_folders.sql`
- `tests/case-payloads.test.ts`
- `tests/client-report-form-integration.test.ts`
- `tests/client-reports.test.ts`
- `tests/document-migration.test.ts`
- `tests/schema-check.test.ts`

## Artefactos locales respaldados

| Grupo | Cantidad | Clasificación | Acción |
| --- | ---: | --- | --- |
| `.analysis/` | 16 | Resultados y scripts locales de auditoría; algunos fijan configuración pública de un proyecto | Ignorar |
| `.kiro/` | 3 | Planificación temporal ya reflejada por código y pruebas | Ignorar |
| Informes/guías de commit en raíz | 4 | Duplicados y desactualizados | Ignorar |
| Scripts de commit/despliegue | 4 | Automatización local riesgosa o específica de una sesión | Ignorar |
| `database.types.new.ts` | 1 | Copia temporal sin referencias de código | Ignorar |

Los 28 artefactos permanecen disponibles en el respaldo externo. Se excluyen del
control de versiones mediante reglas específicas de `.gitignore`; no se ignoran
migraciones, código fuente, pruebas ni scripts SQL necesarios.

## Criterios aplicados

- El código importado por la aplicación y sus pruebas se versiona.
- Las migraciones y verificaciones SQL necesarias se versionan, pero no se
  consideran aplicadas remotamente.
- Los informes operativos de una sesión, mensajes de commit y automatizaciones
  que ejecutan borrados, push o migraciones no forman parte del producto.
- Una copia alternativa de tipos no se conserva junto al archivo tipado activo.
- Los archivos dudosos no fueron destruidos: existe una copia con hashes en el
  respaldo de estabilización.
