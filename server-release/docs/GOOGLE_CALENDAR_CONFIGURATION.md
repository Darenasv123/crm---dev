# Configuración de Google Calendar para Producción

**Dominio de producción:** `https://abogado.consoldi.com`

---

## Estado de la integración

La integración con Google Calendar está **completamente implementada** en el código. Incluye:

- Flujo OAuth 2.0 completo (PKCE + state firmado con HMAC)
- Cifrado AES-256-GCM de refresh tokens antes de guardarlos en Supabase
- Sincronización bidireccional (Google → CRM y CRM → Google)
- Webhooks de notificación push de Google Calendar
- Mantenimiento programado (renovación de canal + cola de sincronización) — requiere cron del SO en este target, ver más abajo
- Resolución de conflictos de sincronización

---

## Cambios requeridos en Google Cloud Console

### 1. Credenciales OAuth → URI de redirección autorizados

Ir a: Google Cloud Console → APIs & Services → Credentials → tu aplicación OAuth 2.0

**Añadir a "Authorized redirect URIs":**
```
https://abogado.consoldi.com/api/google-calendar/callback
```

**Conservar temporalmente para desarrollo:**
```
http://localhost:3000/api/google-calendar/callback
http://localhost:8080/api/google-calendar/callback
```

### 2. Orígenes autorizados de JavaScript (si aplica)

**Añadir a "Authorized JavaScript origins":**
```
https://abogado.consoldi.com
```

---

## Variables de entorno requeridas

Estas variables deben configurarse en `.env.production` del servidor:

| Variable | Dónde obtenerla |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://abogado.consoldi.com/api/google-calendar/callback` |
| `GOOGLE_OAUTH_STATE_SECRET` | Generar con Node (ver abajo) |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Generar con Node (ver abajo) |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | `https://abogado.consoldi.com/api/google-calendar/webhook` |
| `GOOGLE_CALENDAR_MAINTENANCE_SECRET` | Generar con Node/openssl (ver abajo) — requerida en este target, ver "Sobre el cron de mantenimiento" |

### Generar secretos aleatorios

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ejecutar dos veces: una para `GOOGLE_OAUTH_STATE_SECRET` y otra para `GOOGLE_TOKEN_ENCRYPTION_KEY`. Usar valores distintos para cada una.

---

## Rutas de la aplicación involucradas

| Ruta | Método | Descripción |
|---|---|---|
| `/api/google-calendar/connect` | GET | Inicia el flujo OAuth. Devuelve `{ authorizationUrl }`. |
| `/api/google-calendar/callback` | GET | Recibe el `code` de Google. Redirige a `/configuracion?google=connected`. |
| `/api/google-calendar/status` | GET | Estado actual de la conexión. |
| `/api/google-calendar/actions` | POST | Acciones: `disconnect`, `sync`, `renew`. |
| `/api/google-calendar/webhook` | POST | Recibe notificaciones push de Google cuando hay cambios en el calendario. |
| `/api/google-calendar/maintenance` | POST | Mantenimiento programado (renovación de canal + cola de sincronización). Gated por secreto, pensado para cron — ver abajo. |

---

## Sobre el cron de mantenimiento

El archivo `wrangler.toml` original incluía:
```toml
[triggers]
crons = ["0 */6 * * *"]
```

Este cron ejecutaba `runGoogleCalendarScheduledMaintenance()` (renueva el canal de Google antes de que expire y procesa la cola de sincronización pendiente) automáticamente cada 6 horas.

**En Virtualmin con Node.js, `scheduled()` de Cloudflare Workers no existe — este cron NO se ejecuta nunca por sí solo.** Sin nada que lo dispare, el canal de notificaciones expira a los ~6 días de conectar y Google→CRM deja de recibir cambios de Google en silencio (el flujo CRM→Google no se ve afectado).

### Configuración correcta: cron del sistema operativo + endpoint dedicado

