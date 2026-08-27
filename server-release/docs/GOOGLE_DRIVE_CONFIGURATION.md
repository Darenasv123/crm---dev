# Configuración de Google Drive (Fases 8B–8E)

**GOOGLE CLOUD CONSOLE NO CONFIGURADA TODAVÍA.** Este documento describe la fundación server-side ya construida en el código y los pasos que faltarán *en el futuro* para activarla — no es una guía para conectar Drive hoy. Google Drive real permanece desconectado; no hay ninguna cuenta, carpeta ni archivo sincronizado.

---

## Estado de la integración

**Fundación implementada** (Fase 8B): schema de base de datos, módulo OAuth server-side, cifrado de tokens, y 4 rutas de API (conectar, callback, estado, desconectar).

**Añadido en Fase 8C**: lectura de carpetas de Drive (solo lectura), selección y persistencia de la carpeta raíz de Clientes, vista previa Cliente ↔ Carpeta, resolución manual de ambigüedades, persistencia atómica de las vinculaciones, y la sección **Configuración → Google Drive**.

**Añadido en Fase 8D (CRM -> Drive)**: creación automática de la carpeta de un Cliente, subida de documentos, propagación del renombrado y traslado a la papelera, todo a través de una cola procesada por un cron.

**Añadido en Fase 8E (Drive -> CRM, consumidor)**: importación de un archivo añadido manualmente en una carpeta de Cliente ya vinculada, como un documento real del CRM (`import_drive_file`). Es exclusivamente el **consumidor**: nada en esta fase detecta ni produce ese evento por sí solo.

**Nada de lo siguiente existe todavía**: descubrimiento automático de archivos nuevos (`changes.list`, `changes.watch`, webhook), reconciliación completa, exportación de archivos nativos de Google Workspace, ni reemplazo de contenido de un documento. Esas piezas llegan en 8F (descubrimiento/reconciliación) o quedan explícitamente diferidas sin fecha (Workspace export, reemplazo de contenido).

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
| `GOOGLE_DRIVE_WEBHOOK_URL` | (Fase 8F, opcional) `https://abogado.consoldi.com/api/google-drive/webhook`. HTTPS siempre que se use de verdad -- nunca `localhost` en producción. Sin esta variable, el watch queda deshabilitado y el CRM sigue funcionando: el poll periódico (mantenimiento) es la vía de durabilidad real, el watch solo reduce la latencia. |

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

**Fase 8E deliberadamente NO añade ninguna ruta.** El consumidor de `import_drive_file` (`enqueueGoogleDriveImportFile`) es server-only: no existe -- ni existirá con esa forma -- un `POST /api/google-drive/import-file` que acepte un `driveFileId` del navegador. Ver "Cómo funciona Drive -> CRM" más abajo.

Añadida en **Fase 8F** (sincronización automática):

| Ruta | Método | Descripción |
|---|---|---|
| `/api/google-drive/webhook` | POST | Receptor de notificaciones de `changes.watch`. Sin sesión ni secreto de mantenimiento -- la autoridad es el propio canal (`channel_id` + hash del `channel_token`, verificados en tiempo constante). Siempre ligero: solo encola `poll_changes`, nunca llama a Google. Ver "Cómo funciona la sincronización automática" más abajo. |

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

## Cómo funciona Drive -> CRM (Fase 8E, solo consumidor)

Fase 8E construye únicamente el **importador**: dado un `drive_file_id` que alguien ya identificó como "archivo nuevo", lo convierte en un documento real del CRM de forma segura e idempotente. Nada en esta fase detecta ese archivo por su cuenta -- ni `changes.list`, ni `changes.watch`, ni ningún webhook. El helper `enqueueGoogleDriveImportFile` (server-only, sin endpoint HTTP: ver más abajo) es exactamente lo que **Fase 8F** invocará cuando implemente el descubrimiento automático.

### Alcance V1: solo hijos directos, solo blobs

