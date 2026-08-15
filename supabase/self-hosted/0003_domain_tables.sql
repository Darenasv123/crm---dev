-- Canonical final CRM domain for an empty PostgreSQL 17 Supabase instance.
-- No legacy columns, backfills, cleanup schemas or historical rows are created.

begin;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  color text not null default 'oklch(0.55 0.13 235)',
  phone text,
  email text,
  status text not null default 'Activo',
  registered_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint clients_status_check
    check (status in ('Activo', 'En espera', 'Cerrado'))
);

create index clients_phone_idx on public.clients (phone);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  expediente text not null,
  process_type text not null,
  priority text not null default 'Media',
  next_hearing timestamptz,
  status text not null default 'Pendiente de clasificación',
  created_at timestamptz not null default now(),
  internal_code text,
  case_name text,
  case_type text,
  legal_area text,
  case_number text,
  case_year integer,
  filing_date date,
  closing_date date,
  current_summary text,
  current_status_description text,
  last_action_date date,
  next_action text,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  materia text,
  constraint cases_priority_check
    check (priority in ('Alta', 'Media', 'Baja')),
  constraint cases_status_check
    check (status in (
      'Pendiente de clasificación', 'En preparación', 'Presentado',
      'En trámite', 'En audiencia', 'En ejecución', 'Concluido',
      'Archivado', 'pendiente_revision'
    )),
  constraint cases_materia_check
    check (materia is null or materia in ('Familia', 'Penal'))
);

create index cases_case_number_idx on public.cases (case_number);
create index cases_client_status_idx on public.cases (client_id, status);
create index cases_materia_idx on public.cases (materia);
create index cases_responsible_idx on public.cases (responsible_user_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service text not null,
  fees numeric(12,2) not null,
  paid numeric(12,2) not null default 0,
  total_installments integer not null default 1,
  paid_installments integer not null default 0,
  status text not null default 'Pendiente',
  created_at timestamptz not null default now(),
  case_id uuid references public.cases(id) on delete set null,
  constraint payments_amounts_check
    check (fees >= 0 and paid >= 0 and paid <= fees),
  constraint payments_installments_check
    check (
      total_installments >= 1
      and paid_installments >= 0
      and paid_installments <= total_installments
    ),
  constraint payments_status_check
    check (status in ('Pagado', 'Parcial', 'Pendiente', 'Vencido'))
);

create index payments_case_id_idx on public.payments (case_id);

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  amount numeric(12,2) not null,
  method text not null,
  receipt text,
  notes text,
  payment_date date not null default current_date,
  created_at timestamptz not null default now(),
  constraint payment_records_amount_check check (amount > 0)
);

create table public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'Cita',
  event_date date not null,
  event_time time not null,
  location text,
  client_id uuid references public.clients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  created_at timestamptz not null default now(),
  google_event_id text,
  google_calendar_id text,
  google_etag text,
  google_updated_at timestamptz,
  google_html_link text,
  sync_status text not null default 'pending',
  sync_error text,
  last_synced_at timestamptz,
  sync_origin text not null default 'crm',
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint agenda_events_type_check
    check (type in ('Audiencia', 'Cita', 'Recordatorio')),
  constraint agenda_events_sync_status_check
    check (sync_status in ('pending', 'syncing', 'synced', 'error', 'conflict', 'deleted')),
  constraint agenda_events_sync_origin_check
    check (sync_origin in ('crm', 'google'))
);

create index agenda_events_case_id_idx on public.agenda_events (case_id);
create unique index agenda_events_google_identity_idx
  on public.agenda_events (google_calendar_id, google_event_id)
  where google_calendar_id is not null and google_event_id is not null;
create index agenda_events_sync_queue_idx
  on public.agenda_events (sync_status, updated_at)
  where sync_status in ('pending', 'error', 'conflict');

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  parent_id uuid references public.document_folders(id) on delete restrict,
  name text not null,
  normalized_name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_folders_no_self_parent check (id <> parent_id),
  constraint document_folders_unique_name_under_parent
    unique (client_id, parent_id, normalized_name)
);

create unique index document_folders_root_unique
  on public.document_folders (client_id, normalized_name)
  where parent_id is null;
