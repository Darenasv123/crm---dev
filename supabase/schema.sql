-- ============================================================
-- CRM Estudio Jurídico Arenas — Schema v2 (limpio y ordenado)
-- Ejecutar completo en Supabase > SQL Editor > New query > Run
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- FUNCIÓN: handle_new_user (trigger de auth)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, initials, role, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(
      new.raw_user_meta_data->>'initials',
      upper(substr(split_part(new.email, '@', 1), 1, 2))
    ),
    coalesce(new.raw_user_meta_data->>'role', 'Personal'),
    nullif(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    initials  = excluded.initials,
    role      = excluded.role,
    phone     = excluded.phone;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- TABLA: profiles
-- ============================================================
create table if not exists public.profiles (
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

drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "Usuarios autenticados pueden leer perfiles" on public.profiles;
drop policy if exists "Solo Administrador puede insertar perfiles" on public.profiles;
drop policy if exists "Solo Administrador puede actualizar perfiles" on public.profiles;

create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() is not null);

create policy "profiles_update" on public.profiles
  for update using (auth.uid() is not null);

-- ============================================================
-- TABLA: clients
-- ============================================================
create table if not exists public.clients (
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
  created_at    timestamptz not null default now()
);

alter table public.clients enable row level security;

drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;
drop policy if exists "Autenticados pueden leer clientes" on public.clients;
drop policy if exists "Autenticados pueden crear clientes" on public.clients;
drop policy if exists "Autenticados pueden actualizar clientes" on public.clients;

create policy "clients_select" on public.clients
  for select using (auth.uid() is not null);

create policy "clients_insert" on public.clients
  for insert with check (auth.uid() is not null);

create policy "clients_update" on public.clients
  for update using (auth.uid() is not null);

create policy "clients_delete" on public.clients
  for delete using (auth.uid() is not null);

-- ============================================================
-- TABLA: cases
-- ============================================================
create table if not exists public.cases (
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
  created_at    timestamptz not null default now()
);

alter table public.cases enable row level security;

drop policy if exists "cases_select" on public.cases;
drop policy if exists "cases_insert" on public.cases;
drop policy if exists "cases_update" on public.cases;
drop policy if exists "cases_delete" on public.cases;
drop policy if exists "Autenticados pueden leer casos" on public.cases;
drop policy if exists "Autenticados pueden crear casos" on public.cases;
drop policy if exists "Autenticados pueden actualizar casos" on public.cases;

create policy "cases_select" on public.cases
  for select using (auth.uid() is not null);

create policy "cases_insert" on public.cases
  for insert with check (auth.uid() is not null);

create policy "cases_update" on public.cases
  for update using (auth.uid() is not null);

create policy "cases_delete" on public.cases
  for delete using (auth.uid() is not null);

-- ============================================================
-- TABLA: payments
-- ============================================================
create table if not exists public.payments (
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

drop policy if exists "payments_select" on public.payments;
drop policy if exists "payments_insert" on public.payments;
drop policy if exists "payments_update" on public.payments;
drop policy if exists "Autenticados pueden leer pagos" on public.payments;
drop policy if exists "Autenticados pueden crear pagos" on public.payments;
drop policy if exists "Autenticados pueden actualizar pagos" on public.payments;

create policy "payments_select" on public.payments
  for select using (auth.uid() is not null);

create policy "payments_insert" on public.payments
  for insert with check (auth.uid() is not null);

create policy "payments_update" on public.payments
  for update using (auth.uid() is not null);

-- ============================================================
-- TABLA: payment_records
-- ============================================================
create table if not exists public.payment_records (
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

drop policy if exists "payment_records_select" on public.payment_records;
drop policy if exists "payment_records_insert" on public.payment_records;
drop policy if exists "Autenticados pueden leer historial" on public.payment_records;
drop policy if exists "Autenticados pueden registrar abonos" on public.payment_records;

create policy "payment_records_select" on public.payment_records
  for select using (auth.uid() is not null);

create policy "payment_records_insert" on public.payment_records
  for insert with check (auth.uid() is not null);

-- ============================================================
-- TABLA: agenda_events
-- ============================================================
create table if not exists public.agenda_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  type        text not null default 'Cita'
    check (type in ('Audiencia','Cita','Recordatorio')),
  event_date  date not null,
  event_time  time not null,
  location    text,
  client_id   uuid references public.clients(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.agenda_events enable row level security;

drop policy if exists "agenda_select" on public.agenda_events;
drop policy if exists "agenda_insert" on public.agenda_events;
drop policy if exists "agenda_update" on public.agenda_events;
drop policy if exists "agenda_delete" on public.agenda_events;
drop policy if exists "Autenticados pueden leer agenda" on public.agenda_events;
drop policy if exists "Autenticados pueden crear eventos" on public.agenda_events;
drop policy if exists "Autenticados pueden actualizar eventos" on public.agenda_events;
drop policy if exists "Autenticados pueden eliminar eventos" on public.agenda_events;

create policy "agenda_select" on public.agenda_events
  for select using (auth.uid() is not null);

create policy "agenda_insert" on public.agenda_events
  for insert with check (auth.uid() is not null);

create policy "agenda_update" on public.agenda_events
  for update using (auth.uid() is not null);

create policy "agenda_delete" on public.agenda_events
  for delete using (auth.uid() is not null);

-- ============================================================
-- TABLA: documents
-- ============================================================
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null,
  size          text not null,
  storage_path  text not null,
  client_id     uuid references public.clients(id) on delete set null,
  case_id       uuid references public.cases(id) on delete set null,
  uploaded_at   date not null default current_date,
  created_at    timestamptz not null default now()
);

alter table public.documents enable row level security;

drop policy if exists "documents_select" on public.documents;
drop policy if exists "documents_insert" on public.documents;
drop policy if exists "documents_delete" on public.documents;
drop policy if exists "Autenticados pueden leer documentos" on public.documents;
drop policy if exists "Autenticados pueden subir documentos" on public.documents;
drop policy if exists "Autenticados pueden eliminar documentos" on public.documents;

create policy "documents_select" on public.documents
  for select using (auth.uid() is not null);

create policy "documents_insert" on public.documents
  for insert with check (auth.uid() is not null);

create policy "documents_delete" on public.documents
  for delete using (auth.uid() is not null);

-- ============================================================
-- STORAGE: bucket de documentos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict do nothing;

drop policy if exists "storage_insert" on storage.objects;
drop policy if exists "storage_select" on storage.objects;
drop policy if exists "storage_delete" on storage.objects;
drop policy if exists "Autenticados pueden subir archivos" on storage.objects;
drop policy if exists "Autenticados pueden leer archivos" on storage.objects;
drop policy if exists "Autenticados pueden eliminar archivos" on storage.objects;

create policy "storage_insert" on storage.objects
  for insert with check (bucket_id = 'documents' and auth.uid() is not null);

create policy "storage_select" on storage.objects
  for select using (bucket_id = 'documents' and auth.uid() is not null);

create policy "storage_delete" on storage.objects
  for delete using (bucket_id = 'documents' and auth.uid() is not null);

-- ============================================================
-- MIGRACIÓN: columna notes en cases (ejecutar si la tabla ya existe)
-- ============================================================
alter table public.cases add column if not exists notes text;

-- ============================================================
-- MIGRACIÓN: columna gcal_event_id en agenda_events
-- Ejecutar en Supabase > SQL Editor
-- ============================================================
alter table public.agenda_events
  add column if not exists gcal_event_id text;
