# Guía de Despliegue en Virtualmin

**Aplicación:** CRM Jurídico Estudio Arenas (advocate-nest)  
**Dominio:** `https://abogado.consoldi.com`  
**Release:** 2026-08-01  
**Versión Node.js requerida:** 22.x (LTS) o superior  

---

## Arquitectura

```
Internet
  │
  ▼
https://abogado.consoldi.com  (puerto 443, HTTPS)
  │
  ▼
Apache/Nginx de Virtualmin  (proxy inverso)
  │
  ▼
http://127.0.0.1:3000  (servidor Node.js interno)
  │
  ▼
CRM TanStack Start + Nitro  (.output/server/index.mjs)
  │
  ▼
Supabase (externo)  — Auth, PostgreSQL, RLS, RPC, Storage
```

---

## Ubicación propuesta en el servidor

```
/home/abogado/apps/advocate-nest/
├── releases/
│   └── 2026-08-01/          ← contenido del ZIP descomprimido aquí
│       ├── app/
│       │   ├── .output/
│       │   ├── package.json
│       │   └── package-lock.json
│       ├── config/
│       │   └── .env.production.example
│       ├── docs/
│       ├── scripts/
│       ├── RELEASE_INFO.txt
│       └── MANIFEST.sha256
├── current/                 ← enlace simbólico al release activo
│   └── → releases/2026-08-01/
└── shared/
    └── .env.production      ← variables de entorno reales (fuera del ZIP)
```

> ⚠️ **No colocar en `/home/abogado/public_html/`** — esa carpeta es servida directamente por Apache como archivos estáticos. El CRM es una aplicación Node.js, no archivos estáticos.

---

## Paso a paso de instalación

### 1. Subir el release por SFTP

```
Servidor: 144.126.140.178
Puerto: 2705
Usuario: abogado
Destino: /home/abogado/apps/advocate-nest/releases/
```

Subir el archivo: `advocate-nest-virtualmin-release-2026-08-01.zip`

### 2. Descomprimir en el servidor

```bash
cd /home/abogado/apps/advocate-nest/releases/
unzip advocate-nest-virtualmin-release-2026-08-01.zip -d 2026-08-01/
```

### 3. Instalar dependencias de producción

```bash
cd /home/abogado/apps/advocate-nest/releases/2026-08-01/app
npm install --omit=dev --ignore-scripts
```

> El `.output/server/` ya incluye la mayoría de dependencias empaquetadas. Esta instalación es por si alguna dependencia nativa necesita resolverse en el entorno Linux.

### 4. Configurar variables de entorno

```bash
mkdir -p /home/abogado/apps/advocate-nest/shared
cp /home/abogado/apps/advocate-nest/releases/2026-08-01/config/.env.production.example \
   /home/abogado/apps/advocate-nest/shared/.env.production
chmod 600 /home/abogado/apps/advocate-nest/shared/.env.production
nano /home/abogado/apps/advocate-nest/shared/.env.production
# ← Completar con los valores reales
```

### 5. Verificar variables

```bash
cd /home/abogado/apps/advocate-nest/releases/2026-08-01
node scripts/validate-production-env.mjs
# Debe imprimir: ✓ Todas las variables requeridas están presentes.
```

### 6. Crear enlace simbólico

```bash
ln -sfn /home/abogado/apps/advocate-nest/releases/2026-08-01 \
        /home/abogado/apps/advocate-nest/current
```

### 7. Iniciar con PM2 (recomendado)

```bash
cd /home/abogado/apps/advocate-nest/current/app
pm2 start .output/server/index.mjs \
  --name advocate-nest \
  --env production \
  --env-file /home/abogado/apps/advocate-nest/shared/.env.production \
  --restart-delay 5000 \
  --max-restarts 10 \
  --log /home/abogado/logs/advocate-nest.log \
  --error /home/abogado/logs/advocate-nest.error.log
pm2 save
pm2 startup   # ← ejecutar el comando que PM2 sugiera como root
```

### 8. Verificar que el servidor responde

```bash
curl http://127.0.0.1:3000/api/health
# Debe retornar: {"status":"ok","service":"advocate-nest",...}
```

---

## Comando de inicio

```bash
node .output/server/index.mjs
```

Con variables de entorno:
```bash
NODE_ENV=production HOST=127.0.0.1 PORT=3000 node .output/server/index.mjs
```

---

## Configuración de red

| Variable | Valor recomendado | Notas |
|---|---|---|
| `HOST` | `127.0.0.1` | Solo accesible localmente |
| `PORT` | `3000` | No exponer directo a Internet |
| `NODE_ENV` | `production` | Obligatorio |

---

## Proxy inverso

### Apache (Virtualmin usa Apache por defecto)

Añadir en la configuración del virtualhost de `abogado.consoldi.com`:

