# Configuración de Google Drive (Fases 8B–8C)

**GOOGLE CLOUD CONSOLE NO CONFIGURADA TODAVÍA.** Este documento describe la fundación server-side ya construida en el código y los pasos que faltarán *en el futuro* para activarla — no es una guía para conectar Drive hoy. Google Drive real permanece desconectado; no hay ninguna cuenta, carpeta ni archivo sincronizado.

---

## Estado de la integración

**Fundación implementada** (Fase 8B): schema de base de datos, módulo OAuth server-side, cifrado de tokens, y 4 rutas de API (conectar, callback, estado, desconectar).

**Añadido en Fase 8C**: lectura de carpetas de Drive (solo lectura), selección y persistencia de la carpeta raíz de Clientes, vista previa Cliente ↔ Carpeta, resolución manual de ambigüedades, persistencia atómica de las vinculaciones, y la sección **Configuración → Google Drive**.

**Nada de lo siguiente existe todavía**: subir/descargar archivos, crear/renombrar/mover/eliminar en Drive, `changes.list`, `changes.watch`, webhook, ni cola de sincronización procesando trabajos reales. Esas piezas llegan en 8D en adelante.

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

**No existen todavía** (llegan en fases posteriores): `/api/google-drive/sync-now`, `/api/google-drive/webhook`, `/api/google-drive/maintenance`.

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

## Limitación conocida: Drive puede cambiar fuera del CRM

Drive es un sistema externo y **no existe atomicidad distribuida** entre Google y PostgreSQL. Al vincular un cliente, el servidor revalida la carpeta contra Drive (existe, es carpeta, no está en la papelera, cuelga de la raíz) inmediatamente antes de escribir, y la escritura es atómica y serializada — pero entre esa validación y el COMMIT queda una ventana en la que alguien con acceso al Drive puede mover o borrar la carpeta.

Esto **no se intenta resolver con una transacción distribuida**: el remedio sería peor que el problema. Se asume como limitación conocida y se resuelve por detección posterior: la sincronización de **Fase 8F** comparará el padre real de cada carpeta con el esperado y marcará `DRIVE_PARENT_MISMATCH` como conflicto para que una persona lo resuelva. En ningún caso se reasignará `client_id` de forma automática — el CRM es la autoridad de la relación jurídica.

---

## Lo que NO hace todavía

- No sube ni descarga contenido.
- No crea `changes.watch` ni procesa webhooks.
- No mueve, renombra ni elimina nada en Drive.
- No importa nada de Drive al CRM.
- No crea carpetas: un cliente sin carpeta se muestra como tal, sin ofrecer crearla.
- La cola de sincronización existe en la base de datos pero nada la alimenta con trabajos reales todavía.

---

## Nota sobre tokens

Este documento **nunca** debe incluir instrucciones para pegar un `refresh_token` o `access_token` manualmente en ningún lugar (BD, `.env`, panel de administración). La única forma prevista de obtener un token es el flujo OAuth completo (`/api/google-drive/connect` → consentimiento de Google → `/api/google-drive/callback`), que cifra el `refresh_token` antes de guardarlo y nunca persiste el `access_token`.