Solo se importan archivos cuyo padre **directo** sea la carpeta de un Cliente ya vinculada y sincronizada. Un archivo dentro de una subcarpeta ("Expediente 2025/demanda.pdf") **nunca** se interpreta automáticamente -- eso sería inferencia jurídica sobre qué expediente corresponde, y esta integración no toma esa decisión por nadie. Igualmente, `case_id` siempre queda `NULL` y `type`/`document_type` siempre `'Otros'`: ningún nombre de archivo, subcarpeta o convención se usa para adivinar el expediente o el tipo de documento.

Solo se importan **blob files** -- PDF, DOCX, imágenes, hojas de cálculo de Office, cualquier cosa con bytes reales. Los tipos nativos de Google Workspace (Docs, Sheets, Slides, Drawings, Forms, Apps Script, Sites, Jamboard...) se rechazan con `GOOGLE_WORKSPACE_FILE_UNSUPPORTED`; carpetas y accesos directos con `DRIVE_ENTRY_NOT_IMPORTABLE`. Ninguno de los dos casos llama nunca a `files.export` -- convertir un Doc nativo a DOCX/PDF automáticamente cambiaría su representación, generaría una copia-snapshot fuera de nuestro control y complicaría cualquier edición futura. Queda deliberadamente diferido a una fase posterior, con una política explícita que decida el formato de exportación -- no forma parte de este release.

### Nunca resucitar lo que el CRM ya gestiona o ya borró

Antes de tratar un archivo como "nuevo", se leen sus `appProperties`. Si contienen `crm_entity="document"` (la misma marca que Fase 8D escribe al subir), el archivo **no** es un documento inbound: es una subida outbound existente, o el rastro de un documento que el CRM ya eliminó.

- El documento referenciado existe y su mapping coincide con este archivo -> ya gestionado, no-op.
- El documento existe pero el mapping no coincide o falta -> `OUTBOUND_MAPPING_REPAIR_REQUIRED`; Fase 8F reconciliará, aquí nunca se crea un segundo documento.
- **El documento ya NO existe en el CRM -> `OUTBOUND_ORPHAN_REVIEW_REQUIRED`. Nunca se reimporta.** Este es exactamente el caso de un `prepare-document-trash` que se perdió y un borrado que sí se ejecutó (ver la limitación de reconciliación de borrado más abajo): el archivo huérfano en Drive jamás vuelve a convertirse en un documento del CRM por su cuenta.
- `appProperties` con `crm_entity` presente pero con una forma irreconocible (falta algún campo, o el entity no es uno conocido) -> `DRIVE_APP_PROPERTY_CONFLICT`. Nunca se ignora en silencio.

### Doble comprobación: Drive puede cambiar entre validar y descargar

Entre confirmar que un archivo es válido y terminar de descargarlo, Drive -- un sistema externo -- puede cambiar: alguien lo renombra, lo mueve a otra carpeta (incluso la de otro Cliente), lo actualiza, o lo manda a la papelera. Por eso se toman dos fotos de metadata (M1 antes de descargar, M2 después) y se comparan id, versión, `modifiedTime`, padres, papelera, nombre y checksum. Cualquier diferencia -> `DRIVE_FILE_CHANGED_RETRY`, sin escribir nada: ni Storage ni base de datos. Un archivo movido de la carpeta del Cliente A a la del Cliente B a mitad de la descarga **no** se importa a A ni a B en ese intento -- el próximo ciclo lo reprocesará contra el estado ya estable.

También se verifica el tamaño real descargado (nunca solo `metadata.size`, que puede faltar o estar desactualizado) con un tope duro durante la propia lectura del stream, y -- cuando Drive lo reporta -- el MD5 de los bytes descargados contra `md5Checksum`. El SHA-256 local sigue siendo el baseline propio del CRM; ninguno sustituye al otro.

