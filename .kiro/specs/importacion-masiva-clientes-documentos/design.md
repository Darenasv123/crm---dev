# Technical Design Document

## Feature: Importación masiva de clientes y documentos

---

## Principios de diseño

- **Mínima superficie**: solo se crean archivos nuevos. Los existentes solo reciben adiciones puntuales (un botón + un estado de modal en `_app.clientes.index.tsx`).
- **Sin nuevas dependencias**: todas las utilidades necesarias ya existen en el repo.
- **Sin migraciones**: las tablas `import_jobs`, `import_folders`, `clients` y `documents` ya tienen las columnas necesarias.
- **Sin integración Drive**: la carpeta se selecciona localmente con `webkitdirectory`.
- **Seguridad por defecto**: `getAuthClient()` en todas las operaciones, `upsert: false` siempre, RLS activo.

---

## Archivos nuevos

```
src/
  lib/
    imports/
      folder-import.ts          ← FolderAnalyzer + tipos + lógica pura
      folder-import-engine.ts   ← ImportEngine (operaciones Supabase)
  components/
    folder-import.tsx            ← FolderImport modal (UI completa)
tests/
  folder-import.test.ts          ← Tests de FolderAnalyzer
```

---

## Archivos modificados

```
src/routes/_app.clientes.index.tsx
  ← +1 import (FolderImport)
  ← +1 estado (showFolderImportModal)
  ← +1 botón en la barra de acciones
  ← +1 render del modal
```

---

## Tipos principales (`src/lib/imports/folder-import.ts`)

```ts
export type ClientEntryStatus =
  | 'new'
  | 'duplicate_exact'
  | 'duplicate_approximate'
  | 'empty'
  | 'excluded'
  | 'failed'
  | 'done';

export type DocumentEntryStatus =
  | 'pending'
  | 'duplicate_skipped'
  | 'invalid_format'
  | 'invalid_empty'
  | 'invalid_size'
  | 'uploading'
  | 'done'
  | 'failed';

export interface DocumentEntry {
  file: File;
  /** Ruta relativa desde la carpeta raíz, ej: "JUAN PÉREZ/Resoluciones/res01.pdf" */
  relativePath: string;
  /** Nombre original del archivo sin sanitizar */
  originalName: string;
  status: DocumentEntryStatus;
  errorMessage?: string;
  checksum?: string;
  storagePath?: string;   // ruta construida para Storage
}

export interface ClientEntry {
  /** Nombre original de la carpeta (conservado para mostrar y guardar) */
  folderName: string;
  /** Nombre normalizado para comparación (no se guarda en BD) */
  normalizedName: string;
  status: ClientEntryStatus;
  /** UUID del cliente existente si es duplicate_exact */
  existingClientId?: string;
  /** UUID del cliente creado al importar */
  createdClientId?: string;
  documents: DocumentEntry[];
  errorMessage?: string;
  /** Resolución elegida por el usuario para duplicado exacto */
  duplicateResolution?: 'use_existing' | 'create_new' | 'skip';
  /** Nombre del cliente existente si hay coincidencia */
  existingClientName?: string;
}

export interface FolderAnalysisResult {
  rootName: string;
  clients: ClientEntry[];
  ignoredFiles: string[];
}

export const BULK_IMPORT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'jpg', 'jpeg', 'png', 'webp', 'txt',
]);

export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
```

---

## FolderAnalyzer — algoritmo (`src/lib/imports/folder-import.ts`)

### `analyzeFiles(files: FileList | File[]): FolderAnalysisResult`

```
1. Convertir FileList a Array<File>.
2. Para cada File, leer file.webkitRelativePath.
3. Separar la ruta en segmentos: segments = relativePath.split('/').
4. rootName = segments[0].
5. Si segments.length < 2 → ignorar el archivo (está directamente en la raíz).
6. firstLevel = segments[1] → nombre de la carpeta de cliente.
7. Si shouldIgnorePath(file.name) || shouldIgnorePath(firstLevel) → añadir a ignoredFiles.
8. Si no existe ClientEntry para firstLevel → crear uno con status='new', normalizedName = normalizeText(firstLevel).
9. relativePath del documento = segments.slice(1).join('/') (relativo al firstLevel, ej: "JUAN/Res/res01.pdf" → "JUAN/Res/res01.pdf")
   Nota: se conserva la ruta completa desde el primer nivel para el Storage path.
10. Crear DocumentEntry con status='pending', validar extensión y tamaño:
    - ext no en BULK_IMPORT_EXTENSIONS → status='invalid_format'
    - size === 0 → status='invalid_empty'
    - size > MAX_IMPORT_FILE_SIZE → status='invalid_size'
11. Añadir DocumentEntry al ClientEntry correspondiente.
12. Al finalizar, marcar como 'empty' los ClientEntries sin ningún DocumentEntry válido (status='pending').
13. Retornar { rootName, clients, ignoredFiles }.
```

