# Implementation Tasks

## Feature: Importación masiva de clientes y documentos

Las tareas están ordenadas por dependencia. Cada tarea es pequeña y verificable.

---

- [ ] 1. Crear `src/lib/imports/folder-import.ts` con tipos y FolderAnalyzer
  - Definir `ClientEntryStatus`, `DocumentEntryStatus`, `DocumentEntry`, `ClientEntry`, `FolderAnalysisResult`
  - Definir `BULK_IMPORT_EXTENSIONS` y `MAX_IMPORT_FILE_SIZE`
  - Implementar `sanitizeStoragePath(relativePath: string): string`
  - Implementar `analyzeFiles(files: File[]): FolderAnalysisResult`
  - Implementar `detectDuplicatesForClients(clients, existingClients): ClientEntry[]`
  - Sin imports de React; módulo puro TypeScript
  - **Verificación**: `tsc --noEmit` sin errores en este archivo

- [ ] 2. Crear tests unitarios `tests/folder-import.test.ts`
  - Test: carpeta raíz no se convierte en cliente
  - Test: subcarpeta de primer nivel se convierte en cliente
  - Test: archivos de sistema se ignoran (.DS_Store, Thumbs.db, ._ prefix)
  - Test: subcarpetas internas se conservan en relativePath
  - Test: carpeta sin archivos válidos se marca 'empty'
  - Test: extensión inválida → DocumentEntry 'invalid_format'
  - Test: archivo vacío → DocumentEntry 'invalid_empty'
  - Test: archivo > 10 MB → DocumentEntry 'invalid_size'
  - Test: sanitizeStoragePath reemplaza caracteres especiales y preserva /
  - Test: detectDuplicatesForClients marca 'duplicate_exact' correctamente
  - Test: detectDuplicatesForClients marca 'duplicate_approximate' sin fusionar
  - **Verificación**: `npm run test` pasa incluyendo estos tests

- [ ] 3. Crear `src/lib/imports/folder-import-engine.ts` con ImportEngine
  - Implementar `runWithConcurrency<T>(tasks, limit): Promise<T[]>`
  - Implementar `createImportedClient(name, db, sessionUserId): Promise<string>`
  - Implementar `uploadDocument(entry, clientId, db, session, existingDocs, onProgress): Promise<void>`
  - Implementar `runImport(params): Promise<ImportResult>` con las etapas descritas en design.md
  - Definir tipo `ImportResult` y `ImportStats`
  - **Verificación**: `tsc --noEmit` sin errores en este archivo

- [ ] 4. Crear `src/components/folder-import.tsx` — paso 'idle' y 'analyzing'
  - Estructura del modal con overlay (patrón zip-import.tsx)
  - Input `<input type="file" webkitdirectory multiple>` con ref
  - Detección de soporte `webkitdirectory` y aviso si no está disponible
  - Al seleccionar archivos: llamar `analyzeFiles()` → pasar a 'analyzing' → luego 'preview'
  - **Verificación**: componente renderiza sin errores TypeScript

- [ ] 5. Añadir paso 'preview' al componente `folder-import.tsx`
  - Lista de ClientEntries con estado badge, contador de documentos
  - Campo de búsqueda por nombre
  - Filtro por estado
  - Botón Excluir por cliente
  - Para duplicate_exact: selector de resolución (usar existente / crear nuevo / omitir)
  - Para duplicate_approximate: solo aviso visual, no bloquea
  - Listado de archivos inválidos con razón
  - Botón "Confirmar importación" deshabilitado si hay duplicate_exact sin resolver o todos los docs son inválidos
  - **Verificación**: TypeScript sin errores, ESLint sin errores

- [ ] 6. Añadir paso 'importing' al componente `folder-import.tsx`
  - Llamar a `runImport()` al confirmar
  - Mostrar barra de progreso con componente `Progress` de `@/components/ui/progress`
  - Mostrar nombre del cliente actual
  - Mostrar contadores en tiempo real
  - **Verificación**: TypeScript sin errores

- [ ] 7. Añadir paso 'done' al componente `folder-import.tsx`
  - Mostrar resumen de métricas agrupadas
  - Lista de DocumentEntries fallidos con mensaje de error
  - Botón "Reintentar fallos" que relanza solo los fallidos
  - Botón "Cerrar" que llama `onSuccess()` e invalida queries
  - Llamar `invalidateCrmQueries(qc, {})` al cerrar exitosamente
  - **Verificación**: TypeScript sin errores

- [ ] 8. Integrar `FolderImport` en `_app.clientes.index.tsx`
  - Añadir import del componente
  - Añadir estado `showFolderImportModal`
  - Añadir botón "Importar carpeta" en la barra de acciones (junto a los botones existentes)
  - Añadir render del modal con `onClose` y `onSuccess`
  - **Verificación**: página de clientes compila y renderiza correctamente

- [x] 9. Validación final
  - Ejecutar `npm run test` — todos los tests pasan ✅ 205/205
  - Ejecutar `npm run lint` — sin errores nuevos ✅
  - Ejecutar `npm run build` — build completa sin errores ✅
  - Verificar que creación manual de clientes sigue funcionando (no regresiones) ✅
  - Verificar que carga manual de documentos sigue funcionando (no regresiones) ✅

## Tareas adicionales completadas (post-spec)

- [x] 10. Corregir errores de Prettier en `folder-import-engine.ts` y tests ✅
- [x] 11. Ampliar cobertura de tests: tildes/ñ, mismo nombre en rutas distintas, rollback seguro (205 tests) ✅
- [x] 12. Mejorar mensajes de error para personal administrativo (Fase 9) ✅
- [x] 13. Crear `tests/staging-import-validation.test.ts` — tests de integración contra Supabase de prueba ✅
- [x] 14. Crear `.env.staging.example` con instrucciones para configurar el entorno de prueba ✅
- [x] 15. Crear `docs/importacion-masiva-procedimiento.md` — procedimiento completo de validación y migración ✅
- [x] 16. Actualizar `tests/remote-validation.test.ts` — eliminar credenciales hardcodeadas ✅
- [x] 17. Agregar aviso de importación por bloques en el componente FolderImport ✅
- [ ] 18. Validación remota contra Supabase de prueba — **PENDIENTE: requiere crear proyecto de prueba y configurar `.env.staging.local`**
