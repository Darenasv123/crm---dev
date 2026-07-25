# Requirements Document

## Feature: Importación masiva de clientes y documentos

---

## Introducción

Esta funcionalidad permite al personal del Estudio Jurídico Arenas importar de forma masiva clientes y sus documentos asociados, seleccionando una carpeta local descargada previamente desde Google Drive. El sistema interpreta cada subcarpeta de primer nivel como un cliente, y los archivos contenidos en ella (y sus subcarpetas internas) como documentos asociados a ese cliente.

La importación ocurre completamente desde el navegador del usuario. No existe integración directa con Google Drive ni se envía toda la carpeta como una sola petición al servidor. La funcionalidad reutiliza las mismas tablas, bucket de Storage, políticas RLS y utilidades ya existentes en el CRM.

---

## Hallazgos del análisis del repositorio

### Stack tecnológico real

- **Frontend**: React 19 + TanStack Router + TanStack Query 5 + Vite 8
- **Backend / Deploy**: Cloudflare Workers (Nitro adapter) via `wrangler.toml`
- **Base de datos y Storage**: Supabase (`@supabase/supabase-js` ^2.108.2)
- **UI**: Tailwind CSS v4 + Radix UI + Lucide React
- **Formularios**: React Hook Form + Zod
- **Testing**: Vitest 3 (`npm run test` ejecuta todos los tests en `tests/`)
- **Linting**: ESLint 9 (`npm run lint`)
- **Build**: `npm run build` (Vite + Cloudflare Workers target)

### Tablas de Supabase confirmadas

**`public.clients`** — columnas requeridas en Insert:
- `name` (text, NOT NULL)
- `initials` (text, NOT NULL)
- `color` (text, NOT NULL, default `'oklch(0.55 0.13 235)'`)
- `dni` (text, NOT NULL) — campo heredado, aún requerido
- `phone` (text, NOT NULL) — campo heredado, aún requerido
- `process_type` (text, NOT NULL)
- Nullable (opcionales en Insert): `document_type`, `document_number`, `whatsapp`, `occupation`, `notes`, `email`, `address`, `birthdate`, `civil_status`, `created_by`, `status`

**`public.documents`** — columnas requeridas en Insert:
- `name` (text, NOT NULL)
- `type` (text, NOT NULL)
- `size` (text, NOT NULL)
- `storage_path` (text, NOT NULL)
- Nullable (opcionales): `original_name`, `display_name`, `document_type`, `mime_type`, `source_type`, `source_provider`, `file_size`, `checksum`, `processing_status`, `verification_status`, `client_id`, `case_id`, `created_by`

**`public.import_jobs`** — columnas disponibles para tracking:
- `id`, `name`, `provider`, `status`, `total_folders`, `total_documents`, `processed_documents`, `failed_documents`, `detected_clients`, `progress_percentage`, `started_at`, `completed_at`, `created_by`, `error_message`, `configuration` (jsonb)
- Status válidos (constraint): `'draft'`, `'inventory'`, `'processing'`, `'consolidating'`, `'review_required'`, `'completed'`, `'partially_completed'`, `'failed'`, `'cancelled'`

**`public.import_folders`** — disponible para registrar carpetas procesadas:
- `import_job_id`, `external_folder_id`, `folder_name`, `folder_path`, `detected_client_id`, `analysis_status`

### Bucket de Storage confirmado

- Nombre: `documents`
- Acceso: privado (`public: false`)
- Políticas RLS: INSERT requiere `is_staff()`, SELECT requiere `is_staff()`, DELETE requiere `is_admin()`

### Funciones y utilidades existentes reutilizables

Todas verificadas en el repositorio:

