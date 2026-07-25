# Procedimiento de Importación Masiva de Clientes

## Estado del desarrollo

- Código: **completo**
- Tests unitarios/mockeados: **205/205 ✅**
- ESLint: **limpio ✅**
- Build de producción: **aprobado ✅**
- Migración SQL: **preparada, pendiente de aplicar**
- Validación contra Supabase de prueba: **pendiente de configurar**

---

## Archivos clave

| Archivo | Descripción |
|---|---|
| `src/lib/imports/folder-import.ts` | Análisis de carpetas en memoria (puro, sin I/O) |
| `src/lib/imports/folder-import-engine.ts` | Orquestador: crea clientes, sube documentos, registra en BD |
| `src/components/folder-import.tsx` | Modal wizard: idle → analyzing → preview → importing → done |
| `src/routes/_app.clientes.index.tsx` | Integración: botón "Importar carpeta" en la lista de clientes |
| `supabase/migrations/20260724000000_bulk_import_support.sql` | Migración: hace opcionales dni/phone/process_type, agrega relative_path y content_hash |
| `tests/folder-import.test.ts` | 35 tests unitarios del analizador |
| `tests/folder-import-engine.test.ts` | 14 tests del engine con Supabase mockeado |
| `tests/staging-import-validation.test.ts` | Tests de integración contra Supabase de prueba |

---

## PASO 1 — Crear el proyecto Supabase de prueba

1. Ir a https://supabase.com/dashboard/projects
2. Clic en "New project"
3. Nombre sugerido: `advocate-nest-staging`
4. Región: la misma que producción (por latencia)
5. Contraseña de base de datos: generarla aleatoriamente y guardarla en un gestor de contraseñas
6. Clic en "Create new project" y esperar ~2 minutos

**Cómo confirmar que NO es producción:**
- La URL del proyecto debe ser distinta a `https://pnqdgwpxcxngeueosmnh.supabase.co`
- El "Project Ref" en Settings → General debe ser diferente a `pnqdgwpxcxngeueosmnh`

---

## PASO 2 — Obtener las credenciales del proyecto de prueba

En el proyecto de prueba:
1. Settings → API
2. Copiar "Project URL" → `VITE_SUPABASE_URL`
3. Copiar "anon public" key → `VITE_SUPABASE_ANON_KEY`
4. Copiar "service_role" key → `SUPABASE_SERVICE_ROLE_KEY`
5. Copiar el "Reference ID" (ej: `abcdefghijklmno`) → `SUPABASE_STAGING_PROJECT_REF`

---

## PASO 3 — Aplicar el esquema base al proyecto de prueba

El proyecto de prueba necesita el mismo esquema que producción.

### Opción A: Copiar el esquema completo manualmente

En el proyecto de **prueba**, ir a SQL Editor y ejecutar cada migración en orden:

```
1. supabase/migrations/20260713131000_add_client_reports.sql
2. supabase/migrations/20260713150000_usability_timezone_case_links_and_rls.sql
3. supabase/migrations/20260713162000_fix_client_reports_permissions.sql
4. supabase/migrations/20260721090000_legal_case_foundation.sql
5. supabase/migrations/20260721120000_case_summary_defensive_backfill.sql
6. supabase/migrations/20260721130000_grant_table_permissions.sql
7. supabase/migrations/20260721140000_revoke_anon_write_permissions.sql
8. supabase/migrations/20260724000000_bulk_import_support.sql  ← LA NUEVA
```

### Opción B: Usar Supabase CLI (requiere CLI instalada)

```powershell
supabase link --project-ref REFERENCIA-DEL-PROYECTO-PRUEBA
supabase db push
```

---

## PASO 4 — Crear un usuario de prueba en el proyecto de prueba

1. Authentication → Users → Add user
2. Email: `admin-prueba@estudio-arenas.test`
3. Contraseña: generarla aleatoriamente
4. Después de crear el usuario, ejecutar en SQL Editor del proyecto de prueba:

