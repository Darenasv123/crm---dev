-- Migración: restricción de permisos del rol Personal
-- Fecha: 2026-07-30
-- Objetivo: Personal solo lectura en Agenda, sin crear tareas
--
-- IMPORTANTE: Esta migración NO debe aplicarse en producción sin pruebas previas.
-- Ejecutar primero en desarrollo y staging.

begin;

-- ============================================================
-- AGENDA_EVENTS: Personal solo lectura, Admin gestiona
-- ============================================================

-- Personal puede VER eventos, pero no crear/editar/eliminar.
-- La sincronización automática desde Google Calendar sigue funcionando
-- porque el proceso del servidor usa credenciales administrativas separadas.

drop policy if exists "agenda_insert" on public.agenda_events;
drop policy if exists "agenda_update" on public.agenda_events;
drop policy if exists "agenda_delete" on public.agenda_events;

-- SELECT: todos los staff pueden ver eventos
-- (ya existe política "agenda_select" que permite is_staff())

-- INSERT: solo Administrador puede crear eventos
create policy "agenda_insert" on public.agenda_events
  for insert to authenticated
  with check (public.is_admin());

-- UPDATE: solo Administrador puede editar eventos
create policy "agenda_update" on public.agenda_events
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: solo Administrador puede eliminar eventos
create policy "agenda_delete" on public.agenda_events
  for delete to authenticated
  using (public.is_admin());

comment on policy "agenda_insert" on public.agenda_events is
  'Solo Administrador activo puede crear eventos en la agenda.';
comment on policy "agenda_update" on public.agenda_events is
  'Solo Administrador activo puede editar eventos en la agenda.';
comment on policy "agenda_delete" on public.agenda_events is
  'Solo Administrador activo puede eliminar eventos de la agenda.';

-- ============================================================
-- CASE_TASKS: reforzar que Personal no crea tareas directamente
-- ============================================================

-- La política INSERT ya existe y restringe a Administrador.
-- Verificamos que esté correctamente implementada según 20260729211000.

-- Personal puede:
-- 1. Ver tareas (SELECT ya implementado con is_staff())
-- 2. Tomar tareas mediante RPC claim_case_task
-- 3. Actualizar estado/observaciones de sus propias tareas (UPDATE ya implementado)
-- 4. Devolver tareas mediante RPC return_case_task

-- Personal NO puede:
-- 1. Crear tareas (INSERT restringido a is_admin())
-- 2. Eliminar tareas (DELETE restringido a is_admin())
-- 3. Asignar/reasignar tareas a otros (guard_case_task_update lo impide)
-- 4. Modificar campos administrativos (guard_case_task_update lo impide)

-- Verificar que el trigger guard_case_task_update está activo
drop trigger if exists guard_case_task_update_trigger on public.case_tasks;
create trigger guard_case_task_update_trigger
  before update on public.case_tasks
  for each row
  execute function public.guard_case_task_update();

-- ============================================================
-- VALIDACIÓN: verificar funciones RPC
-- ============================================================

-- Confirmar que claim_case_task y return_case_task tienen
-- permisos correctos (solo authenticated, no anon ni PUBLIC)

-- Ya están revocados de anon/PUBLIC en la migración 20260729211000
-- No es necesario re-revocar, pero podemos confirmar explícitamente:

revoke execute on function public.claim_case_task(uuid) from public, anon;
revoke execute on function public.return_case_task(uuid) from public, anon;

-- Asegurar que solo authenticated puede ejecutar
grant execute on function public.claim_case_task(uuid) to authenticated;
grant execute on function public.return_case_task(uuid) to authenticated;

-- ============================================================
-- DOCUMENTACIÓN
-- ============================================================

comment on table public.agenda_events is
  'Eventos del calendario jurídico. Personal: solo lectura. Administrador: gestión completa.';

comment on table public.case_tasks is
  'Cola de trabajo compartida. Personal: ver, tomar mediante RPC, actualizar propias. Administrador: gestión completa.';

comment on function public.claim_case_task(uuid) is
  'RPC para que cualquier staff (Personal o Administrador) tome una tarea disponible de forma atómica.';

comment on function public.return_case_task(uuid) is
  'RPC para que el responsable devuelva su tarea a la cola de Disponibles.';

-- ============================================================
-- CONTRATO DE VALIDACIÓN
-- ============================================================

-- Las siguientes queries deben ejecutarse como pruebas después de aplicar la migración:
--
-- Como Administrador Activo:
--   ✅ SELECT * FROM agenda_events; (debe retornar eventos)
--   ✅ INSERT INTO agenda_events (...) VALUES (...); (debe funcionar)
--   ✅ UPDATE agenda_events SET ... WHERE id = ...; (debe funcionar)
--   ✅ DELETE FROM agenda_events WHERE id = ...; (debe funcionar)
--   ✅ INSERT INTO case_tasks (...) VALUES (...); (debe funcionar)
--   ✅ SELECT claim_case_task('task-id'); (debe funcionar)
--
-- Como Personal Activo:
--   ✅ SELECT * FROM agenda_events; (debe retornar eventos)
--   ❌ INSERT INTO agenda_events (...) VALUES (...); (debe fallar con 42501)
--   ❌ UPDATE agenda_events SET ... WHERE id = ...; (debe fallar con 42501)
--   ❌ DELETE FROM agenda_events WHERE id = ...; (debe fallar con 42501)
--   ❌ INSERT INTO case_tasks (...) VALUES (...); (debe fallar con 42501)
--   ✅ SELECT claim_case_task('task-id-disponible'); (debe funcionar)
--   ✅ UPDATE case_tasks SET status='blocked' WHERE id='mi-tarea' AND assigned_to=auth.uid(); (debe funcionar)
--   ❌ UPDATE case_tasks SET assigned_to='otro-user' WHERE id='mi-tarea'; (debe fallar)
--
-- Como anon (no autenticado):
--   ❌ SELECT claim_case_task('task-id'); (debe fallar - sin permisos de ejecución)
--   ❌ SELECT * FROM agenda_events; (debe fallar - RLS)

commit;