| Función / Utilidad | Archivo | Uso |
|---|---|---|
| `normalizeText(value)` | `src/lib/client-validation.ts` | Normaliza nombre para comparación (NFD, minúsculas, sin especiales) |
| `normalizeDigits(value)` | `src/lib/client-validation.ts` | Extrae solo dígitos de un string |
| `buildClientInitials(name)` | `src/lib/client-validation.ts` | Genera iniciales de 2 caracteres a partir del nombre |
| `findClientDuplicates(input, clients, excludeId?)` | `src/lib/client-validation.ts` | Detecta duplicados exactos y aproximados (≥2 tokens, ≥75%) |
| `validateDocumentFile(file)` | `src/hooks/use-documents.ts` | Valida extensión, tamaño y nombre de archivo |
| `MAX_DOCUMENT_SIZE_BYTES` | `src/hooks/use-documents.ts` | `10 * 1024 * 1024` (10 MB) |
| `ALLOWED_DOCUMENT_EXTENSIONS` | `src/hooks/use-documents.ts` | Set actual: `pdf, doc, docx, jpg, jpeg, png, xlsx, xls` |
| `getAuthClient()` | `src/lib/supabase.ts` | Cliente Supabase con token de sesión activo para RLS |
| `supabase` | `src/lib/supabase.ts` | Cliente Supabase base para Storage |
| `invalidateCrmQueries(qc, opts)` | `src/lib/query-invalidation.ts` | Invalida `["clients"]`, `["documents"]`, etc. |
| `COLORS` (array) | `src/hooks/use-clients.ts` | Paleta de 6 colores oklch para asignar a clientes |
| `isMissingSchemaFieldError(error)` | `src/lib/supabase-errors.ts` | Fallback para esquema legacy |
| `normalizeFolderName(name)` | `src/lib/imports/zip-import.ts` | Limpia nombre de carpeta (espacios, sufijos Google Drive) |
| `shouldIgnorePath(path)` | `src/lib/imports/zip-import.ts` | Filtra archivos de sistema (`.DS_Store`, `__MACOSX`, etc.) |
| `sha256(buffer)` | `src/lib/imports/zip-import.ts` | SHA-256 con Web Crypto API |
| `formatSize(bytes)` | `src/lib/imports/zip-import.ts` | Formatea bytes a KB/MB |

### Componentes visuales reutilizables

- `AppLayout`, `Card`, `StatusBadge` — `src/components/app-layout.tsx`
- `Progress` — `src/components/ui/progress.tsx` (`@radix-ui/react-progress`)
- Todos los componentes en `src/components/ui/` (Dialog, Button, Badge, Select, Input, etc.)

### Componentes de importación existentes (NO reemplazar)

- `ZipImport` — `src/components/zip-import.tsx` — importa un ZIP de un solo cliente
- `CSVImport` — `src/components/csv-import.tsx` — importa lista de clientes desde CSV/XLSX
- Ambos son accesibles desde `_app.clientes.index.tsx` con modales separados

### Rutas relevantes

- `/clientes` — `src/routes/_app.clientes.index.tsx` — página donde se añadirá el botón de acceso
- `/importaciones` — `src/routes/_app.importaciones.index.tsx` — existe pero es para consultar jobs

### Funciones RLS confirmadas

- `is_staff()` — retorna `true` para rol `'Administrador'` o `'Personal'` con `status = 'Activo'`
- `is_admin()` — retorna `true` solo para rol `'Administrador'` con `status = 'Activo'`
- No existe columna `user_id` ni `org_id` en `clients` ni `documents`; el acceso es solo por rol del perfil autenticado

### Variables de entorno del cliente (únicas disponibles)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Las variables `CF_IMPORT_QUEUE` y `CF_IMPORT_WORKFLOW` están marcadas como "futuras" en `.env.example` y **no están activas**

### Tests existentes relevantes

- `tests/zip-import.test.ts` — cubre `normalizeFolderName`, `shouldIgnorePath`, `sha256`, `detectDuplicates`, `parseZipFile`
- `tests/validation-safety.test.ts` — cubre `validateClientForm`, `findClientDuplicates`
- `tests/text-utils.test.ts` — cubre utilidades de texto
- Comando: `npm run test` (excluye `tests/remote-validation.test.ts`)

---

## Incompatibilidades detectadas entre la solicitud y el CRM real

### IC-1: Campos NOT NULL en `clients` sin datos disponibles en la carpeta

