# Bugs and Risks

## P0

### P0-1 Carpetas contenedoras creadas como clientes

Descripcion: el ZIP toma siempre `parts[0]` como cliente. Evidencia: `src/lib/imports/zip-import.ts:375` a `:377`; UI incluso documenta "Cada carpeta de primer nivel se trata como un cliente" en `src/components/zip-import.tsx:789` a `:795`.

Causa raiz: no hay reconstruccion jerarquica Cliente -> Expediente -> Documentos. Impacto: puede crear `A-EXPEDIENTES DE CLIENTES` como cliente y asociar documentos incorrectamente. Reproducir: subir ZIP con carpeta contenedora de primer nivel. Recomendacion: detectar carpetas contenedoras y construir candidatos por niveles con revision humana. Dependencias: nuevo parser jerarquico y migracion de import sessions.

### P0-2 Documentos asociados al cliente/expediente incorrecto

Descripcion: todos los archivos bajo `parts[0]` se agrupan en un solo candidato; al insertar documentos se usa `caseIds[0]` para todos. Evidencia: agrupacion `src/lib/imports/zip-import.ts:386` a `:395`; asociacion `src/components/zip-import.tsx:644` a `:657`.

Causa raiz: no se conserva relacion subcarpeta-expediente. Impacto: documentos de varios expedientes/clientes pueden terminar en un solo cliente o primer expediente. Reproducir: ZIP con un contenedor y subcarpetas de varios clientes/expedientes. Recomendacion: modelar candidatos de cliente, expediente y documento antes de persistir.

### P0-3 Errores de Supabase no comprobados al crear expedientes

Descripcion: insert a `cases` no captura `error`; solo mira `caseData?.id`. Evidencia: `src/components/zip-import.tsx:600` a `:614`.

Causa raiz: destructuring omite `error`. Impacto: cliente puede quedar creado sin expediente y UI puede reportar success. Reproducir: forzar status invalido o RLS en insert cases. Recomendacion: revisar `error`, abortar/compensar o registrar fallo por candidato.

### P0-4 Errores de documents no comprobados

Descripcion: `db.from("documents").insert(...)` no captura ni revisa error. Evidencia: `src/components/zip-import.tsx:647` a `:666`.

Causa raiz: `await` sin inspeccionar respuesta Supabase. Impacto: archivo subido sin fila en `documents`, contador incorrecto, documentos invisibles. Reproducir: quitar permiso insert documents o provocar columna invalida. Recomendacion: capturar `{ data, error }`, borrar Storage si falla.

### P0-5 Falta de transacciones/compensaciones

Descripcion: el flujo crea cliente, luego cases, luego Storage/documents sin transaccion. Evidencia: operaciones separadas en `src/components/zip-import.tsx:572`, `:600`, `:639`, `:647`; catch parcial en `:667` a `:669`.

Causa raiz: procesamiento masivo en frontend con llamadas independientes. Impacto: registros inconsistentes e importaciones irreversibles. Recomendacion: backend RPC/Edge Function/Queue con import batch, estado y compensaciones.

### P0-6 Procesamiento masivo en navegador

Descripcion: JSZip, extraccion y buffers completos viven en el browser. Evidencia: `File.arrayBuffer()` en `src/components/zip-import.tsx:465`; `ZipFileEntry.data: ArrayBuffer` en `src/lib/imports/zip-import.ts:87`.

Causa raiz: no hay worker/backend. Impacto: memoria alta, congelamiento, secretos imposibles de usar de forma segura, fallos parciales. Recomendacion: mover inventario/procesamiento a backend con cola.

## P1

### P1-1 Deteccion de juzgado rota

Evidencia: `firstMatch` devuelve grupo 1 (`src/lib/imports/zip-import.ts:206` a `:210`), `PATTERNS.court` no tiene grupo (`:63`) y `analyzeText` usa `PATTERNS.court` (`:284`). Impacto: `juzgado` casi siempre `undefined`; fallback "Por determinar". Recomendacion: usar patron con captura o devolver match completo.

### P1-2 Frases aleatorias como tipo de proceso

Evidencia: regex libre `processType` en `src/lib/imports/zip-import.ts:69` a `:70`; se persiste en clientes/cases en `src/components/zip-import.tsx:563` a `:566` y `:596` a `:599`. Impacto: clasificacion juridica sucia. Recomendacion: catalogo + normalizador + confianza.

