-- Fase 4.3: CORTE DESTRUCTIVO.
--
-- PRECONDICIONES OBLIGATORIAS:
-- 1. respaldo lógico y restauración de prueba verificados;
-- 2. ejecución satisfactoria en staging;
-- 3. inventario de consumidores externos y vistas;
-- 4. tipos regenerados contra staging;
-- 5. aprobación explícita del responsable de datos.
--
-- Para impedir una aplicación accidental, la sesión debe ejecutar antes:
--   set app.confirm_crm_destructive_drop = 'BACKUP_VERIFIED';
-- Esta migración NO elimina case_parties: aún puede contener datos históricos.

begin;

do $$
begin
  if current_setting('app.confirm_crm_destructive_drop', true)
       is distinct from 'BACKUP_VERIFIED' then
    raise exception
      'Migración destructiva bloqueada: falta respaldo verificado y confirmación de staging';
  end if;
end;
$$;

-- Pérdida de datos de contacto/identificación y clasificación legacy del cliente.
alter table public.clients
  drop column if exists dni,
  drop column if exists document_type,
  drop column if exists document_number,
  drop column if exists whatsapp,
  drop column if exists occupation,
  drop column if exists address,
  drop column if exists birthdate,
  drop column if exists civil_status,
  drop column if exists notes,
  drop column if exists process_type;

-- Pérdida de metadatos judiciales retirados del producto.
alter table public.cases
  drop column if exists case_stage,
  drop column if exists court,
  drop column if exists juzgado,
  drop column if exists judicial_district,
  drop column if exists judge_or_prosecutor,
  drop column if exists demandante,
  drop column if exists demandado;

commit;
