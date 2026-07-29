# Checklist de Aplicación Controlada
## Migración: `20260725120000_document_folders.sql`

> **Leer completo antes de ejecutar ningún paso.**
> Cada paso debe completarse y verificarse antes de pasar al siguiente.
> Ante cualquier resultado inesperado: detener y revisar.

---

### PASO 0 — Estado limpio del proyecto

- [ ] Ejecutar `git status --short` → sin cambios sin commit.
- [ ] Ejecutar `git diff --check` → sin conflictos de espacios.
- [ ] Ejecutar `npm test` local → todos los tests pasan (377 passed, 14 skipped esperados).
- [ ] Ejecutar `npx tsc --noEmit` → 0 errores.
- [ ] Ejecutar `npm run lint` → 0 errores (solo los 7 warnings ya conocidos de react-refresh/ui).
- [ ] Hacer commit de respaldo con tag: `git tag pre-migration-document-folders`.

---

### PASO 1 — Backup de Supabase

- [ ] Entrar a Supabase Dashboard → Database → Backups.
- [ ] Crear backup o anotar el punto de restauración disponible más reciente.
- [ ] Alternativamente: `supabase db dump --db-url "<URL>" -f backup-pre-document-folders.sql`.
- [ ] Guardar el archivo de backup en lugar seguro (fuera del repo).

---

### PASO 2 — Revisar estado actual de la base de datos

Ejecutar en Supabase SQL Editor (solo lectura):

```sql
-- Número de clientes
select count(*) from public.clients;

-- Número de documentos
select count(*) from public.documents;

-- Número de documentos con relative_path (candidatos a migrar)
select count(*) from public.documents where relative_path is not null and relative_path <> '';

-- ¿Ya existe la tabla? (debe ser 0 antes de la migración)
select count(*) from information_schema.tables
where table_schema = 'public' and table_name = 'document_folders';

-- ¿Ya existe la columna? (debe ser 0 antes de la migración)
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'documents' and column_name = 'folder_id';
```

- [ ] Anotar: cantidad de clientes, documentos totales, documentos con relative_path.
- [ ] Confirmar que `document_folders` NO existe aún.
- [ ] Confirmar que `documents.folder_id` NO existe aún.

---

### PASO 3 — Aplicar la migración SQL

Ejecutar en Supabase SQL Editor:

```sql
-- Pegar el contenido completo de:
-- supabase/migrations/20260725120000_document_folders.sql
```

- [ ] La migración ejecuta sin errores.
- [ ] El output termina con `COMMIT` exitoso (no debe haber `ROLLBACK`).

---

### PASO 4 — Ejecutar SQL de verificación

Ejecutar en Supabase SQL Editor:

```sql
-- Pegar el contenido completo de:
-- supabase/verification/verify_document_folders.sql
```

- [ ] Todos los `[OK]` aparecen en los NOTICES.
- [ ] No aparece ningún `[FAIL]`.
- [ ] Las queries de datos devuelven 0 filas en las secciones de duplicados, ciclos y documentos cruzados.
- [ ] La query de "pendientes de migrar" muestra los conteos esperados (informativo).

---

### PASO 5 — Prueba manual: crear una carpeta raíz

En la aplicación web (Administrador Activo):

- [ ] Ir a un cliente de prueba → sección Documentos.
- [ ] Crear carpeta raíz "TestMigracion".
- [ ] Verificar que aparece en la lista de carpetas.
- [ ] Verificar en Supabase que el registro existe en `document_folders`.

---

### PASO 6 — Prueba manual: crear una subcarpeta

- [ ] Dentro de "TestMigracion", crear subcarpeta "Sub01".
- [ ] Verificar que `parent_id` apunta correctamente a "TestMigracion".
- [ ] Verificar que el `client_id` coincide con el cliente de prueba.

---

### PASO 7 — Prueba manual: asignar documento a carpeta

- [ ] Mover un documento existente del cliente de prueba a la carpeta "TestMigracion/Sub01".
- [ ] Verificar que `documents.folder_id` se actualizó correctamente.
- [ ] Verificar que el `folder_id` apunta a la carpeta del mismo cliente.
- [ ] Verificar que `storage_path` **no cambió**.
- [ ] Verificar que el documento sigue descargable.

---

### PASO 8 — Prueba con Administrador