**Añadido en Fase 8E.1** -- la descarga es estrictamente streaming, sin ninguna ruta de recuperación con `arrayBuffer()`: si `response.body` no llega como stream, se falla de forma clasificable (transitorio) en vez de materializar la respuesta completa en memoria antes de poder acotarla. Y antes de siquiera pedir `alt=media`, `metadata.size` se valida con un parseo seguro (formato decimal, comparación por `BigInt` contra el límite real): si falta o tiene un formato que no se puede confiar, se rechaza con `DRIVE_FILE_SIZE_UNKNOWN` sin descargar nada -- nunca se procede a ciegas solo porque el tope real de bytes durante el stream seguiría acotando la respuesta. Al terminar de leer el stream, el total de bytes real se compara contra `metadata.size`; si no coincide, `DRIVE_DOWNLOAD_SIZE_MISMATCH` (reintentable) -- otra verificación barata de la misma clase de problema que M1/M2 detecta.

### Idempotencia ante un crash

Igual que el flujo outbound, la identidad se reserva ANTES de escribir en Storage: `target_document_id` y `storage_path` se persisten en el `payload` de la propia fila de la cola la primera vez, y cualquier reintento los reutiliza tal cual. Si el proceso muere entre "subí a Storage" y "finalicé el documento en la base de datos", el reintento encuentra el mismo path ya ocupado, compara su SHA-256 y -- si coincide -- lo reutiliza sin escribir un segundo blob. Si no coincide (otra identidad ocupa ese path), `STORAGE_IMPORT_IDENTITY_CONFLICT`, nunca un `overwrite`.

La finalización (creación de `documents` + `google_drive_document_files`) corre en una única transacción de PostgreSQL. Repetir exactamente el mismo import es idempotente; si el mismo `drive_file_id` ya fue importado por otro proceso con un `target_document_id` distinto, nunca se crea un segundo documento.

### Compensación de Storage cuando se pierde la carrera permanentemente

**Añadido en Fase 8E.1.** Si la finalización responde `DRIVE_FILE_ALREADY_IMPORTED` o `IMPORT_IDENTITY_CONFLICT` -- otro proceso ganó de forma permanente, la RPC es atómica y nuestro `target_document_id` nunca llegó a insertarse --, el blob que este intento escribió (o reutilizó de un crash previo -- ambos casos por igual) queda huérfano. Antes de borrarlo se consulta la propia base de datos: si algún `documents.storage_path` coincide con la ruta reservada, **no se borra**, sin importar si fue este intento quien la creó. Solo cuando ningún documento la referencia se intenta un `remove` best-effort; un fallo ahí no cambia el resultado de la finalización (el objetivo de sincronización ya está cumplido por el ganador) ni se reintenta indefinidamente dentro de este worker. Ante cualquier otro error -- transitorio, de conexión, de base de datos -- el blob se conserva siempre para que el reintento lo reutilice; el cleanup solo actúa ante un conflicto permanente confirmado. Este cleanup best-effort no garantiza cero objetos huérfanos en absoluto: una reconciliación operativa futura (8F o posterior) puede detectar y resolver los residuos excepcionales que queden.

### No hay endpoint HTTP de importación

Deliberadamente no existe ningún `POST /api/google-drive/import-file` que acepte un `driveFileId` del navegador -- convertiría al CRM en un proxy para importar cualquier archivo cuyo identificador alguien conociera. `enqueueGoogleDriveImportFile` es server-only: solo código de servidor de confianza puede invocarlo (hoy, los tests; en Fase 8F, el propio consumidor de `changes.list`).

### Atribución honesta

Un documento importado automáticamente no lo subió ninguna sesión interactiva del CRM, así que `documents.created_by` queda `NULL` -- atribuirlo a un Administrador concreto sería una atribución falsa. La columna ya era nullable en el esquema base.

---

## Cómo funciona la sincronización automática (Fase 8F)

