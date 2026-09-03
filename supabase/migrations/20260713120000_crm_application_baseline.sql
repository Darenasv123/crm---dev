-- T0-CANONICAL application baseline.
--
-- Recovered and approved through server-release/docs/
-- GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md, Sections 44-46 (Fases
-- 8I-B2B-0B2B-R / R1 / R2). Read those sections before modifying this
-- file — every clause below is traceable to a specific piece of
-- evidence documented there.
--
-- Purpose: the historical migration chain (20260713131000 onward)
-- assumes public.profiles/clients/cases/payments/payment_records/
-- agenda_events/documents already exist. No file in supabase/migrations/
-- ever creates them. This migration recreates their T0 shape — the
-- state immediately BEFORE 20260713131000 — so a FRESH database (empty
-- Hosted project, fresh self-hosted install, disposable CI database) can
-- run the full 34-migration chain unmodified.
--
-- Sources, by evidence tier (see runbook Section 46.F for the full
-- ledger):
--   DIRECT_GIT  — git show 4668d4163c3c0f5b0d4cc14a6e511ee378b77976:
--                 supabase/schema.sql (2026-06-30, the oldest SQL
--                 artifact in this repository's history, unmodified
--                 until 2026-07-21 — i.e. unchanged through the T0
--                 boundary of 2026-07-13).
--   DERIVED     — required by forward-replay collision analysis
--                 (runbook Section 46.J): a field absent from the
--                 2026-06-30 snapshot but proven necessary for a later
--                 tracked migration to apply without error. Every such
--                 field is marked "T0-CANONICAL replay compatibility
--                 field" in a comment at its declaration — none are
--                 claimed as pure historical T0 facts.
--
-- Explicitly NOT reproduced from the historical T0 snapshot: the
-- original handle_new_user() function read `role` directly from
-- user-controlled auth metadata (raw_user_meta_data->>'role'), a
-- privilege-escalation defect documented in
-- audit/self-hosted-migration/cloud-vs-repository.md and confirmed
-- present in the T0 source itself (runbook Section 46.F). Per the
-- explicit, human-approved decision recorded in runbook Section 46.Y,
-- this migration installs the hardened implementation already tracked
-- in supabase/self-hosted/0004_functions_and_rpc.sql and
-- supabase/self-hosted/0005_triggers.sql instead — copied verbatim, not
-- rewritten from memory. That implementation never reads role/status
-- from metadata.
--
-- This migration does not create or alter auth.users, storage.objects,
-- storage.buckets, or any other Supabase-platform-managed schema. It
-- only references auth.users (a foreign key, and one application
-- trigger attached to it) — both patterns Supabase Hosted supports on
-- any project from creation. It does not provision the "documents"
-- Storage bucket; that remains a separate post-schema step (runbook
-- Section 46.R).
--
-- FRESH-only contract: this migration is not a general-purpose
-- upgrade/reconciliation tool. It refuses to run — RAISE EXCEPTION,
-- whole transaction rolled back — against any database where some or
-- all of the seven core tables already exist (production included).
-- CREATE TABLE IF NOT EXISTS is deliberately NOT used as the safety
-- mechanism here; the explicit precondition check below is. An
-- already-migrated or partially-migrated database must be brought to
-- parity through the migration-history adoption path (a narrow,
-- human-authorized `supabase migration repair`, per runbook Section
-- 46.O), never by executing this file against it.

begin;

-- ============================================================
-- 1. Tri-state precondition (fail-closed)
-- ============================================================
-- FRESH   (0 of 7 core tables exist)  -> continue.
-- EXISTING (7 of 7 exist)             -> abort, no DDL applied.
-- PARTIAL (1-6 exist)                 -> abort, no DDL applied.
do $$
declare
  v_existing int := 0;
begin
  if to_regclass('public.profiles') is not null then v_existing := v_existing + 1; end if;
  if to_regclass('public.clients') is not null then v_existing := v_existing + 1; end if;
  if to_regclass('public.cases') is not null then v_existing := v_existing + 1; end if;
  if to_regclass('public.payments') is not null then v_existing := v_existing + 1; end if;
  if to_regclass('public.payment_records') is not null then v_existing := v_existing + 1; end if;
  if to_regclass('public.agenda_events') is not null then v_existing := v_existing + 1; end if;
  if to_regclass('public.documents') is not null then v_existing := v_existing + 1; end if;

  if v_existing = 7 then
    raise exception
      'crm_application_baseline: precondition EXISTING (7/7 core application tables already present). This migration is FRESH-only and refuses to run against an already-provisioned schema. Use the migration-history adoption path instead of executing this file.'
      using errcode = '55000';
  elsif v_existing between 1 and 6 then
    raise exception
      'crm_application_baseline: precondition PARTIAL (% of 7 core application tables present). Refusing to continue — this indicates an interrupted bootstrap or a manually altered environment, and must be resolved by manual inspection before any migration is retried.',
      v_existing
      using errcode = '55000';
  end if;
  -- v_existing = 0 -> FRESH, fall through and continue the transaction.
