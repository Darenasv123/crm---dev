-- Align the Cloud task-claim contract with the canonical self-hosted model.
-- This migration is intentionally limited to claim metadata, the guarded
-- claim/return transition, and the RPC privileges required by the frontend.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(
  hashtext('crm_align_cloud_task_claim_contract_20260811')
);

alter table public.case_tasks
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid;

do $$
declare
  v_named_constraint_exists boolean;
  v_equivalent_constraint_exists boolean;
begin
  select exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.case_tasks'::regclass
      and c.conname = 'case_tasks_claimed_by_fkey'
  ) into v_named_constraint_exists;

  select exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.case_tasks'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.confdeltype = 'n'
      and c.conkey = array[
        (
          select a.attnum
          from pg_attribute a
          where a.attrelid = 'public.case_tasks'::regclass
            and a.attname = 'claimed_by'
            and not a.attisdropped
        )
      ]::smallint[]
      and c.confkey = array[
        (
          select a.attnum
          from pg_attribute a
          where a.attrelid = 'public.profiles'::regclass
            and a.attname = 'id'
            and not a.attisdropped
        )
      ]::smallint[]
  ) into v_equivalent_constraint_exists;

  if v_named_constraint_exists and not v_equivalent_constraint_exists then
    raise exception
      'case_tasks_claimed_by_fkey exists but does not match profiles(id) ON DELETE SET NULL';
  end if;

  if not v_equivalent_constraint_exists then
    alter table public.case_tasks
      add constraint case_tasks_claimed_by_fkey
      foreign key (claimed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists case_tasks_claimed_by_idx
  on public.case_tasks (claimed_by) where claimed_by is not null;

-- The canonical RPCs mark trusted transitions through crm.task_transition.
-- Align the existing guard function so the installed trigger recognizes both
-- claim and return operations. The trigger itself already exists in Cloud.
create or replace function public.guard_case_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_transition text := current_setting('crm.task_transition', true);
begin
  if public.crm_is_active_admin() then return new; end if;
  if v_uid is null or not public.crm_is_active_staff() then
    raise exception 'No tienes permiso para modificar esta tarea' using errcode = '42501';
  end if;

  if v_transition = 'claim:' || v_uid::text
     and old.assigned_to is null and old.status = 'pending'
     and new.assigned_to = v_uid and new.claimed_by = v_uid
     and new.claimed_at is not null and new.status = 'in_progress'
     and new.case_id is not distinct from old.case_id
     and new.client_id is not distinct from old.client_id then
    return new;
  end if;

  if v_transition = 'return:' || v_uid::text
     and old.assigned_to = v_uid and new.assigned_to is null
     and new.claimed_by is null and new.claimed_at is null
     and new.status = 'pending'
     and new.case_id is not distinct from old.case_id
     and new.client_id is not distinct from old.client_id then
    return new;
  end if;

  if old.assigned_to is distinct from v_uid or new.assigned_to is distinct from v_uid then
    raise exception 'Solo puedes modificar una tarea que hayas tomado' using errcode = '42501';
  end if;
  if new.claimed_at is distinct from old.claimed_at
     or new.claimed_by is distinct from old.claimed_by
     or new.case_id is distinct from old.case_id
     or new.client_id is distinct from old.client_id
     or new.title is distinct from old.title
     or new.priority is distinct from old.priority
     or new.due_date is distinct from old.due_date
     or new.scheduled_for is distinct from old.scheduled_for
     or new.is_all_day is distinct from old.is_all_day
     or new.source is distinct from old.source
     or new.created_by is distinct from old.created_by
     or new.created_by_ai is distinct from old.created_by_ai
     or new.verification_status is distinct from old.verification_status
     or (
       new.started_at is distinct from old.started_at
       and not (old.status is distinct from 'in_progress' and new.status = 'in_progress')
     ) then
    raise exception 'Personal solo puede actualizar estado y observaciones'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- PostgreSQL cannot change a function's return shape with CREATE OR REPLACE.
-- Remove only an incompatible existing uuid signature; an already-canonical
-- SETOF case_tasks function is preserved for an idempotent second execution.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.claim_case_task(uuid)')
      and (not p.proretset or p.prorettype <> 'public.case_tasks'::regtype)
  ) then
    execute 'drop function public.claim_case_task(uuid)';
  end if;
end;
$$;

create or replace function public.claim_case_task(p_task_id uuid)
returns setof public.case_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.case_tasks%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.crm_is_active_staff() then
    raise exception 'Debes ser un integrante activo para tomar tareas' using errcode = '42501';
  end if;
  select t.* into v_task from public.case_tasks t where t.id = p_task_id for update;
  if not found then raise exception 'La tarea no existe' using errcode = 'P0002'; end if;
  if v_task.assigned_to is not null or v_task.status <> 'pending' then
    raise exception 'Esta tarea ya no está disponible' using errcode = 'P0001';
  end if;
  perform set_config('crm.task_transition', 'claim:' || v_uid::text, true);
  return query
    update public.case_tasks t
    set assigned_to = v_uid, claimed_by = v_uid, claimed_at = now(), status = 'in_progress'
    where t.id = p_task_id and t.assigned_to is null and t.status = 'pending'
    returning t.*;
  if not found then raise exception 'Esta tarea acaba de ser tomada' using errcode = 'P0001'; end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.return_case_task(uuid)')
      and (not p.proretset or p.prorettype <> 'public.case_tasks'::regtype)
  ) then
    execute 'drop function public.return_case_task(uuid)';
  end if;
end;
$$;

create or replace function public.return_case_task(p_task_id uuid)
returns setof public.case_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.crm_is_active_staff() then
    raise exception 'Debes ser un integrante activo para devolver tareas' using errcode = '42501';
  end if;
  perform set_config('crm.task_transition', 'return:' || v_uid::text, true);
  return query
    update public.case_tasks t
    set assigned_to = null, claimed_by = null, claimed_at = null,
        status = 'pending', completed_at = null, completed_by = null
    where t.id = p_task_id and t.assigned_to = v_uid
      and t.status not in ('completed', 'cancelled')
    returning t.*;
  if not found then
    raise exception 'Solo puedes devolver una tarea activa que hayas tomado' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.claim_case_task(uuid) from public, anon, authenticated;
revoke all on function public.return_case_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_case_task(uuid) to authenticated;
grant execute on function public.return_case_task(uuid) to authenticated;
grant execute on function public.claim_case_task(uuid) to service_role;
grant execute on function public.return_case_task(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
