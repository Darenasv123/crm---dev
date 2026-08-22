-- Añade un timestamp de claim real a la cola de sincronización de Google
-- Calendar, para poder recuperar de forma segura solicitudes "processing"
-- abandonadas (p. ej. el proceso Node murió a mitad de un ciclo) sin
-- arriesgar procesamiento concurrente de una solicitud que legítimamente
-- sigue en curso.
--
-- Problema que resuelve:
-- `google_calendar_sync_requests` solo tenía `created_at` (fijado al
-- insertar, es decir, cuando llega el webhook) y `processed_at` (fijado
-- solo al completar o fallar). No existía ningún timestamp que registrara
-- CUÁNDO un worker reclamó la fila (pending -> processing). Usar
-- `created_at` como proxy de "tiempo en processing" es incorrecto: una
-- solicitud puede esperar en `pending` un tiempo arbitrario antes de ser
-- reclamada (p. ej. backlog, o el mantenimiento programado corriendo cada
-- 15 minutos), y en ese caso `created_at` ya sería "antiguo" en el momento
-- exacto en que el procesamiento recién comienza — un segundo worker podría
-- considerarla inmediatamente abandonada y reclamarla de nuevo, causando
-- procesamiento concurrente de la misma solicitud.
--
-- Esta migración añade `claimed_at`, que el código fija explícitamente en
-- el mismo UPDATE condicional que transiciona pending -> processing. La
-- detección de "abandonada" pasa a basarse en `claimed_at`, no en
-- `created_at`.
--
-- Segundo problema que resuelve esta misma migración (hardening pre-commit):
-- `runGoogleCalendarScheduledMaintenance()` decide renovar el canal de
-- Google con un patrón "leer si hace falta -> crear canal nuevo -> detener
-- los viejos". Si el endpoint de mantenimiento (o el cron de Cloudflare) se
-- invoca dos veces casi simultáneamente mientras el canal está por expirar,
-- ambas ejecuciones pueden decidir "hace falta renovar" antes de que
-- cualquiera termine, creando DOS canales reales en Google — y cada
-- ejecución, al limpiar "canales viejos", terminaría deteniendo el canal
-- recién creado por la otra, pudiendo dejar la conexión sin ningún canal
-- activo (el webhook deja de recibir notificaciones hasta el próximo ciclo).
--
-- `google_calendar_connections.renewal_claimed_at` añade el mismo patrón de
-- claim optimista ya usado para la cola: antes de renovar, se reclama la
-- conexión con un UPDATE condicional; si otra ejecución ya la reclamó
-- recientemente, esta se abstiene de renovar en este ciclo.
--
-- Caso de upgrade auditado (hardening pre-commit): el bug que esta
-- migración corrige (`processGoogleSyncQueue` sin ningún reclamo de
-- solicitudes abandonadas) ya existía en el código previo a esta fase. Por
-- tanto, en el momento en que esta migración se aplique a una base real, es
-- plausible que existan filas `status='processing'` legítimamente
-- abandonadas (el proceso murió a mitad de un ciclo, antes de que existiera
-- cualquier mecanismo de recuperación). `add column` deja `claimed_at` en
-- NULL para esas filas preexistentes, y `isStaleProcessing()`/el reclamo
-- tratan NULL como "no abandonado" a propósito (más seguro no reclamar por
-- falta de evidencia que reclamar por error) — así que, sin backfill, esas
-- filas legacy quedarían irrecuperables para siempre, exactamente el mismo
-- bug que se está corrigiendo, solo que permanente para ellas.
--
-- Backfill (una sola vez, en la propia migración, no como regla permanente):
-- para las filas `processing` que existan en este momento, se usa
-- `created_at` como la única evidencia disponible — es una subestimación de
-- cuándo se reclamaron realmente (el claim ocurre en o después de
-- created_at, nunca antes), así que el backfill las hace lucir igual de
-- antiguas o más, nunca menos: el efecto es que se reclaman en el primer
-- ciclo posterior a la migración, nunca que se ignoren. La lógica normal
-- después de esta migración sigue usando exclusivamente claimed_at (fijado
-- por el propio claim) — este backfill no reintroduce created_at como regla
-- general, solo resuelve el registro histórico existente en este instante.
--
-- No se aplica remotamente como parte de esta fase.

begin;

alter table public.google_calendar_sync_requests
  add column if not exists claimed_at timestamptz;

comment on column public.google_calendar_sync_requests.claimed_at is
  'Momento en que un worker reclamó la solicitud (pending -> processing). '
  'Null mientras está pending. Se usa para detectar solicitudes abandonadas '
  'en vez de created_at (que refleja la llegada del webhook, no el claim).';

-- Backfill único para filas 'processing' preexistentes al momento del
-- upgrade (ver nota de arriba). No afecta filas 'pending'/'completed'/
-- 'failed', que correctamente no necesitan claimed_at retroactivo.
update public.google_calendar_sync_requests
   set claimed_at = created_at
 where status = 'processing'
   and claimed_at is null;

-- Índice parcial para la consulta de reclamo de solicitudes abandonadas
-- (mismo patrón que el índice parcial ya existente sobre status='pending').
create index if not exists google_calendar_sync_requests_processing_idx
  on public.google_calendar_sync_requests (claimed_at)
  where status = 'processing';

alter table public.google_calendar_connections
  add column if not exists renewal_claimed_at timestamptz;

comment on column public.google_calendar_connections.renewal_claimed_at is
  'Claim optimista para evitar renovaciones de canal concurrentes cuando '
  'dos ejecuciones de mantenimiento se solapan. Ver runGoogleCalendarScheduledMaintenance().';

commit;
