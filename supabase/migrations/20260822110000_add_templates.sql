-- Fase 5: biblioteca de Plantillas (Configuración → Plantillas).
--
-- Antes de esta migración, Configuración → Plantillas mostraba 6 nombres de
-- plantilla DOCX hardcodeados en el frontend (sin backend, sin archivo real
-- detrás) y no existía ninguna tabla ni bucket dedicado. Esta migración crea
-- el modelo mínimo real: una entidad "Plantilla" distinguible de un
-- Documento cualquiera, con solo los campos que la arquitectura necesita
-- (sin inventar campos ficticios como "variables" que la UI mock mostraba
-- sin ningún soporte real detrás).
--
-- Storage: las plantillas NO usan un bucket nuevo. Reutilizan el bucket
-- "documents" ya existente bajo el prefijo de ruta "templates/" (ver
-- src/hooks/use-templates.ts).
--
-- Corrección de seguridad (Fase 5B, tras auditoría posterior al primer
-- borrador de esta migración): las políticas de storage.objects ya
-- existentes (supabase/self-hosted/0007_storage.sql y
-- 20260713150000_usability_timezone_case_links_and_rls.sql) SÍ cubren
-- automáticamente cualquier objeto bajo "templates/" para SELECT
-- (crm_documents_staff_select, todo el staff) y DELETE
-- (crm_documents_admin_delete, ya solo Administrador) -- para esas dos
-- acciones, en efecto, no hacía falta ninguna policy nueva. Pero
-- crm_documents_staff_insert y crm_documents_staff_update conceden INSERT
-- y UPDATE a "todo el staff activo" sin distinguir por ruta -- correcto y
-- deliberado para Documentos normales (Personal debe poder subir
-- documentos, resolveDocumentPermissions.canUploadDocuments = true para
-- ambos roles), pero significa que, sin ninguna policy adicional, Personal
-- podría escribir/reemplazar directamente un objeto de Storage bajo
-- "templates/" llamando a la API de Storage sin pasar por el frontend del
-- CRM -- aunque la tabla public.templates ya exige is_admin() para INSERT,
-- la fila de metadata y el objeto de Storage son dos sistemas de
-- autorización distintos, y uno no protege al otro.
--
-- Se corrige con dos policies RESTRICTIVE nuevas y aditivas (no se toca ni
-- se redefine ninguna policy histórica): en Postgres, una policy
-- RESTRICTIVE se combina con AND sobre las policies PERMISSIVE existentes,
-- así que esto solo puede volverse más estricto que el comportamiento
-- actual, nunca más permisivo, y es un no-op total (siempre verdadera)
-- para cualquier objeto fuera de bucket_id = 'documents' o fuera del
-- prefijo "templates/" -- los permisos de Documentos normales quedan
-- exactamente iguales.
--
-- Permisos (resolveTemplatePermissions en src/lib/permissions.ts): ver y
-- descargar están disponibles para Administrador y Personal por igual;
-- crear/subir y eliminar son exclusivos de Administrador (no existe una
-- razón de negocio para que Personal cree o borre plantillas del estudio).
-- La RLS de abajo refleja exactamente esa misma regla -- ocultar botones en
-- la UI no es la garantía final.
--
-- NO se aplica remotamente como parte de esta fase.

begin;

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size bigint not null check (size > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists templates_storage_path_key
  on public.templates (storage_path);

create index if not exists templates_created_at_idx
  on public.templates (created_at desc);

drop trigger if exists templates_set_updated_at on public.templates;
create trigger templates_set_updated_at before update on public.templates
for each row execute function public.set_updated_at();

alter table public.templates enable row level security;

drop policy if exists "templates_select" on public.templates;
drop policy if exists "templates_insert" on public.templates;
drop policy if exists "templates_update" on public.templates;
drop policy if exists "templates_delete" on public.templates;

-- SELECT: todo el staff activo puede ver y descargar plantillas.
create policy "templates_select" on public.templates
  for select to authenticated
  using (public.is_staff());

-- INSERT/UPDATE: solo Administrador puede crear o modificar metadata de plantillas.
create policy "templates_insert" on public.templates
  for insert to authenticated
  with check (public.is_admin());

create policy "templates_update" on public.templates
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: solo Administrador puede eliminar plantillas.
create policy "templates_delete" on public.templates
  for delete to authenticated
  using (public.is_admin());

comment on policy "templates_select" on public.templates is
  'Todo el staff activo puede consultar y descargar plantillas.';
comment on policy "templates_insert" on public.templates is
  'Solo Administrador puede crear/subir plantillas.';
comment on policy "templates_update" on public.templates is
  'Solo Administrador puede editar metadata de plantillas.';
comment on policy "templates_delete" on public.templates is
  'Solo Administrador puede eliminar plantillas.';

grant select, insert, update, delete on public.templates to authenticated;

-- Storage hardening (Fase 5B): restringe INSERT/UPDATE bajo "templates/" a
-- Administrador, sin tocar ninguna policy histórica de storage.objects.
drop policy if exists "crm_templates_insert_admin_only" on storage.objects;
drop policy if exists "crm_templates_update_admin_only" on storage.objects;

create policy "crm_templates_insert_admin_only" on storage.objects
  as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'documents'
    or name not like 'templates/%'
    or (select public.crm_is_active_admin())
  );

create policy "crm_templates_update_admin_only" on storage.objects
  as restrictive
  for update to authenticated
  using (
    bucket_id <> 'documents'
    or name not like 'templates/%'
    or (select public.crm_is_active_admin())
  )
  with check (
    bucket_id <> 'documents'
    or name not like 'templates/%'
    or (select public.crm_is_active_admin())
  );

comment on policy "crm_templates_insert_admin_only" on storage.objects is
  'Restrictiva: bajo templates/ dentro del bucket documents, solo Administrador puede subir. No afecta ninguna otra ruta ni bucket.';
comment on policy "crm_templates_update_admin_only" on storage.objects is
  'Restrictiva: bajo templates/ dentro del bucket documents, solo Administrador puede reemplazar. No afecta ninguna otra ruta ni bucket.';

commit;