La tabla `clients` requiere `dni` (NOT NULL), `phone` (NOT NULL) y `process_type` (NOT NULL). La estructura de carpetas solo provee el nombre del cliente. **Resolución adoptada**: insertar valores centinela `dni = 'PENDIENTE'`, `phone = '000000000'`, `process_type = 'Por clasificar'` y `status = 'En espera'`, con una nota en `notes` indicando el origen de importación masiva. Estos valores centinela son distintos de los que `validateClientForm` acepta (DNI de 8 dígitos, teléfono de 9 dígitos), por lo que la importación masiva **no debe pasar por `validateClientForm`**; en cambio construye el payload directamente igual que hace `useCreateClient`, usando el fallback legacy si es necesario.

### IC-2: `ALLOWED_DOCUMENT_EXTENSIONS` no incluye `webp` ni `txt`

`validateDocumentFile` en `use-documents.ts` solo acepta: `pdf, doc, docx, jpg, jpeg, png, xlsx, xls`. La importación masiva requiere también `webp` y `txt`. **Resolución adoptada**: la función de validación de la importación masiva define su propio conjunto extendido (`BULK_IMPORT_EXTENSIONS`) sin modificar `ALLOWED_DOCUMENT_EXTENSIONS` ni `validateDocumentFile`, para no afectar la carga manual.

### IC-3: Límite de 10 MB por archivo

`MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024`. Carpetas escaneadas pueden contener archivos mayores. **Resolución**: archivos que superen este límite se marcan como `invalid_size` sin detener el resto de la importación.

### IC-4: No existe columna `user_id` ni `org_id` en `clients` o `documents`

El acceso es exclusivamente por rol del perfil autenticado via `is_staff()` / `is_admin()`. La importación masiva usa `getAuthClient()` igual que el resto del CRM, y registra `created_by = auth.uid()` en cada registro.

### IC-5: `import_jobs` ya existe con constraint de status definido

Los valores válidos del constraint son: `'draft'`, `'inventory'`, `'processing'`, `'consolidating'`, `'review_required'`, `'completed'`, `'partially_completed'`, `'failed'`, `'cancelled'`. La importación masiva usará `'processing'` durante la ejecución y `'completed'`, `'partially_completed'` o `'failed'` al finalizar.

### IC-6: `webkitdirectory` no es estándar W3C

Funciona en Chrome, Edge y Safari modernos. No funciona en Firefox < 50 ni en algunos entornos móviles. La implementación mostrará un aviso si el atributo no está disponible.

### IC-7: Cloudflare Queues / Workflows no disponibles

`CF_IMPORT_QUEUE` y `CF_IMPORT_WORKFLOW` están marcados como "futuros" en `.env.example`. Toda la orquestación ocurre en el cliente con concurrencia limitada (máx. 3 uploads simultáneos) usando un pool de promesas.

### IC-8: `ZipImport` y `CSVImport` ya existen y no deben ser afectados

El nuevo componente `FolderImport` coexistirá con ambos. Solo se añade un botón adicional en la barra de acciones de `/clientes` y un nuevo modal, sin modificar la lógica de los componentes existentes.

---

## Glosario

- **FolderImport**: Componente modal principal de la importación masiva desde carpeta local.
- **FolderAnalyzer**: Módulo puro (sin I/O) que lee `webkitRelativePath` y construye el árbol de clientes/documentos en memoria.
- **ImportEngine**: Servicio de orquestación que crea clientes, sube archivos y registra documentos.
- **ClientEntry**: Representación en memoria de un cliente detectado antes de ser persistido.
- **DocumentEntry**: Representación en memoria de un archivo detectado antes de ser subido.
- **Carpeta raíz**: El directorio seleccionado por el usuario; no se convierte en cliente.
- **Subcarpeta de primer nivel**: Cada directorio inmediatamente dentro de la raíz; representa un cliente.
- **Archivo de sistema**: Ignorado: `.DS_Store`, `Thumbs.db`, `desktop.ini`, cualquier nombre que empiece con `._`.
- **Duplicado exacto**: Nombre normalizado idéntico al de un cliente existente (via `normalizeText` + `findClientDuplicates`).
- **Coincidencia aproximada**: ≥ 2 tokens de longitud > 2 y ≥ 75% de tokens compartidos, sin ser exacto.
- **Storage path**: `{client_uuid}/{sanitized_relative_path}` donde los caracteres no seguros se reemplazan con `_` preservando `/`.
- **`is_staff()`**: Roles `'Administrador'` o `'Personal'` con estado `'Activo'`.
- **`is_admin()`**: Solo rol `'Administrador'` con estado `'Activo'`.
- **`BULK_IMPORT_EXTENSIONS`**: Conjunto extendido: `pdf, doc, docx, xls, xlsx, jpg, jpeg, png, webp, txt`.

