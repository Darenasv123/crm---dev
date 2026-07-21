-- Usability/security update:
-- - Link agenda events to a specific case.
-- - Recreate RLS policies without depending on helper functions such as public.is_staff().
-- Run after 20260713131000_add_client_reports.sql.

alter table public.agenda_events
  add column if not exists case_id uuid references public.cases(id) on delete set null;

create index if not exists agenda_events_case_id_idx
  on public.agenda_events (case_id);

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.cases enable row level security;
alter table public.payments enable row level security;
alter table public.payment_records enable row level security;
alter table public.agenda_events enable row level security;
alter table public.documents enable row level security;
alter table public.client_reports enable row level security;

-- Profiles: keep profile reads available to authenticated users so role checks on other
-- tables can resolve without recursive profile policies.
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;

create policy "profiles_select" on public.profiles
  for select using (auth.uid() is not null);

create policy "profiles_insert" on public.profiles
  for insert with check (auth.uid() is not null);

create policy "profiles_update" on public.profiles
  for update using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Clients
drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;

create policy "clients_select" on public.clients
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "clients_insert" on public.clients
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "clients_update" on public.clients
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "clients_delete" on public.clients
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- Cases
drop policy if exists "cases_select" on public.cases;
drop policy if exists "cases_insert" on public.cases;
drop policy if exists "cases_update" on public.cases;
drop policy if exists "cases_delete" on public.cases;

create policy "cases_select" on public.cases
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "cases_insert" on public.cases
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "cases_update" on public.cases
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "cases_delete" on public.cases
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- Payments
drop policy if exists "payments_select" on public.payments;
drop policy if exists "payments_insert" on public.payments;
drop policy if exists "payments_update" on public.payments;

create policy "payments_select" on public.payments
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "payments_insert" on public.payments
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

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

drop policy if exists "payment_records_select" on public.payment_records;
drop policy if exists "payment_records_insert" on public.payment_records;

create policy "payment_records_select" on public.payment_records
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

create policy "payment_records_insert" on public.payment_records
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- Agenda
drop policy if exists "agenda_select" on public.agenda_events;
drop policy if exists "agenda_insert" on public.agenda_events;
drop policy if exists "agenda_update" on public.agenda_events;
drop policy if exists "agenda_delete" on public.agenda_events;

create policy "agenda_select" on public.agenda_events
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "agenda_insert" on public.agenda_events
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "agenda_update" on public.agenda_events
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "agenda_delete" on public.agenda_events
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

-- Documents metadata
drop policy if exists "documents_select" on public.documents;
drop policy if exists "documents_insert" on public.documents;
drop policy if exists "documents_delete" on public.documents;

create policy "documents_select" on public.documents
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "documents_insert" on public.documents
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "documents_delete" on public.documents
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- Reports
drop policy if exists "client_reports_select" on public.client_reports;
drop policy if exists "client_reports_insert" on public.client_reports;
drop policy if exists "client_reports_update" on public.client_reports;
drop policy if exists "client_reports_delete" on public.client_reports;

create policy "client_reports_select" on public.client_reports
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "client_reports_insert" on public.client_reports
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "client_reports_update" on public.client_reports
  for update using (
    author_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  )
  with check (
    author_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

create policy "client_reports_delete" on public.client_reports
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- Storage documents bucket
drop policy if exists "storage_insert" on storage.objects;
drop policy if exists "storage_select" on storage.objects;
drop policy if exists "storage_delete" on storage.objects;

create policy "storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "storage_select" on storage.objects
  for select using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "storage_delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );
