# Configuración de Google Drive (Fases 8B–8D)

**GOOGLE CLOUD CONSOLE NO CONFIGURADA TODAVÍA.** Este documento describe la fundación server-side ya construida en el código y los pasos que faltarán *en el futuro* para activarla — no es una guía para conectar Drive hoy. Google Drive real permanece desconectado; no hay ninguna cuenta, carpeta ni archivo sincronizado.

---

## Estado de la integración

**Fundación implementada** (Fase 8B): schema de base de datos, módulo OAuth server-side, cifrado de tokens, y 4 rutas de API (conectar, callback, estado, desconectar).

**Añadido en Fase 8C**: lectura de carpetas de Drive (solo lectura), selección y persistencia de la carpeta raíz de Clientes, vista previa Cliente ↔ Carpeta, resolución manual de ambigüedades, persistencia atómica de las vinculaciones, y la sección **Configuración → Google Drive**.

**Añadido en Fase 8D (CRM -> Drive)**: creación automática de la carpeta de un Cliente, subida de documentos, propagación del renombrado y traslado a la papelera, todo a través de una cola procesada por un cron.

**Nada de lo siguiente existe todavía**: leer cambios hechos directamente en Drive (`changes.list`, `changes.watch`, webhook), reconciliación completa, ni reemplazo de contenido de un documento. Esas piezas llegan en 8E/8F.

---

## Aislamiento de Google Calendar

### Proyecto de Google Cloud DEDICADO (decisión de arquitectura)

Google Drive debe usar un **proyecto de Google Cloud propio, separado del proyecto que usa Calendar**. No basta con crear un OAuth client distinto dentro del mismo proyecto.

**Motivo técnico concreto:** revocar un token OAuth revoca los grants a nivel de **proyecto**, no solo los del OAuth client que emitió ese token. Si Calendar y Drive comparten proyecto, revocar el acceso de Drive (por ejemplo al desconectar) puede invalidar también los tokens de Calendar y romper una integración que ya está en producción, sin que nadie lo haya pedido.

Un proyecto dedicado da además:

- scope restringido (`.../auth/drive`) aislado del resto;
- pantalla de consentimiento independiente;
- grants OAuth independientes;
- revocación independiente;
- una eventual verificación de Google acotada solo a Drive;
- cero riesgo sobre Calendar.

**Consecuencia en el código actual:** mientras ese proyecto dedicado no exista, el módulo de Drive **nunca llama al endpoint de revocación de Google**. La desconexión es exclusivamente local (ver más abajo). La revocación remota solo se reintroducirá cuando Drive tenga su propio proyecto.

### OAuth client separado

Drive usa además un **OAuth client completamente separado** — nunca comparte `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. El código nunca hace *fallback* silencioso a las credenciales de Calendar si faltan las de Drive: si Drive no está configurado, las rutas devuelven un error explícito de configuración, no una conexión sustituta con la cuenta equivocada.

Ambos servicios sí pueden reutilizar `GOOGLE_OAUTH_STATE_SECRET` y `GOOGLE_TOKEN_ENCRYPTION_KEY` (son secretos genéricos de firma/cifrado, no específicos de un servicio de Google en particular).

### Independencia del código

`src/lib/google-drive/google-drive.server.ts` **no importa nada** de `google-calendar.server.ts`. Las primitivas equivalentes (comparación en tiempo constante, saneado de errores, umbral de operaciones abandonadas) están implementadas de forma propia dentro del módulo de Drive, con sus propios tests. Un cambio en Calendar no puede alterar el comportamiento de Drive, ni al revés.

---

## Desconexión (local, sin llamar a Google)

`POST /api/google-drive/disconnect`:

- marca la conexión como `disconnected`;
- **destruye** el `encrypted_refresh_token` (lo deja en `NULL`) — una conexión desconectada nunca conserva material reutilizable;
- conserva la fila como rastro auditable de quién conectó y cuándo;
- **no llama a Google** (ver el motivo del proyecto dedicado, arriba);
- no borra Clientes, no borra Documentos, no toca Calendar.

Después de desconectar, esa conexión no puede volver a obtener un access token. Para volver a usar Drive hay que pasar por el flujo OAuth completo otra vez, que emite un grant y un token nuevos.

---

## Variables de entorno

Estas variables deben configurarse en `.env.production` del servidor **cuando llegue el momento de conectar Drive real** — no antes:

| Variable | Descripción |
|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` | Client ID de un OAuth Web Client de Google **distinto** del que usa Calendar |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Client Secret correspondiente (secreto) |
| `GOOGLE_DRIVE_REDIRECT_URI` | `https://abogado.consoldi.com/api/google-drive/callback` |

