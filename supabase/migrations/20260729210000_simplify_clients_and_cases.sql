-- Fase 4.3: compatibilidad previa a la simplificación definitiva.
-- Aditiva/no destructiva. No aplicar en producción antes de probar en staging.

begin;

-- El formulario final acepta correo vacío y lo persiste como NULL.
alter table public.clients
  alter column email drop not null;

-- Permite desplegar el runtime simplificado antes del corte destructivo.
alter table public.cases
  alter column juzgado drop not null;

comment on column public.clients.email is
  'Correo opcional. Las cadenas vacías deben normalizarse a NULL en la aplicación.';
comment on column public.cases.juzgado is
  'LEGACY Fase 4.3. No usar; pendiente de eliminación destructiva respaldada.';
comment on column public.cases.case_stage is
  'LEGACY Fase 4.3. No usar; pendiente de eliminación destructiva respaldada.';
comment on column public.cases.court is
  'LEGACY Fase 4.3. No usar; pendiente de eliminación destructiva respaldada.';
comment on column public.cases.judicial_district is
  'LEGACY Fase 4.3. No usar; pendiente de eliminación destructiva respaldada.';
comment on column public.cases.judge_or_prosecutor is
  'LEGACY Fase 4.3. No usar; pendiente de eliminación destructiva respaldada.';
comment on column public.case_tasks.due_date is
  'LEGACY Fase 4.3. El runtime no programa ni filtra tareas por vencimiento.';
comment on column public.case_tasks.is_all_day is
  'LEGACY Fase 4.3. El runtime no programa tareas en Agenda.';

commit;
