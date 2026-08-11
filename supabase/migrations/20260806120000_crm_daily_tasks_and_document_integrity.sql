-- Mejoras CRM 2026-08-06: fecha histórica de trabajo, auditoría y
-- consistencia de metadatos documentales. Migración aditiva y revisable.
-- No aplicar remotamente sin respaldo y validación previa en staging.

begin;

alter table public.case_tasks
  add column if not exists scheduled_for date,
  add column if not exists started_at timestamptz;

-- El backfill se ejecuta sin el guard de actualizaciones porque la migración
-- no tiene una sesión de usuario. Ningún otro trigger se deshabilita.
alter table public.case_tasks
  disable trigger case_tasks_20_guard_update;

update public.case_tasks
   set scheduled_for = coalesce(
     (due_date at time zone 'America/Lima')::date,
     (created_at at time zone 'America/Lima')::date
   )
 where scheduled_for is null;

alter table public.case_tasks
  enable trigger case_tasks_20_guard_update;

alter table public.case_tasks
  alter column scheduled_for set default ((now() at time zone 'America/Lima')::date),
  alter column scheduled_for set not null;

update public.case_tasks task
   set client_id = case_row.client_id
  from public.cases case_row
 where task.case_id = case_row.id
   and task.client_id is null;

create or replace function public.validate_case_task_relationship()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_client_id uuid;
begin
  if new.case_id is null then return new; end if;
  select client_id into v_case_client_id from public.cases where id = new.case_id;
  if not found then
    raise exception 'El expediente seleccionado no existe' using errcode = '23503';
  end if;
  if new.client_id is null then
    new.client_id := v_case_client_id;
  elsif new.client_id <> v_case_client_id then
    raise exception 'El cliente no corresponde al expediente seleccionado' using errcode = '23514';
  end if;
  return new;
end;
$$;

create index if not exists case_tasks_scheduled_for_idx
  on public.case_tasks (scheduled_for, status);

comment on column public.case_tasks.scheduled_for is
  'Fecha de trabajo original. No se mueve automáticamente cuando la tarea queda pendiente.';
comment on column public.case_tasks.due_date is
  'Fecha/hora límite opcional; es independiente de scheduled_for.';

create or replace function public.guard_case_task_schedule()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.scheduled_for is distinct from old.scheduled_for and not public.is_admin() then
    raise exception 'Solo el Administrador puede reprogramar la fecha de trabajo'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists case_tasks_05_guard_schedule on public.case_tasks;
create trigger case_tasks_05_guard_schedule
  before update of scheduled_for on public.case_tasks
  for each row execute function public.guard_case_task_schedule();

create table if not exists public.case_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.case_tasks(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  old_status text,
  new_status text,
  old_scheduled_for date,
  new_scheduled_for date,
  changes jsonb not null default '{}'::jsonb
);

create index if not exists case_task_history_task_changed_idx
  on public.case_task_history (task_id, changed_at desc);

alter table public.case_task_history enable row level security;

drop policy if exists "case_task_history_select" on public.case_task_history;
create policy "case_task_history_select" on public.case_task_history
  for select to authenticated using (public.is_staff());

grant select on public.case_task_history to authenticated;
revoke insert, update, delete on public.case_task_history from authenticated, anon;

create or replace function public.audit_case_task_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.status is distinct from old.status then
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
  end if;
  if new.scheduled_for is distinct from old.scheduled_for then
    v_changes := v_changes || jsonb_build_object(
      'scheduled_for', jsonb_build_array(old.scheduled_for, new.scheduled_for)
    );
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    v_changes := v_changes || jsonb_build_object(
      'assigned_to', jsonb_build_array(old.assigned_to, new.assigned_to)
    );
  end if;
  if new.title is distinct from old.title then
    v_changes := v_changes || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
  end if;
  if v_changes <> '{}'::jsonb then
    insert into public.case_task_history (
      task_id, changed_by, old_status, new_status,
      old_scheduled_for, new_scheduled_for, changes
    ) values (
      new.id, auth.uid(), old.status, new.status,
      old.scheduled_for, new.scheduled_for, v_changes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists case_tasks_audit_changes on public.case_tasks;
create trigger case_tasks_audit_changes
  after update on public.case_tasks
  for each row execute function public.audit_case_task_changes();

-- Se amplía la función ya asociada a case_tasks_10_apply_completion.
-- El trigger existente no se elimina, reemplaza ni deshabilita.
create or replace function public.apply_case_task_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'in_progress' and (tg_op = 'INSERT' or old.status is distinct from 'in_progress') then
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
      new.completed_by := auth.uid();
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

-- Un expediente documental siempre debe corresponder al cliente seleccionado.
create or replace function public.validate_document_relationship()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_case_client_id uuid;
begin
  if new.case_id is null then return new; end if;
  select client_id into v_case_client_id from public.cases where id = new.case_id;
  if not found then
    raise exception 'El expediente seleccionado no existe' using errcode = '23503';
  end if;
  if new.client_id is null then
    new.client_id := v_case_client_id;
  elsif new.client_id <> v_case_client_id then
    raise exception 'El expediente no corresponde al cliente seleccionado' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_validate_relationship on public.documents;
create trigger documents_validate_relationship
  before insert or update of client_id, case_id on public.documents
  for each row execute function public.validate_document_relationship();

create table if not exists public.document_change_history (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  changes jsonb not null
);

alter table public.document_change_history enable row level security;
drop policy if exists "document_change_history_select" on public.document_change_history;
create policy "document_change_history_select" on public.document_change_history
  for select to authenticated using (public.is_staff());
grant select on public.document_change_history to authenticated;
revoke insert, update, delete on public.document_change_history from authenticated, anon;

create or replace function public.audit_document_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.name is distinct from old.name then
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_array(old.name, new.name));
  end if;
  if new.client_id is distinct from old.client_id then
    v_changes := v_changes || jsonb_build_object('client_id', jsonb_build_array(old.client_id, new.client_id));
  end if;
  if new.case_id is distinct from old.case_id then
    v_changes := v_changes || jsonb_build_object('case_id', jsonb_build_array(old.case_id, new.case_id));
  end if;
  if new.document_type is distinct from old.document_type then
    v_changes := v_changes || jsonb_build_object('document_type', jsonb_build_array(old.document_type, new.document_type));
  end if;
  if new.verification_status is distinct from old.verification_status then
    v_changes := v_changes || jsonb_build_object('verification_status', jsonb_build_array(old.verification_status, new.verification_status));
  end if;
  if new.document_date is distinct from old.document_date then
    v_changes := v_changes || jsonb_build_object('document_date', jsonb_build_array(old.document_date, new.document_date));
  end if;
  if v_changes <> '{}'::jsonb then
    insert into public.document_change_history (document_id, changed_by, changes)
    values (new.id, auth.uid(), v_changes);
  end if;
  return new;
