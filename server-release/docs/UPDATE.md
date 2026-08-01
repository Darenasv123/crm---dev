# Procedimiento de Actualización

**Aplicación:** advocate-nest  
**Estrategia:** Blue-green sin downtime

---

## Preparación

1. Preparar el nuevo release (ZIP verificado y probado)
2. Subir por SFTP a `/home/abogado/apps/advocate-nest/releases/`
3. **No detener el servidor actual todavía**

---

## Pasos de actualización

```bash
# 1. Descomprimir el nuevo release
cd /home/abogado/apps/advocate-nest/releases/
unzip advocate-nest-virtualmin-release-NUEVA_FECHA.zip -d NUEVA_FECHA/

# 2. Instalar dependencias
cd NUEVA_FECHA/app
npm install --omit=dev

# 3. Verificar variables de entorno (las mismas del release anterior)
cd ..
cp /home/abogado/apps/advocate-nest/shared/.env.production .env.production.test
node scripts/validate-production-env.mjs

# 4. Probar el nuevo release en otro puerto (sin afectar el activo)
PORT=3001 NODE_ENV=production node app/.output/server/index.mjs &
TEST_PID=$!
curl http://127.0.0.1:3001/api/health

# 5. Si el health check responde correctamente, detener la prueba
kill $TEST_PID

# 6. Actualizar el enlace simbólico al nuevo release
ln -sfn /home/abogado/apps/advocate-nest/releases/NUEVA_FECHA \
        /home/abogado/apps/advocate-nest/current

# 7. Reiniciar el proceso de producción
pm2 restart advocate-nest
# ó
systemctl restart advocate-nest
```

---

## Verificación post-actualización

```bash
# Verificar healthcheck
curl http://127.0.0.1:3000/api/health

# Ver logs en tiempo real
pm2 logs advocate-nest --lines 50
# ó
journalctl -u advocate-nest -n 50 -f
```

---

## Si algo sale mal, ver ROLLBACK.md