### `detectDuplicatesForClients(clients: ClientEntry[], existingClients: ClientRow[]): ClientEntry[]`

```
Para cada ClientEntry con status='new':
  1. Construir un ClientFormValues mínimo con name = entry.folderName.
  2. Llamar a findClientDuplicates({ name, ... }, existingClients).
  3. Si hay match con strength='exact':
     - entry.status = 'duplicate_exact'
     - entry.existingClientId = match.clientId
     - entry.existingClientName = match.clientName
  4. Si hay match con strength='approximate' (y no hay exact):
     - entry.status = 'duplicate_approximate'
     - entry.existingClientName = match.clientName (para mostrar advertencia)
Retornar los clientes actualizados.
```

### `sanitizeStoragePath(relativePath: string): string`

```
Reemplaza caracteres que no sean [a-zA-Z0-9._\-/] con '_'.
Colapsa múltiples '_' consecutivos.
Preserva separadores '/'.
```

---

## ImportEngine — orquestación (`src/lib/imports/folder-import-engine.ts`)

### Función principal: `runImport(params): Promise<ImportResult>`

```
Parámetros:
  clients: ClientEntry[]         ← resultado de análisis + resoluciones del usuario
  onProgress: (stats) => void    ← callback para actualizar UI
  signal?: AbortSignal           ← para cancelación futura

Etapas:
  1. Validar sesión activa (getAuthClient → supabase.auth.getSession).
  2. Crear registro en import_jobs con status='processing'.
  3. Por cada ClientEntry (secuencial):
     a. Si status='excluded' o duplicateResolution='skip' → marcar como omitido, continuar.
     b. Si status='duplicate_exact' y duplicateResolution='use_existing' → usar existingClientId.
     c. Si status='new' o duplicateResolution='create_new' → crear cliente en Supabase (REQ-6).
     d. Con el client_id resuelto:
        - Pre-consultar documentos existentes de ese cliente (batch query por client_id).
        - Procesar DocumentEntries con concurrencia máx. 3 (pool de promesas).
  4. Actualizar import_jobs al finalizar.
  5. Retornar ImportResult con métricas finales.
```

### Pool de concurrencia limitada

```ts
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]>
```

Implementado con un contador de activos y una cola. No requiere dependencias externas.

### Creación de cliente

```ts
async function createImportedClient(name: string, db): Promise<string>
```

Payload exacto (mismo patrón que `useCreateClient`):
- `name`, `initials` (via `buildClientInitials`), `color` (via `COLORS[random]`)
- `dni = 'PENDIENTE'`, `phone = '000000000'`, `process_type = 'Por clasificar'`
- `status = 'En espera'`, `document_type = 'Otro'`
- `notes = 'Importado masivamente — datos pendientes de completar'`
- `created_by = session.user.id`

Si falla por `isMissingSchemaFieldError` → retry con payload legacy (mismos campos base que `useCreateClient`).

### Subida de documento

```ts
async function uploadDocument(entry: DocumentEntry, clientId: string, db, existingDocs): Promise<void>
```

Pasos:
1. Verificar duplicado por `original_name` + `client_id` en `existingDocs`.
2. Calcular SHA-256 (si `crypto.subtle` disponible) y verificar contra `checksum` existente.
3. Si duplicado → marcar `duplicate_skipped`, retornar.
4. Construir `storagePath = clientId + '/' + sanitizeStoragePath(entry.relativePath)`.
5. Upload con `supabase.storage.from('documents').upload(storagePath, entry.file, { upsert: false })`.
6. Si upload falla → marcar `failed`, retornar.
7. Construir size string: `< 1 MB → "X KB"`, `>= 1 MB → "X.XX MB"`.
8. Insert en `documents` con todos los campos de REQ-8.
9. Si insert falla → `supabase.storage.from('documents').remove([storagePath])`, marcar `failed`.

---

## FolderImport modal — UI (`src/components/folder-import.tsx`)

### Pasos del wizard (estado interno)

