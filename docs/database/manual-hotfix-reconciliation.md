# Reconciliación de hotfixes manuales del CRM

**Fecha de cierre:** 2026-07-31  
**Rama:** `refactor/final-crm-visual-polish`  
**Propósito:** Documentar todos los cambios SQL que fueron aplicados manualmente en Supabase SQL Editor durante el desarrollo, y confirmar que cada uno tiene su migración local correspondiente.

---

## Convenciones

| Estado | Significado |
|---|---|
| ✅ Registrado localmente | Migración `.sql` presente en `supabase/migrations/` |
| ✅ Aplicado remotamente | Ejecutado en Supabase SQL Editor en producción/staging |
| ⚠️ Pendiente de portabilidad | No tiene migración local equivalente |
| ❌ No aplicar | Obsoleto o reemplazado por migración posterior |

---

## 1. Acceso operativo de Personal (`is_staff()`)

**Problema:** Personal no podía ver Clientes ni Expedientes después de aplicar restricciones parciales.  
**Hotfix remoto:** Policies `clients_select`, `cases_select` reescritas para `is_staff()`.  
**Migración local:** `20260730190000_fix_personal_operational_read_access.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  
**Objeto final:** `20260730210000_equal_operational_data_access.sql` (supersede al anterior)

---

## 2. Igualdad operativa Admin/Personal

**Problema:** Personal no podía crear ni editar Clientes, Expedientes, Documentos, Reportes ni Carpetas.  
**Hotfix remoto:** Policies de INSERT/UPDATE reescritas para `is_staff()` en todas esas tablas.  
**Migración local:** `20260730210000_equal_operational_data_access.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

**Tabla de permisos definitiva:**

| Acción | Administrador | Personal |
|---|:---:|:---:|
| Ver clientes | ✅ | ✅ |
| Crear/editar clientes | ✅ | ✅ |
| Eliminar clientes | ✅ | ❌ |
| Ver expedientes | ✅ | ✅ |
| Crear/editar expedientes | ✅ | ✅ |
| Eliminar expedientes | ✅ | ❌ |
| Ver/subir/editar documentos | ✅ | ✅ |
| Eliminar documentos | ✅ | ❌ |
| Ver/crear carpetas | ✅ | ✅ |
| Eliminar carpetas | ✅ | ❌ |
| Ver/crear/editar reportes | ✅ | ✅ |
| Eliminar reportes | ✅ | ❌ |
| Ver todas las tareas | ✅ | ✅ |
| Crear tareas | ✅ | ❌ |
| Tomar tareas (RPC) | ✅ | ✅ |
| Ver todos los eventos de agenda | ✅ | ✅ |
| Crear/editar/eliminar eventos | ✅ | ❌ |
| Ver pagos | ✅ | ❌ |
| Configuración | ✅ | ❌ |

---

## 3. `cases.materia`

**Problema:** El campo `materia` (Familia/Penal) no existía en la tabla `cases`.  
**Hotfix remoto:** `ALTER TABLE cases ADD COLUMN IF NOT EXISTS materia text CHECK (...)`.  
**Migración local:** `20260727000000_add_cases_materia.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 4. `client_reports` extendido

**Problema:** El formulario de reportes necesitaba campos: `materia`, `status_date`, `current_status`, `informative_message`, `reminder_days`, `final_text`.  
**Hotfix remoto:** `ALTER TABLE client_reports ADD COLUMN IF NOT EXISTS ...` (6 columnas).  
**Migración local:** `20260727120000_extend_client_reports.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 5. `cases_status_check`

**Problema:** El constraint original solo aceptaba valores legacy. El workflow nuevo usaba valores distintos, causando `23514 check_violation` en imports.  
**Hotfix remoto:** DROP constraint + backfill + ADD constraint con valores actuales.  
**Migración local:** `20260724120000_fix_cases_status_check_constraint.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 6. `claim_case_task` / `return_case_task`

**Problema:** La toma de tareas no era atómica; dos usuarios podían tomar la misma tarea simultáneamente.  
**Hotfix remoto:** RPCs `claim_case_task(uuid)` y `return_case_task(uuid)` con `SELECT ... FOR UPDATE`.  
**Migración local:** `20260729211000_task_claim_workflow.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 7. `guard_case_task_update`

**Problema:** Personal podía modificar campos administrativos de tareas (título, prioridad, asignación).  
**Hotfix remoto:** Función y trigger `guard_case_task_update_trigger` sobre `case_tasks`.  
**Migración local:** `20260729211000_task_claim_workflow.sql` (incluida en el mismo archivo)  
**Recreado en:** `20260730180000_personal_role_permissions.sql` (DROP + CREATE para garantizar estado)  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 8. Policies de Agenda (Personal solo lectura)

**Problema:** Personal podía crear/editar/eliminar eventos de agenda.  
**Hotfix remoto:** Policies `agenda_insert`, `agenda_update`, `agenda_delete` restringidas a `is_admin()`.  
**Migración local:** `20260730180000_personal_role_permissions.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 9. Columnas legacy opcionales (nullable)

**Problema:** Campos judiciales y de partes eliminados del formulario pero requeridos por el schema, bloqueando inserts.  
**Hotfix remoto:** `ALTER COLUMN ... DROP NOT NULL` / `ADD COLUMN IF NOT EXISTS ... DEFAULT NULL`.  
**Migración local:** `20260729213000_drop_deprecated_client_case_fields.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## 10. Policies de Pagos (solo Admin)

**Problema:** Rol Personal podía acceder a datos de pagos.  
**Hotfix remoto:** Policies en `payments` y `payment_records` restringidas a `is_admin()`.  
**Migración local:** `20260724200000_restrict_payments_to_admin.sql`  
**Estado:** ✅ Registrado localmente / ✅ Aplicado remotamente  

---

## Resumen de portabilidad

| # | Hotfix | Migración local | Portabilidad |
|---|---|---|:---:|
| 1 | Acceso operativo Personal (select) | `20260730190000` | ✅ |
| 2 | Igualdad operativa definitiva | `20260730210000` | ✅ |
| 3 | `cases.materia` | `20260727000000` | ✅ |
| 4 | `client_reports` extendido | `20260727120000` | ✅ |
| 5 | `cases_status_check` | `20260724120000` | ✅ |
| 6 | `claim_case_task` / `return_case_task` | `20260729211000` | ✅ |
| 7 | `guard_case_task_update` | `20260729211000` + `20260730180000` | ✅ |
| 8 | Agenda solo lectura Personal | `20260730180000` | ✅ |
| 9 | Columnas legacy nullable | `20260729213000` | ✅ |
| 10 | Pagos solo Admin | `20260724200000` | ✅ |

**Todos los hotfixes tienen migración local equivalente. No existen objetos remotos sin registro.**

---

## Instrucciones para instalación nueva

Para reproducir el estado completo de la base de datos en un entorno nuevo:

```bash
# Con Supabase CLI conectado al proyecto
supabase db push
# Aplica todas las migraciones en orden cronológico
```

O manualmente en Supabase SQL Editor, ejecutando los archivos en orden estrictamente cronológico por timestamp del nombre.

---

## Notas adicionales

- Las funciones helper `is_staff()` y `is_admin()` se definen en `20260721090000_legal_case_foundation.sql`.
- Las migraciones `20260730190000` y `20260730210000` son secuenciales: la primera corrigió el acceso de lectura, la segunda extendió a escritura. Ambas deben aplicarse en ese orden.
- El trigger `guard_case_task_update_trigger` se recrea explícitamente en `20260730180000` con DROP + CREATE para garantizar que esté activo incluso si el estado remoto divergió.
