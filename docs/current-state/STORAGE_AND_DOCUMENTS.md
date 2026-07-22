# Storage and Documents

## Bucket

El bucket confirmado es `documents`, creado como privado (`public=false`) en `supabase/schema.sql:307` a `:309`.

Politicas base iniciales permiten insert/select/delete a usuarios autenticados (`supabase/schema.sql:318` a `:325`). Politicas finales por rol restringen insert/select a staff y delete a admin (`supabase/schema.sql:531` a `:536`). La migracion de calendario/RLS tambien recrea politicas de storage (`supabase/migrations/20260713150000_usability_timezone_case_links_and_rls.sql:357` a `:386`).

## Rutas de almacenamiento

- Upload manual general: `Date.now()_safeName` en `src/hooks/use-documents.ts:47`.
- ZIP: `clientId/Date.now_safeName` en `src/components/zip-import.tsx:635` a `:637`.
- Comprobantes de pago: suben a Storage desde ruta Pagos en `src/routes/_app.pagos.index.tsx:145` a `:147` (path exacto no documentado aqui por no imprimir el bloque completo; No confirmado).

## Subida manual de documentos

`useUploadDocument` sube primero al bucket `documents` (`src/hooks/use-documents.ts:52` a `:55`). Luego inserta metadata en `documents` con nombre original, display, tipo, mime, tamano, `storage_path`, fuente, estado de procesamiento/verificacion, `client_id` y `case_id` (`src/hooks/use-documents.ts:62` a `:78`). Si falla el insert, borra el archivo subido (`src/hooks/use-documents.ts:103` a `:108`). Este flujo reduce riesgo de archivos huerfanos.

## Subida ZIP

ZIP sube cada archivo activo al bucket (`src/components/zip-import.tsx:639` a `:642`) y luego inserta metadata (`:647` a `:664`). Guarda `original_name`, `display_name`, `document_type`, `file_size`, `checksum`, `source_type='zip_import'`, `source_provider='google_drive_zip'`, `processing_status` y `verification_status`.

Riesgo: no guarda `zipPath`/ruta original dentro del ZIP en tabla `documents`. `ZipFileEntry` si conserva `zipPath` en memoria (`src/lib/imports/zip-import.ts:97` a `:98`), pero el insert no lo persiste.

## URLs, descarga y eliminacion

- `useSignedUrl` crea URL firmada por 300 segundos (`src/hooks/use-documents.ts:131` a `:140`).
- Pantalla Documentos crea URLs para abrir/descargar (`src/routes/_app.documentos.index.tsx:107`, `:117`, `:566` a `:568`).
- Detalle cliente crea URL firmada para descarga (`src/routes/_app.clientes.$id.tsx:224`).
- Detalle expediente crea URL firmada para ver/descargar (`src/routes/_app.casos.$id.tsx:234`, `:244` a `:246`).
- Eliminacion manual borra Storage y luego fila `documents` (`src/hooks/use-documents.ts:118` a `:125`).

## Metadatos y limites

Extensiones ZIP permitidas: `src/lib/imports/zip-import.ts:17` a `:31`. No se encontro limite maximo de tamano en frontend para ZIP o upload manual. No confirmado limite de bucket Supabase.

Hash: ZIP calcula SHA-256 (`src/lib/imports/zip-import.ts:171` a `:176`) y consulta duplicado por `checksum` (`src/components/zip-import.tsx:625` a `:632`). Upload manual no calcula hash.

Documentos sin expediente: permitidos porque `documents.case_id` es nullable (`supabase/schema.sql:281`). En ZIP ocurre cuando no se crea ningun expediente (`src/components/zip-import.tsx:644`).

Documentos sin cliente: permitidos por schema (`supabase/schema.sql:280` nullable), aunque los flujos visibles normalmente pasan `clientId` o lo derivan del expediente.

## Riesgos

- Archivos huerfanos: alto en ZIP si Storage sube y `documents.insert` falla, porque no se revisa error ni se elimina storage (`src/components/zip-import.tsx:647` a `:668`).
- Registros sin archivo: bajo en manual porque primero sube archivo; en ZIP si insert se hiciera tras fallo de storage no ocurre porque `uploadErr` lanza.
- Duplicados: ZIP solo deduplica por `checksum` contra `documents`; no hay unique index de `checksum` confirmado.
- Permisos: Storage usa `public.is_staff()` en politicas finales (`supabase/schema.sql:531` a `:536`); si `profiles` no existe/rol inactivo, fallara por RLS.
- URLs publicas accidentales: bucket privado confirmado. No se encontraron URLs publicas persistentes; se usan signed URLs.