`/api/google-calendar/maintenance` está diseñado para ser invocado por un cron del SO, sin sesión de usuario. Se autentica con un secreto compartido (nunca con un token de sesión de Administrador — evitar guardar tokens de usuario en crontab).

**Pasos para configurar en el VPS (no ejecutado como parte de esta fase — requiere el próximo despliegue autorizado):**

1. **Generar un secreto aleatorio** (no reutilizar ningún otro secreto de la aplicación):
   ```bash
   openssl rand -hex 32
   ```
2. **Añadir `GOOGLE_CALENDAR_MAINTENANCE_SECRET`** al archivo de entorno del servicio (`.env.production` o equivalente), con el valor generado. No commitear el valor real a ningún repositorio.
3. **Reiniciar el proceso Node (PM2/systemd)** únicamente durante la ventana del próximo despliegue autorizado, para que recoja la nueva variable — no de forma ad-hoc.
4. **Configurar un cron del sistema operativo o systemd timer** que haga POST al endpoint. Ejemplo de entrada de `crontab` para el usuario de la aplicación:
   ```bash
   */15 * * * * curl -fsS -X POST \
     -H "X-Maintenance-Secret: $GOOGLE_CALENDAR_MAINTENANCE_SECRET" \
     https://abogado.consoldi.com/api/google-calendar/maintenance \
     >> /var/log/crm-google-maintenance.log 2>&1
   ```
   (Si se prefiere no exportar el secreto en el propio crontab, léelo desde el archivo de entorno del servicio dentro de un script wrapper en vez de escribirlo literalmente en la línea de cron.)
5. **Enviar el secreto exclusivamente por header** (`X-Maintenance-Secret`), nunca como parámetro de la URL — una URL con el secreto puede quedar registrada en logs de acceso, logs del proxy inverso, historial de shell o herramientas de observabilidad.
6. **Frecuencia recomendada:** cada 15 minutos es más que suficiente — el mantenimiento solo actúa cuando realmente hay cola pendiente o el canal está por expirar (ventana de renovación de 24 h antes de la expiración a 6 días); ejecutarlo con más frecuencia no aporta nada y solo genera ruido en logs.
7. **Verificar la respuesta:** `200` con un cuerpo `{ "queue": <n>, "renewed": <bool> }` indica éxito. `503` significa que el secreto no está configurado en el servidor; `401` que el secreto enviado no coincide.
8. **Verificar la cola:** confirmar en Supabase que `google_calendar_sync_requests` no acumula filas en `pending`/`processing` de forma creciente entre ejecuciones.
9. **Verificar la renovación del canal:** confirmar que `google_calendar_channels.expires_at` se mantiene siempre por delante de la fecha actual (no debe llegar nunca a menos de 24 h de margen salvo justo antes de una renovación).

**Alternativa sin cron:** la integración también soporta sincronización manual desde la UI de Configuración → Google Calendar (botón "Sincronizar"), pero no sustituye al mantenimiento programado — no renueva el canal proactivamente y depende de que alguien recuerde pulsarlo.

---

## Flujo de conexión (para referencia del administrador)

Una vez que el servidor esté activo con HTTPS:

1. Iniciar sesión en el CRM como Administrador
2. Ir a Configuración → Google Calendar
3. Hacer clic en "Conectar Google Calendar"
4. Introducir el ID del calendario a sincronizar
5. Aprobar los permisos en la pantalla de Google
6. El sistema redirigirá automáticamente de vuelta a `/configuracion?google=connected`
7. La sincronización inicial comenzará automáticamente

---

## Nota importante

Las credenciales actuales de Google Calendar (si existen en producción) corresponden a URIs de redirección configuradas con la URL anterior. Si se cambia el dominio, la conexión con Google dejará de funcionar hasta que:

1. Se añada `https://abogado.consoldi.com/api/google-calendar/callback` en Google Cloud Console
2. Se reconecte el calendario desde la UI del CRM (esto genera nuevos tokens con el nuevo redirect URI)

No es necesario crear una nueva aplicación OAuth — basta con añadir el nuevo URI a la existente.