```
'idle'      → UI inicial con input[webkitdirectory]
'analyzing' → Procesando archivos en memoria
'preview'   → Vista previa interactiva
'importing' → Importación en curso (barra de progreso)
'done'      → Resumen final
```

### Componentes usados del proyecto

- `Card` de `@/components/app-layout`
- `Progress` de `@/components/ui/progress`
- `Dialog` / modal con overlay propio (patrón del `ZipImport` existente)
- Iconos de `lucide-react`: `FolderOpen`, `Upload`, `CheckCircle2`, `AlertCircle`, `Loader2`, `X`, `RefreshCw`, `Eye`, `EyeOff`, `FileText`, `ChevronDown`, `ChevronRight`

### Props del componente

```ts
interface FolderImportProps {
  onClose: () => void;
  onSuccess: () => void;
}
```

### Estructura de la vista previa

```
[Buscador por nombre]  [Filtro por estado]
─────────────────────────────────────────
Para cada ClientEntry:
  [▶] NOMBRE CLIENTE          [estado badge]  [X Excluir]
      Si duplicate_exact:
        ⚠ "Ya existe: NOMBRE EXISTENTE"
        [Usar existente] [Crear nuevo] [Omitir]
      Si duplicate_approximate:
        ~ "Nombre similar a: NOMBRE EXISTENTE" (solo aviso)
      N documentos: nombre1.pdf, nombre2.docx ...
      Archivos inválidos en rojo con razón
─────────────────────────────────────────
[Cancelar]          [Confirmar importación] (disabled si hay exact sin resolver)
```

### Progreso

```
Importando NOMBRE CLIENTE...
████████████░░░░  65%
✓ 42 subidos  ✗ 3 errores  ⏭ 8 omitidos  ⏳ 21 pendientes
```

### Resumen final

```
✅ Clientes creados: 38
🔗 Asociados a existentes: 12
⏭ Omitidos: 5
❌ Fallidos: 2

📄 Documentos subidos: 234
⏭ Duplicados omitidos: 18
⚠ Inválidos: 4
❌ Fallidos: 3

[Reintentar fallos]   [Cerrar]
```

---

## Modificación en `_app.clientes.index.tsx`

Solo se añaden:

1. Un import: `import { FolderImport } from "@/components/folder-import";`
2. Un estado: `const [showFolderImportModal, setShowFolderImportModal] = useState(false);`
3. Un botón en las `actions` del `AppLayout`:
   ```tsx
   <button onClick={() => setShowFolderImportModal(true)} ...>
     <FolderOpen className="h-4 w-4" /> Importar carpeta
   </button>
   ```
4. El modal al final del JSX:
   ```tsx
   {showFolderImportModal && (
     <FolderImport
       onClose={() => setShowFolderImportModal(false)}
       onSuccess={() => { setShowFolderImportModal(false); refetch(); }}
     />
   )}
   ```

---

## Flujo de datos completo

```
Usuario selecciona carpeta
        ↓
File[] con webkitRelativePath
        ↓
analyzeFiles() → FolderAnalysisResult (memoria)
        ↓
detectDuplicatesForClients() + lista clients[] de Supabase
        ↓
ImportPreview (usuario resuelve duplicados exactos)
        ↓
Usuario confirma
        ↓
ImportEngine.runImport()
  ├─ Crear import_job en Supabase
  ├─ Por cada cliente (secuencial):
  │   ├─ Crear/usar cliente existente
  │   └─ Por cada documento (concurrencia 3):
  │       ├─ Check duplicado (nombre + checksum)
  │       ├─ Upload Storage
  │       └─ Insert documents
  └─ Actualizar import_job final
        ↓
invalidateCrmQueries()
        ↓
Resumen final
```

---

## Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Validación con `BULK_IMPORT_EXTENSIONS` propio | Modificar `ALLOWED_DOCUMENT_EXTENSIONS` | No rompe la carga manual |
| Valores centinela para `dni`/`phone`/`process_type` | Hacer esos campos nullable | No requiere migración |
| SHA-256 solo si `crypto.subtle` disponible | Siempre requerido | Compatibilidad con entornos sin WebCrypto |
| Concurrencia máx. 3 | Sin límite | Evita saturar Supabase Storage y el navegador |
| Pool de promesas con contador | `p-limit` u otra librería | Sin nueva dependencia |
| Modal independiente | Ruta nueva `/importaciones/carpeta` | Menor impacto en routing existente |
| `supabase` base para Storage | `getAuthClient()` para Storage | Patrón del `useUploadDocument` existente |
