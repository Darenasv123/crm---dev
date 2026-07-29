-- Agregar columna materia a la tabla cases
-- Migración aditiva y nullable para compatibilidad con expedientes antiguos

begin;

-- Agregar columna materia (nullable)
alter table public.cases
  add column if not exists materia text
  check (materia is null or materia in ('Familia', 'Penal'));

-- Crear índice para mejorar filtrado
create index if not exists cases_materia_idx on public.cases (materia);

commit;