```sql
-- Crear el perfil con rol Administrador para el usuario de prueba
-- Reemplaza 'UUID-DEL-USUARIO' con el ID que aparece en Authentication → Users
INSERT INTO public.profiles (id, full_name, role, status)
VALUES (
  'UUID-DEL-USUARIO',
  'Admin Prueba',
  'Administrador',
  'Activo'
)
ON CONFLICT (id) DO UPDATE
  SET role = 'Administrador', status = 'Activo';
```

---

## PASO 5 — Crear el bucket `documents` en el proyecto de prueba

1. Storage → New bucket
2. Nombre: `documents`
3. Desmarcar "Public bucket" (debe ser privado)
4. Las políticas RLS ya quedan configuradas al aplicar la migración `20260713150000`

---

## PASO 6 — Configurar las variables de entorno locales

Crear el archivo `.env.staging.local` en la raíz del proyecto (ya está en `.gitignore`):

```env
VITE_SUPABASE_URL=https://TU-PROYECTO-PRUEBA.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY_DE_PRUEBA
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY_DE_PRUEBA
SUPABASE_STAGING_PROJECT_REF=TU_REFERENCIA_DE_PRUEBA
ALLOW_STAGING_TESTS=true
STAGING_TEST_EMAIL=admin-prueba@estudio-arenas.test
STAGING_TEST_PASSWORD=TU_CONTRASEÑA_DE_PRUEBA
```

---

## PASO 7 — Ejecutar los tests de integración contra el proyecto de prueba

```powershell
# Cargar variables de entorno desde .env.staging.local
Get-Content .env.staging.local | ForEach-Object {
  if ($_ -match '^([^#][^=]+)=(.+)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}

# Ejecutar tests de staging
npm run test:staging
```

**Resultado esperado:** todos los tests de `staging-import-validation.test.ts` en verde.

---

## PASO 8 — Levantar el CRM apuntando al proyecto de prueba

```powershell
# Reemplazar temporalmente las variables de entorno para el dev server
$env:VITE_SUPABASE_URL="https://TU-PROYECTO-PRUEBA.supabase.co"
$env:VITE_SUPABASE_ANON_KEY="TU_ANON_KEY_DE_PRUEBA"
npm run dev
```

Abrir en el navegador: http://localhost:3000

---

## PASO 9 — Prueba manual con tres carpetas ficticias

Crear esta estructura de carpetas en tu sistema de archivos:

```
CLIENTES_PRUEBA/
├── Cliente Prueba Uno/
│   ├── Resoluciones/
│   │   └── Documento.pdf       (archivo PDF cualquiera)
│   └── Anexos/
│       └── Documento.pdf       (otro PDF — mismo nombre, ruta distinta)
├── Cliente Prueba Dos/
│   ├── Demanda.docx            (archivo Word cualquiera)
│   └── Foto.jpg                (imagen cualquiera)
└── Cliente Existente Prueba/
    └── Documento nuevo.pdf     (PDF cualquiera)
```

**Antes de la prueba:** crear manualmente "Cliente Existente Prueba" en el CRM de prueba
para verificar que no se duplica.

**Pasos de verificación:**
1. Ir a Clientes en el CRM
2. Clic en "Importar carpeta"
3. Seleccionar la carpeta `CLIENTES_PRUEBA`
4. En la vista previa confirmar:
   - Carpeta raíz `CLIENTES_PRUEBA` NO aparece como cliente
   - `Cliente Prueba Uno` aparece como "Nuevo"
   - `Cliente Prueba Dos` aparece como "Nuevo"
   - `Cliente Existente Prueba` aparece como "Duplicado exacto"
   - `Cliente Existente Prueba` tiene preseleccionado "Usar cliente existente"
   - `Cliente Prueba Uno` muestra 2 documentos válidos
5. Resolver el duplicado de `Cliente Existente Prueba` → "Usar cliente existente"
6. Clic en "Confirmar importación"
7. Esperar a que termine
8. Verificar el resumen:
   - Clientes creados: 2
   - Asociados a existentes: 1
   - Documentos subidos: 4
9. Ir a la ficha de `Cliente Prueba Uno` y confirmar:
   - DNI: vacío (NULL)
   - Teléfono: vacío (NULL)
   - Tipo de proceso: vacío (NULL)
   - 2 documentos llamados "Documento.pdf" con rutas distintas:
     - `Resoluciones/Documento.pdf`
     - `Anexos/Documento.pdf`