---

## Requirements

### REQ-1: Punto de entrada y selección de carpeta

**User Story:** Como personal del estudio, quiero seleccionar una carpeta completa desde mi sistema de archivos para iniciar la importación masiva, sin tener que crear clientes ni subir documentos uno por uno.

#### Acceptance Criteria

1. El botón "Importar carpeta" SHALL ser visible en la barra de acciones de `/clientes` para cualquier usuario que satisfaga `is_staff()`.
2. Al activarlo, SHALL abrirse un modal con un `<input type="file" webkitdirectory multiple>` que permita seleccionar un directorio completo.
3. Si el navegador no soporta `webkitdirectory`, SHALL mostrarse un aviso indicando que se requiere Chrome, Edge o Safari.
4. Tras seleccionar la carpeta, SHALL leerse el atributo `webkitRelativePath` de cada `File` para construir el árbol en memoria.
5. Si la carpeta seleccionada no contiene ninguna subcarpeta de primer nivel con archivos válidos, SHALL mostrarse un error y permitir seleccionar otra carpeta.

---

### REQ-2: Análisis de la estructura de carpetas (FolderAnalyzer)

**User Story:** Como personal del estudio, quiero que el sistema interprete automáticamente la estructura de carpetas para identificar clientes y documentos sin clasificarlos manualmente.

#### Acceptance Criteria

1. El FolderAnalyzer SHALL identificar la carpeta de mayor nivel como raíz y NO crear un ClientEntry para ella.
2. SHALL crear un ClientEntry por cada subdirectorio de primer nivel dentro de la raíz, usando el nombre de la carpeta como `name`.
3. SHALL asociar cada archivo al ClientEntry correspondiente a su carpeta de primer nivel ancestral, preservando la ruta relativa interna completa.
4. SHALL ignorar archivos cuyo nombre sea `.DS_Store`, `Thumbs.db`, `desktop.ini` o que empiece con `._`.
5. SHALL marcar con estado `empty` un ClientEntry cuya carpeta no contenga ningún archivo válido (después de filtrar archivos de sistema).
6. SHALL operar completamente en memoria sin realizar ninguna operación de red o escritura en base de datos.
7. SHALL reutilizar `shouldIgnorePath` de `src/lib/imports/zip-import.ts` para el filtrado de archivos de sistema.

---

### REQ-3: Normalización y detección de duplicados de clientes

**User Story:** Como personal del estudio, quiero que el sistema detecte si ya existe un cliente con el mismo nombre antes de crear uno nuevo.

#### Acceptance Criteria

1. SHALL normalizar cada nombre de ClientEntry usando `normalizeText` de `src/lib/client-validation.ts` (NFD, minúsculas, sin especiales, sin guiones, sin espacios duplicados).
2. SHALL conservar el nombre original de la carpeta para mostrarlo en pantalla y almacenarlo en la base de datos.
3. SHALL usar `findClientDuplicates` para comparar contra los clientes existentes en la tabla `clients`.
4. Una coincidencia de `strength === 'exact'` SHALL marcar el ClientEntry como `duplicate_exact` y asociarlo al `id` del cliente existente.
5. Una coincidencia de `strength === 'approximate'` SHALL marcar el ClientEntry como `duplicate_approximate` y generar sólo una advertencia visual.
6. Nunca SHALL fusionarse automáticamente dos clientes basándose en una coincidencia aproximada.
7. Un ClientEntry `duplicate_exact` SHALL requerir resolución manual antes de habilitar el botón de confirmar.