Fase 8F cierra el descubrimiento automático: ya no hace falta que algo externo le diga a `enqueueGoogleDriveImportFile` qué archivo es nuevo -- el propio CRM lo detecta.

### Arquitectura: watch como señal, changes.list como autoridad, polling como durabilidad

```
Google Drive
   │  (canal de notificación, opcional)
   ▼
webhook (ligero: SOLO encola poll_changes, deduped, responde 204)
   │
   ▼
poll_changes (worker de la cola)
   │  changes.list, paginado, desde el cursor persistido
   ▼
clasificación de cada cambio -> enqueue de la operación real
   (import_drive_file / marcar conflict-missing / reparar mapping)
```

El webhook **nunca** decide nada por sí mismo: una notificación solo dice "puede que haya cambios", nunca trae el `fileId` ni el tipo de cambio con autoridad. Toda decisión real sale de `changes.list`, que el `poll_changes` encolado ejecuta por separado. Esto es deliberado (no una limitación): Google documenta que las notificaciones pueden llegar duplicadas, fuera de orden, o antes de que la propia suscripción termine de registrarse -- construir lógica de negocio directamente sobre el webhook heredaría todas esas garantías débiles.

**El watch es una optimización de latencia, no la garantía de durabilidad.** Si el webhook nunca está configurado (`GOOGLE_DRIVE_WEBHOOK_URL` vacío), si Google no logra entregar una notificación, o si el canal expira antes de renovarse, el CRM sigue descubriendo cambios igual: cada ejecución de `POST /api/google-drive/maintenance` encola su propio `poll_changes` sin depender de ninguna notificación. La durabilidad real es el cursor persistido (`changes_page_token`) más el mantenimiento periódico -- el watch solo hace que la detección sea casi instantánea en vez de esperar al siguiente ciclo de mantenimiento.

### El cursor (`changes_page_token`): compare-and-swap real, nunca last-write-wins

El bootstrap pide un `startPageToken` (T0) la primera vez que hay una conexión activa con raíz configurada, y lo persiste UNA sola vez (`initialize_google_drive_change_token`) -- un segundo bootstrap nunca sobrescribe un cursor ya existente, porque eso perdería exactamente los cambios ocurridos entre medias. A partir de ahí, cada `poll_changes` pagina `changes.list` completo (procesando cada página según llega) y solo al llegar a la página FINAL -- la que trae `newStartPageToken` -- intenta avanzar el cursor con `advance_google_drive_change_token`, una función que compara el valor esperado antes de escribir (compare-and-swap real a nivel de PostgreSQL, probado con dos sesiones concurrentes reales). Si otro poller ya avanzó el cursor mientras este procesaba, el intento se resuelve como completado sin sobrescribir ni retroceder nada -- ambos pollers partieron del mismo cursor, así que procesaron el mismo tramo de cambios, y todo lo que produjeron (encolados) es idempotente por `dedupe_key`.

Si el proceso muere a mitad de la paginación, el cursor en base de datos sigue siendo el anterior -- el siguiente intento vuelve a pedir desde ahí y reprocesa lo mismo, lo cual es seguro precisamente porque todo lo que este código produce está deduplicado.

### Clasificación de un cambio detectado

Para cada entrada de `changes.list`:

