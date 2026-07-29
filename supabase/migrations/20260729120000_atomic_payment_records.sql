begin;

create or replace function public.register_payment_record_atomic(
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
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_updated_payment public.payments%rowtype;
  v_payment_record public.payment_records%rowtype;
  v_new_paid numeric;
  v_new_paid_installments integer;
  v_new_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'Administrador'
      and status = 'Activo'
  ) then
    raise exception 'Only active administrators can register payments'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero'
      using errcode = '22023';
  end if;

  if p_method is null or btrim(p_method) = '' then
    raise exception 'Payment method is required'
      using errcode = '22023';
  end if;

  select *
    into v_payment
    from public.payments
   where id = p_payment_id
   for update;

  if not found then
    raise exception 'Payment plan was not found'
      using errcode = 'P0002';
  end if;

  v_new_paid := coalesce(v_payment.paid, 0) + p_amount;

  if v_new_paid > v_payment.fees then
    raise exception 'Payment amount exceeds the outstanding balance'
      using errcode = '22003';
  end if;

  v_new_paid_installments := least(
    coalesce(v_payment.paid_installments, 0) + 1,
    v_payment.total_installments
  );

  v_new_status := case
    when v_new_paid = v_payment.fees then 'Pagado'
    else 'Parcial'
  end;

  insert into public.payment_records (
    payment_id,
    amount,
    method,
    receipt,
    notes,
    payment_date
  )
  values (
    p_payment_id,
    p_amount,
    btrim(p_method),
    nullif(btrim(p_receipt), ''),
    nullif(btrim(p_notes), ''),
    coalesce(p_payment_date, current_date)
  )
  returning * into v_payment_record;

  update public.payments
     set paid = v_new_paid,
         paid_installments = v_new_paid_installments,
         status = v_new_status
   where id = p_payment_id
  returning * into v_updated_payment;

  return jsonb_build_object(
    'payment', to_jsonb(v_updated_payment),
    'record', to_jsonb(v_payment_record)
  );
end;
$$;

revoke all on function public.register_payment_record_atomic(
  uuid, numeric, text, text, text, date
) from public;
revoke all on function public.register_payment_record_atomic(
  uuid, numeric, text, text, text, date
) from anon;
revoke all on function public.register_payment_record_atomic(
  uuid, numeric, text, text, text, date
) from authenticated;

grant execute on function public.register_payment_record_atomic(
  uuid, numeric, text, text, text, date
) to authenticated;

comment on function public.register_payment_record_atomic(
  uuid, numeric, text, text, text, date
) is
  'Atomically registers a payment record and updates its payment plan. Restricted to active administrators.';

commit;
