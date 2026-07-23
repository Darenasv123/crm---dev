# Change Plan

## Fase 0 - Limpiar datos erroneos de pruebas

Objetivo: identificar registros creados por ZIP defectuoso antes de corregir. Archivos/tablas: consultas sobre `clients`, `cases`, `documents`. Migraciones: ninguna. Riesgos: borrar datos reales por error. Pruebas: dry run SQL, revision manual. Criterio: lista aprobada de registros a corregir/eliminar. Prioridad: P0. Complejidad: Media.

## Fase 1 - Corregir importador actual

Objetivo: detener inconsistencias inmediatas sin redisenar todo. Archivos: `src/components/zip-import.tsx`, `src/lib/imports/zip-import.ts`, tests ZIP. Tablas: `clients`, `cases`, `documents`. Migraciones: posiblemente ninguna. Riesgos: cambiar UX de importacion. Pruebas: unitarias de errores, casos sin expediente, status valido, Supabase mock. Criterio: no success si falla case/document; storage se limpia si insert falla. Prioridad: P0. Complejidad: Media.

## Fase 2 - Separar cliente, expediente y documento

Objetivo: parser jerarquico con candidatos separados. Archivos: `src/lib/imports/zip-import.ts`, `src/components/zip-import.tsx`. Tablas: aun actuales. Migraciones: no obligatoria si solo preview. Riesgos: romper importacion existente. Pruebas: ZIP con contenedor, multiples clientes, multiples expedientes. Criterio: `A-EXPEDIENTES DE CLIENTES` no aparece como cliente. Prioridad: P0. Complejidad: Alta.

## Fase 3 - Crear import_batch y vista de revision

Objetivo: persistir lote/candidatos antes de crear entidades reales. Archivos: nueva ruta/panel, hooks de importacion. Tablas: usar o ampliar `import_jobs`, `import_folders`; posiblemente nuevas tablas candidatos. Migraciones: si. Riesgos: RLS y migracion de datos. Pruebas: RLS, CRUD candidatos, aprobacion/rechazo. Criterio: nada se inserta en `clients/cases/documents` antes de confirmar. Prioridad: P0. Complejidad: Alta.

## Fase 4 - Mejorar extraccion DOCX y PDF

Objetivo: robustecer texto y evidencia. Archivos: nuevo servicio extractor; tests con fixtures. Tablas: `document_extractions`, `source_references`. Migraciones: indices/estados si faltan. Riesgos: rendimiento y formatos. Pruebas: PDF textual, PDF escaneado, DOCX, TXT, errores. Criterio: cada hallazgo tiene fuente y confianza. Prioridad: P1. Complejidad: Alta.

## Fase 5 - Crear expedientes provisionales

Objetivo: permitir documentos/casos sin numero confirmado. Archivos: hooks/casos/UI. Tablas: `cases`. Migraciones: hacer `case_number` nullable canonico, agregar `is_provisional` y codigo interno; revisar `expediente not null`. Riesgos: compatibilidad con UI heredada. Pruebas: crear provisional, convertir a real, reportes/documentos. Criterio: documentos nunca quedan perdidos por falta de numero. Prioridad: P1. Complejidad: Media/Alta.

## Fase 6 - Mover procesamiento masivo al backend

Objetivo: sacar JSZip/OCR del navegador. Archivos: server functions/Edge/Cloudflare Worker, UI progreso. Tablas: `import_jobs`, candidatos, logs. Migraciones: estados y errores. Riesgos: despliegue/secretos. Pruebas: job queue, reintentos, idempotencia. Criterio: navegador solo sube/monitorea, backend procesa. Prioridad: P1. Complejidad: Alta.

## Fase 7 - Integrar Google Drive

Objetivo: importar desde Drive real con OAuth. Archivos: `src/lib/imports/drive-provider.ts`, provider real, backend OAuth. Tablas: `documents.external_file_id`, `external_folder_id`, `external_url`, import tables. Migraciones: tokens seguros si aplica. Riesgos: permisos OAuth y datos sensibles. Pruebas: carpetas reales de prueba, refresh token, duplicados por external id. Criterio: Drive real inventaria sin descargar manualmente ZIP y conserva IDs externos. Prioridad: P2/P1 segun urgencia. Complejidad: Alta.


## Checkpoint Fase 1 - 2026-07-22

Fase 1 implementada en commits separados: dependencia directa `jszip`, parser jerarquico, persistencia segura, UI de revision, ajuste de Clientes y tests. Las fases 3 a 7 siguen vigentes para batch backend, OCR robusto, Drive OAuth y modelo canonico de importaciones.
## Fase 8 - Limpieza y estabilizacion operativa completada el 2026-07-22

Completado:

- Checkpoint de importacion individual en `6af7b5c`.
- Herramienta segura de limpieza `scripts/cleanup-test-imports.ts` con dry-run/execute en `4d2b033`.
- Ejecucion y reporte de limpieza en `eeb7dfb`.
- Formato del script administrativo en `1a53698`.
- Estabilizacion de busqueda, documentos, pagos y ficha de cliente en `193e072`.

Siguiente orden recomendado para registrar clientes reales:

1. Mantener detenida la importacion ZIP masiva.
2. Crear clientes manualmente desde `Clientes`.
3. Crear expedientes manuales desde `Expedientes` y asociarlos al cliente correcto.
4. Subir documentos uno por uno, asociandolos a cliente y expediente cuando corresponda.
5. Usar `Reportes` solo con cliente/expediente ya revisado.
6. Retomar importacion ZIP solo cuando exista batch backend o una cola con revision humana.

## Fase 9 - Cierre funcional del core CRM completado el 2026-07-23

Completado:

- Menu principal simplificado y herramientas de importacion reubicadas.
- Dashboard accionable para trabajo diario.
- Clientes: filtros persistentes, creacion/edicion completa, duplicados, ficha por pestanas y archivado seguro.
- Expedientes: lenguaje unificado, filtros operativos, conteos, acciones rapidas, edicion completa y cambio de estado.
- ZIP individual: confirmacion editable, fusion de propuestas, estados validos, errores visibles y documentos sin clasificar cuando corresponde.
- React Query: invalidaciones compartidas para reducir pantallas desactualizadas despues de mutaciones.
- Documentos/layout: mejoras de accesibilidad y scroll horizontal.
- Tests: cobertura agregada para invalidaciones compartidas.

Siguiente orden recomendado:

1. Probar manualmente con usuario real administrador y personal.
2. Validar Supabase remoto, RLS y Storage con datos reales.
3. Registrar clientes reales manualmente desde Clientes.
4. Crear expedientes manuales y asociar documentos revisados.
5. Usar ZIP solo para importacion individual controlada, no para carga masiva.
6. Planificar auditoria persistida, backend de importacion, OCR real y optimizacion de chunks antes de produccion final.
