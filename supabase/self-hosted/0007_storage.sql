-- Private CRM document bucket. No Storage objects are copied or inserted.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, null, null)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = null,
    allowed_mime_types = null;

revoke all on storage.objects from public, anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects to service_role;

create policy crm_documents_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select public.crm_is_active_staff()));

create policy crm_documents_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (select public.crm_is_active_staff()));

create policy crm_documents_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (select public.crm_is_active_staff()))
  with check (bucket_id = 'documents' and (select public.crm_is_active_staff()));

create policy crm_documents_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (select public.crm_is_active_admin()));

commit;