- **Archivo desconocido, manual, hijo directo de una carpeta de Cliente sincronizada** -> se encola `import_drive_file`. Esta fase NUNCA duplica la validación de 8E (M1/M2, tamaño, integridad, appProperties) -- solo decide que vale la pena intentarlo.
- **Archivo desconocido fuera de cualquier carpeta de Cliente vinculada** -> se ignora. Nunca se importa "todo Mi unidad".
- **Archivo desconocido con `appProperties.crm_entity=document`** -- ya lo gestiona (o gestionó) el CRM -- se intenta reparar el mapping automáticamente solo si la identidad es inequívoca (un único padre, coincide exactamente con la carpeta del Cliente referenciado); si el documento referenciado ya no existe, no se repara nada aquí -- lo cubre la reconciliación (ver más abajo), que nunca resucita.
- **Archivo YA mapeado, sin cambios respecto al último baseline sincronizado** -> no-op. Esto es lo que absorbe el eco de nuestras propias operaciones (una subida, un import, un rename) sin generar un bucle.
- **Archivo mapeado renombrado en Drive** -> `sync_status='conflict'`, `sync_error='DRIVE_NAME_CHANGED'`. El CRM **nunca** se renombra solo -- sigue siendo la copia operativa primaria.
- **Archivo mapeado con contenido cambiado (`md5Checksum`/`version` distintos del baseline)** -> `conflict`/`DRIVE_CONTENT_CHANGED`. Nunca se sobreescribe el Storage del CRM automáticamente.
- **Archivo mapeado movido a otra carpeta** -> `conflict`/`DRIVE_PARENT_MISMATCH`. Nunca se reasigna `client_id`, ni se mueve el Storage, ni se cambia `case_id`.
- **Archivo mapeado marcado `trashed` o reportado `removed`** -> `missing`/código estable (`DRIVE_FILE_TRASHED` o `DRIVE_FILE_REMOVED_OR_ACCESS_LOST`). El documento del CRM **se conserva siempre** -- una eliminación en Drive nunca borra nada del CRM.
- **Carpeta de un Cliente movida fuera de la raíz o eliminada** -> se revalida igual que un documento (mismo criterio, nunca se reasigna el mapping del Cliente).

### Reconciliación: red de seguridad, no la ruta principal

El change feed cubre el flujo normal, pero no todo: un `poll_changes` puede haberse perdido antes de este release, un Cliente puede haberse creado sin que su `ensure_client_folder` llegara a encolarse, o -- el caso más delicado -- un documento puede haberse borrado del CRM sin que su `prepare-document-trash` llegara a ejecutarse en Drive, dejando un archivo huérfano marcado `appProperties.crm_entity=document` sin ningún rastro en la base de datos del CRM que lo señale.

Por eso existe `runGoogleDriveReconciliation`, invocada desde el mantenimiento cada `GOOGLE_DRIVE_RECONCILIATION_INTERVAL_MS` (varias horas, no en cada ejecución), con un solo pase activo por conexión (CAS sobre `reconciliation_claimed_at`, sin mantener ningún lock de PostgreSQL abierto mientras dura el escaneo de Drive). Hace, en orden: encolar `ensure_client_folder` para Clientes sin carpeta; encolar `upload_document` para documentos sin mapping (nunca para los de procedencia `google_drive`, que en cambio intentan reparar su mapping si la identidad de Drive sigue siendo válida); escanear los hijos directos de cada carpeta de Cliente (sin recursión) para encontrar manuales sin importar; verificar que cada mapping existente siga apuntando a un archivo real, en el sitio correcto; y, por último, una búsqueda Drive-side por `appProperties.crm_entity=document` para encontrar archivos que Drive todavía marca como gestionados por el CRM pero cuyo documento **ya no existe**.

**Un huérfano detectado nunca se resucita ni se auto-mueve a la papelera.** Se reporta (recuento y lista de `drive_file_id`, expuestos en el status mínimo) para revisión humana -- la ausencia en el CRM podría deberse tanto a un borrado legítimo perdido como a una restauración parcial de base de datos, y esta integración no asume cuál de los dos es.

El cursor de cambios (`changes_page_token`) y la reconciliación son **mecanismos independientes**: completar una reconciliación nunca avanza el cursor, y viceversa.

### Watch/webhook: creación, renovación y la carrera sync-antes-de-persistir

Con `GOOGLE_DRIVE_WEBHOOK_URL` configurada, el mantenimiento asegura un canal de notificación (`changes.watch`) con una duración conservadora (6 días, por debajo del máximo real de Google de 7) y lo renueva cuando falta menos de 24 h para expirar. El token del canal es aleatorio, se envía en texto plano a Google (así puede devolvérnoslo en cada notificación) pero **solo su hash se persiste** -- nunca el texto plano, ni en la base de datos ni en ningún log.

