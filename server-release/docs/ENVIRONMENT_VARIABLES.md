# Variables de Entorno — advocate-nest

**Versión:** 2026-08-01  
**Aplicación:** CRM Jurídico Estudio Arenas

---

## Clasificación de variables

| Variable | Tipo | Uso | Obligatoria |
|---|---|---|---|
| `NODE_ENV` | Pública | Runtime | Sí |
| `HOST` | Pública | Runtime | No (default: 127.0.0.1) |
| `PORT` | Pública | Runtime | No (default: 3000) |
| `APP_URL` | Pública | Runtime | No |
| `SUPABASE_URL` | Pública | Runtime | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | **PRIVADA** | Runtime | Sí |
| `GOOGLE_CLIENT_ID` | Semipública | Runtime | Sí (si Google Cal.) |
| `GOOGLE_CLIENT_SECRET` | **PRIVADA** | Runtime | Sí (si Google Cal.) |
| `GOOGLE_OAUTH_REDIRECT_URI` | Pública | Runtime | Sí (si Google Cal.) |
| `GOOGLE_OAUTH_STATE_SECRET` | **PRIVADA** | Runtime | Sí (si Google Cal.) |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | **PRIVADA** | Runtime | Sí (si Google Cal.) |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | Pública | Runtime | Sí (si Google Cal.) |
| `GOOGLE_SHARED_CALENDAR_ID` | Pública | Runtime | No |
| `GROQ_API_KEY` | **PRIVADA** | Runtime | No (si chatbot Lex) |
| `VITE_SUPABASE_URL` | Pública | **Build time** | Sí |
| `VITE_SUPABASE_ANON_KEY` | Pública | **Build time** | Sí |
| `VITE_GOOGLE_CLIENT_ID` | Pública | **Build time** | No |
| `VITE_BUILD_COMMIT` | Pública | Build time | No |
| `VITE_BUILD_DATE` | Pública | Build time | No |

---

## Variables de Build Time (prefijo VITE_)

Estas variables son leídas por Vite **durante la compilación** y se incrustan en el bundle JavaScript del cliente. Son visibles en el bundle resultante.

### `VITE_SUPABASE_URL`
- **Valor esperado:** `https://PROJECT_ID.supabase.co`
- **Contexto:** URL pública del proyecto Supabase. La anon key y la URL son públicas por diseño en Supabase.
- **Fallback en código:** Existe un fallback hardcoded en `src/lib/supabase.ts`. En producción **debe estar definida** para que Vite la sobreescriba con el valor correcto durante el build.

### `VITE_SUPABASE_ANON_KEY`
- **Valor esperado:** JWT que empieza con `eyJ...`
- **Contexto:** Clave anon pública. Es segura en el bundle porque Supabase la expone intencionalmente.

### `VITE_GOOGLE_CLIENT_ID`
- **Valor esperado:** `XXXXX.apps.googleusercontent.com`
- **Contexto:** Client ID para el flujo OAuth de Google en el frontend (si aplica).

### `VITE_BUILD_COMMIT`
- **Valor esperado:** Hash corto de Git (ej: `40c43d9`)
- **Contexto:** Se muestra en `/api/health`. No es sensible.

### `VITE_BUILD_DATE`
- **Valor esperado:** Fecha ISO (`2026-08-01`)
- **Contexto:** Se muestra en `/api/health`.

> **Importante:** El release ya incluye el bundle compilado con estas variables. El servidor **no necesita** las variables `VITE_*` en runtime. Solo son necesarias si se recompila el proyecto.

---

## Variables de Runtime

Estas variables son leídas por el servidor Node **en tiempo de ejecución**. Se pasan como variables de entorno al proceso.

### `NODE_ENV`
- **Valor requerido:** `production`
- **Efecto:** Activa optimizaciones de Node y React.

### `HOST`
- **Valor recomendado:** `127.0.0.1`
- **Default Nitro:** Si no se define, escucha en todas las interfaces.
- **Nota:** Usar `127.0.0.1` para que el servidor solo sea accesible desde el proxy inverso local.

### `PORT`
- **Valor recomendado:** `3000`
- **Alias:** `NITRO_PORT` también funciona.
- **Nota:** No exponer directamente a Internet.

### `SUPABASE_URL`
- **Valor requerido:** `https://PROJECT_ID.supabase.co`
- **Uso:** Operaciones de servidor en `google-calendar.server.ts` que requieren el cliente admin.

### `SUPABASE_SERVICE_ROLE_KEY` ⚠️ SECRETO
- **Uso:** Solo en el servidor. Permite operaciones con privilegios de administrador en Supabase (bypass de RLS).
- **Dónde NO debe estar:**
  - En el bundle del cliente (nunca usar prefijo `VITE_`)
  - En logs del servidor
  - En respuestas HTTP
  - En el ZIP del release

### `GOOGLE_CLIENT_ID`
- **Uso:** Identificar la aplicación en el flujo OAuth de Google Calendar.

### `GOOGLE_CLIENT_SECRET` ⚠️ SECRETO
- **Uso:** Intercambiar el authorization code por tokens de acceso/refresh.

### `GOOGLE_OAUTH_REDIRECT_URI`
- **Valor exacto:** `https://abogado.consoldi.com/api/google-calendar/callback`
- **Requisito:** Debe estar registrado en Google Cloud Console como "URI de redirección autorizado".

### `GOOGLE_OAUTH_STATE_SECRET` ⚠️ SECRETO
- **Uso:** Firmar el parámetro `state` del flujo OAuth (protección CSRF).
- **Generación:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### `GOOGLE_TOKEN_ENCRYPTION_KEY` ⚠️ SECRETO
- **Uso:** Cifrar refresh tokens de Google con AES-256-GCM antes de guardarlos en Supabase.
- **Generación:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### `GOOGLE_CALENDAR_WEBHOOK_URL`
- **Valor:** `https://abogado.consoldi.com/api/google-calendar/webhook`
- **Requisito:** Debe ser accesible públicamente por los servidores de Google.

### `GROQ_API_KEY` ⚠️ SECRETO
- **Uso:** API del chatbot Lex. Si no se configura, el chatbot mostrará error.

---

## Cómo configurar en producción

### Opción 1: Archivo .env (recomendado con PM2 o systemd)

```bash
cp config/.env.production.example .env.production
chmod 600 .env.production
# Editar con valores reales
nano .env.production
```

Con PM2:
```bash
pm2 start app/server/index.mjs --name advocate-nest --env production
```

Con systemd (ver `docs/VIRTUALMIN_DEPLOYMENT.md` para la unidad completa):
```ini
EnvironmentFile=/home/abogado/apps/advocate-nest/current/.env.production
```

### Opción 2: Variables en el proceso

```bash
export NODE_ENV=production
export HOST=127.0.0.1
export PORT=3000
export SUPABASE_URL=https://...
# ... resto de variables
node app/server/index.mjs
```

---

## Verificación antes de iniciar

```bash
node scripts/validate-production-env.mjs
```

El script verifica que todas las variables requeridas estén presentes y que `VITE_SUPABASE_SERVICE_ROLE_KEY` no esté definida.