---

### REQ-4: Vista previa interactiva (ImportPreview)

**User Story:** Como personal del estudio, quiero revisar los resultados del análisis antes de que se escriba nada en la base de datos.

#### Acceptance Criteria

1. SHALL mostrarse la lista de todos los ClientEntries con su estado: `new`, `duplicate_exact`, `duplicate_approximate`, `empty`, `excluded`.
2. Para cada ClientEntry SHALL mostrarse el número de DocumentEntries asociados y la lista de nombres de archivos.
3. SHALL permitir buscar ClientEntries por nombre (campo de texto, búsqueda insensible a mayúsculas).
4. SHALL permitir filtrar por estado.
5. SHALL permitir marcar manualmente un ClientEntry como `excluded`.
6. Para `duplicate_exact` SHALL ofrecerse tres opciones: asociar al cliente existente, crear nuevo cliente, omitir carpeta.
7. Para `duplicate_approximate` SHALL mostrarse una advertencia pero el botón de confirmar NO SHALL bloquearse por este estado.
8. SHALL mostrarse los archivos inválidos (formato, tamaño, vacíos) con su razón de rechazo antes de confirmar.
9. El botón "Confirmar importación" SHALL estar deshabilitado mientras existan ClientEntries en estado `duplicate_exact` sin resolver.
10. Una carpeta `empty` SHALL mostrarse con una etiqueta de advertencia pero no bloquear la confirmación.

---

### REQ-5: Validación de archivos

**User Story:** Como personal del estudio, quiero que los archivos inválidos se marquen sin detener el resto de la importación.

#### Acceptance Criteria

1. SHALL validarse cada DocumentEntry con el conjunto `BULK_IMPORT_EXTENSIONS`: `pdf, doc, docx, xls, xlsx, jpg, jpeg, png, webp, txt` (comparación insensible a mayúsculas).
2. Archivos con extensión fuera del conjunto SHALL marcarse como `invalid_format`.
3. Archivos con tamaño de 0 bytes SHALL marcarse como `invalid_empty`.
4. Archivos que superen `MAX_DOCUMENT_SIZE_BYTES` (10 485 760 bytes) SHALL marcarse como `invalid_size`.
5. Un DocumentEntry inválido SHALL excluirse de la importación sin cancelar los demás.
6. Si todos los DocumentEntries de todos los clientes son inválidos, el botón "Confirmar importación" SHALL estar deshabilitado.

---

### REQ-6: Creación de clientes nuevos

**User Story:** Como personal del estudio, quiero que el sistema cree los clientes nuevos automáticamente en Supabase al confirmar la importación.

#### Acceptance Criteria

1. Por cada ClientEntry con estado `new`, SHALL insertarse un registro en `clients` usando `getAuthClient()`.
2. El payload SHALL incluir: `name` (nombre original trimmed), `initials` (via `buildClientInitials`), `color` (seleccionado aleatoriamente del array `COLORS` de `use-clients.ts`), `dni = 'PENDIENTE'`, `document_type = 'Otro'`, `phone = '000000000'`, `process_type = 'Por clasificar'`, `status = 'En espera'`, `notes = 'Importado masivamente — datos pendientes'`, `created_by = auth.uid()`.
3. Si la inserción falla por un error de esquema legacy, SHALL intentarse el fallback con solo los campos base (igual que `useCreateClient`).
4. Si la inserción falla definitivamente, SHALL marcarse el ClientEntry como `failed` con el mensaje de error, y continuar con los demás.
5. SHALL registrarse el UUID real del cliente creado para usarlo en las rutas de Storage y en `client_id` de documentos.

---

### REQ-7: Detección de documentos duplicados

**User Story:** Como personal del estudio, quiero que el sistema evite subir documentos que ya existen para el mismo cliente.

#### Acceptance Criteria