10. Ejecutar de nuevo la importación con la misma carpeta y confirmar:
    - Clientes existentes: 3
    - Documentos duplicados omitidos: 4

---

## PASO 10 — Prueba controlada con 5 a 10 clientes reales

Antes de importar los 120 clientes, realizar una prueba parcial **en producción**:

Seleccionar manualmente una muestra que incluya:
- 1 cliente con pocos documentos (1-3 archivos)
- 1 cliente con muchas subcarpetas (> 5 carpetas internas)
- 1 cliente que ya exista en el CRM (para probar la detección de duplicados)
- Archivos: PDF, Word (.docx), Excel (.xlsx), imágenes (JPG/PNG)
- Al menos 1 par de archivos con el mismo nombre en subcarpetas distintas

**Procedimiento:**
1. Aplicar la migración `20260724000000_bulk_import_support.sql` en producción
   (ver sección "Aplicar la migración en producción" más abajo)
2. Descargar solo esas 5-10 carpetas de Google Drive
3. Importar usando el CRM desplegado en Cloudflare
4. Revisar el informe final
5. Abrir cada ficha de cliente y verificar documentos
6. Si todo está correcto, continuar con la migración completa

---

## PASO 11 — Migración completa de los ~120 clientes

**Recomendación:** importar por bloques de 20-30 clientes para facilitar la revisión.

Por cada bloque:
1. Importar el bloque
2. Revisar el informe: clientes creados / asociados / omitidos / fallidos
3. Revisar documentos subidos / duplicados / inválidos / fallidos
4. Guardar el informe (botón de descarga CSV/JSON)
5. Reintentar solo los fallidos si los hay
6. Confirmar en la ficha de cliente que los documentos son visibles
7. Continuar con el siguiente bloque

> ⚠️ **Para carpetas grandes, se recomienda importar por bloques de 20 a 30 clientes
> y revisar el informe después de cada importación.**

---

## Aplicar la migración en producción

### Opción recomendada: Supabase Dashboard SQL Editor

1. Ir al proyecto de producción en https://supabase.com/dashboard/projects
2. SQL Editor → New query
3. Copiar y pegar el contenido de:
   `supabase/migrations/20260724000000_bulk_import_support.sql`
4. Clic en "Run"
5. Verificar que no hubo errores
6. La migración es idempotente: puede ejecutarse varias veces sin problema

### Verificación post-migración

```sql
-- Confirmar que las columnas son nullable
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name IN ('dni', 'phone', 'process_type');
-- Esperado: is_nullable = 'YES' para las tres columnas

-- Confirmar que relative_path y content_hash existen en documents
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'documents'
  AND column_name IN ('relative_path', 'content_hash');
-- Esperado: ambas columnas presentes, is_nullable = 'YES'

-- Confirmar el índice parcial único
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'documents'
  AND indexname = 'documents_client_relative_path_unique';
-- Esperado: aparece el índice con WHERE client_id IS NOT NULL AND relative_path IS NOT NULL
```

---

## Columnas reales utilizadas por la importación

### Tabla `clients` — Insert

| Columna | Tipo | Valor en importación masiva |
|---|---|---|
| `name` | text NOT NULL | Nombre original de la carpeta (trimmed) |
| `initials` | text NOT NULL | Generado con `buildClientInitials(name)` |
| `color` | text NOT NULL | Seleccionado aleatoriamente del array COLORS |
| `dni` | text **NULL** ✅ | `null` — staff completa después |
| `phone` | text **NULL** ✅ | `null` — staff completa después |
| `process_type` | text **NULL** ✅ | `null` — staff completa después |
| `document_type` | text | `'Otro'` |
| `document_number` | text | `null` |
| `status` | text | `'En espera'` |
| `notes` | text | `'Importado masivamente — datos pendientes de completar'` |
| `created_by` | uuid | ID del usuario autenticado (`auth.uid()`) |

### Tabla `documents` — Insert