```apache
<VirtualHost *:443>
    ServerName abogado.consoldi.com
    
    # Certificado SSL (configurar con Let's Encrypt o similar)
    SSLEngine on
    SSLCertificateFile    /etc/ssl/certs/abogado.consoldi.com.crt
    SSLCertificateKeyFile /etc/ssl/private/abogado.consoldi.com.key
    
    # Proxy al servidor Node.js
    ProxyRequests Off
    ProxyPreserveHost On
    
    # WebSocket support (para hot reload en desarrollo — no necesario en prod)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule ^/(.*) ws://127.0.0.1:3000/$1 [P,L]
    
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    
    # Headers de seguridad
    Header always set X-Content-Type-Options nosniff
    Header always set X-Frame-Options SAMEORIGIN
    Header always set Referrer-Policy strict-origin-when-cross-origin
    
    # Logs
    ErrorLog  /var/log/virtualmin/abogado.consoldi.com_error.log
    CustomLog /var/log/virtualmin/abogado.consoldi.com_access.log combined
</VirtualHost>

# Redirección HTTP → HTTPS
<VirtualHost *:80>
    ServerName abogado.consoldi.com
    Redirect permanent / https://abogado.consoldi.com/
</VirtualHost>
```

Módulos Apache requeridos:
```bash
a2enmod proxy proxy_http proxy_wstunnel ssl rewrite headers
systemctl restart apache2
```

---

### Nginx (alternativo)

```nginx
server {
    listen 443 ssl;
    server_name abogado.consoldi.com;
    
    ssl_certificate     /etc/ssl/certs/abogado.consoldi.com.crt;
    ssl_certificate_key /etc/ssl/private/abogado.consoldi.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout generoso para SSR
        proxy_read_timeout 60s;
    }
    
    # Logs
    access_log /var/log/nginx/abogado.consoldi.com.access.log;
    error_log  /var/log/nginx/abogado.consoldi.com.error.log;
}

server {
    listen 80;
    server_name abogado.consoldi.com;
    return 301 https://$host$request_uri;
}
```

---

## Proceso permanente

### Opción 1: PM2 (recomendada)

```bash
npm install -g pm2
pm2 start .output/server/index.mjs --name advocate-nest
pm2 startup  # configurar inicio automático
pm2 save
```

Comandos útiles de PM2:
```bash
pm2 status          # ver estado
pm2 logs advocate-nest   # ver logs en tiempo real
pm2 restart advocate-nest
pm2 stop advocate-nest
```

### Opción 2: systemd

Crear `/etc/systemd/system/advocate-nest.service`:

```ini
[Unit]
Description=CRM Jurídico Estudio Arenas
After=network.target

[Service]
Type=simple
User=abogado
WorkingDirectory=/home/abogado/apps/advocate-nest/current/app
EnvironmentFile=/home/abogado/apps/advocate-nest/shared/.env.production
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=advocate-nest
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable advocate-nest
systemctl start advocate-nest
systemctl status advocate-nest
```

### Opción 3: Supervisor

Crear `/etc/supervisor/conf.d/advocate-nest.conf`:

```ini
[program:advocate-nest]
command=node .output/server/index.mjs
directory=/home/abogado/apps/advocate-nest/current/app
user=abogado
autostart=true
autorestart=true
stderr_logfile=/home/abogado/logs/advocate-nest.err.log
stdout_logfile=/home/abogado/logs/advocate-nest.out.log
environment=NODE_ENV="production",HOST="127.0.0.1",PORT="3000"
```

```bash
supervisorctl reread
supervisorctl update
supervisorctl start advocate-nest
```

---

## SSL

1. Instalar certbot: `apt install certbot python3-certbot-apache`
2. Obtener certificado: `certbot --apache -d abogado.consoldi.com`
3. Verificar renovación automática: `certbot renew --dry-run`
4. **Después de activar HTTPS**, actualizar en Supabase:
   - Authentication → URL Configuration → Site URL: `https://abogado.consoldi.com`

---

## Logs

| Fuente | Ubicación |
|---|---|
| PM2 stdout | `pm2 logs advocate-nest --out` |
| PM2 stderr | `pm2 logs advocate-nest --err` |
| PM2 combinado | `~/.pm2/logs/advocate-nest*.log` |
| systemd | `journalctl -u advocate-nest -f` |
| Apache acceso | `/var/log/virtualmin/abogado.consoldi.com_access.log` |
| Apache error | `/var/log/virtualmin/abogado.consoldi.com_error.log` |
| Dominio Virtualmin | Panel Virtualmin → tu dominio → Logs |

---

## Actualización a una nueva versión

Ver `docs/UPDATE.md` para el procedimiento de actualización sin downtime.

---

## Rollback

Ver `docs/ROLLBACK.md` para el procedimiento de rollback a la versión anterior.