- [ ] Iniciar sesión como Administrador Activo.
- [ ] Verificar que la herramienta "Migración de organización documental" aparece en Configuración.
- [ ] Hacer click en "Verificar disponibilidad" → debe mostrar "Esquema disponible" (no error).
- [ ] Verificar que el botón "Analizar documentos" está disponible.

---

### PASO 9 — Prueba con Personal

- [ ] Iniciar sesión como usuario con rol Personal.
- [ ] Verificar que la herramienta de migración **NO aparece** en Configuración.
- [ ] Verificar que Personal puede ver carpetas normalmente (lectura).
- [ ] Verificar que Personal puede crear y renombrar carpetas si tiene permiso INSERT/UPDATE.
- [ ] Verificar que Personal **no puede eliminar** carpetas (política `document_folders_delete` solo admin).

---

### PASO 10 — Dry run para un solo cliente de prueba

En la herramienta de migración (Administrador):

- [ ] Seleccionar "Un cliente específico" → elegir el cliente de prueba.
- [ ] Click "Analizar documentos" (dry run).
- [ ] Revisar el resumen: documentos analizados, pendientes de migrar, carpetas por crear.
- [ ] Confirmar que ningún documento se modificó (Storage sin cambios, folder_id sin cambios aún).
- [ ] Descargar el informe JSON del análisis y archivarlo.

---

### PASO 11 — Migrar un solo cliente de prueba

- [ ] Con el plan del paso anterior visible, click "Ejecutar migración".
- [ ] Escribir la frase de confirmación `MIGRAR DOCUMENTOS`.
- [ ] Observar el progreso por lotes hasta completar.
- [ ] Revisar el informe final: documentos asignados, carpetas creadas/reutilizadas, errores.
- [ ] Verificar en Supabase:
  - `document_folders` tiene los registros esperados.
  - `documents.folder_id` fue actualizado para los documentos del cliente.
  - `documents.storage_path` **no cambió** en ningún registro.
- [ ] Verificar que los archivos siguen accesibles en Storage.

---

### PASO 12 — Verificar Storage

- [ ] Abrir Supabase → Storage → bucket `documents`.
- [ ] Confirmar que los archivos físicos están exactamente en las mismas rutas que antes.
- [ ] No debe haber carpetas nuevas ni archivos movidos en Storage.
- [ ] Descargar al menos un documento del cliente de prueba para confirmar acceso.

---

### PASO 13 — Revisar logs y errores

- [ ] Revisar el informe JSON descargado en el paso 11.
- [ ] Si hay errores: analizar cada uno antes de continuar.
- [ ] Ejecutar nuevamente el SQL de verificación (paso 4) para confirmar consistencia.

---

### PASO 14 — Segunda ejecución del mismo cliente (idempotencia)

- [ ] Volver a ejecutar el dry run para el mismo cliente de prueba.
- [ ] El plan debe mostrar: `documentsPendingMigration = 0` (todos ya migrados).
- [ ] Ejecutar la migración real → debe completar sin crear carpetas nuevas ni duplicados.
- [ ] Verificar que `foldersCreated = 0` y `documentsAssigned = 0`.

---

### PASO 15 — Evaluación para todos los clientes

> **Solo proceder si todos los pasos anteriores fueron exitosos.**

- [ ] Revisar los conteos del PASO 2 y estimar tiempo de migración.
- [ ] Seleccionar "Todos los clientes" en la herramienta de migración.
- [ ] Ejecutar dry run global → revisar el resumen completo.
- [ ] Descargar informe JSON del dry run.
- [ ] Si el conteo de errores en el dry run es 0: proceder.
- [ ] Ejecutar la migración real para todos los clientes.
- [ ] Revisar el informe final.
- [ ] Ejecutar SQL de verificación nuevamente.

---

### NOTAS IMPORTANTES

- **Si algo falla**: usar `supabase/verification/rollback_document_folders.sql` (requiere backup previo).
- **No ejecutar "Todos los clientes" como primer paso de prueba.**
- **No usar service_role en el frontend** (la herramienta usa `getAuthClient()` con token de usuario).
- **El rollback elimina toda la organización en carpetas** pero no elimina documentos ni Storage.
- Los tests locales siempre deben pasar antes y después de aplicar la migración remota.
