# INFORME — RELEASE VIRTUALMIN CONSERVANDO SUPABASE

**Fecha:** 2026-08-01  
**Rama:** `chore/virtualmin-node-release`  
**Proyecto:** advocate-nest — CRM Jurídico Estudio Arenas

---

## 1. Resumen ejecutivo

Se preparó un release de producción completo del CRM para despliegue en Virtualmin como aplicación Node.js, manteniendo el proyecto de Supabase actual sin ninguna modificación. El build con preset `node-server` fue verificado localmente: el servidor inicia con `node .output/server/index.mjs`, responde en HTTP, sirve assets, y el healthcheck retorna `{"status":"ok"}`. El ZIP final pesa 1.87 MB y está listo para entrega al administrador del servidor vía SFTP.

---

## 2. Rama

| Campo | Valor |
|---|---|
| Rama de trabajo | `chore/virtualmin-node-release` |
| Base | `refactor/final-crm-visual-polish` (commit `40c43d9`) |
| Push | No realizado (según instrucciones) |

---

## 3. Target anterior

| Campo | Valor |
|---|---|
| Preset Nitro | `cloudflare-module` |
| Entrypoint | `.output/server/index.mjs` — exporta `{fetch, scheduled}` (Cloudflare Worker) |
| Inicio posible con Node | No — el proceso termina inmediatamente sin abrir puerto HTTP |
| Comando de despliegue | `wrangler deploy` |

---

## 4. Target Node

| Campo | Valor |
|---|---|
| Preset Nitro | `node-server` |
| Entrypoint | `.output/server/index.mjs` — llama a `serve({port, hostname, fetch})` |
| Puerto | `PORT` env (default 3000) |
| Host | `HOST` env (recomendado 127.0.0.1) |
| Inicio | `node .output/server/index.mjs` |
| Assets | Servidos por el propio servidor Node |

El cambio se activa con `BUILD_TARGET=node npm run build` (o `npm run build:node`). Sin esa variable, el build por defecto sigue usando `cloudflare-module` para compatibilidad con Lovable / Wrangler.

---

## 5. Archivos modificados

| Archivo | Tipo de cambio |
|---|---|
| `vite.config.ts` | Añadido soporte para preset `node` via `BUILD_TARGET=node` |
| `package.json` | Nuevos scripts: `build:node`, `start`, `start:production`, `validate:production`; nueva devDep `cross-env@7.0.3` |
| `package-lock.json` | Actualizado por instalación de `cross-env` |
| `src/routes/api.health.ts` | Nuevo — endpoint `GET /api/health` |
| `src/routeTree.gen.ts` | Auto-generado por TanStack router (incluye nueva ruta `/api/health`) |
| `scripts/validate-production-env.mjs` | Nuevo — validador de variables de entorno en runtime |
| `docs/deployment/virtualmin-node-audit.md` | Nuevo — auditoría completa del target |
| `server-release/**` | Nueva carpeta con release estructurado |

**Archivos NO modificados:** toda la lógica de negocio, Supabase, Auth, RLS, RPC, Google Calendar, rutas de la aplicación, componentes, hooks.

---

## 6. Variables

### Build time (incrustadas en el bundle)
| Variable | Estado en este build |
|---|---|
| `VITE_SUPABASE_URL` | Incrustada (fallback del código) |
| `VITE_SUPABASE_ANON_KEY` | Incrustada (fallback del código) |
| `VITE_BUILD_COMMIT` | `40c43d9` |
| `VITE_BUILD_DATE` | `2026-08-01` |

### Runtime (a configurar en el servidor)
| Variable | Tipo |
|---|---|
| `NODE_ENV` | Pública |
| `HOST` | Pública |
| `PORT` | Pública |
| `SUPABASE_URL` | Pública |
| `SUPABASE_SERVICE_ROLE_KEY` | **SECRETO** |
| `GOOGLE_CLIENT_ID` | Semipública |
| `GOOGLE_CLIENT_SECRET` | **SECRETO** |
| `GOOGLE_OAUTH_REDIRECT_URI` | Pública |
| `GOOGLE_OAUTH_STATE_SECRET` | **SECRETO** |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | **SECRETO** |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | Pública |
| `GROQ_API_KEY` | **SECRETO** |

