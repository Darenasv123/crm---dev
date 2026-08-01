# Auditoría de Target — Virtualmin Node.js

**Fecha:** 2026-08-01  
**Rama:** chore/virtualmin-node-release  
**Proyecto:** advocate-nest (CRM Jurídico Estudio Arenas)

---

## 1. Target Actual

| Campo | Valor |
|---|---|
| Framework | TanStack Start + Nitro |
| Preset Nitro | `cloudflare-module` |
| Bundler | Vite 8 + Rolldown |
| Entrypoint generado | `.output/server/index.mjs` |
| Tipo de export | `export default { fetch() }` (Cloudflare Worker handler) |
| Assets | `.output/public/` |
| Comando actual | `npx wrangler deploy` |

### Diagnóstico crítico

El entrypoint `.output/server/index.mjs` actualmente exporta únicamente un objeto `{ fetch, scheduled }` compatible con la interfaz de Cloudflare Workers. **No abre un puerto HTTP**. Si se ejecuta con `node .output/server/index.mjs` en un servidor Node estándar, el proceso termina inmediatamente sin servir ninguna solicitud.

El preset `cloudflare-module` instruye a Nitro a:
- Omitir el listener HTTP de Node
- Usar `globalThis.caches` (API de Cloudflare)
- Confiar en el runtime de Workerd para servir assets
- Usar `ASSETS` binding para archivos estáticos

---

## 2. Target Requerido

| Campo | Valor |
|---|---|
| Preset Nitro | `node` |
| Entrypoint esperado | `.output/server/index.mjs` (abre puerto HTTP con `node:http`) |
| Comando de inicio | `node .output/server/index.mjs` |
| Assets | Servidos por el servidor Node embebido |
| Variables de red | `HOST=127.0.0.1`, `PORT=3000` |

Con el preset `node`, Nitro genera un entrypoint que:
- Importa `node:http` y llama a `createServer`
- Escucha en `HOST:PORT` (configurable por variables de entorno)
- Sirve assets estáticos desde `.output/public/`
- Expone todas las server functions y API routes de TanStack Start

---

## 3. Archivos Afectados

| Archivo | Cambio |
|---|---|
| `vite.config.ts` | Añadir `nitro: { preset: 'node' }` condicionado a modo producción/Node |
| `package.json` | Añadir scripts `start`, `start:production`, `validate:production` |
| `src/routes/api.health.ts` | Nuevo — endpoint `/health` |
| `scripts/validate-production-env.mjs` | Nuevo — validador de variables |
| `server-release/` | Nueva carpeta de release |

**Archivos NO modificados:**
- `src/server.ts` — Compatible con Node (es un handler fetch genérico)
- `src/lib/server-runtime-env.ts` — Ya usa `process.env` como fallback
- `src/lib/google-calendar.server.ts` — Usa fetch estándar y crypto Web API
- Toda la lógica de negocio, Supabase, RLS, RPC

---

## 4. Variables de Entorno

### Usadas durante build (se incrustan en el bundle del cliente)
- `VITE_SUPABASE_URL` — URL del proyecto Supabase
- `VITE_SUPABASE_ANON_KEY` — Clave anon pública
- `VITE_GOOGLE_CLIENT_ID` — Client ID de Google OAuth (frontend)

### Usadas durante runtime (se leen en el servidor Node)
- `NODE_ENV` — `production`
- `HOST` — IP de escucha (recomendado: `127.0.0.1`)
- `PORT` — Puerto HTTP (recomendado: `3000`)
- `SUPABASE_URL` — URL del proyecto (mismo que `VITE_SUPABASE_URL` o sin prefijo)
- `SUPABASE_SERVICE_ROLE_KEY` — **SECRETO** — Solo servidor, nunca en el bundle
- `GOOGLE_CLIENT_ID` — Client ID OAuth
- `GOOGLE_CLIENT_SECRET` — **SECRETO** — Solo servidor
- `GOOGLE_OAUTH_REDIRECT_URI` — URI de callback OAuth registrado en Google Console
- `GOOGLE_OAUTH_STATE_SECRET` — **SECRETO** — Clave HMAC para firmar estados OAuth
- `GOOGLE_TOKEN_ENCRYPTION_KEY` — **SECRETO** — Clave AES para cifrar refresh tokens
- `GOOGLE_CALENDAR_WEBHOOK_URL` — URL pública del webhook (debe ser HTTPS)
- `GOOGLE_SHARED_CALENDAR_ID` — ID del calendario (opcional)
- `GROQ_API_KEY` — **SECRETO** — Clave del chatbot Lex

### Hardcoded con fallback (a respetar en producción)
En `src/lib/supabase.ts` existe un fallback hardcoded con URL y anon key del proyecto. En producción, las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` **deben estar definidas durante el build** para sobrescribir esos fallbacks, ya que Vite los inyecta en tiempo de compilación.

---

## 5. Rutas de Callback de Supabase Auth

La aplicación usa Supabase Auth con flujo de email/password. No hay rutas de callback de Supabase Auth en el router de TanStack (no se usa OAuth de Supabase, solo `signInWithPassword`). La autenticación reside completamente en el cliente mediante `@supabase/supabase-js`.

**Configuración requerida en Supabase → Authentication → URL Configuration:**
- Site URL: `https://abogado.consoldi.com`
- Redirect URLs: `https://abogado.consoldi.com/**` (comodín para cubrir cualquier ruta post-login)
- Conservar temporalmente: `http://localhost:3000` para desarrollo local

---

## 6. Rutas de Google Calendar OAuth

| Ruta | Método | Descripción |
|---|---|---|
| `/api/google-calendar/connect` | GET | Inicia el flujo OAuth, devuelve `authorizationUrl` |
| `/api/google-calendar/callback` | GET | Recibe el code de Google, completa OAuth, redirige a `/configuracion?google=connected` |
| `/api/google-calendar/status` | GET | Estado de la conexión |
| `/api/google-calendar/actions` | POST | Desconectar, sincronizar, renovar canal |
| `/api/google-calendar/webhook` | POST | Webhook de notificaciones de Google |

**URI de redirección OAuth que debe registrarse en Google Cloud Console:**
- `https://abogado.consoldi.com/api/google-calendar/callback`

---

## 7. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| El preset `node` no incluye `ASSETS` binding de Cloudflare — los assets los sirve el servidor Node directamente | Bajo | Nitro `node` incluye serving de estáticos nativo |
| `SUPABASE_SERVICE_ROLE_KEY` no debe llegar al bundle del cliente | Alto | Verificado: se lee solo en `google-calendar.server.ts` vía `readServerRuntimeEnv` (server-only) |
| Variables `VITE_*` se incrustan en build time — URL y anon key en bundle | Bajo/Aceptable | La anon key es pública por diseño en Supabase |
| El servidor Node no tiene reverse proxy — no exponer directo a Internet | Medio | Documentado: Apache/Nginx de Virtualmin debe hacer proxy |
| Cron de Google Calendar (`0 */6 * * *`) no funciona en Node | Medio | Documentado: reemplazar con cron del SO o PM2 scheduler |

---

## 8. Cambios Mínimos Requeridos

1. **`vite.config.ts`** — Añadir preset `node` para build de producción
2. **`package.json`** — Añadir scripts `start`, `start:production`
3. **Nuevo: `src/routes/api.health.ts`** — Endpoint `/health`
4. **Nuevo: `scripts/validate-production-env.mjs`** — Validador de env
5. **Nueva: `server-release/`** — Estructura del release

No se modifica nada de la lógica de aplicación, Supabase, Auth, ni reglas de negocio.