**No se necesita ninguna variable nueva de cifrado ni de firma de estado** — Drive reutiliza `GOOGLE_OAUTH_STATE_SECRET` y `GOOGLE_TOKEN_ENCRYPTION_KEY`, ya configuradas para Calendar.

**Drive es opcional.** Su ausencia no impide que el CRM arranque ni afecta a ninguna otra funcionalidad — `/api/google-drive/status` simplemente responde `{ configured: false }`.

No se documentan aquí valores reales de ninguna variable. No pegar secretos reales en este archivo ni en ningún archivo versionado.

---

## Scope solicitado

```
openid email https://www.googleapis.com/auth/drive
```

**No `drive.file`.** El diseño (Fase 8A) requiere detectar archivos que el personal jurídico añada directamente en Drive, fuera del CRM — un caso que `drive.file` no puede cubrir por diseño de Google (ese scope solo da acceso a lo que la app creó o el usuario seleccionó explícitamente vía Picker, nunca a archivos preexistentes o añadidos después sin pasar por ahí). El scope está centralizado en una sola constante (`GOOGLE_DRIVE_SCOPES` en `src/lib/google-drive/google-drive.server.ts`), no repetido en varios lugares.

El callback verifica que el scope efectivamente concedido por Google incluya `.../auth/drive` antes de guardar la conexión — si Google concede menos de lo solicitado, la conexión falla de forma explícita y no se persiste nada incompleto.

---

## Rutas de la aplicación

| Ruta | Método | Descripción |
|---|---|---|
| `/api/google-drive/connect` | POST | Solo Administrador. Genera PKCE + state, devuelve `{ authorizationUrl }`. |
| `/api/google-drive/callback` | GET | Recibe el `code` de Google. Redirige a `/configuracion?googleDrive=connected\|error`. |
| `/api/google-drive/status` | GET | Solo Administrador. Estado sanitizado — nunca tokens ni secretos. |
| `/api/google-drive/disconnect` | POST | Solo Administrador. Desconexión **local**: destruye el refresh token cifrado. No llama a Google. |

Añadidas en **Fase 8C** (carpeta raíz y onboarding, todas solo Administrador):

| Ruta | Método | Descripción |
|---|---|---|
| `/api/google-drive/folders` | GET | Lista las subcarpetas directas de `parentId` (o de Mi unidad). Solo acepta `parentId`. |
| `/api/google-drive/root-folder` | POST | Fija la carpeta raíz de Clientes. Solo acepta `folderId`; el nombre lo obtiene el servidor de Google. |
| `/api/google-drive/onboarding/preview` | GET | Vista previa Cliente ↔ Carpeta. Solo lectura: no escribe en Supabase ni en Drive. |
| `/api/google-drive/onboarding/apply` | POST | Persiste un lote de vinculaciones, revalidado contra Google y aplicado de forma atómica. |

Añadidas en **Fase 8D** (CRM -> Drive):

| Ruta | Método | Descripción |
|---|---|---|
| `/api/google-drive/sync-client` | POST | Productor: encola asegurar la carpeta de un Cliente. Solo acepta `clientId`. |
| `/api/google-drive/sync-document` | POST | Productor: encola subir o renombrar un documento. Solo acepta `documentId`. |
| `/api/google-drive/prepare-document-trash` | POST | Productor: encola el traslado a la papelera antes de borrar. Exige permiso de eliminar documentos. |
| `/api/google-drive/maintenance` | POST | Máquina a máquina: procesa la cola. Secreto dedicado, nunca sesión de Administrador. |

**No existen todavía** (llegan en 8E/8F): `/api/google-drive/webhook` y el sondeo de cambios.

---

## Cambios futuros en Google Cloud Console (NO ejecutados en esta fase)

En un **proyecto de Google Cloud NUEVO y dedicado a Drive** (no el que usa Calendar — ver el razonamiento arriba):

