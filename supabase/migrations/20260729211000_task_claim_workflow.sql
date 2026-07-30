-- Fase 4.3: cola de trabajo voluntaria con reclamación atómica.
-- No aplicar remotamente durante la fase de implementación local.

begin;

alter table public.case_tasks
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid
    references public.profiles(id) on delete set null;

create index if not exists case_tasks_available_idx
  on public.case_tasks (priority, created_at)
  where assigned_to is null and status = 'pending';
create index if not exists case_tasks_claimed_by_idx
  on public.case_tasks (claimed_by)
  where claimed_by is not null;

comment on column public.case_tasks.claimed_at is
  'Fecha en que un integrante tomó la tarea disponible.';
comment on column public.case_tasks.claimed_by is
  'Usuario autenticado que tomó la tarea; se limpia al devolverla.';

-- Personal solo cambia estado/observaciones de tareas propias. Las transiciones
-- de asignación se realizan mediante las RPC definidas más abajo.
create or replace function public.guard_case_task_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if not public.is_staff() then
    raise exception 'No tienes permiso para modificar esta tarea'
      using errcode = '42501';
  end if;

  -- Reclamación ejecutada por claim_case_task.
  if old.assigned_to is null
     and old.status = 'pending'
     and new.assigned_to = auth.uid()
     and new.claimed_by = auth.uid()
     and new.claimed_at is not null
     and new.status = 'in_progress' then
    return new;
  end if;

  -- Devolución de una tarea propia a la cola.
  if old.assigned_to = auth.uid()
     and new.assigned_to is null
     and new.claimed_by is null
     and new.claimed_at is null
     and new.status = 'pending' then
    return new;
  end if;

  if old.assigned_to is distinct from auth.uid() then
    raise exception 'Solo puedes modificar una tarea que hayas tomado'
      using errcode = '42501';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.claimed_at is distinct from old.claimed_at
     or new.claimed_by is distinct from old.claimed_by
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

-- Sustituye el auditor histórico basado en vencimientos. Conserva únicamente
-- cambios vigentes de estado y asignación en la cronología del expediente.
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
  elsif new.assigned_to is distinct from old.assigned_to then
    if old.assigned_to is null then
      v_title := 'Tarea tomada: ' || new.title;
      v_description := 'La tarea salió de Disponibles.';
    elsif new.assigned_to is null then
      v_title := 'Tarea devuelta: ' || new.title;
      v_description := 'La tarea volvió a Disponibles.';
    else
      v_title := 'Tarea reasignada: ' || new.title;
      v_description := 'Se actualizó la persona responsable.';
    end if;
  elsif new.status is distinct from old.status then
    v_title := 'Estado de tarea actualizado: ' || new.title;
    v_description := old.status || ' → ' || new.status;
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

create or replace function public.claim_case_task(p_task_id uuid)
returns setof public.case_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.case_tasks%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Debes ser un integrante activo para tomar tareas'
      using errcode = '42501';
  end if;

  select *
    into v_task
    from public.case_tasks
   where id = p_task_id
   for update;

  if not found then
    raise exception 'La tarea no existe' using errcode = 'P0002';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'Una tarea terminada no puede ser tomada' using errcode = 'P0001';
  end if;
  if v_task.assigned_to is not null or v_task.status <> 'pending' then
    raise exception 'Esta tarea acaba de ser tomada por otro integrante.'
      using errcode = 'P0001';
  end if;

  return query
  update public.case_tasks
     set assigned_to = auth.uid(),
         claimed_by = auth.uid(),
         claimed_at = now(),
         status = 'in_progress',
         updated_at = now()
   where id = p_task_id
     and assigned_to is null
     and status = 'pending'
  returning *;

  if not found then
    raise exception 'Esta tarea acaba de ser tomada por otro integrante.'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.return_case_task(p_task_id uuid)
returns setof public.case_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Debes ser un integrante activo para devolver tareas'
      using errcode = '42501';
  end if;

  return query
  update public.case_tasks
     set assigned_to = null,
         claimed_by = null,
         claimed_at = null,
         status = 'pending',
         completed_at = null,
         completed_by = null,
         updated_at = now()
   where id = p_task_id
     and assigned_to = auth.uid()
     and status not in ('completed', 'cancelled')
  returning *;

  if not found then
    raise exception 'Solo puedes devolver una tarea activa que hayas tomado'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.claim_case_task(uuid) from public, anon;
revoke execute on function public.return_case_task(uuid) from public, anon;
grant execute on function public.claim_case_task(uuid) to authenticated;
grant execute on function public.return_case_task(uuid) to authenticated;

drop policy if exists "case_tasks_insert" on public.case_tasks;
create policy "case_tasks_insert" on public.case_tasks
  for insert to authenticated
  with check (
    public.is_admin()
    and assigned_to is null
    and claimed_at is null
    and claimed_by is null
    and status = 'pending'
  );

drop policy if exists "case_tasks_update" on public.case_tasks;
create policy "case_tasks_update" on public.case_tasks
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and assigned_to = auth.uid())
  )
  with check (
    public.is_admin()
    or (public.is_staff() and (assigned_to = auth.uid() or assigned_to is null))
  );

commit;