### P1-3 Expedientes no creados

Evidencia: solo se crean por `candidate.detected.expedientes` (`src/components/zip-import.tsx:591` a `:594`). PDF escaneado queda `ocr_required` (`src/lib/imports/zip-import.ts:449` a `:461`). Impacto: documentos sin expediente. Recomendacion: detectar expediente por carpeta/nombre/documento y crear provisionales revisables.

### P1-4 Extraccion PDF poco confiable

Evidencia: heuristica `BT/ET/Font` y parsing manual en `src/lib/imports/zip-import.ts:225` a `:267`. Impacto: no lee PDFs reales complejos/escaneados. Recomendacion: parser PDF robusto + OCR.

### P1-5 Falta de revision humana por entidad

Evidencia: vista previa existe por carpeta-candidato (`src/components/zip-import.tsx:489` a `:494`), no por cliente/expediente/documento. Impacto: usuario no puede corregir jerarquia antes de insertar. Recomendacion: import_batch con candidatos y aprobacion.

### P1-6 JSZip transitivo

Evidencia: `import JSZip from "jszip"` (`src/lib/imports/zip-import.ts:10`) y comentario de transitiva (`:7`). `npm ls` confirma llega por `exceljs/mammoth`. Impacto: cambio de dependencias puede romper build. Recomendacion: declararlo directo cuando se haga fase de correccion.

### P1-7 Status ZIP puede violar check de cases

Evidencia: `status: candidate.detected.stage ?? "En tramite"` (`src/components/zip-import.tsx:607`), pero check base permite `Consulta`, `Documentacion`, `Demanda presentada`, `En proceso`, `Audiencia`, `Sentencia`, `Archivado` (`supabase/schema.sql:137` a `:141`). Impacto: insert de cases puede fallar y no ser reportado por P0-3. Recomendacion: mapear estados.

## P2

### P2-1 Documentacion desactualizada

README/HANDOFF dicen que importaciones son demo (`README.md:17`, `HANDOFF.md:55`), pero ZIP persiste. Impacto: confusion operativa. Recomendacion: actualizar docs tras definir arquitectura.

### P2-2 Warnings lint Fast Refresh

Evidencia: lint reporta 7 warnings en UI/auth. Impacto bajo en produccion, ruido en desarrollo. Recomendacion: separar exports auxiliares en archivos no-componentes.

### P2-3 Build con chunks grandes

Evidencia: `npm run build` advierte chunks > 500 kB, especialmente importaciones/exceljs. Impacto: carga inicial pesada. Recomendacion: code splitting/dynamic import de importadores pesados.


## Actualizacion Fase 1 - 2026-07-22

Mitigado en frontend actual: P0-1, P0-2, P0-3, P0-4, parte de P0-5, P1-1, P1-2, P1-3 y P1-6. Persisten riesgos estructurales: procesamiento pesado en navegador, falta de transaccion real de base de datos, OCR pendiente y necesidad de migracion canonica para expedientes provisionales.
## Actualizacion limpieza y estabilizacion - 2026-07-22

Mitigado:

- Datos ZIP de prueba eliminados de Supabase: 53 clientes, 66 expedientes, 650 documentos y 650 objetos del bucket `documents`.
- Verificacion post-limpieza: 0 IDs del plan permanecen en `clients`, `cases` o `documents`; 0 objetos Storage del plan permanecen presentes; 0 errores de borrado.
- Búsqueda global: ahora no queda inutilizada por fallos de tablas secundarias y consulta telefono/documento/juzgado/partes.
- Subida manual de documentos: ahora valida extension permitida, archivo no vacio y limite de 10 MB antes de subir a Storage.
- Pagos: ahora valida cliente, servicio, honorarios positivos y cuotas >= 1 tambien en el hook, no solo en el formulario.
- Ficha de cliente: incorpora agenda vinculada y documentos sin clasificar para operar cliente por cliente.

Riesgos pendientes:

- No se probo Google Calendar end-to-end con OAuth real en esta fase; requiere token vigente y calendario conectado.
- No se probo flujo E2E autenticado con Playwright; la app responde en localhost, pero la revision visual final queda para prueba manual con usuario real.
- Los warnings Fast Refresh historicos siguen presentes y no bloquean build.
- Sigue pendiente mover procesamiento pesado ZIP/OCR a backend si se retoma importacion masiva.