1. Crear el proyecto dedicado para la integración de Drive del CRM.
2. Habilitar la **Google Drive API** en ese proyecto nuevo.
3. Crear un **OAuth Client Web** en ese proyecto (independiente del de Calendar en todo sentido: otro proyecto, otro client, otro grant).
4. Añadir el callback de Drive a los "Authorized redirect URIs" de ese client: `https://abogado.consoldi.com/api/google-drive/callback` (y el equivalente de `localhost` para desarrollo).
5. Configurar la pantalla de consentimiento OAuth **de ese proyecto** (no se toca la de Calendar).
6. Añadir el scope `https://www.googleapis.com/auth/drive` (ver el análisis de scope en el informe de Fase 8A: `drive.file` no cubre el requisito de detectar archivos añadidos directamente en Drive).
7. Determinar si el proyecto se publica como **Internal** (cuenta Google Workspace del estudio) o **External** (Gmail personal) — esto cambia si Google exige verificación.
8. Evaluar la verificación de Google (incluida una posible evaluación CASA para scopes restringidos) **únicamente si el escenario External aplica realmente**. Al estar en un proyecto dedicado, cualquier proceso de verificación afecta solo a Drive y nunca a Calendar.

**No ejecutar ninguno de estos 8 pasos todavía.**

---

## Por qué NO se usa Google Picker

El selector de carpetas es propio (`/api/google-drive/folders` + un diálogo del CRM), **no** el Google Picker.

Google Picker se ejecuta en el navegador y exige que la página le entregue un **access token de Drive** (y además una API key de navegador). En esta arquitectura la conexión de Drive representa a **todo el estudio**, no al usuario que tiene el navegador abierto: entregar ese token al front daría, desde la consola del navegador, acceso directo a todo el Drive del estudio, saltándose por completo las restricciones que aplican estos endpoints (solo carpetas, solo dentro de la raíz, solo Administrador).

Consecuencias concretas de esta decisión:

- el access token y el refresh token **nunca** salen del servidor;
- no se carga ningún script de `apis.google.com`;
- no hace falta crear ni exponer una API key de navegador;
- el servidor construye íntegramente la consulta a Drive: el cliente solo puede enviar un `parentId`, nunca `q`, `fields` ni una URL.

---

## Cómo funciona CRM -> Drive (Fase 8D)

### El CRM nunca depende de Drive

Drive es una integración **secundaria**. Cuando se crea un Cliente o se sube un documento, la operación del CRM se completa primero y solo después se **encola** el trabajo de Drive. Si Google está caído, mal configurado o desconectado, la operación del CRM sigue siendo un éxito y el trabajo queda pendiente. En ningún caso se revierte un documento porque Drive fallara.

Como contrapartida asumida, un encolado puntual puede perderse (el navegador se cierra justo después de guardar, un importador inserta documentos por otra vía). La reconciliación de Fase 8F reparará esos huecos, pero **por dos vías distintas según el tipo de evento perdido** -- ver la subsección siguiente, porque no todos los huecos se ven de la misma forma.

### Contrato de reconciliación para 8F: no todo se ve desde la misma base de datos (Fase 8D.1)

Es importante no dar a entender que un simple barrido de la base de datos del CRM basta para reparar cualquier evento de sincronización perdido. Depende de qué se perdió:

**Creates/uploads perdidos (Cliente sin carpeta, documento sin copia): reconciliables desde el CRM.**
Si nunca se encoló `ensure_client_folder` o `upload_document` -- o el trabajo se perdió antes de completarse -- el Cliente y el Documento **siguen existiendo** en las tablas del CRM. Un barrido que compare `clients`/`documents` contra `google_drive_client_folders`/`google_drive_document_files` encuentra el hueco sin más: basta con consultar la propia base de datos del CRM.

**Deletes perdidos (papelera nunca ejecutada): NO son visibles desde la base de datos del CRM.**
Si `prepare-document-trash` falla en silencio (best-effort, por diseño) y el documento se borra igualmente, ocurre lo siguiente: el documento desaparece de `documents`, y `google_drive_document_files` desaparece con él por su propio `ON DELETE CASCADE`. **No queda ningún rastro en el CRM de que ese documento -- ni su copia en Drive -- existieron alguna vez.** Un barrido que solo mire la base de datos del CRM no tiene con qué compararse: no hay ninguna fila que apunte a un archivo huérfano, porque la fila que lo habría señalado ya no existe.

Por eso Fase 8F **debe** incluir una reconciliación del lado de Drive, no solo del lado del CRM: listar archivos con `appProperties.crm_entity = "document"` directamente en Drive (aprovechando que esas `appProperties` ya se escriben desde Fase 8D, ver más abajo) y, para cada uno, comprobar si `appProperties.crm_document_id` sigue existiendo en `documents`. Si no existe, es un **archivo huérfano** dejado por un borrado que nunca llegó a ejecutarse en Drive.