La renovación crea el canal **nuevo** primero (persistido de forma atómica, superseding el anterior en la misma operación) y solo después intenta `channels.stop` del viejo, de forma best-effort: si ese `stop` remoto falla, el canal nuevo sigue activo igual -- un breve solapamiento de dos canales notificando es un resultado aceptado (ambos deduplican al mismo `poll_changes`), nunca un error.

El webhook mismo es deliberadamente ligero: valida `channel_id` + hash del `channel_token` (comparación en tiempo constante) + `resource_id`, y si todo coincide y el estado es `change`, encola `poll_changes` y responde `204`. Nunca llama a Google, nunca hace un escaneo de base de datos largo, ignora el body de la petición. Un `channel_id` que la base de datos todavía no reconoce se **ignora** (`204`), nunca se rechaza como error -- Google puede enviar el mensaje `sync` inicial antes de que la propia respuesta de `changes.watch` termine de persistirse localmente, y esa carrera no implica nada malicioso. Un token incorrecto, en cambio, sí se rechaza explícitamente. Un `resourceState` desconocido o futuro (Google documenta que puede añadir nuevos) también se ignora con `204`, nunca con un error 500 -- `X-Goog-Message-Number` nunca se usa como cursor, solo el `changes_page_token` real tiene autoridad.

---

## Limitación conocida: Drive puede cambiar fuera del CRM

Drive es un sistema externo y **no existe atomicidad distribuida** entre Google y PostgreSQL. Al vincular un cliente, el servidor revalida la carpeta contra Drive (existe, es carpeta, no está en la papelera, cuelga de la raíz) inmediatamente antes de escribir, y la escritura es atómica y serializada — pero entre esa validación y el COMMIT queda una ventana en la que alguien con acceso al Drive puede mover o borrar la carpeta.

Esto **no se intenta resolver con una transacción distribuida**: el remedio sería peor que el problema. Se asume como limitación conocida y se resuelve por detección posterior: la sincronización automática de **Fase 8F** compara el padre real de cada carpeta y de cada documento mapeado contra el esperado (tanto vía el change feed como en la reconciliación periódica) y marca `DRIVE_PARENT_MISMATCH` como conflicto para que una persona lo resuelva. En ningún caso se reasigna `client_id` de forma automática — el CRM es la autoridad de la relación jurídica.

---

## Lo que NO hace todavía

- No reemplaza el contenido de un documento ya subido (el CRM tampoco lo ofrece).
- No exporta archivos nativos de Google Workspace (Docs/Sheets/Slides/...); los rechaza explícitamente.
- No importa archivos fuera de una carpeta de Cliente vinculada, ni desde subcarpetas internas (sin recursión, ni en el change feed ni en la reconciliación).
- No mueve a la papelera la carpeta de un Cliente eliminado.
- No resuelve conflictos automáticamente ("usar CRM" / "usar Drive" / fusionar): los detecta y los deja para revisión humana -- una UI de resolución es, como mucho, una fase futura.
- No auto-trashea ni auto-repara un huérfano Drive-side detectado por la reconciliación: solo lo reporta.
- No conecta todavía Google Drive real ni Google Cloud Console -- toda la validación de 8F, igual que las fases anteriores, es contra mocks y PostgreSQL local.

---

## Nota sobre tokens

Este documento **nunca** debe incluir instrucciones para pegar un `refresh_token` o `access_token` manualmente en ningún lugar (BD, `.env`, panel de administración). La única forma prevista de obtener un token es el flujo OAuth completo (`/api/google-drive/connect` → consentimiento de Google → `/api/google-drive/callback`), que cifra el `refresh_token` antes de guardarlo y nunca persiste el `access_token`.
