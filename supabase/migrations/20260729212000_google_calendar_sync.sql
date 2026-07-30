-- Fase 4.3: infraestructura segura para un calendario compartido de Google.
-- Los secretos OAuth viven en servidor. No aplicar ni conectar remotamente aquí.

begin;

create table if not exists public.google_calendar_connections (
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
  status text not null default 'connected'
    check (status in ('connected', 'reconnect_required', 'disconnected', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists google_calendar_one_active_connection_idx
  on public.google_calendar_connections ((status = 'connected'))
  where status = 'connected';

create table if not exists public.google_calendar_channels (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.google_calendar_connections(id) on delete cascade,
  channel_id text not null unique,
  resource_id text not null,
  channel_token_hash text not null,
  expires_at timestamptz not null,
  stopped_at timestamptz,
  last_message_number bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_calendar_channels_renewal_idx
  on public.google_calendar_channels (expires_at)
  where stopped_at is null;

create table if not exists public.google_calendar_sync_log (
  id bigint generated always as identity primary key,
  connection_id uuid references public.google_calendar_connections(id) on delete set null,
  direction text not null check (direction in ('local_to_google', 'google_to_local', 'system')),
  operation text not null,
  agenda_event_id uuid references public.agenda_events(id) on delete set null,
  google_event_id text,
  status text not null check (status in ('started', 'succeeded', 'failed', 'conflict', 'ignored')),
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  calendar_id text not null,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.google_calendar_sync_requests (
  id bigint generated always as identity primary key,
  connection_id uuid not null
    references public.google_calendar_connections(id) on delete cascade,
  channel_id text,
  message_number bigint,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists google_calendar_webhook_dedup_idx
  on public.google_calendar_sync_requests (channel_id, message_number);
create index if not exists google_calendar_sync_requests_pending_idx
  on public.google_calendar_sync_requests (created_at)
  where status = 'pending';

alter table public.agenda_events
  add column if not exists google_event_id text,
  add column if not exists google_calendar_id text,
  add column if not exists google_etag text,
  add column if not exists google_updated_at timestamptz,
  add column if not exists google_html_link text,
  add column if not exists sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'synced', 'error', 'conflict', 'deleted')),
  add column if not exists sync_error text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_origin text not null default 'crm'
    check (sync_origin in ('crm', 'google')),
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Conserva compatibilidad con la columna histórica sin usarla como clave final.
update public.agenda_events
   set google_event_id = gcal_event_id
 where google_event_id is null and gcal_event_id is not null;

create unique index if not exists agenda_events_google_identity_idx
  on public.agenda_events (google_calendar_id, google_event_id)
  where google_calendar_id is not null and google_event_id is not null;
create index if not exists agenda_events_sync_queue_idx
  on public.agenda_events (sync_status, updated_at)
  where sync_status in ('pending', 'error', 'conflict');

drop trigger if exists google_calendar_connections_set_updated_at
  on public.google_calendar_connections;
create trigger google_calendar_connections_set_updated_at
  before update on public.google_calendar_connections
  for each row execute function public.set_updated_at();

drop trigger if exists google_calendar_channels_set_updated_at
  on public.google_calendar_channels;
create trigger google_calendar_channels_set_updated_at
  before update on public.google_calendar_channels
  for each row execute function public.set_updated_at();

drop trigger if exists agenda_events_set_updated_at on public.agenda_events;
create trigger agenda_events_set_updated_at
  before update on public.agenda_events
  for each row execute function public.set_updated_at();

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_channels enable row level security;
alter table public.google_calendar_sync_log enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_sync_requests enable row level security;

create policy "google_connections_admin_select"
  on public.google_calendar_connections for select to authenticated
  using (public.is_admin());
create policy "google_connections_admin_insert"
  on public.google_calendar_connections for insert to authenticated
  with check (public.is_admin() and connected_by = auth.uid());
create policy "google_connections_admin_update"
  on public.google_calendar_connections for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "google_connections_admin_delete"
  on public.google_calendar_connections for delete to authenticated
  using (public.is_admin());

create policy "google_channels_admin_select"
  on public.google_calendar_channels for select to authenticated
  using (public.is_admin());
create policy "google_sync_log_admin_select"
  on public.google_calendar_sync_log for select to authenticated
  using (public.is_admin());

revoke all on public.google_calendar_connections from public, anon;
revoke all on public.google_calendar_channels from public, anon;
revoke all on public.google_calendar_sync_log from public, anon;
revoke all on public.google_calendar_oauth_states from public, anon, authenticated;
revoke all on public.google_calendar_sync_requests from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_connections to authenticated;
grant select on public.google_calendar_channels to authenticated;
grant select on public.google_calendar_sync_log to authenticated;
grant usage, select on sequence public.google_calendar_sync_log_id_seq to authenticated;

commit;
