# Arquitectura vigente

## Flujo principal

- React 19 y TanStack Router componen la interfaz.
- TanStack Query administra lectura e invalidación por módulo.
- Supabase Auth identifica al usuario y PostgreSQL aplica RLS.
- Clientes conserva nombre, teléfono, correo opcional, estado y datos administrativos.
- Expedientes conserva información operativa; la ficha ya no mantiene un submódulo de personas.
- Tareas funciona como una cola voluntaria independiente de Agenda.
- Agenda lee exclusivamente `agenda_events`.

## Google Calendar

La integración usa un calendario compartido:

1. Un Administrador inicia OAuth en un endpoint de servidor.
2. El servidor valida estado firmado y PKCE.
3. El refresh token se cifra con AES-GCM antes de persistirlo.
4. Las mutaciones locales guardan primero el evento y solicitan sincronización.
5. Google notifica cambios por webhook; el endpoint valida canal, recurso y token.
6. Un proceso programado consume la cola incremental y renueva canales próximos a vencer.

Los secretos se leen desde bindings de Cloudflare o variables exclusivas del proceso servidor.
El cliente web sólo envía peticiones autenticadas a endpoints del mismo origen.

## Seguridad

- `claim_case_task` toma tareas de forma atómica.
- RLS limita creación, edición, reasignación y eliminación según rol.
- Las RPC no son ejecutables por `PUBLIC` ni `anon`.
- Las tablas internas de OAuth, canales y cola no se exponen al navegador.
- La resolución de conflictos de Agenda se reserva al Administrador.

Las migraciones de esta fase son locales y no se han aplicado a ningún entorno remoto.