end;
$$;

drop trigger if exists documents_audit_metadata on public.documents;
create trigger documents_audit_metadata
  after update on public.documents
  for each row execute function public.audit_document_metadata();

-- Simulación por defecto. Solo Administrador puede aplicar los valores conocidos.
-- Los valores desconocidos se reportan y no se modifican.
create or replace function public.normalize_document_types(p_apply boolean default false)
returns table (
  document_id uuid,
  previous_value text,
  canonical_value text,
  is_known boolean,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_key text;
  v_canonical text;
begin
  if not public.is_admin() then
    raise exception 'Solo el Administrador puede auditar tipos documentales'
      using errcode = '42501';
  end if;

  for v_row in
    select id, type, document_type,
           coalesce(nullif(document_type, ''), type) as current_value
      from public.documents
     order by uploaded_at, id
  loop
    v_key := lower(translate(trim(coalesce(v_row.current_value, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
    v_canonical := case
      when v_key in ('demanda', 'demandas') then 'Demanda'
      when v_key in ('resolucion', 'resoluciones') then 'Resolución'
      when v_key in ('sentencia', 'sentencias') then 'Sentencia'
      when v_key in ('poder', 'poderes') then 'Poder'
      when v_key in ('contrato', 'contratos') then 'Contrato'
      when v_key in ('otro', 'otros') then 'Otros'
      else null
    end;

    document_id := v_row.id;
    previous_value := v_row.current_value;
    canonical_value := coalesce(v_canonical, 'Otros');
    is_known := v_canonical is not null;
    was_applied := false;

    if p_apply and is_known and (
      v_row.type is distinct from v_canonical
      or v_row.document_type is distinct from v_canonical
    ) then
      update public.documents
         set type = v_canonical,
             document_type = v_canonical,
             updated_at = now()
       where id = v_row.id;
      was_applied := true;
    end if;
    return next;
  end loop;
end;
$$;

revoke execute on function public.normalize_document_types(boolean) from public, anon;
grant execute on function public.normalize_document_types(boolean) to authenticated;

-- Verificación del único registro histórico confirmado antes de la migración.
-- Además de la fecha, se protege expresamente su estado operativo.
do $$
declare
  v_historical_task_count integer;
  v_valid_historical_task_count integer;
begin
  select
    count(*),
    count(*) filter (
      where scheduled_for = date '2026-08-05'
        and status = 'ready_to_file'
    )
  into v_historical_task_count, v_valid_historical_task_count
  from public.case_tasks
  where created_at = timestamptz '2026-08-06 02:02:30.149561+00';

  if v_historical_task_count <> 1 then
    raise exception
      'Verificación fallida: se esperaba exactamente una tarea histórica con created_at 2026-08-06 02:02:30.149561+00; se encontraron %',
      v_historical_task_count;
  end if;

  if v_valid_historical_task_count <> 1 then
    raise exception
      'Verificación fallida: la tarea histórica debe conservar status ready_to_file y scheduled_for 2026-08-05';
  end if;
end;
$$;

-- Todos los triggers de case_tasks, incluido el guard temporalmente
-- deshabilitado, deben terminar habilitados en modo normal (O = origin).
do $$
declare
  v_disabled_triggers text;
begin
  select string_agg(tgname, ', ' order by tgname)
  into v_disabled_triggers
  from pg_trigger
  where tgrelid = 'public.case_tasks'::regclass
    and tgenabled <> 'O';

  if v_disabled_triggers is not null then
    raise exception
      'Verificación fallida: los siguientes triggers de public.case_tasks no terminaron con tgenabled = O: %',
      v_disabled_triggers;
  end if;
end;
$$;

commit;
