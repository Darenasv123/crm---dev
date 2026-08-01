# Procedimiento de Rollback

**Aplicación:** advocate-nest

---

## Cuándo usar rollback

- El nuevo release presenta errores críticos en producción
- El healthcheck `/api/health` no responde después de la actualización
- Los usuarios reportan errores de autenticación o pérdida de datos

---

## Pasos de rollback

```bash
# 1. Identificar el release anterior
ls -la /home/abogado/apps/advocate-nest/releases/

# 2. Apuntar el enlace simbólico al release anterior
ln -sfn /home/abogado/apps/advocate-nest/releases/FECHA_ANTERIOR \
        /home/abogado/apps/advocate-nest/current

# 3. Reiniciar el proceso
pm2 restart advocate-nest
# ó
systemctl restart advocate-nest

# 4. Verificar que el rollback fue exitoso
curl http://127.0.0.1:3000/api/health
```

---

## Rollback de configuración de Supabase

Si se actualizó el Site URL en Supabase y el rollback requiere revertirlo:

1. Ir a Supabase Dashboard → Authentication → URL Configuration
2. Restaurar el Site URL anterior
3. Los usuarios activos perderán su sesión y deberán volver a iniciar sesión

---

## Conservación de releases anteriores

Se recomienda mantener al menos los últimos 2 releases en el servidor para facilitar rollbacks rápidos. Eliminar releases más antiguos:

```bash
# Listar releases por fecha
ls -la /home/abogado/apps/advocate-nest/releases/

# Eliminar release antiguo (verificar que no es el activo)
readlink /home/abogado/apps/advocate-nest/current  # confirmar release activo
rm -rf /home/abogado/apps/advocate-nest/releases/FECHA_A_ELIMINAR
```
