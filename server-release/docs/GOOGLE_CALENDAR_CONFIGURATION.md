# Configuración de Google Calendar para Producción

**Dominio de producción:** `https://abogado.consoldi.com`

---

## Estado de la integración

La integración con Google Calendar está **completamente implementada** en el código. Incluye:

- Flujo OAuth 2.0 completo (PKCE + state firmado con HMAC)
- Cifrado AES-256-GCM de refresh tokens antes de guardarlos en Supabase
- Sincronización bidireccional (Google → CRM y CRM → Google)
- Webhooks de notificación push de Google Calendar
- Cron de mantenimiento cada 6 horas
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

---

## Sobre el cron de mantenimiento

El archivo `wrangler.toml` original incluía:
```toml
[triggers]
crons = ["0 */6 * * *"]
```

Este cron ejecutaba `runGoogleCalendarScheduledMaintenance()` cada 6 horas.

**En Virtualmin con Node.js, este cron NO se ejecuta automáticamente.** Opciones:

1. **Cron del sistema operativo (recomendado):**
   ```bash
   # Añadir en crontab del usuario abogado
   0 */6 * * * curl -s -X POST https://abogado.consoldi.com/api/google-calendar/actions -H "Content-Type: application/json" -d '{"action":"sync"}' -H "Authorization: Bearer TOKEN_ADMIN" >> /var/log/crm-sync.log 2>&1
   ```

2. **PM2 con scheduler:**
   ```bash
   pm2 start scripts/google-cron.mjs --cron "0 */6 * * *"
   ```

3. **Aceptar sincronización manual:** La integración también soporta sincronización manual desde la UI de Configuración → Google Calendar.

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
