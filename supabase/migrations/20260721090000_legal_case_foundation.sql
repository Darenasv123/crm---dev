-- CRM juridico - base de expedientes, trazabilidad e importacion asistida.
-- Migracion aditiva: no elimina ni renombra tablas o columnas existentes.

begin;

create extension if not exists "pgcrypto";

-- Estas funciones se declaran aqui para que la migracion sea autosuficiente.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'Administrador'
      and p.status = 'Activo'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('Administrador', 'Personal')
      and p.status = 'Activo'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Compatibilidad: se conservan name/dni, expediente/process_type/juzgado y name/type/size.
alter table public.clients add column if not exists document_type text not null default 'DNI';
alter table public.clients add column if not exists document_number text;
alter table public.clients add column if not exists whatsapp text;
alter table public.clients add column if not exists occupation text;
alter table public.clients add column if not exists notes text;
alter table public.clients add column if not exists updated_at timestamptz not null default now();
alter table public.clients add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.clients
set document_number = nullif(dni, '')
where document_number is null;

update public.clients
set whatsapp = nullif(phone, '')
where whatsapp is null;

alter table public.cases add column if not exists internal_code text;
alter table public.cases add column if not exists case_name text;
alter table public.cases add column if not exists case_type text;
alter table public.cases add column if not exists legal_area text;
alter table public.cases add column if not exists case_stage text;
alter table public.cases add column if not exists court text;
alter table public.cases add column if not exists judicial_district text;
alter table public.cases add column if not exists case_number text;
alter table public.cases add column if not exists case_year integer;
alter table public.cases add column if not exists judge_or_prosecutor text;
alter table public.cases add column if not exists filing_date date;
alter table public.cases add column if not exists closing_date date;
alter table public.cases add column if not exists current_summary text;
alter table public.cases add column if not exists current_status_description text;
alter table public.cases add column if not exists last_action_date date;
alter table public.cases add column if not exists next_action text;
alter table public.cases add column if not exists responsible_user_id uuid references public.profiles(id) on delete set null;
alter table public.cases add column if not exists updated_at timestamptz not null default now();
alter table public.cases add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.cases
set internal_code = coalesce(nullif(expediente, ''), 'EXP-' || upper(left(id::text, 8))),
    case_name = coalesce(case_name, process_type),
    case_type = coalesce(case_type, process_type),
    court = coalesce(court, juzgado),
    case_number = coalesce(case_number, expediente),
    current_summary = coalesce(current_summary, notes)
where internal_code is null
   or case_name is null
   or case_type is null
   or court is null
   or case_number is null
   or (current_summary is null and notes is not null);

alter table public.payments add column if not exists case_id uuid references public.cases(id) on delete set null;

alter table public.documents add column if not exists original_name text;
alter table public.documents add column if not exists display_name text;
alter table public.documents add column if not exists document_type text;
alter table public.documents add column if not exists mime_type text;
alter table public.documents add column if not exists source_type text not null default 'supabase_storage';
alter table public.documents add column if not exists source_provider text;
alter table public.documents add column if not exists external_file_id text;
alter table public.documents add column if not exists external_folder_id text;
alter table public.documents add column if not exists external_url text;
alter table public.documents add column if not exists document_date date;
alter table public.documents add column if not exists file_size bigint;
alter table public.documents add column if not exists checksum text;
alter table public.documents add column if not exists processing_status text not null default 'pending';
alter table public.documents add column if not exists verification_status text not null default 'pending';
alter table public.documents add column if not exists is_confidential boolean not null default false;
alter table public.documents add column if not exists updated_at timestamptz not null default now();
alter table public.documents add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.documents
set original_name = coalesce(original_name, name),
    display_name = coalesce(display_name, name),
    document_type = coalesce(document_type, type)
where original_name is null or display_name is null or document_type is null;

create table if not exists public.case_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  full_name text not null,
  document_type text,
  document_number text,
  role text not null,
  relationship text,
  phone text,
  email text,
  address text,
  is_minor boolean not null default false,
  birth_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  extraction_method text not null,
  raw_text text,
  structured_data jsonb not null default '{}'::jsonb,
  language text,
  page_count integer,
  ocr_used boolean not null default false,
  model_name text,
  processing_duration_ms integer,
  confidence_score numeric(5,4),
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  constraint document_extractions_confidence_check
    check (confidence_score is null or confidence_score between 0 and 1)
);

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  event_type text not null,
  title text not null,
  description text,
  event_date date not null,
  source_page integer,
  source_excerpt text,
  confidence_score numeric(5,4),
  verification_status text not null default 'approved',
  created_by_ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  constraint case_events_confidence_check
    check (confidence_score is null or confidence_score between 0 and 1),
  constraint case_events_verification_check
    check (verification_status in ('pending', 'approved', 'edited', 'rejected', 'conflict'))
);

create table if not exists public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'Media',
  status text not null default 'pending',
  due_date timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  source text not null default 'manual',
  created_by_ai boolean not null default false,
  verification_status text not null default 'approved',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint case_tasks_priority_check check (priority in ('Alta', 'Media', 'Baja')),
  constraint case_tasks_status_check
    check (status in ('pending', 'in_progress', 'completed', 'cancelled', 'overdue')),
  constraint case_tasks_verification_check
    check (verification_status in ('pending', 'approved', 'edited', 'rejected', 'conflict'))
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null default 'mock',
  source_folder_id text,
  source_folder_url text,
  status text not null default 'draft',
  total_folders integer not null default 0,
  total_documents integer not null default 0,
  processed_documents integer not null default 0,
  failed_documents integer not null default 0,
  detected_clients integer not null default 0,
  detected_cases integer not null default 0,
  progress_percentage numeric(5,2) not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error_message text,
  configuration jsonb not null default '{}'::jsonb,
  constraint import_jobs_status_check check (status in (
    'draft', 'inventory', 'processing', 'consolidating', 'review_required',
    'completed', 'partially_completed', 'failed', 'cancelled'
  )),
  constraint import_jobs_progress_check check (progress_percentage between 0 and 100)
);

