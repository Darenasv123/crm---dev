# Phase 1 Implementation Report

Fecha: 2026-07-22. Rama: `rescue/fase-2a-antigravity`.

## Alcance implementado

- Importador ZIP con arbol completo de carpetas: nombre, ruta, profundidad, padre, subcarpetas, archivos directos y total de documentos descendientes.
- Clasificacion explicita de carpetas: contenedor, posible cliente, posible expediente, documental y desconocida.
- Los contenedores genericos como expedientes, clientes, archivos, documentos, casos, respaldo, backup o Google Drive ya no se persisten como clientes.
- Los clientes candidatos conservan ruta original, evidencia, confianza, advertencias, documentos y expedientes candidatos.
- Agrupacion de documentos por numero de expediente, subcarpeta de expediente o grupo provisional.
- Expediente provisional para documentos sin numero: titulo `Expediente pendiente de clasificacion`, `case_number = null` y estado operacional compatible con esquema actual.
- `process_type` deja de aceptar fragmentos libres; se usa catalogo/reglas y fallback `Pendiente de clasificacion`.
- Persistencia segura por pasos: cliente, expediente, upload, fila `documents`, asociacion con cliente/caso y compensacion de Storage si falla el insert documental.
- Duplicados por `checksum` se verifican por cliente antes de subir.
- Se conserva SHA-256 y ruta original ZIP en columnas existentes: `checksum`, `external_file_id`, `external_folder_id`, `external_url`.
- CSV/XLSX permanece separado del flujo ZIP.
- Vista previa jerarquica: cliente, subcarpetas, expedientes, documentos, mover documentos, excluir archivos/carpetas y crear expediente manual.
- Pantalla Clientes muestra resumen de expedientes reales en lugar de texto libre importado como proceso.

## Limitaciones conscientes

- No se implemento backend masivo, cola, Edge Function ni procesamiento directo de Google Drive OAuth.
- El esquema actual conserva `cases.expediente` como obligatorio; para provisionales se genera un codigo interno compatible y `case_number` queda en `null`. Una migracion futura deberia modelar provisionales de forma canonica.
- `documents` no tiene una columna dedicada `zip_path`; se reutilizan campos externos existentes para conservar ruta y carpeta de origen.
- OCR real para PDFs escaneados sigue pendiente.

## Validacion

- `npm test`: 8 archivos, 121 pruebas pasadas.
- `npx tsc --noEmit --pretty false`: pasado antes de documentar.
