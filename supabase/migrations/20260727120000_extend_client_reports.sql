-- Extender tabla client_reports para soportar reportes estructurados al cliente
-- Migración aditiva y nullable para compatibilidad con reportes antiguos
-- NO EJECUTAR REMOTAMENTE — SOLO LOCAL

begin;

-- Agregar campos del nuevo formulario
alter table public.client_reports
  add column if not exists materia text
    check (materia is null or materia in ('Familia', 'Penal')),
  add column if not exists status_date date,
  add column if not exists current_status text,
  add column if not exists informative_message text,
  add column if not exists reminder_days integer
    check (reminder_days is null or reminder_days > 0),
  add column if not exists final_text text;

-- Índices opcionales para mejorar consultas
create index if not exists client_reports_materia_idx on public.client_reports (materia);
create index if not exists client_reports_status_date_idx on public.client_reports (status_date);

commit;