| Columna | Tipo | Valor en importación masiva |
|---|---|---|
| `name` | text NOT NULL | Nombre original del archivo |
| `original_name` | text | Nombre original del archivo |
| `display_name` | text | Nombre original del archivo |
| `type` | text NOT NULL | `'Importado'` |
| `document_type` | text | `'Importado'` |
| `size` | text NOT NULL | `'X KB'` o `'X.XX MB'` |
| `file_size` | bigint | Tamaño en bytes |
| `storage_path` | text NOT NULL | `{client_uuid}/{sanitized_relative_path}` |
| `client_id` | uuid | UUID real del cliente |
| `relative_path` | text ✅ | Ruta desde la carpeta del cliente, ej: `Resoluciones/res.pdf` |
| `content_hash` | text ✅ | SHA-256 hex del contenido (si `crypto.subtle` disponible) |
| `checksum` | text | Mismo valor que `content_hash` |
| `source_type` | text | `'bulk_import'` |
| `source_provider` | text | `'local_folder'` |
| `processing_status` | text | `'pending'` |
| `verification_status` | text | `'pending'` |
| `mime_type` | text | MIME type del archivo (si no vacío) |
| `created_by` | uuid | ID del usuario autenticado |

### Tabla `import_jobs` — seguimiento de sesión de importación

Existe. Definida en migración `20260721090000`. Columnas usadas:

| Columna | Valor |
|---|---|
| `name` | `'Importación carpeta — {rootName} — {fecha}'` |
| `provider` | `'local_folder'` |
| `status` | `'processing'` → `'completed'` / `'partially_completed'` / `'failed'` |
| `total_folders` | Número de clientes |
| `total_documents` | Número de documentos pendientes |
| `detected_clients` | Número de clientes |
| `processed_documents` | Documentos subidos exitosamente |
| `failed_documents` | Documentos fallidos |
| `progress_percentage` | 100 al finalizar |
| `started_at` | ISO timestamp del inicio |
| `completed_at` | ISO timestamp del fin |
| `created_by` | ID del usuario |
| `configuration` | JSON con rootName, totalClients, totalDocuments |

---

## Estrategia de deduplicación

### Clientes

1. Se normalizan los nombres con `normalizeText()` (NFD, minúsculas, sin especiales)
2. Se compara con todos los clientes existentes usando `findClientDuplicates()`
3. Coincidencia exacta → `duplicate_exact` → usuario debe elegir: usar existente / crear nuevo / omitir
4. Coincidencia aproximada (≥75% tokens compartidos) → `duplicate_approximate` → solo aviso, no bloquea
5. **Nunca se fusionan automáticamente coincidencias aproximadas**

### Documentos

- Clave primaria de dedup: `(client_id, relative_path)` — índice parcial único en BD
- Clave secundaria: SHA-256 del contenido (`content_hash`) — para detectar el mismo archivo renombrado
- Dos archivos con el mismo nombre en subcarpetas distintas **coexisten** porque tienen `relative_path` diferente
- El mismo archivo importado nuevamente en la misma ruta → rechazado con `23505` → marcado `duplicate_skipped`

---

## Riesgos pendientes

| Riesgo | Estado | Mitigación |
|---|---|---|
| Migración no aplicada en producción | ⏳ Pendiente | Engine detecta el error y avisa claramente al usuario |
| Bucket `documents` no existe en proyecto de prueba | ⏳ Pendiente | Crear manualmente (ver PASO 5) |
| Usuario de prueba sin perfil o rol incorrecto | ⏳ Pendiente | Crear con SQL (ver PASO 4) |
| Validación remota no ejecutada | ⏳ Pendiente | Requiere proyecto de prueba configurado |
| Carpetas con > 100 documentos pueden ser lentas | Bajo | Concurrencia limitada a 3; progreso visible |
| Archivos > 10 MB son rechazados por el validador | Documentado | Se muestran como `invalid_size` sin detener la importación |

---

## Confirmación de no modificación de producción

- No se ejecutó ninguna migración contra el proyecto de producción
- No se conectó el código nuevo a producción
- No se hizo push ni deploy
- El `.env` de producción no fue modificado
- Las claves de producción no fueron añadidas a ningún archivo de código fuente nuevo
- El archivo `remote-validation.test.ts` fue actualizado para eliminar las credenciales hardcodeadas que tenía anteriormente