1. ANTES de subir cada DocumentEntry, SHALL consultarse la tabla `documents` filtrando por `client_id` y `original_name`.
2. Si existe un registro con el mismo `client_id` y `original_name`, SHALL marcarse el DocumentEntry como `duplicate_skipped` sin subir ni registrar.
3. WHERE `crypto.subtle.digest` esté disponible, SHALL calcularse el SHA-256 del contenido del archivo usando `sha256` de `src/lib/imports/zip-import.ts` y compararse con el campo `checksum` de los documentos existentes del mismo cliente.
4. Si el checksum coincide, SHALL marcarse como `duplicate_skipped` independientemente del nombre.
5. Nunca SHALL usarse `upsert: true` en las llamadas de Storage.

---

### REQ-8: Subida de documentos y registro en base de datos

**User Story:** Como personal del estudio, quiero que los documentos se suban al bucket `documents` de Supabase Storage y queden registrados en la tabla `documents`.

#### Acceptance Criteria

1. La ruta de Storage SHALL ser `{client_uuid}/{sanitized_relative_path}`, donde `sanitized_relative_path` reemplaza caracteres que no sean `[a-zA-Z0-9._\-/]` con `_`, preservando separadores `/`.
2. El nombre original SHALL conservarse en los campos `name`, `original_name` y `display_name` del registro en `documents`.
3. La subida SHALL hacerse con `supabase.storage.from('documents').upload(storagePath, file, { upsert: false })`.
4. Si la subida tiene éxito, SHALL insertarse en `documents`: `name`, `original_name`, `display_name`, `type = 'Importado'`, `document_type = 'Importado'`, `size` (formato KB/MB), `file_size` (bytes), `storage_path`, `client_id`, `source_type = 'bulk_import'`, `source_provider = 'local_folder'`, `processing_status = 'pending'`, `verification_status = 'pending'`, `checksum` (si se calculó), `created_by = auth.uid()`, `mime_type` (si no es vacío).
5. Si la subida falla, SHALL marcarse el DocumentEntry como `failed` sin intentar insertar en `documents`.
6. Si la inserción en `documents` falla tras una subida exitosa, SHALL intentarse eliminar el archivo huérfano con `supabase.storage.from('documents').remove([storagePath])` y marcarse como `failed`.

---

### REQ-9: Concurrencia controlada y tolerancia a fallos

**User Story:** Como personal del estudio, quiero que la importación no sature el navegador ni el servidor, y que los errores parciales no cancelen todo.

#### Acceptance Criteria

1. Los DocumentEntries SHALL procesarse con concurrencia máxima de 3 subidas simultáneas usando un pool de promesas.
2. Los ClientEntries SHALL crearse de forma secuencial para evitar condiciones de carrera en la detección de duplicados.
3. Un error en un DocumentEntry SHALL registrarse, marcar ese entry como `failed`, y continuar con los demás.
4. Una interrupción de red SHALL marcar como `failed` los DocumentEntries en proceso, conservando los ya guardados.
5. SHALL permitirse reintentar únicamente los DocumentEntries con estado `failed`.

---

### REQ-10: Registro en `import_jobs`

**User Story:** Como personal del estudio, quiero que cada sesión de importación quede registrada para auditoría.

#### Acceptance Criteria

1. Al confirmar la importación, SHALL crearse un registro en `import_jobs` con: `name` (fecha + nombre de carpeta raíz), `provider = 'local_folder'`, `status = 'processing'`, `created_by = auth.uid()`, `configuration` (JSON con nombre de raíz y totales).
2. Durante la importación, SHALL actualizarse periódicamente: `processed_documents`, `failed_documents`, `detected_clients`, `total_documents`, `total_folders`, `progress_percentage`.
3. Al finalizar, SHALL actualizarse `status` a `'completed'`, `'partially_completed'` o `'failed'`, y registrar `completed_at`.
4. Si ocurre un error fatal, SHALL registrarse en `error_message` y cambiar `status` a `'failed'`.

---

### REQ-11: Progreso visible

**User Story:** Como personal del estudio, quiero ver el avance de la importación en tiempo real.

#### Acceptance Criteria

