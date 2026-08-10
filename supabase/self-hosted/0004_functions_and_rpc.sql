-- Canonical functions and RPC for PostgreSQL 17 / Supabase.

begin;

create function public.crm_is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'Activo'
      and p.role in ('Administrador', 'Personal')
  );
$$;

create function public.crm_is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'Activo'
      and p.role = 'Administrador'
  );
$$;

-- Compatibility wrappers for current frontend/RLS names. Authorization logic
-- remains centralized in the two crm_* helpers above.
create function public.is_staff()
returns boolean language sql stable set search_path = ''
as $$ select public.crm_is_active_staff(); $$;

create function public.is_admin()
returns boolean language sql stable set search_path = ''
as $$ select public.crm_is_active_admin(); $$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
begin
  v_full_name := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuario'
  );
  insert into public.profiles (id, full_name, email, phone, role, status, initials)
  values (
    new.id,
    v_full_name,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    'Personal',
    'Activo',
    upper(left(v_full_name, 1))
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        initials = excluded.initials;

  return new;
end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.check_folder_parent_same_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_client uuid;
begin
  if new.parent_id is null then return new; end if;
  select f.client_id into v_parent_client
  from public.document_folders f where f.id = new.parent_id;
  if not found then
    raise exception 'La carpeta padre no existe' using errcode = '23503';
  end if;
  if v_parent_client <> new.client_id then
    raise exception 'La carpeta padre pertenece a otro cliente' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.check_folder_no_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid := new.parent_id;
  v_depth integer := 0;
begin
  while v_current is not null loop
    if v_current = new.id then
      raise exception 'La jerarquía de carpetas no puede contener ciclos'
        using errcode = '23514';
    end if;
    select f.parent_id into v_current
    from public.document_folders f where f.id = v_current;
    exit when not found;
    v_depth := v_depth + 1;
    if v_depth > 50 then
      raise exception 'La jerarquía supera 50 niveles' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create function public.check_document_folder_same_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder_client uuid;
begin
  if new.folder_id is null then return new; end if;
  select f.client_id into v_folder_client
  from public.document_folders f where f.id = new.folder_id;
  if not found then
    raise exception 'La carpeta destino no existe' using errcode = '23503';
  end if;
  if new.client_id is null or v_folder_client <> new.client_id then
    raise exception 'La carpeta destino pertenece a otro cliente' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.validate_document_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case_client_id uuid;
begin
  if new.case_id is null then return new; end if;
  select c.client_id into v_case_client_id from public.cases c where c.id = new.case_id;
  if not found then
    raise exception 'El expediente seleccionado no existe' using errcode = '23503';
  end if;
  if new.client_id is null then
    new.client_id := v_case_client_id;
  elsif new.client_id <> v_case_client_id then
    raise exception 'El expediente no corresponde al cliente' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.audit_document_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
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

create function public.normalize_document_types(p_apply boolean default false)
returns table (
  document_id uuid,
  previous_value text,
  canonical_value text,
  is_known boolean,
  was_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_key text;
  v_canonical text;
begin
  if not public.crm_is_active_admin() then
    raise exception 'Solo un Administrador activo puede normalizar tipos documentales'
      using errcode = '42501';
  end if;
  for v_row in
    select d.id, d.type, d.document_type,
           coalesce(nullif(d.document_type, ''), d.type) as current_value
    from public.documents d order by d.uploaded_at, d.id
  loop
    v_key := lower(translate(trim(coalesce(v_row.current_value, '')),
      'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
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
    if p_apply and is_known and
       (v_row.type is distinct from v_canonical or v_row.document_type is distinct from v_canonical) then
      update public.documents d
      set type = v_canonical, document_type = v_canonical
      where d.id = v_row.id;
      was_applied := true;
    end if;
    return next;
  end loop;
end;
$$;

create function public.validate_case_task_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case_client_id uuid;
begin
  if new.case_id is null then return new; end if;
  select c.client_id into v_case_client_id from public.cases c where c.id = new.case_id;
  if not found then
    raise exception 'El expediente seleccionado no existe' using errcode = '23503';
  end if;
  if new.client_id is null then
    new.client_id := v_case_client_id;
  elsif new.client_id <> v_case_client_id then
    raise exception 'El cliente no corresponde al expediente' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.apply_case_task_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'in_progress'
     and (tg_op = 'INSERT' or old.status is distinct from 'in_progress') then
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

create function public.guard_case_task_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_for is distinct from old.scheduled_for
     and not public.crm_is_active_admin() then
    raise exception 'Solo el Administrador puede reprogramar la tarea'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.guard_case_task_update()
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

create function public.audit_case_task_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.status is distinct from old.status then
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
  end if;
  if new.scheduled_for is distinct from old.scheduled_for then
    v_changes := v_changes || jsonb_build_object('scheduled_for', jsonb_build_array(old.scheduled_for, new.scheduled_for));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    v_changes := v_changes || jsonb_build_object('assigned_to', jsonb_build_array(old.assigned_to, new.assigned_to));
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

create function public.log_case_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_description text;
begin
  if new.case_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_title := 'Tarea creada: ' || new.title;
    v_description := 'Estado inicial: ' || new.status;
  elsif new.assigned_to is distinct from old.assigned_to then
    v_title := case
      when old.assigned_to is null then 'Tarea tomada: '
      when new.assigned_to is null then 'Tarea devuelta: '
      else 'Tarea reasignada: '
    end || new.title;
    v_description := 'Cambio de responsable de tarea.';
  elsif new.status is distinct from old.status then
    v_title := 'Estado de tarea actualizado: ' || new.title;
    v_description := old.status || ' → ' || new.status;
  else
    return new;
  end if;
  insert into public.case_events (
    case_id, event_type, title, description, event_date,
    verification_status, created_by_ai, created_by
  ) values (
    new.case_id, 'task_update', v_title, v_description, current_date,
    'approved', false, auth.uid()
  );
  return new;
end;
$$;

create function public.claim_case_task(p_task_id uuid)
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

create function public.return_case_task(p_task_id uuid)
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

create function public.register_payment_record_atomic(
  p_payment_id uuid,
  p_amount numeric,
  p_method text,
  p_receipt text default null,
  p_notes text default null,
  p_payment_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_updated public.payments%rowtype;
  v_record public.payment_records%rowtype;
  v_new_paid numeric;
begin
  if not public.crm_is_active_admin() then
    raise exception 'Solo un Administrador activo puede registrar pagos' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe debe ser mayor que cero' using errcode = '22023';
  end if;
  if p_method is null or btrim(p_method) = '' then
    raise exception 'El método de pago es obligatorio' using errcode = '22023';
  end if;
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found then raise exception 'El plan de pago no existe' using errcode = 'P0002'; end if;
  v_new_paid := v_payment.paid + p_amount;
  if v_new_paid > v_payment.fees then
    raise exception 'El importe supera el saldo pendiente' using errcode = '22003';
  end if;
  insert into public.payment_records (payment_id, amount, method, receipt, notes, payment_date)
  values (
    p_payment_id, p_amount, btrim(p_method), nullif(btrim(p_receipt), ''),
    nullif(btrim(p_notes), ''), coalesce(p_payment_date, current_date)
  ) returning * into v_record;
  update public.payments p
  set paid = v_new_paid,
      paid_installments = least(p.paid_installments + 1, p.total_installments),
      status = case when v_new_paid = p.fees then 'Pagado' else 'Parcial' end
  where p.id = p_payment_id returning * into v_updated;
  return jsonb_build_object('payment', to_jsonb(v_updated), 'record', to_jsonb(v_record));
end;
$$;

commit;
