-- Fase 6: protección de integridad — el sistema nunca debe quedar sin
-- ningún Administrador activo.
--
-- Problema que resuelve: auditoría confirmó que ninguna capa protegía este
-- escenario. La RLS de public.profiles (policy "profiles_update_admin" en
-- 20260730*_equal_operational_data_access.sql / self-hosted 0006) exige que
-- quien EJECUTA el UPDATE sea Administrador activo, pero no evalúa qué le
-- ocurre a la fila objetivo -- un Administrador puede degradarse a sí mismo
-- a Personal, o desactivarse, sin ninguna restricción, incluso siendo el
-- último Administrador activo del sistema. Tampoco existía ninguna
-- protección de UI. El resultado sería un CRM sin ningún usuario capaz de
-- gestionar personal, plantillas administrativas, Google Calendar, etc.
--
-- Solución: un trigger BEFORE UPDATE/DELETE en public.profiles que, cuando
-- la fila afectada es actualmente un Administrador activo y la operación
-- haría que dejara de serlo (cambio de role, cambio de status, o borrado),
-- cuenta cuántos OTROS Administradores activos quedarían. Si el resultado
-- sería cero, la operación se rechaza con una excepción clara -- la
-- garantía final vive en la base de datos, no solo en la UI (mismo
-- principio ya aplicado en Fases 4B/5B).
--
-- Semántica deliberada: esto NO bloquea que un Administrador se degrade o
-- desactive a sí mismo, ni que otro Administrador lo haga, siempre que
-- quede al menos un Administrador activo distinto -- eso es una acción
-- legítima, no un caso a impedir. Solo se bloquea el caso que dejaría el
-- sistema sin ninguna capacidad administrativa.
--
-- No se introduce ningún nivel adicional de rol (sigue habiendo
-- exactamente Administrador/Personal) ni un campo nuevo -- se usa
-- directamente role/status, las mismas columnas ya existentes.
--
-- Corrección de seguridad (Fase 6B, tras auditoría de concurrencia posterior
-- al primer borrador de esta migración): la versión original de esta misma
-- migración contaba los Administradores activos restantes con un simple
-- `select count(*)`, sin ningún lock. Bajo READ COMMITTED (el nivel de
-- aislamiento por defecto de Postgres, que este proyecto no cambia en
-- ningún lado), dos transacciones que degradan/desactivan/borran a DOS
-- Administradores DISTINTOS no compiten por ningún lock de fila -- cada una
-- bloquea una fila distinta. Sin coordinación adicional, ambas pueden
-- ejecutar su propio `select count(*)` viendo todavía activo al
-- Administrador que la OTRA transacción está a punto de degradar (porque
-- esa otra transacción aún no ha hecho commit), concluir "queda al menos
-- otro Administrador activo" y completar las dos -- dejando el sistema con
-- CERO Administradores activos pese a que el trigger existía. Esto es un
-- caso clásico de "write skew": el trigger protege cada fila individual,
-- pero no serializa el INVARIANTE GLOBAL (el conteo) frente a operaciones
-- concurrentes sobre filas distintas. Se demostró empíricamente contra un
-- Postgres local real antes de corregirlo (ver informe de la fase).
--
-- Corrección: antes de contar, la función adquiere un advisory lock
-- transaccional (pg_advisory_xact_lock) con una única clave lógica fija y
-- compartida para todo el sistema -- "crm:last-active-admin", convertida a
-- bigint de forma determinística vía hashtextextended(text, bigint), sin
-- números mágicos hardcodeados. No se usa el id del usuario como clave:
-- necesitamos serializar el invariante GLOBAL (cuántos Administradores
-- activos quedan en todo el sistema), no cada fila por separado -- dos
-- transacciones que afectan a Administradores distintos deben competir por
-- EL MISMO lock. pg_advisory_xact_lock es transaction-level (sufijo
-- "_xact"): se libera automáticamente al COMMIT o ROLLBACK de la
-- transacción que lo adquirió, sin necesidad de un unlock manual y sin
-- riesgo de dejarlo retenido tras un rollback. La segunda transacción que
-- intente adquirir la misma clave simplemente espera (sin polling, sin
-- sleeps) hasta que la primera termine; en ese momento, su propio `select
-- count(*)` -- una sentencia nueva bajo READ COMMITTED, con su propio
-- snapshot -- ya observa el estado confirmado (commiteado) por la primera
-- transacción, no un estado obsoleto. Como solo existe UN lock lógico en
-- juego (nunca uno por usuario/fila), no hay ningún orden de adquisición
-- que pueda producir un deadlock circular.
--
-- El lock solo se adquiere cuando la fila afectada realmente podría dejar
-- de ser Administrador activo (losing_admin = true) -- nunca en una edición
-- inocua (nombre, teléfono, o cualquier operación que no reduzca el
-- conjunto de Administradores activos), para no serializar innecesariamente
-- el resto de las escrituras sobre profiles.
--
-- La función permanece sin declaración explícita STABLE/IMMUTABLE (el
-- default de PL/pgSQL, VOLATILE, es el correcto y obligatorio aquí: lee
-- estado que cambia entre invocaciones y tiene efectos dependientes de ese
-- estado -- se declara VOLATILE de forma explícita para dejar constancia
-- de que es una decisión deliberada, no un descuido).
--
-- Precheck de datos (Fase 6B): si al aplicar esta migración YA existen 0
-- Administradores activos, el invariante que se busca proteger ya está
-- violado -- activar el trigger en ese estado sería declarar falsamente
-- que la protección existe. La migración verifica esto primero y aborta
-- con una excepción operativa clara si no hay ningún Administrador activo,
-- sin promover ni modificar ningún usuario automáticamente; corregirlo es
-- una decisión humana, no algo que una migración deba decidir en silencio.
--
-- NO se aplica remotamente como parte de esta fase.