create table if not exists public.import_folders (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  external_folder_id text not null,
  parent_external_folder_id text,
  folder_name text not null,
  folder_path text not null,
  detected_client_id uuid references public.clients(id) on delete set null,
  detected_case_id uuid references public.cases(id) on delete set null,
  analysis_status text not null default 'pending',
  confidence_score numeric(5,4),
  analysis_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_folders_confidence_check
    check (confidence_score is null or confidence_score between 0 and 1)
);

create table if not exists public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid references public.import_jobs(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  analysis_type text not null,
  model_provider text not null,
  model_name text not null,
  prompt_version text not null,
  input_reference text,
  output_data jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,4),
  status text not null default 'pending',
  error_message text,
  token_usage jsonb,
  estimated_cost numeric(12,6),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint ai_analysis_runs_confidence_check
    check (confidence_score is null or confidence_score between 0 and 1)
);

create table if not exists public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.ai_analysis_runs(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  finding_type text not null,
  field_name text not null,
  proposed_value jsonb,
  normalized_value jsonb,
  confidence_score numeric(5,4),
  source_page integer,
  source_excerpt text,
  verification_status text not null default 'pending',
  review_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  constraint ai_findings_confidence_check
    check (confidence_score is null or confidence_score between 0 and 1),
  constraint ai_findings_verification_check
    check (verification_status in ('pending', 'approved', 'edited', 'rejected', 'conflict'))
);

create table if not exists public.source_references (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  field_name text not null,
  document_id uuid references public.documents(id) on delete set null,
  source_page integer,
  source_excerpt text,
  confidence_score numeric(5,4),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint source_references_confidence_check
    check (confidence_score is null or confidence_score between 0 and 1)
);

create index if not exists clients_document_number_idx on public.clients (document_number);
create index if not exists clients_phone_idx on public.clients (phone);
create index if not exists cases_client_status_idx on public.cases (client_id, status);
create index if not exists cases_case_number_idx on public.cases (case_number);
create index if not exists cases_responsible_idx on public.cases (responsible_user_id);
create index if not exists payments_case_id_idx on public.payments (case_id);
create index if not exists documents_case_processing_idx on public.documents (case_id, processing_status);
create index if not exists documents_external_file_idx on public.documents (source_provider, external_file_id);
create index if not exists case_parties_case_id_idx on public.case_parties (case_id);
create index if not exists case_parties_document_number_idx on public.case_parties (document_number);
create index if not exists document_extractions_document_id_idx on public.document_extractions (document_id);
create index if not exists case_events_case_date_idx on public.case_events (case_id, event_date desc);
create index if not exists case_tasks_case_status_due_idx on public.case_tasks (case_id, status, due_date);
create index if not exists case_tasks_assigned_due_idx on public.case_tasks (assigned_to, due_date);
create index if not exists import_folders_job_idx on public.import_folders (import_job_id);
create index if not exists ai_analysis_runs_job_idx on public.ai_analysis_runs (import_job_id);
create index if not exists ai_findings_review_idx on public.ai_findings (verification_status, created_at);
create index if not exists source_references_entity_idx on public.source_references (entity_type, entity_id);

alter table public.case_parties enable row level security;
alter table public.document_extractions enable row level security;
alter table public.case_events enable row level security;
alter table public.case_tasks enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_folders enable row level security;
alter table public.ai_analysis_runs enable row level security;
alter table public.ai_findings enable row level security;
alter table public.source_references enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.case_parties to authenticated;
grant select, insert, update, delete on public.document_extractions to authenticated;
grant select, insert, update, delete on public.case_events to authenticated;
grant select, insert, update, delete on public.case_tasks to authenticated;
grant select, insert, update, delete on public.import_jobs to authenticated;
grant select, insert, update, delete on public.import_folders to authenticated;
grant select, insert, update, delete on public.ai_analysis_runs to authenticated;
grant select, insert, update, delete on public.ai_findings to authenticated;
grant select, insert, update, delete on public.source_references to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'case_parties', 'document_extractions', 'case_events', 'case_tasks',
    'import_jobs', 'import_folders', 'ai_analysis_runs', 'ai_findings', 'source_references'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
    execute format(
      'create policy %I on public.%I for select using (public.is_staff())',
      table_name || '_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.is_staff())',
      table_name || '_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (public.is_staff()) with check (public.is_staff())',
      table_name || '_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (public.is_admin())',
      table_name || '_delete', table_name
    );
  end loop;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at before update on public.cases
for each row execute function public.set_updated_at();

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists case_parties_set_updated_at on public.case_parties;
create trigger case_parties_set_updated_at before update on public.case_parties
for each row execute function public.set_updated_at();

drop trigger if exists case_events_set_updated_at on public.case_events;
create trigger case_events_set_updated_at before update on public.case_events
for each row execute function public.set_updated_at();

drop trigger if exists case_tasks_set_updated_at on public.case_tasks;
create trigger case_tasks_set_updated_at before update on public.case_tasks
for each row execute function public.set_updated_at();

drop trigger if exists import_jobs_set_updated_at on public.import_jobs;
create trigger import_jobs_set_updated_at before update on public.import_jobs
for each row execute function public.set_updated_at();

drop trigger if exists import_folders_set_updated_at on public.import_folders;
create trigger import_folders_set_updated_at before update on public.import_folders
for each row execute function public.set_updated_at();

commit;
