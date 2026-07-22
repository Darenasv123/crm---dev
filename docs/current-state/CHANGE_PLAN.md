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