create index document_folders_client_id_idx on public.document_folders (client_id);
create index document_folders_parent_id_idx on public.document_folders (parent_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  size text not null,
  storage_path text not null,
  client_id uuid references public.clients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  uploaded_at date not null default current_date,
  created_at timestamptz not null default now(),
  original_name text,
  display_name text,
  document_type text,
  mime_type text,
  source_type text not null default 'supabase_storage',
  source_provider text,
  external_file_id text,
  external_folder_id text,
  external_url text,
  document_date date,
  file_size bigint,
  checksum text,
  processing_status text not null default 'pending',
  verification_status text not null default 'pending',
  is_confidential boolean not null default false,
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  relative_path text,
  content_hash text,
  folder_id uuid references public.document_folders(id) on delete restrict,
  constraint documents_type_check
    check (type in ('Demanda', 'Resolución', 'Sentencia', 'Poder', 'Contrato', 'Otros')),
  constraint documents_document_type_check
    check (document_type is null or document_type = type),
  constraint documents_processing_status_check
    check (processing_status in ('pending', 'processing', 'completed', 'failed', 'ocr_required')),
  constraint documents_verification_status_check
    check (verification_status in ('pending', 'approved', 'edited', 'rejected', 'conflict')),
  constraint documents_file_size_check
    check (file_size is null or file_size >= 0)
);

create index documents_case_processing_idx on public.documents (case_id, processing_status);
create index documents_client_id_idx on public.documents (client_id);
create unique index documents_client_relative_path_unique
  on public.documents (client_id, relative_path)
  where client_id is not null and relative_path is not null;
create index documents_external_file_idx
  on public.documents (source_provider, external_file_id);
create index documents_folder_id_idx on public.documents (folder_id);

create table public.client_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  category text not null default 'Reporte',
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  materia text,
  status_date date,
  current_status text,
  informative_message text,
  reminder_days integer,
  final_text text,
  constraint client_reports_category_check
    check (category in ('Reporte', 'Noticia', 'Seguimiento', 'Alerta', 'Estado', 'Observacion')),
  constraint client_reports_materia_check
    check (materia is null or materia in ('Familia', 'Penal')),
  constraint client_reports_reminder_days_check
    check (reminder_days is null or reminder_days > 0)
);

create index client_reports_case_id_idx on public.client_reports (case_id);
create index client_reports_client_id_created_at_idx
  on public.client_reports (client_id, created_at desc);
create index client_reports_materia_idx on public.client_reports (materia);
create index client_reports_status_date_idx on public.client_reports (status_date);