1. SHALL mostrarse una barra de progreso usando `Progress` de `src/components/ui/progress.tsx`, calculada como `(processed + failed) / total * 100`.
2. SHALL mostrarse contadores actualizados: documentos procesados, pendientes, errores.
3. SHALL mostrarse el nombre del cliente que se procesa en ese momento.
4. El modal SHALL permanecer abierto durante toda la importación.

---

### REQ-12: Resumen final y reintento de errores

**User Story:** Como personal del estudio, quiero ver un resumen al finalizar y poder reintentar los elementos fallidos.

#### Acceptance Criteria

1. SHALL mostrarse métricas agrupadas: clientes creados, asociados, omitidos, fallidos; documentos subidos, duplicados omitidos, inválidos, fallidos.
2. SHALL mostrarse la lista de DocumentEntries `failed` con nombre, cliente y mensaje de error.
3. Al solicitar reintento, SHALL procesarse únicamente los DocumentEntries `failed`, sin repetir los ya completados.
4. Si no hay fallos, SHALL mostrarse un mensaje de éxito completo y un botón para cerrar.
5. Al finalizar, SHALL invocarse `invalidateCrmQueries(qc, {})` para refrescar `["clients"]` y `["documents"]`.

---

### REQ-13: Idempotencia

**User Story:** Como personal del estudio, quiero que importar la misma carpeta dos veces no genere duplicados innecesarios.

#### Acceptance Criteria

1. En una segunda ejecución, los clientes ya existentes (detectados por nombre normalizado exacto) SHALL asociarse como `duplicate_exact` en lugar de crearse de nuevo.
2. Los documentos ya existentes (por `original_name` + `client_id` o por checksum SHA-256) SHALL marcarse como `duplicate_skipped`.
3. El conjunto de registros en `clients` y `documents` SHALL ser idéntico al producido en la primera ejecución.

---

### REQ-14: Seguridad

**User Story:** Como administrador, quiero que la importación masiva no comprometa la seguridad del CRM.

#### Acceptance Criteria

1. SHALL usarse exclusivamente `getAuthClient()` con el token de sesión activo. Nunca `service_role` en el frontend.
2. SHALL validarse que existe sesión activa antes de iniciar cualquier escritura; si no hay sesión, mostrar error y detener.
3. RLS SHALL permanecer activo en todas las tablas y en el bucket `documents`.
4. Los documentos NO SHALL tener URLs públicas; el acceso SHALL ser via `createSignedUrl`.
5. No SHALL añadirse nuevas variables de entorno al repositorio.
6. No SHALL enviarse la carpeta completa como una única petición HTTP a Cloudflare.

---

### REQ-15: Integración con módulo de clientes existente

**User Story:** Como personal del estudio, quiero que la importación conviva con la creación manual de clientes y la carga manual de documentos.

#### Acceptance Criteria

1. El componente `FolderImport` SHALL coexistir con `ZipImport` y `CSVImport` sin interferir con su funcionamiento.
2. `ClientFormModal` SHALL permanecer funcional mientras `FolderImport` está activo.
3. `useUploadDocument` SHALL permanecer funcional mientras `FolderImport` está activo.
4. El nuevo botón en `/clientes` SHALL añadirse sin modificar la lógica existente de esa página más allá de agregar el estado del modal y el botón.
5. Los registros importados SHALL aparecer en la lista de clientes inmediatamente al finalizar la importación.

---

### REQ-16: Calidad técnica

**User Story:** Como desarrollador, quiero que el código cumpla los estándares del proyecto.

#### Acceptance Criteria

1. Todo el código nuevo SHALL estar en TypeScript sin `any`, `@ts-ignore` ni desactivaciones de ESLint.
2. `FolderAnalyzer` SHALL tener pruebas unitarias en `tests/` usando Vitest cubriendo: detección de clientes, exclusión de raíz, filtrado de archivos de sistema, preservación de subcarpetas.
3. `npm run test` SHALL pasar sin regresiones en tests existentes.
4. `npm run lint` SHALL pasar sin errores nuevos.
5. `npm run build` SHALL completarse correctamente.
