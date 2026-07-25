-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Restringir acceso a pagos solo al rol Administrador
--
-- Problema detectado: la política payments_select anterior permitía que el
-- rol 'Personal' leyera filas de la tabla payments.  Esto contradice el
-- modelo de permisos del CRM donde el módulo de Pagos es exclusivo del
-- Administrador.
--
-- Esta migración reemplaza únicamente las políticas de payments y
-- payment_records; no toca ninguna otra tabla ni elimina RLS.
--
-- Valores de rol reales (public.profiles.role):
--   'Administrador' — acceso completo a pagos
--   'Personal'      — sin acceso a pagos (SELECT, INSERT, UPDATE, DELETE)
--
-- Puede revisarse antes de ejecutarse remotamente.  No es destructiva para
-- los datos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── payments ─────────────────────────────────────────────────────────────────

-- Eliminar políticas anteriores
drop policy if exists "payments_select" on public.payments;
drop policy if exists "payments_insert" on public.payments;
drop policy if exists "payments_update" on public.payments;
drop policy if exists "payments_delete" on public.payments;

-- SELECT: solo Administrador activo
create policy "payments_select" on public.payments
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- INSERT: solo Administrador activo
create policy "payments_insert" on public.payments
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- UPDATE: solo Administrador activo
create policy "payments_update" on public.payments
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- DELETE: solo Administrador activo
create policy "payments_delete" on public.payments
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- ── payment_records ───────────────────────────────────────────────────────────

-- Eliminar políticas anteriores
drop policy if exists "payment_records_select" on public.payment_records;
drop policy if exists "payment_records_insert" on public.payment_records;
drop policy if exists "payment_records_update" on public.payment_records;
drop policy if exists "payment_records_delete" on public.payment_records;

-- SELECT: solo Administrador activo
create policy "payment_records_select" on public.payment_records
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- INSERT: solo Administrador activo
create policy "payment_records_insert" on public.payment_records
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- UPDATE: solo Administrador activo
create policy "payment_records_update" on public.payment_records
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- DELETE: solo Administrador activo
create policy "payment_records_delete" on public.payment_records
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación rápida (comentada para ejecución manual):
-- select policyname, cmd, qual from pg_policies
--   where tablename in ('payments', 'payment_records');
-- ─────────────────────────────────────────────────────────────────────────────