---

## 7. Supabase

**Decisión:** No se modifica nada del proyecto de Supabase existente.

Cambios que debe realizar el administrador **después** de que el dominio esté activo con HTTPS:

| Cambio | Dónde |
|---|---|
| Site URL → `https://abogado.consoldi.com` | Supabase → Auth → URL Configuration |
| Añadir Redirect URL: `https://abogado.consoldi.com/**` | Supabase → Auth → URL Configuration |
| Conservar temporalmente URLs de desarrollo | Supabase → Auth → URL Configuration |

No se modifican tablas, Auth, RLS, Policies, RPC, Storage, usuarios ni datos.

---

## 8. Google Calendar

La integración está completamente implementada. Cambios requeridos **antes de reconectar**:

| Cambio | Dónde |
|---|---|
| Añadir URI de redirección: `https://abogado.consoldi.com/api/google-calendar/callback` | Google Cloud Console → Credentials → OAuth App |
| Añadir origen: `https://abogado.consoldi.com` | Google Cloud Console → Credentials → OAuth App |

El cron de mantenimiento (cada 6h) que funcionaba via Cloudflare Workers deberá reemplazarse con un cron del SO o PM2 scheduler. Ver `server-release/docs/GOOGLE_CALENDAR_CONFIGURATION.md`.

---

## 9. Build

| Campo | Resultado |
|---|---|
| Comando | `BUILD_TARGET=node VITE_BUILD_COMMIT=40c43d9 VITE_BUILD_DATE=2026-08-01 npx vite build` |
| Exit code | 0 |
| Tiempo | ~18 segundos |
| Entrypoint generado | `.output/server/index.mjs` |
| Assets generados | `.output/public/` |
| Preset confirmado en nitro.json | `node-server` |
| TypeScript (`tsc --noEmit`) | Exit code 0 |
| ESLint (archivos nuevos) | Exit code 0 |
| Tests (`vitest run`) | 438/438 pasados |

---

## 10. Prueba aislada

