-- Canonical trigger set. Exactly one case-task update guard is installed.

begin;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger cases_set_updated_at before update on public.cases
  for each row execute function public.set_updated_at();
create trigger agenda_events_set_updated_at before update on public.agenda_events
  for each row execute function public.set_updated_at();
create trigger document_folders_set_updated_at before update on public.document_folders
  for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger case_parties_set_updated_at before update on public.case_parties
  for each row execute function public.set_updated_at();
create trigger case_events_set_updated_at before update on public.case_events
  for each row execute function public.set_updated_at();
create trigger case_tasks_90_set_updated_at before update on public.case_tasks
  for each row execute function public.set_updated_at();
create trigger import_jobs_set_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();
create trigger import_folders_set_updated_at before update on public.import_folders
  for each row execute function public.set_updated_at();
create trigger google_calendar_connections_set_updated_at
  before update on public.google_calendar_connections
  for each row execute function public.set_updated_at();
create trigger google_calendar_channels_set_updated_at
  before update on public.google_calendar_channels
  for each row execute function public.set_updated_at();

create trigger trg_df_parent_same_client
  before insert or update of parent_id, client_id on public.document_folders
  for each row execute function public.check_folder_parent_same_client();
create trigger trg_df_no_cycle
  before insert or update of parent_id on public.document_folders
  for each row execute function public.check_folder_no_cycle();
create trigger trg_doc_folder_same_client
  before insert or update of folder_id, client_id on public.documents
  for each row execute function public.check_document_folder_same_client();

create trigger documents_validate_relationship
  before insert or update of client_id, case_id on public.documents
  for each row execute function public.validate_document_relationship();
create trigger documents_audit_metadata
  after update on public.documents
  for each row execute function public.audit_document_metadata();

create trigger case_tasks_00_validate_relationship
  before insert or update of client_id, case_id on public.case_tasks
  for each row execute function public.validate_case_task_relationship();
create trigger case_tasks_05_guard_schedule
  before update of scheduled_for on public.case_tasks
  for each row execute function public.guard_case_task_schedule();
create trigger case_tasks_10_apply_completion
  before insert or update of status, completed_at, completed_by on public.case_tasks
  for each row execute function public.apply_case_task_completion();
create trigger case_tasks_20_guard_update
  before update on public.case_tasks
  for each row execute function public.guard_case_task_update();
create trigger case_tasks_audit_changes
  after update on public.case_tasks
  for each row execute function public.audit_case_task_changes();
create trigger case_tasks_log_event
  after insert or update on public.case_tasks
  for each row execute function public.log_case_task_event();

commit;
