-- Explicit final RLS, policies and grants for CRM roles.

begin;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.cases enable row level security;
alter table public.payments enable row level security;
alter table public.payment_records enable row level security;
alter table public.agenda_events enable row level security;
alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.client_reports enable row level security;
alter table public.case_parties enable row level security;
alter table public.document_extractions enable row level security;
alter table public.case_events enable row level security;
alter table public.case_tasks enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_folders enable row level security;
alter table public.ai_analysis_runs enable row level security;
alter table public.ai_findings enable row level security;
alter table public.source_references enable row level security;
alter table public.case_task_history enable row level security;
alter table public.document_change_history enable row level security;
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_channels enable row level security;
alter table public.google_calendar_sync_log enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_sync_requests enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using ((select public.crm_is_active_staff()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.crm_is_active_admin()))
  with check ((select public.crm_is_active_admin()));

-- Operational tables: active staff read/create/update; only active admins delete.
create policy clients_select on public.clients for select to authenticated using ((select public.crm_is_active_staff()));
create policy clients_insert on public.clients for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy clients_update on public.clients for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy clients_delete on public.clients for delete to authenticated using ((select public.crm_is_active_admin()));

create policy cases_select on public.cases for select to authenticated using ((select public.crm_is_active_staff()));
create policy cases_insert on public.cases for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy cases_update on public.cases for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy cases_delete on public.cases for delete to authenticated using ((select public.crm_is_active_admin()));

create policy document_folders_select on public.document_folders for select to authenticated using ((select public.crm_is_active_staff()));
create policy document_folders_insert on public.document_folders for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy document_folders_update on public.document_folders for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy document_folders_delete on public.document_folders for delete to authenticated using ((select public.crm_is_active_admin()));

create policy documents_select on public.documents for select to authenticated using ((select public.crm_is_active_staff()));
create policy documents_insert on public.documents for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy documents_update on public.documents for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy documents_delete on public.documents for delete to authenticated using ((select public.crm_is_active_admin()));

create policy client_reports_select on public.client_reports for select to authenticated using ((select public.crm_is_active_staff()));
create policy client_reports_insert on public.client_reports for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy client_reports_update on public.client_reports for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy client_reports_delete on public.client_reports for delete to authenticated using ((select public.crm_is_active_admin()));

create policy case_parties_select on public.case_parties for select to authenticated using ((select public.crm_is_active_staff()));
create policy case_parties_insert on public.case_parties for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy case_parties_update on public.case_parties for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy case_parties_delete on public.case_parties for delete to authenticated using ((select public.crm_is_active_admin()));

create policy document_extractions_select on public.document_extractions for select to authenticated using ((select public.crm_is_active_staff()));
create policy document_extractions_insert on public.document_extractions for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy document_extractions_update on public.document_extractions for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy document_extractions_delete on public.document_extractions for delete to authenticated using ((select public.crm_is_active_admin()));

create policy case_events_select on public.case_events for select to authenticated using ((select public.crm_is_active_staff()));
create policy case_events_insert on public.case_events for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy case_events_update on public.case_events for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy case_events_delete on public.case_events for delete to authenticated using ((select public.crm_is_active_admin()));

create policy import_jobs_select on public.import_jobs for select to authenticated using ((select public.crm_is_active_staff()));
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy import_jobs_update on public.import_jobs for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy import_jobs_delete on public.import_jobs for delete to authenticated using ((select public.crm_is_active_admin()));

create policy import_folders_select on public.import_folders for select to authenticated using ((select public.crm_is_active_staff()));
create policy import_folders_insert on public.import_folders for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy import_folders_update on public.import_folders for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy import_folders_delete on public.import_folders for delete to authenticated using ((select public.crm_is_active_admin()));

create policy ai_analysis_runs_select on public.ai_analysis_runs for select to authenticated using ((select public.crm_is_active_staff()));
create policy ai_analysis_runs_insert on public.ai_analysis_runs for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy ai_analysis_runs_update on public.ai_analysis_runs for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy ai_analysis_runs_delete on public.ai_analysis_runs for delete to authenticated using ((select public.crm_is_active_admin()));

create policy ai_findings_select on public.ai_findings for select to authenticated using ((select public.crm_is_active_staff()));
create policy ai_findings_insert on public.ai_findings for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy ai_findings_update on public.ai_findings for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy ai_findings_delete on public.ai_findings for delete to authenticated using ((select public.crm_is_active_admin()));

create policy source_references_select on public.source_references for select to authenticated using ((select public.crm_is_active_staff()));
create policy source_references_insert on public.source_references for insert to authenticated with check ((select public.crm_is_active_staff()));
create policy source_references_update on public.source_references for update to authenticated using ((select public.crm_is_active_staff())) with check ((select public.crm_is_active_staff()));
create policy source_references_delete on public.source_references for delete to authenticated using ((select public.crm_is_active_admin()));

-- Payments are entirely administrative; writes should normally use the atomic RPC.
create policy payments_select on public.payments for select to authenticated using ((select public.crm_is_active_admin()));
create policy payments_insert on public.payments for insert to authenticated with check ((select public.crm_is_active_admin()));
create policy payments_update on public.payments for update to authenticated using ((select public.crm_is_active_admin())) with check ((select public.crm_is_active_admin()));
create policy payments_delete on public.payments for delete to authenticated using ((select public.crm_is_active_admin()));
create policy payment_records_select on public.payment_records for select to authenticated using ((select public.crm_is_active_admin()));
create policy payment_records_insert on public.payment_records for insert to authenticated with check ((select public.crm_is_active_admin()));
create policy payment_records_update on public.payment_records for update to authenticated using ((select public.crm_is_active_admin())) with check ((select public.crm_is_active_admin()));
create policy payment_records_delete on public.payment_records for delete to authenticated using ((select public.crm_is_active_admin()));

-- Agenda is visible to staff, but only administrators manage it.
create policy agenda_events_select on public.agenda_events for select to authenticated using ((select public.crm_is_active_staff()));
create policy agenda_events_insert on public.agenda_events for insert to authenticated with check ((select public.crm_is_active_admin()));
create policy agenda_events_update on public.agenda_events for update to authenticated using ((select public.crm_is_active_admin())) with check ((select public.crm_is_active_admin()));
create policy agenda_events_delete on public.agenda_events for delete to authenticated using ((select public.crm_is_active_admin()));

-- Task creation/deletion is administrative. Personal operates only assigned tasks;
-- atomic claim/return RPCs bypass RLS but are checked by their guarded functions.
create policy case_tasks_select on public.case_tasks for select to authenticated using ((select public.crm_is_active_staff()));
create policy case_tasks_insert on public.case_tasks for insert to authenticated
  with check ((select public.crm_is_active_admin()) and assigned_to is null and claimed_by is null and claimed_at is null and status = 'pending');
create policy case_tasks_update on public.case_tasks for update to authenticated
  using ((select public.crm_is_active_admin()) or ((select public.crm_is_active_staff()) and assigned_to = auth.uid()))
  with check ((select public.crm_is_active_admin()) or ((select public.crm_is_active_staff()) and assigned_to = auth.uid()));
create policy case_tasks_delete on public.case_tasks for delete to authenticated using ((select public.crm_is_active_admin()));

create policy case_task_history_select on public.case_task_history for select to authenticated using ((select public.crm_is_active_staff()));
create policy document_change_history_select on public.document_change_history for select to authenticated using ((select public.crm_is_active_staff()));

-- Calendar configuration is administrative; sync internals are service-role only.
create policy google_calendar_connections_select on public.google_calendar_connections for select to authenticated using ((select public.crm_is_active_admin()));
create policy google_calendar_connections_insert on public.google_calendar_connections for insert to authenticated with check ((select public.crm_is_active_admin()));
create policy google_calendar_connections_update on public.google_calendar_connections for update to authenticated using ((select public.crm_is_active_admin())) with check ((select public.crm_is_active_admin()));
create policy google_calendar_connections_delete on public.google_calendar_connections for delete to authenticated using ((select public.crm_is_active_admin()));
create policy google_calendar_channels_select on public.google_calendar_channels for select to authenticated using ((select public.crm_is_active_admin()));
create policy google_calendar_sync_log_select on public.google_calendar_sync_log for select to authenticated using ((select public.crm_is_active_admin()));

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on
  public.clients, public.cases, public.agenda_events, public.document_folders,
  public.documents, public.client_reports, public.case_parties,
  public.document_extractions, public.case_events, public.case_tasks,
  public.import_jobs, public.import_folders, public.ai_analysis_runs,
  public.ai_findings, public.source_references, public.payments,
  public.payment_records, public.google_calendar_connections
to authenticated;
grant select on public.case_task_history, public.document_change_history,
  public.google_calendar_channels, public.google_calendar_sync_log
to authenticated;

grant execute on function public.crm_is_active_staff() to authenticated;
grant execute on function public.crm_is_active_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.claim_case_task(uuid) to authenticated;
grant execute on function public.return_case_task(uuid) to authenticated;
grant execute on function public.normalize_document_types(boolean) to authenticated;
grant execute on function public.register_payment_record_atomic(uuid, numeric, text, text, text, date) to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

commit;
