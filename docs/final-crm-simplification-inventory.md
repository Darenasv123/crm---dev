# Fase 4.3 — Inventario técnico previo

Fecha: 2026-07-29
Rama local de trabajo: `feature/final-crm-simplification`
Punto de partida verificado: `4a4f9702fc04016fdc6047ea64e4c01e7f7e1af2`

## Límites de esta fase

- Los cambios se preparan y validan únicamente en local.
- No se aplican migraciones a Supabase remoto.
- No se ejecutan `db push`, despliegues ni sincronizaciones reales con Google.
- No se escriben secretos, tokens, correos, calendarios ni datos personales reales.
- Las migraciones destructivas quedan separadas y pendientes de respaldo, revisión y aprobación.

## Inventario de clientes

La tabla `public.clients` conserva campos que ya no pertenecen al CRM final:
`dni`, `document_type`, `document_number`, `whatsapp`, `occupation`,
`address`, `birthdate`, `civil_status`, `notes` y `process_type`.
`email` y `phone` ya admiten `null` en los tipos locales; la migración aditiva lo
declara expresamente para tolerar instalaciones con un esquema anterior.

Dependencias activas detectadas:

- altas, edición, búsqueda y detalle de clientes;
- validación y detección de duplicados;
- búsqueda global;
- importadores CSV, ZIP y carpetas;
- reportes y exportaciones;
- datos de demostración, pruebas y herramienta de migración.

Modelo objetivo: `name`, `phone`, `email` opcional, `status`, `registered` y
metadatos técnicos (`id`, `initials`, `color`, marcas de tiempo). La detección
de duplicados se limita a nombre, teléfono y correo normalizados.

## Inventario de expedientes

La tabla `public.cases` contiene `case_stage`, `court`, `juzgado`,
`judicial_district` y `judge_or_prosecutor`, con dependencias en formularios,
detalle, búsqueda global, chatbot, importadores y datos demo.

El panel `case-parties-panel.tsx`, el hook de gestión legal y la búsqueda global
consumen `public.case_parties`. No se detectó una dependencia de RLS de clientes
que obligue a conservar los campos personales eliminados. La tabla
`case_parties` se mantiene físicamente durante esta fase para no destruir
información sin respaldo; se retiran sus rutas visuales, hooks y consultas
activas. Su eliminación queda fuera de la migración destructiva hasta completar
un inventario remoto de datos y dependencias.

Modelo objetivo visible de expedientes: cliente, código/número, tipo de proceso,
materia, estado, responsables, siguiente acción, resumen, fechas y metadatos
operativos. Los cinco campos judiciales obsoletos se retiran del runtime.

## Inventario de tareas

`public.case_tasks` usa actualmente `due_date` e `is_all_day`; esos campos
alimentan filtros por fecha, vencidos, próximos, agenda, formularios, tablero y
métricas. La migración local anterior también permite que Personal inserte
tareas propias, lo cual contradice el flujo final.

Modelo objetivo:

- Administración crea tareas pendientes y sin asignar.
- Personal reclama una tarea disponible mediante la RPC atómica
  `claim_case_task`.
- `claimed_at` y `claimed_by` registran la toma.
- Administración puede liberar o reasignar.
- Personal puede devolver únicamente una tarea propia.
- No hay fecha, hora, “todo el día”, vencidos ni próximos.
- Las vistas se definen por propiedad y estado: disponibles, propias, en
  ejecución, todas y tablero.

`due_date` e `is_all_day` se conservan temporalmente como columnas legacy para
no destruir historial, pero dejan de participar en UI, consultas y lógica de
negocio. Su eliminación física solo puede ocurrir en una fase destructiva
posterior y respaldada.

## Inventario de agenda

`public.agenda_events` es la única fuente funcional de la agenda final. El
runtime actual mezcla eventos con tareas y ejecuta OAuth de Google desde el
navegador, usa `VITE_GOOGLE_CLIENT_ID`, guarda el access token en
`localStorage`, consulta el calendario primario y realiza sincronizaciones
completas por rango.

Ese diseño se reemplaza por una frontera de servidor:

- flujo OAuth Authorization Code con `state` firmado y acceso offline;
- refresh token cifrado en reposo con AES-GCM;
- calendario compartido identificado por configuración de servidor;
- `syncToken` persistido, resincronización completa tras HTTP 410;
- canal webhook persistido y validado por identificador, recurso y token;
- renovación explícita del canal;
- mapeo estable entre evento local y evento Google;
- registro de errores y estado de sincronización.

Los endpoints y servicios se preparan en local. Sin credenciales reales solo se
validan contratos, seguridad y respuestas de configuración incompleta.

## Inventario de reportes

La pantalla contiene dos flujos titulados “Crear reporte para el cliente”.
`ClientReportForm` es el flujo canónico. El formulario inline duplicado agrega
“Tipo” y “Expediente relacionado” y debe retirarse junto con su estado y
mutaciones. Los documentos generados aún incluyen identificación personal y
deben quedar limitados a los datos simples del cliente.

## Estrategia de migraciones

1. `20260729210000_simplify_clients_and_cases.sql`: cambios aditivos y
   compatibilidad previa al corte.
2. `20260729211000_task_claim_workflow.sql`: columnas de reclamación, RPC
   atómica, políticas y permisos.
3. `20260729212000_google_calendar_sync.sql`: configuración cifrada, mapeos,
   tokens de sincronización, canales y auditoría técnica.
4. `20260729213000_drop_deprecated_client_case_fields.sql`: eliminación
   destructiva separada de campos obsoletos de clientes y expedientes.

La cuarta migración no se aplicará hasta contar con respaldo verificado,
regeneración de tipos contra staging, comprobación de consumidores externos y
aprobación explícita. Ninguna migración de este bloque se aplica remotamente en
esta fase.

## Riesgos y decisiones

- La base remota puede no coincidir con los tipos locales; las migraciones usan
  precondiciones y el despliegue futuro debe ejecutarse primero en staging.
- Los tokens OAuth nunca deben alcanzar el cliente ni almacenarse sin cifrar.
- Un webhook de Google notifica cambios, pero no contiene el evento; el servidor
  debe validar el canal y luego ejecutar sincronización incremental.
- La sincronización bidireccional necesita una política determinista de
  conflictos. Se adopta “última modificación válida” con marcas remotas/locales
  y una ventana anti-eco; los borrados se propagan mediante tombstones.
- Se conserva `case_parties` y las columnas legacy de vencimiento hasta disponer
  de respaldo y evidencia remota suficiente; conservar datos no implica
  mantenerlos expuestos en el producto.
- `database.types.ts` se actualiza manualmente para compilar contra las
  migraciones preparadas. Debe regenerarse desde staging antes de producción.
