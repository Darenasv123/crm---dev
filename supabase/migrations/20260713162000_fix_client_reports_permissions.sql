-- Fix client_reports permissions for authenticated staff.
-- Safe to run even if the client_reports table was already created.

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

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.client_reports to authenticated;

drop policy if exists "client_reports_select" on public.client_reports;
drop policy if exists "client_reports_insert" on public.client_reports;
drop policy if exists "client_reports_update" on public.client_reports;
drop policy if exists "client_reports_delete" on public.client_reports;

create policy "client_reports_select" on public.client_reports
  for select using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "client_reports_insert" on public.client_reports
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "client_reports_update" on public.client_reports
  for update using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  )
  with check (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

create policy "client_reports_delete" on public.client_reports
  for delete using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );
