# Configuración de Supabase para Producción

**Dominio de producción:** `https://abogado.consoldi.com`

> ⚠️ Estos cambios deben realizarse **después de que el dominio esté activo y con HTTPS** para evitar interrumpir el servicio actual.

---

## Cambios requeridos en Supabase Dashboard

### 1. Authentication → URL Configuration

#### Site URL
Cambiar de la URL actual de desarrollo a:
```
https://abogado.consoldi.com
```

#### Redirect URLs
Añadir las siguientes URLs (conservar las de desarrollo mientras se siga desarrollando localmente):

**URLs de producción a añadir:**
```
https://abogado.consoldi.com/**
https://abogado.consoldi.com
```

**URLs de desarrollo a conservar temporalmente:**
```
http://localhost:3000/**
http://localhost:3000
http://localhost:8080/**
```

> **Nota sobre la autenticación:** Este CRM usa exclusivamente `signInWithPassword` (email + contraseña). No hay flujo de OAuth de Supabase Auth, confirmación de correo por enlace mágico, ni recuperación de contraseña con redirección. La configuración de Redirect URLs es una medida de seguridad de Supabase que filtra las URLs permitidas después del login.

---

## Lo que NO cambia

La decisión es **no migrar la base de datos** ni modificar nada del backend de Supabase:

| Elemento | Estado |
|---|---|
| URL del proyecto | Sin cambio |
| Tablas y esquema | Sin cambio |
| Row Level Security (RLS) | Sin cambio |
| Policies | Sin cambio |
| RPC / Funciones | Sin cambio |
| Storage buckets | Sin cambio |
| Usuarios y perfiles | Sin cambio |
| Clientes, expedientes, tareas | Sin cambio |
| Datos | Sin cambio |

---

## Variables de entorno relacionadas

Estas variables ya están incrustadas en el bundle del release (build time):

| Variable | Fuente | Nota |
|---|---|---|
| `VITE_SUPABASE_URL` | Build time | Incrustada en el bundle JS |
| `VITE_SUPABASE_ANON_KEY` | Build time | Incrustada en el bundle JS |

Estas se leen en runtime por el servidor Node:

| Variable | Fuente | Nota |
|---|---|---|
| `SUPABASE_URL` | `.env.production` | Mismo valor que `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.production` | **SECRETO** — nunca en el bundle |

---

## Verificación post-despliegue

1. Abrir `https://abogado.consoldi.com/login` en el navegador
2. Iniciar sesión con un usuario de administrador
3. Verificar que el dashboard carga correctamente
4. Abrir DevTools → Network — confirmar que las llamadas a Supabase retornan 200
5. Verificar que los módulos de Clientes, Expedientes, Tareas, Agenda cargan datos

---

## Rollback del Site URL

Si es necesario revertir a la URL anterior:
1. Supabase Dashboard → Authentication → URL Configuration
2. Restaurar el Site URL anterior
3. El CRM en Virtualmin dejará de recibir autenticaciones válidas (eso es lo esperado al hacer rollback completo)