end;
$$;

-- ============================================================
-- 2. Extensions
-- ============================================================
-- Present in the T0 snapshot itself (schema.sql, 2026-06-30, line 9).
-- gen_random_uuid() has been core PostgreSQL since v13, but the
-- extension is declared exactly as the historical source declared it.
create extension if not exists "pgcrypto";

-- ============================================================
-- 3. public.profiles  (DIRECT_GIT: schema.sql 2026-06-30, lines 52-63)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  phone       text,
  role        text not null default 'Personal'
    check (role in ('Administrador', 'Personal')),
  status      text not null default 'Activo'
    check (status in ('Activo', 'Inactivo')),
  initials    text not null,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- T0 policies (DIRECT_GIT): permissive, no role distinction. Any
-- authenticated user may read/insert/update any profile row. This is
-- the same historical shape already documented as a known privilege
-- risk (audit/self-hosted-migration/cloud-vs-repository.md). It is
-- reproduced here deliberately, unmodified, because 20260713150000
-- (the very next migration) replaces these exact policies with
-- role-gated ones — hardening RLS is that migration's job, not this
-- baseline's. Do not harden these policies here.
create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() is not null);

create policy "profiles_update" on public.profiles
  for update using (auth.uid() is not null);

-- ============================================================
-- 4. public.clients  (DIRECT_GIT: schema.sql 2026-06-30, lines 86-102)
-- ============================================================
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  initials      text not null,
  color         text not null default 'oklch(0.55 0.13 235)',
  dni           text not null,
  phone         text not null,
  email         text,
  address       text,
  birthdate     date,
  civil_status  text,
  process_type  text not null,
  status        text not null default 'Activo'
    check (status in ('Activo', 'En espera', 'Cerrado')),
  registered_at date not null default current_date,
  created_at    timestamptz not null default now(),
  -- T0-CANONICAL replay compatibility field (runbook Section 46.J):
  -- absent from the 2026-06-30 snapshot, but 20260721090000_legal_
  -- case_foundation.sql creates a BEFORE UPDATE trigger
  -- (clients_set_updated_at) that assigns NEW.updated_at — a verified
  -- 42703 (undefined_column) collision without this column.
  updated_at    timestamptz not null default now()
);

alter table public.clients enable row level security;

-- T0 policies (DIRECT_GIT): permissive, no role distinction — same
-- rationale as profiles above. 20260713150000 replaces these.
create policy "clients_select" on public.clients
  for select using (auth.uid() is not null);

create policy "clients_insert" on public.clients
  for insert with check (auth.uid() is not null);

create policy "clients_update" on public.clients
  for update using (auth.uid() is not null);

create policy "clients_delete" on public.clients
  for delete using (auth.uid() is not null);

-- ============================================================
-- 5. public.cases  (DIRECT_GIT: schema.sql 2026-06-30, lines 129-147)
-- ============================================================
create table public.cases (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  expediente    text not null,
  process_type  text not null,
  priority      text not null default 'Media'
    check (priority in ('Alta', 'Media', 'Baja')),
  next_hearing  timestamptz,
  status        text not null default 'Consulta'
    check (status in (
      'Consulta','Documentación','Demanda presentada',
      'En proceso','Audiencia','Sentencia','Archivado'
    )),
  juzgado       text not null,
  demandante    text,
  demandado     text,
  notes         text,
  created_at    timestamptz not null default now(),
  -- T0-CANONICAL replay compatibility field — see clients.updated_at
  -- comment above; same collision, same migration (20260721090000),
  -- same trigger family (cases_set_updated_at).
  updated_at    timestamptz not null default now()
);

alter table public.cases enable row level security;

-- T0 policies (DIRECT_GIT): permissive, no role distinction.
-- 20260713150000 replaces these.
create policy "cases_select" on public.cases
  for select using (auth.uid() is not null);

create policy "cases_insert" on public.cases
  for insert with check (auth.uid() is not null);

create policy "cases_update" on public.cases
  for update using (auth.uid() is not null);

create policy "cases_delete" on public.cases
  for delete using (auth.uid() is not null);

-- ============================================================
-- 6. public.payments  (DIRECT_GIT: schema.sql 2026-06-30, lines 174-185)
-- ============================================================
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  service             text not null,
  fees                numeric(12,2) not null,
  paid                numeric(12,2) not null default 0,
  total_installments  int not null default 1,
  paid_installments   int not null default 0,
  status              text not null default 'Pendiente'
    check (status in ('Pagado','Parcial','Pendiente','Vencido')),
  created_at          timestamptz not null default now()
);

