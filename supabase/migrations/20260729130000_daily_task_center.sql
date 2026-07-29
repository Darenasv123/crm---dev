-- Centro de trabajo diario sobre public.case_tasks.
-- Migración aditiva: no copia tareas a agenda_events ni modifica datos existentes.
-- No aplicar remotamente hasta resolver y validar el plan de migraciones pendiente.

begin;

-- Permite tareas generales o asociadas solo a un cliente.
alter table public.case_tasks
  alter column case_id drop not null;

alter table public.case_tasks
  add column if not exists is_all_day boolean not null default false,
  add column if not exists completed_by uuid
    references public.profiles(id) on delete set null;

-- Conserva valores legacy sin reescribir filas y añade el vocabulario operativo.
alter table public.case_tasks
  drop constraint if exists case_tasks_priority_check;
alter table public.case_tasks
  add constraint case_tasks_priority_check
  check (priority in ('Baja', 'Normal', 'Media', 'Alta', 'Urgente'));

alter table public.case_tasks
  drop constraint if exists case_tasks_status_check;
alter table public.case_tasks
  add constraint case_tasks_status_check
  check (
    status in (
      'pending',
      'in_progress',
      'ready_to_file',
      'completed',
      'blocked',
      'cancelled',
      'overdue'
    )
  );

create index if not exists case_tasks_due_date_idx
  on public.case_tasks (due_date)
  where due_date is not null;
create index if not exists case_tasks_assigned_to_idx
  on public.case_tasks (assigned_to);
create index if not exists case_tasks_status_idx
  on public.case_tasks (status);
create index if not exists case_tasks_case_id_idx
  on public.case_tasks (case_id);
create index if not exists case_tasks_client_id_idx
  on public.case_tasks (client_id);

comment on column public.case_tasks.is_all_day is
  'True cuando el vencimiento representa un día completo en America/Lima.';
comment on column public.case_tasks.completed_by is
  'Usuario que cambió la tarea al estado completed.';

-- Si se informan expediente y cliente, ambos deben corresponder.
create or replace function public.validate_case_task_relationship()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_client_id uuid;
begin
  if new.case_id is null then
    return new;
  end if;

  select client_id
    into v_case_client_id
    from public.cases
   where id = new.case_id;

  if not found then
    raise exception 'El expediente seleccionado no existe'
      using errcode = '23503';
  end if;

  if new.client_id is not null and new.client_id <> v_case_client_id then
    raise exception 'El cliente no corresponde al expediente seleccionado'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists case_tasks_validate_relationship on public.case_tasks;
create trigger case_tasks_validate_relationship
  before insert or update of case_id, client_id
  on public.case_tasks
  for each row execute function public.validate_case_task_relationship();

-- La base de datos controla autor y fecha de finalización.
create or replace function public.apply_case_task_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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

drop trigger if exists case_tasks_10_apply_completion on public.case_tasks;
create trigger case_tasks_10_apply_completion
  before insert or update of status, completed_at, completed_by
  on public.case_tasks
  for each row execute function public.apply_case_task_completion();

-- Personal solo puede cambiar estado y observaciones de tareas propias.
create or replace function public.guard_case_task_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if not public.is_staff() or old.assigned_to is distinct from auth.uid() then
    raise exception 'No tienes permiso para modificar esta tarea'
      using errcode = '42501';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.case_id is distinct from old.case_id
     or new.client_id is distinct from old.client_id
     or new.title is distinct from old.title
     or new.priority is distinct from old.priority
     or new.due_date is distinct from old.due_date
     or new.is_all_day is distinct from old.is_all_day
     or new.source is distinct from old.source
     or new.created_by is distinct from old.created_by
     or new.created_by_ai is distinct from old.created_by_ai
     or new.verification_status is distinct from old.verification_status then
    raise exception 'Personal solo puede actualizar estado y observaciones'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists case_tasks_20_guard_update on public.case_tasks;
create trigger case_tasks_20_guard_update
  before update on public.case_tasks
  for each row execute function public.guard_case_task_update();

-- Registra una sola entrada de cronología por cambio importante.
create or replace function public.log_case_task_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_title text;
  v_description text;
begin
  v_case_id := case when tg_op = 'INSERT' then new.case_id else coalesce(new.case_id, old.case_id) end;
  if v_case_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_title := 'Tarea creada: ' || new.title;
    v_description := 'Estado inicial: ' || new.status;
  elsif new.status is distinct from old.status then
    v_title := 'Estado de tarea actualizado: ' || new.title;
    v_description := old.status || ' → ' || new.status;
  elsif new.assigned_to is distinct from old.assigned_to then
    v_title := 'Tarea reasignada: ' || new.title;
    v_description := 'Se actualizó la persona responsable.';
  elsif new.due_date is distinct from old.due_date then
    v_title := 'Tarea reprogramada: ' || new.title;
    v_description := 'Se actualizó el vencimiento.';
  else
    return new;
  end if;

  insert into public.case_events (
    case_id,
    event_type,
    title,
    description,
    event_date,
    verification_status,
    created_by_ai,
    created_by
  )
  values (
    v_case_id,
    'task_update',
    v_title,
    v_description,
    now(),
    'approved',
    false,
    auth.uid()
  );

  return new;
end;
$$;

drop trigger if exists case_tasks_log_event on public.case_tasks;
create trigger case_tasks_log_event
  after insert or update on public.case_tasks
  for each row execute function public.log_case_task_event();

-- Mantiene lectura existente para staff, limita cambios de Personal a sus tareas.
drop policy if exists "case_tasks_select" on public.case_tasks;
drop policy if exists "case_tasks_insert" on public.case_tasks;
drop policy if exists "case_tasks_update" on public.case_tasks;
drop policy if exists "case_tasks_delete" on public.case_tasks;

create policy "case_tasks_select" on public.case_tasks
  for select to authenticated
  using (public.is_staff());

create policy "case_tasks_insert" on public.case_tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_staff()
      and assigned_to = auth.uid()
      and created_by = auth.uid()
    )
  );

create policy "case_tasks_update" on public.case_tasks
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and assigned_to = auth.uid())
  )
  with check (
    public.is_admin()
    or (public.is_staff() and assigned_to = auth.uid())
  );

create policy "case_tasks_delete" on public.case_tasks
  for delete to authenticated
  using (public.is_admin());

commit;
