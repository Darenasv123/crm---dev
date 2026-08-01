# Mensaje para el Administrador del Servidor

---

## Mensaje listo para enviar

---

Buenas tardes.

Se ha preparado el release de producción del CRM para el dominio **abogado.consoldi.com**. La aplicación mantiene Supabase externo como autenticación, base de datos y almacenamiento — no requiere ninguna base de datos en el servidor.

Adjunto el archivo: **advocate-nest-virtualmin-release-2026-08-01.zip**

Necesitamos configurar lo siguiente:

---

**1. Node.js**  
La aplicación requiere Node.js 22.x (LTS) o superior.  
Comando de verificación: `node --version`

**2. Instalar dependencias de producción**  
Después de descomprimir el ZIP en `/home/abogado/apps/advocate-nest/releases/2026-08-01/`:
```
cd /home/abogado/apps/advocate-nest/releases/2026-08-01/app
npm install --omit=dev
```

**3. Configurar variables de entorno**  
Copiar el archivo `config/.env.production.example` a una ubicación segura fuera del directorio web, completar los valores reales y aplicar permisos 600:
```
chmod 600 .env.production
```
Los nombres y descripciones de cada variable están en el archivo `docs/ENVIRONMENT_VARIABLES.md`.

**4. Comando de inicio**  
```
node .output/server/index.mjs
```
El servidor escucha en `127.0.0.1:3000` (configurable con variables `HOST` y `PORT`).

**5. Proceso permanente**  
Necesitamos que el proceso se mantenga activo, se reinicie automáticamente si falla y se inicie después de reiniciar el servidor. Las opciones disponibles son PM2, systemd o Supervisor. La configuración detallada de cada opción está en `docs/VIRTUALMIN_DEPLOYMENT.md`.

**6. Proxy inverso**  
Configurar Apache (o Nginx) para redirigir el tráfico de `abogado.consoldi.com` al servidor Node en `http://127.0.0.1:3000`. La configuración exacta está en `docs/VIRTUALMIN_DEPLOYMENT.md`.

**7. HTTPS**  
Activar un certificado SSL para `abogado.consoldi.com`. Recomendamos Let's Encrypt con certbot. **Antes de cambiar la URL en Supabase, confirmar que HTTPS esté activo.**

**8. Reinicio automático**  
Confirmar que el proceso de Node se reinicia automáticamente después de reiniciar el servidor (PM2 startup, systemd enable, o equivalente).

**9. Logs**  
¿En qué ruta quedarán los logs de la aplicación? Necesitamos esa información para monitoreo.

**10. Límites del servidor**  
¿Cuál es el límite de memoria RAM asignado al virtual server? ¿Existe un límite para el tamaño máximo de subida de archivos en el proxy? El CRM permite subir documentos adjuntos a expedientes.

---

Una vez que el servidor esté activo con HTTPS, necesitaremos actualizar la URL del site en el panel de Supabase (Authentication → URL Configuration). Les avisamos en ese momento.

El archivo `docs/VIRTUALMIN_DEPLOYMENT.md` contiene la guía completa paso a paso con todos los comandos exactos.

Quedo pendiente de cualquier consulta.

---

## Información técnica de referencia

| Dato | Valor |
|---|---|
| Aplicación | advocate-nest (CRM Jurídico) |
| Framework | TanStack Start + Nitro (Node preset) |
| Node.js requerido | 22.x o superior |
| Comando de inicio | `node .output/server/index.mjs` |
| Puerto por defecto | 3000 |
| Host por defecto | 127.0.0.1 |
| Healthcheck | `GET /api/health` |
| Backend de datos | Supabase (externo, no en el servidor) |
| Base de datos en servidor | No requerida |
| node_modules en ZIP | No incluido — instalar con `npm install --omit=dev` |
