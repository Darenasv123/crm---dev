-- Garantiza en la base de datos (no solo en el frontend) que un reporte de
-- cliente con expediente asociado (client_reports.case_id) solo pueda
-- apuntar a un expediente que realmente pertenezca al mismo cliente del
-- reporte (client_reports.client_id).
--
-- Problema que resuelve: hasta ahora client_reports tenía dos foreign keys
-- simples e independientes -- case_id -> cases(id) y client_id ->
-- clients(id) -- sin ninguna relación cruzada entre ellas. Nada en la base
-- de datos impedía un INSERT/UPDATE (por ejemplo, uno hecho manipulando
-- directamente la API de Supabase, sin pasar por la UI del CRM) con
-- client_id = Cliente A y case_id = un expediente que en realidad
-- pertenece a Cliente B. El frontend (Fase 4: isCaseOwnedByClient() en
-- src/lib/client-reports.ts) y la mutation (useCreateClientReport() en
-- src/hooks/use-reports.ts) ya evitan esto en circunstancias normales,
-- pero ninguna de las dos capas puede ser la garantía final: ambas se
-- pueden saltar llamando directamente a Supabase con credenciales válidas.
--
-- Estrategia: foreign key compuesta declarativa, sin triggers y sin
-- duplicar client_id en ningún otro lado. cases.id ya es su primary key
-- (por lo tanto ya único); se añade una constraint UNIQUE adicional sobre
-- (id, client_id) -- válida y trivial porque id ya es único por sí solo,
-- así que (id, client_id) lo es automáticamente también -- únicamente para
-- poder referenciarla desde una foreign key compuesta en client_reports
-- (case_id, client_id) -> cases (id, client_id).
--
-- Con el comportamiento MATCH SIMPLE (el que usa Postgres por defecto en
-- toda foreign key que no especifique MATCH FULL/PARTIAL), una fila con
-- CUALQUIER columna de la FK compuesta en NULL se considera automáticamente
-- conforme, sin evaluar las demás columnas. Como client_reports.case_id ya
-- es nullable (un reporte puede no estar asociado a ningún expediente) y
-- esta migración no cambia esa nulabilidad, los reportes sin expediente
-- siguen permitidos exactamente igual que antes -- la nueva constraint solo
-- entra en juego cuando case_id SÍ tiene un valor.
--
-- Compatibilidad con las foreign keys simples ya existentes (auditadas
-- antes de escribir esta migración, en
-- supabase/migrations/20260713131000_add_client_reports.sql, sin cambios
-- desde entonces):
--   client_reports.case_id   -> cases(id)   on delete set null
--   client_reports.client_id -> clients(id) on delete cascade
-- (ninguna de las dos especifica ON UPDATE ni DEFERRABLE, así que ambas
-- usan los valores por defecto de Postgres: ON UPDATE NO ACTION, NOT
-- DEFERRABLE. Esta migración NO modifica ni elimina ninguna de las dos.)
--
-- La FK compuesta nueva declara su propio ON DELETE/ON UPDATE explícitos,
-- en vez de dejarlos implícitos, para que su comportamiento no dependa de
-- cómo Postgres ordene su ejecución respecto a la FK simple de case_id ya
-- existente:
--
--   ON DELETE SET NULL (case_id) -- sintaxis de columnas específicas de
--   Postgres 15+ (el target de este proyecto es PostgreSQL 17.6, ver
--   docs/database/self-hosted-canonical-model.md); confirmado soportado.
--   Sin especificar la columna, "ON DELETE SET NULL" en una FK compuesta
--   pondría a NULL TODAS sus columnas -- incluida client_id, que es NOT
--   NULL en client_reports, lo que haría fallar cualquier borrado de un
--   expediente con reportes. Con "(case_id)" solo se anula case_id al
--   borrar el expediente referenciado; client_id se conserva intacto --
--   exactamente la semántica que ya tenía la FK simple de case_id, y la
--   que el CRM espera: al eliminar un expediente, sus reportes sobreviven
--   como "reporte general del cliente", nunca se borran ni pierden a su
--   cliente.
--
--   ON UPDATE NO ACTION (explícito, aunque coincide con el valor por
--   defecto) -- si algún día se reasigna cases.client_id (ya es posible
--   hoy vía CaseEditDialog / useUpdateCase, que hace
--   update({ client_id: ... })), y ese expediente tiene reportes cuyo
--   client_id no coincide con el nuevo dueño, la actualización del
--   expediente se rechaza con un error de foreign key en vez de dejar
--   una relación cruzada silenciosa (un reporte "del cliente A" señalando
--   a un expediente que ahora es del cliente B). Quien reasigne el
--   expediente debe resolver primero esos reportes explícitamente
--   (reasignar su client_id o desvincular el expediente del reporte).
--
-- Se mantiene la FK simple original de case_id sin cambios (no se elimina
-- ninguna FK existente): con la cláusula explícita de arriba, la nueva FK
-- compuesta ya no depende de esa FK simple para producir el resultado
-- correcto en un DELETE de cases -- ambas, de forma independiente, anulan
-- únicamente case_id y preservan client_id.
--
-- Antes de añadir la FK, se verifica explícitamente que no existan filas
-- históricas que ya violen la regla. Si existieran, la migración falla con
-- una excepción que indica cuántas filas y con qué consulta identificarlas,
-- en vez de reasignar o borrar datos automáticamente: una relación
-- cliente-expediente incorrecta en un reporte jurídico ya emitido es un
-- hecho que debe revisarse y corregirse manualmente, nunca silenciarse
-- dentro de una migración. (Aun sin este chequeo explícito, el propio
-- ALTER TABLE ... ADD CONSTRAINT de Postgres ya validaría todas las filas
-- existentes y fallaría igual ante cualquier violación; este bloque previo
-- solo hace ese fallo más claro y accionable.)
--
-- NO se aplica remotamente como parte de esta fase (Fase 4B).

begin;

do $$
declare
  bad_rows integer;
begin
  select count(*)
    into bad_rows
    from public.client_reports cr
    join public.cases c on c.id = cr.case_id
   where cr.case_id is not null
     and c.client_id <> cr.client_id;

  if bad_rows > 0 then
    raise exception
      'client_reports_case_client_integrity: % fila(s) en client_reports tienen case_id de un expediente que pertenece a un cliente distinto de client_id. Identifícalas con: select cr.id, cr.client_id, cr.case_id, c.client_id as expediente_client_id from public.client_reports cr join public.cases c on c.id = cr.case_id where cr.case_id is not null and c.client_id <> cr.client_id; -- corrige cada caso manualmente (reasignando client_id, case_id, o quitando el expediente del reporte) antes de reintentar esta migración. No se modificó ningún dato.',
      bad_rows;
  end if;
end;
$$;

alter table public.cases
  add constraint cases_id_client_id_key unique (id, client_id);

alter table public.client_reports
  add constraint client_reports_case_client_fkey
    foreign key (case_id, client_id)
    references public.cases (id, client_id)
    on delete set null (case_id)
    on update no action;

comment on constraint client_reports_case_client_fkey on public.client_reports is
  'Garantiza que, si client_reports.case_id no es null, el expediente referenciado pertenezca realmente a client_reports.client_id. MATCH SIMPLE (comportamiento por defecto): case_id NULL sigue permitido, la constraint no se evalúa en ese caso. ON DELETE SET NULL (case_id): al borrar el expediente, solo se anula case_id, client_id se conserva. ON UPDATE NO ACTION: reasignar cases.client_id se rechaza si dejaría una relación cruzada con algún reporte existente.';

commit;
