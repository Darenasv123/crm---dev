# HANDOFF — CRM Jurídico

## Estado actual (rama: `rescue/fase-2a-antigravity`)

El CRM es **funcional y estable**. Todos los módulos core están conectados a Supabase con RLS activo. Se ejecutó una auditoría funcional completa con correcciones de runtime, SSR, importación y tests.

---

## Resultado de la auditoría funcional (2026-07-22)

### Verificaciones ejecutadas

```
npx tsc --noEmit     → 0 errores
npm run lint         → 0 errores (7 warnings pre-existentes en ui/)
npm run build        → ✓ built in 7.72s
npm test             → 60/60 tests pasaron (6 archivos)
```

### Módulos verificados por código + tests

| Módulo | Flujo | Estado | Corrección aplicada |
|---|---|---|---|
| **Importación CSV** | Parseo CSV con headers flexibles | ✅ Verificado | Tests escritos (39 casos) |
| **Importación CSV** | Validación de filas (DNI 8 dig., tel 9 dig.) | ✅ Verificado | Tests escritos |
| **Importación CSV** | Normalización de estados | ✅ Verificado | Tests escritos |
| **Importación CSV** | Detección de tipo de archivo | ✅ Verificado | Tests escritos |
| **Importación CSV** | Archivo .xls rechazado con mensaje claro | ✅ Corregido | Eliminado soporte .xls, mensaje específico |
| **Importación Excel** | Parseo .xlsx con ExcelJS | ✅ Implementado | `parseExcel()` con `cellToString()` robusto |
| **Importación Excel** | Celdas: fórmulas, RichText, Date, error | ✅ Implementado | `cellToString()` maneja todos los tipos |
| **Importación Excel** | Filas vacías omitidas | ✅ Implementado | Guard en `eachRow` |
| **Importación** | Vista previa antes de insertar | ✅ Verificado | Paso "preview" obligatorio |
| **Importación** | Errores individuales por fila en resultado | ✅ Implementado | `importResult.errors[]` con hasta 5 mensajes |
| **Importación** | Prevención de doble envío | ✅ Implementado | Botón `disabled={importing}` + guard `if (importing) return` |
| **Notificaciones** | SSR guard (`typeof window`) | ✅ Corregido | `enabled: isBrowser` en `useQuery` |
| **Notificaciones** | Sin sesión → no hace consulta | ✅ Corregido | Verificación de sesión en `queryFn` antes de consultar |
| **Notificaciones** | Error de Supabase → retorna `[]` | ✅ Corregido | `if (error) return []` sin lanzar excepción |
| **Notificaciones** | Limpieza de intervalos | ✅ Correcto | TanStack Query limpia `refetchInterval` al desmontar |
| **Notificaciones** | Reintentos agresivos | ✅ Corregido | `retry: 1` (mínimo) |
| **Config. Notificaciones** | Toggle SSR-safe | ✅ Corregido | `typeof window === "undefined"` guard en init y setter |
| **Config. Notificaciones** | Persistencia en localStorage | ✅ Implementado | Clave `notification_pref_*` por toggle |
| **Clientes** | Filtro especialidades dinámico | ✅ Implementado | `useMemo` sobre `process_type` reales |
| **Autenticación** | Login, sesión, cierre, rutas protegidas | ✅ Verificado por código | `_app.tsx` + `use-auth.tsx` correctos |
| **Dashboard** | KPIs desde Supabase | ✅ Verificado por código | Sin datos mock en rutas activas |
| **Casos** | CRUD, filtros, paginación | ✅ Verificado por código | Completo y funcional |
| **Pagos** | Honorarios, abonos, comprobantes | ✅ Verificado por código | Hard-cap saldo pendiente implementado |
| **Reportes** | Ficha cliente, DOCX/JPG export | ✅ Verificado por código | Completo |
| **Agenda** | Eventos, Google Calendar sync | ✅ Verificado por código | Auto-sync conservador al abrir |

---

## Módulos en modo demo (requieren integración externa)

### Importaciones desde Google Drive (`/importaciones`)
- Todo el flujo usa `MockDriveProvider`.
- Para integrar con Drive real, implementar `RealDriveProvider` usando el token OAuth ya guardado.
- **Credencial requerida:** `VITE_GOOGLE_CLIENT_ID` (ya configurado para Google Calendar).

### WhatsApp Business, SMTP, Plantillas de documentos
- Marcados explícitamente como "Próximamente" en la UI.
- No requieren código hasta que se tengan credenciales de Meta y un servidor SMTP.

---

## Prueba manual obligatoria (requiere sesión activa en Supabase)

Los siguientes flujos no pueden probarse sin credenciales de usuario reales. Se dejaron preparados para ejecución inmediata:

1. **Login** → `http://localhost:8080/login` → Verificar redirección a `/` tras autenticación.
2. **Crear cliente** → `/clientes` → Botón "Nuevo Cliente" → Verificar aparición inmediata en tabla.
3. **Importar CSV** → `/clientes` → Botón "Importar" → Arrastrar `plantilla_clientes.csv` generada por el mismo sistema → Verificar inserción en Supabase.
4. **Importar Excel** → Subir un `.xlsx` con columnas `nombre,dni,telefono` → Verificar que `.xls` muestra mensaje de error claro.
5. **Crear expediente** → `/casos` → Buscar cliente inline → Verificar creación y aparición en tabla.
6. **Registrar pago** → `/pagos` → Verificar que el saldo se actualiza y el historial muestra el abono.
7. **Campana de notificaciones** → Verificar que muestra eventos de agenda de hoy y próximos 3 días.
8. **Configuración → Notificaciones** → Cambiar toggles → Recargar → Verificar que persisten.

---

## Limitaciones conocidas y documentadas

| Limitación | Descripción | Pendiente |
|---|---|---|
| Preferencias de notificación | Usan localStorage — no se sincronizan entre dispositivos ni usuarios | Implementar tabla `user_preferences` en Supabase si se necesita sincronización |
| Importación .xls | No soportada (ExcelJS solo lee .xlsx). El usuario recibe mensaje claro. | Aceptar como decisión de diseño |
| Google Drive real | No implementado — solo demo | Requiere trabajo de backend |
| WhatsApp / SMTP | No implementados | Requieren credenciales externas |

---

## Archivos modificados en las dos sesiones

```
src/hooks/use-notifications.ts         — Implementado + SSR guard + sesión guard
src/components/csv-import.tsx          — Excel support + .xls rejection + errores por fila
src/routes/_app.clientes.index.tsx     — Filtro dinámico de especialidades
src/routes/_app.configuracion.index.tsx — Toggles SSR-safe + persistentes
tests/csv-import.test.ts               — 39 tests nuevos (todos pasan)
HANDOFF.md                             — Este archivo
```

---

## Verificación final

```
npx tsc --noEmit  → 0 errores
npm run lint      → 0 errores
npm run build     → ✓ 7.72s
npm test          → 60/60 ✓
```