**En Fase 8D no se implementa ninguna de las dos reconciliaciones.** Tampoco se decide aquí qué hacer con un huérfano detectado (¿papelera automática? ¿solo reportarlo para revisión?) -- esa política pertenece a Fase 8F.

### Idempotencia: identificadores reservados por adelantado

Antes de crear nada en Drive se pide un identificador con `files.generateIds` y se **reserva en PostgreSQL**. Cualquier reintento reutiliza ese mismo identificador. Si un intento anterior llegó a crear el objeto pero se perdió la respuesta, el reintento recibe un `409` y, en vez de crear un duplicado, consulta el objeto y comprueba su identidad mediante `appProperties`. Si coincide, se da por hecho; si el identificador pertenece a otra cosa, se detiene con `DRIVE_IDENTITY_CONFLICT` y no crea nada.

Las `appProperties` contienen **solo identificadores internos** (`crm_entity`, `crm_client_id`, `crm_document_id`). Nunca nombre, DNI, teléfono, correo, materia ni expediente: son datos que viven en Google. Se usa `appProperties` y no `properties` porque las segundas serían visibles para cualquiera con acceso al archivo.

### Carpetas de Cliente: nunca duplicar por nombre

Antes de crear la carpeta de un Cliente se listan las subcarpetas de la raíz y se aplica el mismo clasificador de Fase 8A. Si aparece **cualquier** candidata (idéntica, equivalente o ambigua) no se crea nada y el trabajo queda como `CLIENT_FOLDER_REVIEW_REQUIRED`, para que el Administrador lo resuelva en **Revisar coincidencias**. Solo se crea automáticamente cuando no hay ninguna candidata. Así se evita acabar con "Juan Pérez" y "Juan Perez" conviviendo del lado de Drive.

**Y del lado del CRM (Fase 8D.1):** la protección anterior asume que el nombre del Cliente es único, pero el CRM nunca lo exige -- dos personas distintas pueden llamarse igual, y no se añadió ninguna restricción `UNIQUE` sobre el nombre normalizado para prohibirlo (el modelo jurídico de `clients` no cambia). Por eso, antes de crear la carpeta se comprueba también si **otro Cliente del CRM** normaliza al mismo nombre (con la misma `normalizeClientName` del matching de 8A, sin una tercera regla). Si existe, el trabajo se detiene con `CLIENT_NAME_REVIEW_REQUIRED` -- crear automáticamente arriesgaría mezclar los documentos de dos personas distintas bajo una sola carpeta homónima, o crear dos carpetas casi idénticas, y ninguna de las dos cosas es segura sin que alguien decida. Esta comprobación no bloquea la reconciliación de un Cliente que **ya** tenía una carpeta reservada antes de que apareciera el homónimo: solo protege la decisión de crear una carpeta nueva.

### Subida: multipart y resumable

Hasta 5 MB se usa `uploadType=multipart` (una sola petición); por encima, `uploadType=resumable` (init, `Location`, `PUT`), para no tener que reenviar el archivo entero si se corta la conexión. No se usa `media` porque hace falta enviar metadata junto al contenido: el identificador reservado, el nombre, la carpeta y las `appProperties`. El contenido se lee del Storage con el service role y se le reaplican las reglas documentales del CRM (extensiones permitidas y límite de 10 MB).

**Recuperación de una subida resumable interrumpida (Fase 8D.1).** Un `PUT` que falla a mitad de subida (red cortada, `5xx`) no hace abandonar la sesión: primero se pregunta a Google en qué punto se quedó, con el sondeo que documenta la propia API (`PUT` vacío con `Content-Range: bytes */TOTAL`). Según la respuesta:

- `200`/`201` -- el archivo ya se terminó de subir (se perdió solo la confirmación); se da por éxito sin reintentar nada.
- `308` con cabecera `Range` -- retoma exactamente desde el byte siguiente al confirmado, sin reenviar lo que ya llegó.
- `308` sin `Range` -- no se confirmó ningún byte; retoma desde el principio de esa misma sesión.
- `404` -- la sesión caducó. Antes de abrir otra, se comprueba si el archivo ya existe con el identificador reservado (`files.get`); si existe y su identidad coincide, éxito sin nueva sesión. Si no existe, se abre una sesión nueva -- **con el mismo identificador reservado**, nunca uno nuevo.
- `429`/`5xx` (incluso en el propio sondeo) -- transitorio; se propaga como tal para que la cola lo reintente con su backoff, nunca como un bucle dentro del mismo worker.

