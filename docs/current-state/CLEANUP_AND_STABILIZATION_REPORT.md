# Cleanup and Stabilization Report

Fecha: 2026-07-22
Rama: `rescue/fase-2a-antigravity`
Localhost: `http://127.0.0.1:8080/`

## Datos eliminados

Dry-run ejecutado con 0 conflictos y 0 dudosos. Luego se ejecuto `npm run cleanup:test-imports -- --execute` sobre IDs exactos del plan `import-cleanup-2026-07-22T20-13-19-391Z`.

Eliminado:

- Clientes: 53
- Expedientes/casos: 66
- Documentos: 650
- Objetos Storage en bucket `documents`: 650
- Relaciones secundarias detectadas: 0 pagos, 0 reportes, 0 eventos, 0 tareas, 0 extracciones, 0 findings IA

Verificacion posterior:

- Remaining documents from plan: 0
- Remaining cases from plan: 0
- Remaining clients from plan: 0
- Storage objects checked from plan: 650
- Storage objects still present: 0
- Storage probe errors: 0

El detalle completo de IDs, rutas, hashes y ejecucion esta en `docs/current-state/TEST_IMPORT_CLEANUP_REPORT.md`. El respaldo local ignorado por Git quedo en `.local-backups/import-cleanup-2026-07-22T20-13-19-391Z/`.

## Datos preservados

No se eliminaron tablas completas, buckets completos ni registros por coincidencia parcial abierta. La agenda general previa permanecio intacta: el dry-run mostro 913 eventos existentes y 0 eventos vinculados a los clientes/expedientes ZIP del plan.

## Errores corregidos

- Búsqueda global mas tolerante: si reportes, eventos, pagos, partes o actuaciones fallan, los resultados principales no quedan vacios por ese fallo secundario.
- Búsqueda global ampliada: cliente por documento/telefono/WhatsApp y expediente por juzgado, partes y proxima accion.
- Validacion de documentos antes de Storage: extensiones permitidas, archivo no vacio y limite 10 MB.
- Validacion de pagos en hook: cliente requerido, servicio requerido, honorarios positivos y cuotas validas.
- Ficha del cliente: nueva pestaña `Agenda`, pestaña `Documentos sin clasificar`, conserva `Reportes` y resume documentos pendientes de clasificacion.

## Mejoras de usabilidad

- El personal puede revisar por cliente sus expedientes, documentos sin clasificar, pagos, agenda, reportes e historial desde una ficha unica.
- La subida de documentos falla antes de tocar Storage cuando el archivo no cumple reglas basicas.
- Los pagos invalidos se rechazan desde la capa de datos aunque el formulario cambie.
- La busqueda global es mas util para operacion real: telefono, documento, juzgado y partes.

## Pendientes

- E2E visual autenticado con usuario real.
- Google Calendar con OAuth real.
- Auditoria persistida en tabla dedicada para todas las operaciones importantes.
- OCR/Drive/backend para importacion masiva; por ahora se recomienda registro manual cliente por cliente.
- Resolver warnings Fast Refresh historicos cuando se haga una limpieza de componentes UI.

## Pruebas

- `npm test`: 137 tests pasaron.
- `npx tsc --noEmit --pretty false`: OK.
- `npm run lint`: OK con 7 warnings historicos.
- `npm run build`: OK con warnings no bloqueantes de build/chunks/plugins.
- `http://127.0.0.1:8080/`: respondio HTTP 200.

## Commits relevantes

- `6af7b5c feat: completar importación ZIP individual de clientes`
- `4d2b033 chore: agregar limpieza segura de importaciones ZIP de prueba`
- `eeb7dfb chore: documentar ejecucion de limpieza ZIP de prueba`
- `1a53698 chore: formatear script de limpieza ZIP`
- `193e072 fix: estabilizar flujos de cliente documentos y pagos`

## Procedimiento para el primer cliente real

1. Iniciar sesion con un usuario del estudio.
2. Ir a `Clientes` y crear el cliente manualmente con DNI/RUC, telefono y proceso.
3. Abrir el cliente creado y revisar que la ficha muestre 0 expedientes/documentos/pagos/agenda si es nuevo.
4. Ir a `Expedientes` y crear el expediente manual asociado a ese cliente.
5. Subir documentos desde `Documentos` o desde la ficha del cliente, eligiendo cliente y expediente correcto.
6. Registrar pagos solo si corresponde y con montos positivos.
7. Agendar actividades desde `Agenda`, verificando hora Peru UTC-5.
8. Crear reportes desde `Reportes` cuando el cliente y expediente ya esten revisados.
9. No usar importacion ZIP masiva para datos reales hasta cerrar la fase backend/revision humana.