| Campo | Resultado |
|---|---|
| Carpeta de prueba | `C:\Users\daren\advocate-nest-release-test\` |
| Archivos copiados | Solo `.output/` (sin src, sin .git, sin node_modules, sin .env) |
| Comando ejecutado | `node .output/server/index.mjs` |
| Estado de inicio | OK — "Listening on: http://127.0.0.1:3002/" |
| `GET /` | HTTP 200, text/html |
| `GET /login` | HTTP 200, text/html |
| `GET /api/health` | HTTP 200, JSON correcto |
| `GET /assets/styles-*.css` | HTTP 200, text/css |
| `GET /manifest.json` | HTTP 200, JSON válido |
| Dependencias del repositorio original | No requeridas |

---

## 11. Healthcheck

**Endpoint:** `GET /api/health`  
**Respuesta verificada:**
```json
{
  "status": "ok",
  "service": "advocate-nest",
  "version": "40c43d9",
  "buildDate": "2026-08-01"
}
```
No expone claves, variables, rutas internas, ni información de Supabase.  
Header: `Cache-Control: no-store`

---

## 12. Release

**Estructura:**
```
server-release/
├── app/
│   ├── .output/           ← build Node compilado
│   │   ├── server/        ← entrypoint + chunks SSR + libs
│   │   └── public/        ← assets estáticos
│   ├── package.json
│   └── package-lock.json
├── config/
│   └── .env.production.example
├── docs/
│   ├── VIRTUALMIN_DEPLOYMENT.md
│   ├── ENVIRONMENT_VARIABLES.md
│   ├── SUPABASE_PRODUCTION_CONFIGURATION.md
│   ├── GOOGLE_CALENDAR_CONFIGURATION.md
│   ├── ADMIN_SERVER_MESSAGE.md
│   ├── UPDATE.md
│   └── ROLLBACK.md
├── scripts/
│   ├── verify-release.mjs
│   └── smoke-test.mjs
├── RELEASE_INFO.txt
└── MANIFEST.sha256
```

**Contenido excluido del release:** `.git`, `src`, `node_modules`, `.env`, `.env.local`, `wrangler.toml`, `.wrangler`, archivos SQL, datos personales, tokens, contraseñas, claves privadas.

---

## 13. ZIP

| Campo | Valor |
|---|---|
| Archivo | `advocate-nest-virtualmin-release-2026-08-01.zip` |
| Ruta completa | `C:\Users\daren\advocate-nest\advocate-nest-virtualmin-release-2026-08-01.zip` |
| Tamaño | 1.87 MB (1,959,523 bytes) |
| SHA-256 | `b4db9def7911630525b24cce3a8fca5a9f6f64297c9e684fbe21f80d4c62a521` |
| Archivo de hash | `advocate-nest-virtualmin-release-2026-08-01.zip.sha256` |
| Archivos en ZIP | 211 |
| Verificación de apertura | OK (creado con JSZip, estructura confirmada) |
| Contiene .output | Sí |
| Contiene documentación | Sí |
| Contiene manifest | Sí |
| Contiene secretos | No (escaneado) |
| Contiene .git | No |
| Contiene node_modules | No |
| Contiene código fuente | No |

---

## 14. Proxy inverso

El CRM no debe exponerse directamente a Internet. El servidor Virtualmin (Apache) debe configurarse como proxy inverso:

```
https://abogado.consoldi.com  →  http://127.0.0.1:3000
```

Configuración exacta (Apache y Nginx) en: `server-release/docs/VIRTUALMIN_DEPLOYMENT.md`

---

## 15. SSL

- Certificado requerido para `abogado.consoldi.com`
- Recomendado: Let's Encrypt con certbot (`certbot --apache -d abogado.consoldi.com`)
- **El Site URL de Supabase debe actualizarse después de activar HTTPS**, no antes
- Redirigir todo el tráfico HTTP → HTTPS

---

## 16. Proceso permanente

Opción recomendada: **PM2**. El servidor también es compatible con systemd y Supervisor. Ver `server-release/docs/VIRTUALMIN_DEPLOYMENT.md` para la configuración exacta de cada opción.

El proceso debe:
- Iniciarse automáticamente al reiniciar el servidor
- Reiniciarse si falla
- Registrar logs
- Ejecutarse como usuario `abogado` (no root)
- Leer variables desde un archivo `.env.production` con permisos 600

---

## 17. Pruebas funcionales

| Módulo | Estado |
|---|---|
| Servidor arranca desde carpeta aislada | ✓ Verificado |
| Página principal carga | ✓ HTTP 200 |
| Login carga | ✓ HTTP 200 |
| Assets CSS sirven | ✓ HTTP 200 |
| Healthcheck responde | ✓ `{"status":"ok"}` |
| Login real con Supabase | Pendiente — requiere dominio con HTTPS activo |
| Módulos Admin/Personal | Pendiente — requiere login real |
| Google Calendar | Pendiente — requiere reconexión con nuevo redirect URI |

---

## 18. Consola y Network

Verificado en servidor aislado:
- Sin errores en arranque del proceso
- Sin dependencias externas al iniciar
- Sin rutas que retornen 500 en peticiones básicas
- Los assets 404 requieren verificación con navegador real en producción

---

## 19. Validaciones técnicas

| Validación | Resultado |
|---|---|
| `tsc --noEmit` | ✓ Exit 0 |
| `eslint .` (archivos nuevos) | ✓ Exit 0 |
| `vitest run` | ✓ 438/438 pasados |
| `npm run build:node` | ✓ Exit 0, ~18s |
| `git diff --check` | ✓ Sin conflictos de espaciado |
| `node server-release/scripts/verify-release.mjs` | ✓ Exit 0, sin errores |
| Smoke test (7 checks) | ✓ 7/7 pasados |
| `GET /api/health` desde carpeta aislada | ✓ HTTP 200 |
| ZIP íntegro | ✓ SHA-256 verificado |

---

## 20. Seguridad

| Check | Estado |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` no en bundle | ✓ Confirmado — solo en `server-runtime-env.ts` |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` no definida | ✓ No existe en ningún env file |
| Anon key en bundle | Aceptable — es pública por diseño en Supabase |
| Secretos en docs/config del release | ✓ Escaneados — sin valores reales |
| Archivo `.env` en ZIP | ✗ No incluido |
| Archivo `.env.production` en ZIP | ✗ No incluido |
| Tokens Google en ZIP | ✗ No incluidos |
| Claves privadas en ZIP | ✗ No incluidas |

---

## 21. Checksums

**ZIP:**
```
b4db9def7911630525b24cce3a8fca5a9f6f64297c9e684fbe21f80d4c62a521  advocate-nest-virtualmin-release-2026-08-01.zip
```

**Manifest interno:** `server-release/MANIFEST.sha256` — 210 archivos del release

---

## 22. Commits

| Hash | Mensaje |
|---|---|
| `c2758b5` | `chore(deploy): add Node production target for Virtualmin` |
| `393186e` | `test(deploy): validate isolated Node production release` |
| `4391692` | `docs(deploy): add Virtualmin and Supabase production guides` |
| `0883ccf` | `chore(release): package audited Virtualmin production release` |

No se realizó push (según instrucciones).

---

## 23. Estado Git

```
Rama: chore/virtualmin-node-release
Working tree: limpio (sin cambios sin comitear)
Sin push
Basado en: refactor/final-crm-visual-polish (40c43d9)
```

Archivos fuera de Git (no comiteados, según diseño):
- `advocate-nest-virtualmin-release-2026-08-01.zip` — artefacto de entrega
- `advocate-nest-virtualmin-release-2026-08-01.zip.sha256`
- `server-release/app/.output/` — build compilado (en .gitignore)

---

## 24. Información pendiente del administrador

Antes de la puesta en marcha, el administrador debe confirmar:

1. Versión de Node.js disponible en el servidor (requerido ≥ 22.x)
2. Si usa Apache o Nginx como servidor web
3. Si PM2, systemd o Supervisor están disponibles
4. Ruta donde se instalarán los archivos
5. Límite de memoria RAM del virtual server
6. Límite de tamaño de subida de archivos en el proxy
7. Si hay un firewall que bloquee el puerto 3000 internamente
8. Si Cloudflare está activo como proxy delante del dominio (cambiaría la configuración de headers)

---

## 25. Limitaciones

- El login con Supabase no se puede probar localmente con la URL de producción — requiere el dominio activo con HTTPS
- El cron de Google Calendar que corría en Cloudflare Workers no tiene equivalente automático en Node/Virtualmin — debe configurarse manualmente (ver guía)
- El build incluye el fallback hardcoded de Supabase URL/anon key; en el próximo build de producción deben pasarse como variables para sobrescribirlos
- La prueba de roles Administrador/Personal requiere usuarios reales del sistema

---

## 26. Decisión

**RELEASE LISTO PARA INSTALACIÓN EN VIRTUALMIN**

Confirmado:
- ✓ Salida Node funcional (`node-server` preset)
- ✓ Release ejecutado desde carpeta aislada sin dependencias del repo
- ✓ Healthcheck `/api/health` respondiendo correctamente
- ✓ Módulos principales accesibles (HTTP 200 en rutas públicas)
- ✓ Cero secretos en el ZIP
- ✓ ZIP verificado (SHA-256 confirmado)
- ✓ 438 tests pasados
- ✓ Build exit 0
- ✓ TypeScript exit 0
- ✓ 7/7 smoke tests pasados