create table public.case_parties (
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

create index case_parties_case_id_idx on public.case_parties (case_id);
create index case_parties_document_number_idx on public.case_parties (document_number);

create table public.document_extractions (
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

create index document_extractions_document_id_idx
  on public.document_extractions (document_id);

create table public.case_events (
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

create index case_events_case_date_idx on public.case_events (case_id, event_date desc);

create table public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'Normal',
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
  is_all_day boolean not null default false,
  completed_by uuid references public.profiles(id) on delete set null,
  scheduled_for date not null default ((now() at time zone 'America/Lima')::date),
  started_at timestamptz,
  claimed_at timestamptz,
  claimed_by uuid references public.profiles(id) on delete set null,
  constraint case_tasks_priority_check
    check (priority in ('Baja', 'Normal', 'Media', 'Alta', 'Urgente')),
  constraint case_tasks_status_check
    check (status in ('pending', 'in_progress', 'ready_to_file', 'completed', 'blocked', 'cancelled', 'overdue')),
  constraint case_tasks_verification_check
    check (verification_status in ('pending', 'approved', 'edited', 'rejected', 'conflict'))
);

create index case_tasks_assigned_due_idx on public.case_tasks (assigned_to, due_date);
create index case_tasks_assigned_to_idx on public.case_tasks (assigned_to);
create index case_tasks_available_idx
  on public.case_tasks (priority, created_at)
  where assigned_to is null and status = 'pending';
create index case_tasks_case_id_idx on public.case_tasks (case_id);
create index case_tasks_case_status_due_idx on public.case_tasks (case_id, status, due_date);
create index case_tasks_claimed_by_idx
  on public.case_tasks (claimed_by) where claimed_by is not null;
create index case_tasks_client_id_idx on public.case_tasks (client_id);
create index case_tasks_due_date_idx
  on public.case_tasks (due_date) where due_date is not null;
create index case_tasks_scheduled_for_idx on public.case_tasks (scheduled_for, status);
create index case_tasks_status_idx on public.case_tasks (status);

create table public.import_jobs (
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
  -- Matches the cloud contract (20260721090000_legal_case_foundation.sql)
  -- and what src/lib/zip-import/import-engine.server.ts actually writes.
  -- Correction 2026-08-15: this constraint previously listed
  -- ('draft', 'analyzing', 'reviewing', 'importing', 'completed', 'failed',
  -- 'cancelled') — wizard-phase names from the never-implemented
  -- src/lib/imports/folder-import-engine.ts, copied in by mistake. See
  -- supabase/migrations/20260815120000_fix_import_jobs_status_check_constraint.sql
  -- for the hotfix applied to already-bootstrapped self-hosted instances.
  constraint import_jobs_status_check
    check (status in (
      'draft', 'inventory', 'processing', 'consolidating', 'review_required',
      'completed', 'partially_completed', 'failed', 'cancelled'
    )),
  constraint import_jobs_progress_check
    check (progress_percentage between 0 and 100)
);

create table public.import_folders (
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

create index import_folders_job_idx on public.import_folders (import_job_id);

create table public.ai_analysis_runs (
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

create index ai_analysis_runs_job_idx on public.ai_analysis_runs (import_job_id);

create table public.ai_findings (
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

create index ai_findings_review_idx
  on public.ai_findings (verification_status, created_at);

create table public.source_references (
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

create index source_references_entity_idx
  on public.source_references (entity_type, entity_id);

create table public.case_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.case_tasks(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  old_status text,
  new_status text,
  old_scheduled_for date,
  new_scheduled_for date,
  changes jsonb not null default '{}'::jsonb
);

create index case_task_history_task_changed_idx
  on public.case_task_history (task_id, changed_at desc);

create table public.document_change_history (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  changes jsonb not null
);

create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  connected_by uuid not null references public.profiles(id) on delete restrict,
  google_account_email text,
  calendar_id text not null,
  calendar_name text,
  encrypted_refresh_token text not null,
  access_token_expires_at timestamptz,
  sync_token text,
  last_synced_at timestamptz,
  last_error text,
  status text not null default 'connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_status_check
    check (status in ('connected', 'reconnect_required', 'disconnected', 'error'))
);

create unique index google_calendar_one_active_connection_idx
  on public.google_calendar_connections ((status = 'connected'))
  where status = 'connected';

create table public.google_calendar_channels (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  channel_id text not null unique,
  resource_id text not null,
  channel_token_hash text not null,
  expires_at timestamptz not null,
  stopped_at timestamptz,
  last_message_number bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index google_calendar_channels_renewal_idx
  on public.google_calendar_channels (expires_at)
  where stopped_at is null;

create table public.google_calendar_sync_log (
  id bigint generated always as identity primary key,
  connection_id uuid references public.google_calendar_connections(id) on delete set null,
  direction text not null,
  operation text not null,
  agenda_event_id uuid references public.agenda_events(id) on delete set null,
  google_event_id text,
  status text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint google_calendar_sync_log_direction_check
    check (direction in ('local_to_google', 'google_to_local', 'system')),
  constraint google_calendar_sync_log_status_check
    check (status in ('started', 'succeeded', 'failed', 'conflict', 'ignored'))
);

create table public.google_calendar_oauth_states (
  state_hash text primary key,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  calendar_id text not null,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.google_calendar_sync_requests (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  channel_id text,
  message_number bigint,
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint google_calendar_sync_requests_status_check
    check (status in ('pending', 'processing', 'completed', 'failed'))
);

create unique index google_calendar_webhook_dedup_idx
  on public.google_calendar_sync_requests (channel_id, message_number);
create index google_calendar_sync_requests_pending_idx
  on public.google_calendar_sync_requests (created_at)
  where status = 'pending';

commit;
