# Deploy a Cloudflare Workers — CRM Estudio Jurídico Arenas

## Requisitos previos

- Cuenta de Cloudflare con Workers habilitado
- Node.js 22 (ver `.node-version`)
- Wrangler autenticado: `npx wrangler login`

---

## 1. Autenticarse en Cloudflare

```bash
npx wrangler login
```

Abre el navegador y autoriza. Se guarda en `~/.wrangler/config.toml`.

---

## 2. Configurar los secrets del Worker (una sola vez)

Las variables de entorno `VITE_*` se inyectan en el bundle del cliente en build-time,
por lo que ya están embebidas en el JS. Sin embargo, si necesitas sobreescribir
valores en producción sin reconstruir, configúralos como secrets:

```bash
npx wrangler secret put VITE_GROQ_API_KEY --config wrangler.toml
npx wrangler secret put VITE_SUPABASE_URL --config wrangler.toml
npx wrangler secret put VITE_SUPABASE_ANON_KEY --config wrangler.toml
npx wrangler secret put VITE_GOOGLE_CLIENT_ID --config wrangler.toml
```

> **Nota:** El worker se llama `darenasv123-advocate-nest`. Si despliegas por
> primera vez puede que debas crearlo con `npx wrangler deploy`.

---

## 3. Deploy (build + publicar)

```bash
npm run deploy
```

Este comando:
1. Ejecuta `npm run build` → genera `.output/`
2. Ejecuta `wrangler deploy` con el `wrangler.json` generado en `.output/server/`

### Solo build (sin publicar)

```bash
npm run build
```

### Dry-run (verificar sin publicar)

```bash
npm run deploy:dry
```

---

## 4. Previsualizar localmente

```bash
npm run preview
```

---

## 5. Dominio personalizado

Una vez desplegado el worker, en el dashboard de Cloudflare:
1. Workers & Pages → `darenasv123-advocate-nest`
2. Settings → Domains & Routes → Add Custom Domain
3. Ingresa tu dominio (ej: `crm.estudioarenas.pe`)

---

## 6. Google Calendar — Actualizar URI de redirección

Después de asignar el dominio definitivo, actualizar en Google Cloud Console:
1. APIs & Services → Credentials → tu OAuth 2.0 Client ID
2. Authorized redirect URIs: agregar `https://tu-dominio.com/google-calendar-callback`
3. Eliminar la URI antigua si ya no aplica

---

## 7. Supabase — URL del proyecto

El proyecto usa: `https://pnqdgwpxcxngeueosmnh.supabase.co`

Verificar en Supabase Dashboard:
- Authentication → URL Configuration → Site URL: debe ser tu dominio de producción
- Redirect URLs: agregar `https://tu-dominio.com/**`

---

## Estado actual del build

- ✅ Build exitoso (cliente + SSR + Nitro cloudflare-module)
- ✅ Wrangler 4.106.0 instalado como devDependency
- ✅ Worker name: `darenasv123-advocate-nest`
- ✅ Compatibility date: 2026-06-26
- ✅ Compatibility flags: `nodejs_compat`
- ✅ PWA: manifest.json + service worker + iconos completos