alter table public.payments enable row level security;

-- T0 policies (DIRECT_GIT): select/insert/update only — there is no
-- payments_delete policy in the T0 snapshot. Not added here.
create policy "payments_select" on public.payments
  for select using (auth.uid() is not null);

create policy "payments_insert" on public.payments
  for insert with check (auth.uid() is not null);

create policy "payments_update" on public.payments
  for update using (auth.uid() is not null);

-- ============================================================
-- 7. public.payment_records  (DIRECT_GIT: schema.sql 2026-06-30, lines 208-217)
-- ============================================================
create table public.payment_records (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payments(id) on delete cascade,
  amount       numeric(12,2) not null,
  method       text not null,
  receipt      text,
  notes        text,
  payment_date date not null default current_date,
  created_at   timestamptz not null default now()
);

alter table public.payment_records enable row level security;

-- T0 policies (DIRECT_GIT): select/insert only — no update/delete
-- policy exists in the T0 snapshot. Not added here.
create policy "payment_records_select" on public.payment_records
  for select using (auth.uid() is not null);

create policy "payment_records_insert" on public.payment_records
  for insert with check (auth.uid() is not null);

-- ============================================================
-- 8. public.agenda_events  (DIRECT_GIT: schema.sql 2026-06-30,
--    lines 235-245 + 331-336)
-- ============================================================
create table public.agenda_events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  type          text not null default 'Cita'
    check (type in ('Audiencia','Cita','Recordatorio')),
  event_date    date not null,
  event_time    time not null,
  location      text,
  client_id     uuid references public.clients(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Present in T0 itself (a patch already folded into the 2026-06-30
  -- snapshot, lines 331-336 of the source file) — not a replay
  -- compatibility addition.
  gcal_event_id text
);

alter table public.agenda_events enable row level security;

-- T0 policies (DIRECT_GIT): permissive, no role distinction.
-- 20260713150000 replaces these (and adds case_id + its index).
create policy "agenda_select" on public.agenda_events
  for select using (auth.uid() is not null);

create policy "agenda_insert" on public.agenda_events
  for insert with check (auth.uid() is not null);

create policy "agenda_update" on public.agenda_events
  for update using (auth.uid() is not null);

create policy "agenda_delete" on public.agenda_events
  for delete using (auth.uid() is not null);

-- ============================================================
-- 9. public.documents  (DIRECT_GIT: schema.sql 2026-06-30, lines 273-283)
-- ============================================================
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null,
  size          text not null,
  storage_path  text not null,
  client_id     uuid references public.clients(id) on delete set null,
  case_id       uuid references public.cases(id) on delete set null,
  uploaded_at   date not null default current_date,
  created_at    timestamptz not null default now(),
  -- T0-CANONICAL replay compatibility field — see clients.updated_at
  -- comment above; same collision, same migration (20260721090000),
  -- same trigger family (documents_set_updated_at).
  updated_at    timestamptz not null default now()
);

alter table public.documents enable row level security;

-- T0 policies (DIRECT_GIT): select/insert/delete only — there is no
-- documents_update policy in the T0 snapshot. Not added here.
create policy "documents_select" on public.documents
  for select using (auth.uid() is not null);

create policy "documents_insert" on public.documents
  for insert with check (auth.uid() is not null);

create policy "documents_delete" on public.documents
  for delete using (auth.uid() is not null);

-- ============================================================
-- 10. Grants
-- ============================================================
-- No explicit GRANT/REVOKE statements are included. The T0 snapshot
-- itself contains none for these seven tables (its only grant-related
-- statement is `revoke execute on function public.handle_new_user()`,
-- reproduced below with the function). Runbook Section 46.F classifies
-- reliance on Supabase's default privileges for postgres-owned objects
-- as SECONDARY_AUDIT evidence, not DIRECT_GIT — per Section 9 of this
-- phase's instructions, that evidence is not strong enough to justify
-- writing explicit GRANT statements here, and omitting them does not
-- weaken anything the 34 tracked migrations depend on: the first grant
-- statements in the historical chain (20260721130000_grant_table_
-- permissions.sql, 20260721140000_revoke_anon_write_permissions.sql)
-- run later and establish grants explicitly themselves.

-- ============================================================
-- 11. Hardened auth provisioning
-- ============================================================
-- Copied verbatim from supabase/self-hosted/0004_functions_and_rpc.sql
-- (function) and supabase/self-hosted/0005_triggers.sql (trigger) per
-- the explicit decision in runbook Section 46.Y: the historical T0
-- version of this function read `role` from user-controlled
-- raw_user_meta_data and is NOT reproduced. This implementation never
-- reads role or status from metadata — every new profile is created
-- with role='Personal', status='Activo', unconditionally.
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

commit;