Cada ejecución del worker limita sus propios reintentos internos (`MAX_RESUMABLE_ATTEMPTS_PER_RUN`); agotados, el error transitorio sube a la cola. La URL de la sesión resumable es una *capability URL* -- quien la tenga puede escribir en ese archivo sin más credenciales -- así que **nunca** se persiste en PostgreSQL, en el payload de la cola, ni en un log: vive solo en memoria durante esa ejecución. Si el proceso muere del todo, la sesión se pierde sin más consecuencia: la siguiente ejecución sigue protegida por el identificador reservado, que es la garantía real contra duplicados.

### Borrado: papelera, nunca definitivo

El CRM **nunca** hace `files.delete`. Lo único que hace es mover a la papelera (`trashed: true`), reversible durante 30 días.

La secuencia está pensada para que un borrado fallido no destruya nada: el trabajo se encola **antes** del borrado, con un margen; la clave de la cola apunta al documento con `ON DELETE SET NULL`, así que **que ese campo pase a NULL es la prueba de que el borrado se consumó**. Si el documento sigue existiendo cuando el worker se despierta, la copia en Drive no se toca y el trabajo se reprograma; agotados los reintentos termina como `DOCUMENT_STILL_EXISTS` sin haber movido nada.

Eliminar un Cliente **no** mueve su carpeta a la papelera: puede contener material manual u otros documentos. Las carpetas huérfanas quedan fuera de alcance por ahora.

### Procesamiento de la cola

`POST /api/google-drive/maintenance` procesa el lote pendiente. Es máquina a máquina: se autentica con `GOOGLE_DRIVE_MAINTENANCE_SECRET` en la cabecera `X-Maintenance-Secret`, comparada en tiempo constante, y **no** acepta una sesión de Administrador (un cron no tiene usuario). Si el secreto no está configurado responde `503`.

Por eso `validate-production-env.mjs` lo exige **condicionalmente**: Google Drive en su conjunto sigue siendo opcional, pero si las credenciales de Drive están configuradas, el secreto pasa a ser obligatorio -- sin él la cola no la procesaría nadie y los documentos se quedarían encolados en silencio.

Los reintentos usan `available_at` con un backoff acotado (30 s, 2 min, 5 min, 15 min, 30 min) y un máximo de 5 intentos. Cuota y errores 5xx se reintentan; permisos y conflictos de identidad no.

---

## Limitación conocida: Drive puede cambiar fuera del CRM

Drive es un sistema externo y **no existe atomicidad distribuida** entre Google y PostgreSQL. Al vincular un cliente, el servidor revalida la carpeta contra Drive (existe, es carpeta, no está en la papelera, cuelga de la raíz) inmediatamente antes de escribir, y la escritura es atómica y serializada — pero entre esa validación y el COMMIT queda una ventana en la que alguien con acceso al Drive puede mover o borrar la carpeta.

Esto **no se intenta resolver con una transacción distribuida**: el remedio sería peor que el problema. Se asume como limitación conocida y se resuelve por detección posterior: la sincronización de **Fase 8F** comparará el padre real de cada carpeta con el esperado y marcará `DRIVE_PARENT_MISMATCH` como conflicto para que una persona lo resuelva. En ningún caso se reasignará `client_id` de forma automática — el CRM es la autoridad de la relación jurídica.

---

## Lo que NO hace todavía

- No lee cambios hechos directamente en Drive: sin `changes.list`, `changes.watch` ni webhooks.
- No reemplaza el contenido de un documento ya subido (el CRM tampoco lo ofrece).
- No reconcilia eventos perdidos: eso llega en 8F.
- No importa nada de Drive al CRM.
- No mueve a la papelera la carpeta de un Cliente eliminado.

---

## Nota sobre tokens

Este documento **nunca** debe incluir instrucciones para pegar un `refresh_token` o `access_token` manualmente en ningún lugar (BD, `.env`, panel de administración). La única forma prevista de obtener un token es el flujo OAuth completo (`/api/google-drive/connect` → consentimiento de Google → `/api/google-drive/callback`), que cifra el `refresh_token` antes de guardarlo y nunca persiste el `access_token`.
