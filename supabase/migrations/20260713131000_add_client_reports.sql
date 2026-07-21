-- Add shared client/case reports for the CRM.
-- Run in Supabase SQL Editor or with Supabase migrations before deploying the app.

create table if not exists public.client_reports (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  case_id     uuid references public.cases(id) on delete set null,
  author_id   uuid references public.profiles(id) on delete set null,
  category    text not null default 'Reporte'
    check (category in ('Reporte','Noticia','Seguimiento','Alerta','Estado','Observacion')),
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists client_reports_client_id_created_at_idx
  on public.client_reports (client_id, created_at desc);

create index if not exists client_reports_case_id_idx
  on public.client_reports (case_id);

alter table public.client_reports enable row level security;

drop policy if exists "client_reports_select" on public.client_reports;
drop policy if exists "client_reports_insert" on public.client_reports;
drop policy if exists "client_reports_update" on public.client_reports;
drop policy if exists "client_reports_delete" on public.client_reports;

create policy "client_reports_select" on public.client_reports
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('Administrador', 'Personal')
    )
  );

create policy "client_reports_insert" on public.client_reports
  for insert with check (
    (author_id is null or author_id = auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('Administrador', 'Personal')
    )
  );

create policy "client_reports_update" on public.client_reports
  for update using (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Administrador'
    )
  ) with check (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Administrador'
    )
  );

create policy "client_reports_delete" on public.client_reports
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Administrador'
    )
  );
