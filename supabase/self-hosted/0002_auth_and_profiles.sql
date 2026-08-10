-- Canonical profile model. Auth functions and trigger are created in 0004/0005
-- after all dependencies exist.

begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  role text not null default 'Personal',
  status text not null default 'Activo',
  initials text not null,
  created_at timestamptz not null default now(),
  constraint profiles_role_check
    check (role in ('Administrador', 'Personal')),
  constraint profiles_status_check
    check (status in ('Activo', 'Inactivo'))
);

comment on table public.profiles is
  'CRM authorization profile linked one-to-one to auth.users.';
comment on column public.profiles.role is
  'Authorization field. Never sourced from user-controlled signup metadata.';
comment on column public.profiles.status is
  'Authorization field. Only an active Administrador may change it through the CRM.';

commit;
