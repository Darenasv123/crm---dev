# Phase 0 Data Review

Fecha: 2026-07-22. Consulta de solo lectura; no se borraron ni modificaron registros.

## Registros ZIP sospechosos identificados

- Cliente `d4cee6fa-921e-4ef1-a0af-b62bae64a4c8`: `YLLA NEGRON YENI`, creado `2026-07-22T16:55:12.455294+00:00`, notas `Importado desde Google Drive ZIP: YLLA NEGRON YENI -20260722T155441Z-1-001.zip`, `process_type` contiene texto libre no catalogado, 0 casos, 6 documentos con `source_provider = google_drive_zip`, `case_id = null`.
- Cliente `c2af1b4f-63bf-4bc1-8965-3487c437f3c7`: `A-EXPEDIENTES DE CLIENTES`, creado `2026-07-22T17:17:23.161788+00:00`, notas `Importado desde Google Drive ZIP: A-EXPEDIENTES DE CLIENTES -20260722T165939Z-1-002.zip`, nombre compatible con contenedor generico, `process_type` contiene texto libre no catalogado, 0 casos, 343 documentos con `source_provider = google_drive_zip`, `case_id = null`.

## Criterios seguros para distinguirlos

No eliminar automaticamente. Antes de cualquier limpieza, validar en pantalla y con consulta SQL que coincidan todos estos criterios:

- `clients.id` coincide exactamente con uno de los IDs listados.
- `clients.notes` empieza con `Importado desde Google Drive ZIP:` y contiene el ZIP indicado.
- `cases` asociados por `client_id` tienen conteo 0.
- `documents.client_id` apunta al cliente y los documentos tienen `source_provider = google_drive_zip`.
- `documents.case_id` esta en `null`, senal de la importacion defectuosa previa.
- `storage_path` empieza con el UUID del cliente correspondiente.

## Accion tomada

Ninguna eliminacion ni correccion de datos remotos. Solo documentacion para revision manual posterior.
