# HANDOFF — CRM Jurídico

## Estado actual (rama: `rescue/fase-2a-antigravity`)

El CRM está **mayoritariamente funcional** con datos reales de Supabase.

---

## Módulos completados (conectados a Supabase)

| Módulo | Estado |
|---|---|
| Autenticación (login, sesión, perfil) | ✅ Completo |
| Dashboard (KPIs, bandeja de trabajo, agenda) | ✅ Completo |
| Clientes (CRUD, búsqueda, filtros, importación) | ✅ Completo |
| Expedientes / Casos (CRUD, detalle con 8 tabs) | ✅ Completo |
| Pagos (honorarios, abonos, comprobantes) | ✅ Completo (solo Admin) |
| Agenda (eventos, Google Calendar sync) | ✅ Completo |
| Reportes (ficha cliente, DOCX/JPG export) | ✅ Completo |
| Documentos (explorador, upload, signed URLs) | ✅ Completo |
| Configuración (usuarios, backup, Google Cal) | ✅ Completo (solo Admin) |
| Revisión IA (demo + modo real Supabase) | ✅ Mayormente completo |

---

## Trabajo realizado en esta sesión (Kiro — 2026-07-22)

### 1. `src/hooks/use-notifications.ts` — Implementado desde cero
- El hook estaba vacío; todo el sistema de notificaciones (campana, panel, badge) fallaba en runtime.
- Ahora consulta `agenda_events` de Supabase para los próximos 3 días y retorna objetos `Notification` tipados.
- Se actualiza automáticamente cada 5 minutos.

### 2. `src/components/csv-import.tsx` — Soporte Excel (.xlsx) añadido
- Se agregó `parseExcel()` usando ExcelJS (ya dependencia del proyecto).
- El componente ahora acepta `.csv` y `.xlsx` / `.xls`.
- Misma lógica de mapeo flexible de columnas que el parser CSV.
- El dropzone y el `<input file>` actualizados para aceptar ambos formatos.
- Se refactorizó `validateRow` y `normalizeStatus` como funciones reutilizables.
- Se agrega `parseError` state para mostrar errores de lectura al usuario.

### 3. `src/routes/_app.clientes.index.tsx` — Filtro dinámico de especialidades
- `SPECIALTY_OPTIONS` estaba hardcodeado con solo `["Todos", "Penal", "Familia"]`.
- Ahora se construye dinámicamente con `useMemo` a partir de los `process_type` reales de la DB.
- Se normaliza tomando el primer segmento antes de `—` o `-` para agrupar variantes.

### 4. `src/routes/_app.configuracion.index.tsx` — Toggles de notificaciones persistentes
- Los toggles "Audiencias próximas", "Pagos vencidos", etc. eran puramente visuales (estado local efímero).
- Ahora persisten en `localStorage` con claves `notification_pref_*`.
- La preferencia se recupera al montar el componente.

---

## Módulos en modo demo (pendientes de integración real)

### Importaciones (`/importaciones`)
- Todo el flujo usa `MockDriveProvider` y datos de `demo-data.ts`.
- No hay integración real con Google Drive API.
- Para hacerlo real necesitas:
  - Implementar un `RealDriveProvider` que use la token de OAuth ya guardada (`localStorage.gcal_*`) y llame a `drive.google.com/api/v3/files`.
  - Conectar el paso "Confirmar importación" a inserts reales en `clients`, `cases`, `documents`.
  - **Credencial necesaria**: `VITE_GOOGLE_CLIENT_ID` (ya requerido para Google Calendar, mismo valor).

### WhatsApp Business (`/configuracion → WhatsApp`)
- Marcado como "Próximamente". Sin implementación backend.
- Para activar: necesitas una cuenta de WhatsApp Business API (Meta).

### Correo SMTP (`/configuracion → Correo`)
- Marcado como "Próximamente".
- Para activar: necesitas configurar un servidor SMTP y un edge function en Supabase o un worker en Cloudflare.

### Plantillas de documentos (`/configuracion → Plantillas`)
- UI estática. Sin implementación.
- Para activar: necesitas storage en Supabase para los archivos DOCX de plantilla.

---

## Archivos modificados en esta sesión

- `src/hooks/use-notifications.ts` — Implementado
- `src/components/csv-import.tsx` — Soporte Excel + refactor
- `src/routes/_app.clientes.index.tsx` — Filtro dinámico
- `src/routes/_app.configuracion.index.tsx` — Toggles persistentes
- `HANDOFF.md` — Este archivo

---

## Verificación ejecutada

```
npx tsc --noEmit    → 0 errores
npm run lint        → 0 errores (7 warnings pre-existentes en ui/)
npm run build       → ✓ built in 2.94s
```

---

## Próximos pasos recomendados

1. **Integración Google Drive real** — Es la funcionalidad más solicitada y requiere trabajo de backend.
2. **Filtro "dueDate" en pagos** — La tabla no tiene `due_date`; si se necesita vencimiento por fecha, hay que agregar la columna en Supabase.
3. **Notificaciones por correo** — Requiere SMTP o Supabase Edge Functions.
4. **Tests de integración** — El proyecto tiene Vitest configurado pero no hay tests escritos.