begin;

-- Precheck: no activar una protección que ya estaría siendo violada.
do $$
declare
  active_admins integer;
begin
  select count(*)
    into active_admins
    from public.profiles
   where role = 'Administrador'
     and status = 'Activo';

  if active_admins = 0 then
    raise exception
      'prevent_last_admin_removal: no se puede activar la protección porque ya existen 0 Administradores activos en public.profiles. El invariante que esta migración protege ya estaría violado. Corrige manualmente asignando el rol de Administrador a al menos un usuario activo antes de reintentar esta migración. No se promovió ningún usuario automáticamente.';
  end if;
end;
$$;

create or replace function public.prevent_last_admin_removal()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  losing_admin boolean;
  remaining_admins integer;
begin
  if TG_OP = 'DELETE' then
    losing_admin := OLD.role = 'Administrador' and OLD.status = 'Activo';
  else
    losing_admin := OLD.role = 'Administrador' and OLD.status = 'Activo'
      and (NEW.role <> 'Administrador' or NEW.status <> 'Activo');
  end if;

  if losing_admin then
    -- Serializa el invariante GLOBAL (no una fila): ver la nota de
    -- "Corrección de seguridad (Fase 6B)" arriba para el análisis completo
    -- de la carrera que esto evita.
    perform pg_advisory_xact_lock(hashtextextended('crm:last-active-admin', 0));

    select count(*)
      into remaining_admins
      from public.profiles
     where role = 'Administrador'
       and status = 'Activo'
       and id <> OLD.id;

    if remaining_admins = 0 then
      raise exception
        'No se puede completar: el sistema quedaría sin ningún Administrador activo. Asigna el rol de Administrador a otro usuario activo antes de continuar.';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function public.prevent_last_admin_removal() is
  'Impide que un UPDATE o DELETE sobre public.profiles deje al sistema sin ningún Administrador activo, incluso bajo operaciones concurrentes (advisory lock transaccional crm:last-active-admin). Fase 6/6B.';

drop trigger if exists profiles_prevent_last_admin_removal_upd on public.profiles;
create trigger profiles_prevent_last_admin_removal_upd
before update on public.profiles
for each row execute function public.prevent_last_admin_removal();

drop trigger if exists profiles_prevent_last_admin_removal_del on public.profiles;
create trigger profiles_prevent_last_admin_removal_del
before delete on public.profiles
for each row execute function public.prevent_last_admin_removal();

commit;
