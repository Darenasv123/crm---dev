# Revisión de seguridad del bootstrap self-hosted

## Resultado

El bootstrap corrige las dos exposiciones críticas confirmadas en Cloud: el rol de signup ya no procede de metadata controlada por el usuario y `profiles_update` ya no permite actualizaciones amplias a cualquier autenticado. El diseño queda preparado para PostgreSQL 17.6 y no se ha aplicado a ninguna base.

## `handle_new_user`

Riesgo Cloud: `raw_user_meta_data.role` permitía intentar una autoasignación de `Administrador`.

Control canónico:

- asigna literalmente `Personal` y `Activo`;
- solo consume `full_name` y `phone` de metadata;
- en `ON CONFLICT` no escribe `role` ni `status`;
- usa `SECURITY DEFINER` con `search_path=''` y nombres cualificados;
- no concede EXECUTE directo a usuarios; se invoca mediante el trigger de `auth.users`.

La promoción a Administrador ocurre únicamente mediante una actualización de `profiles` autorizada a un Administrador activo o mediante backend `service_role`. Debe existir un procedimiento operativo de “primer administrador” fuera del signup público, ejecutado una sola vez por un operador de confianza.

## RLS de perfiles

`profiles_select` requiere staff activo. `profiles_update_admin` requiere Admin activo tanto para localizar la fila como para aceptar el resultado. No existe policy INSERT o DELETE para `authenticated`: el alta la realiza el trigger Auth y las operaciones backend usan `service_role`.

Se eligió no permitir autoedición directa porque `role` y `status` comparten tabla con nombre/teléfono. PostgreSQL puede complementar RLS con grants de columna, pero el flujo actual del CRM administra perfiles desde una pantalla de Administrador. Si aparece una pantalla de “mi perfil”, la opción segura es una RPC que solo acepte nombre/teléfono; no debe ampliarse `profiles_update_admin`.

## Helpers y cuenta inactiva

La lógica canónica vive en dos funciones: `crm_is_active_staff` y `crm_is_active_admin`. Ambas exigen `status='Activo'`; una cuenta inactiva queda excluida de todas las policies. `is_staff` e `is_admin` son wrappers de compatibilidad, sin duplicar consultas ni reglas. Los helpers definer evitan recursión RLS sobre `profiles`.

## `SECURITY DEFINER`

Se usa solo donde hace falta eludir RLS para autorización central, triggers de integridad/auditoría o RPC atómicas. Todas las funciones definer fijan `search_path=''` y cualifican objetos. `0006_rls_and_grants.sql` revoca primero todos los EXECUTE de `PUBLIC`, `anon` y `authenticated`, y concede ocho puntos explícitos a `authenticated`. Las demás funciones son accesibles por triggers o `service_role`.

Las RPC de tareas usan lock de fila y un marcador transaccional interno que el guard valida. Existe un solo trigger `case_tasks_20_guard_update`. La RPC de pagos comprueba Admin activo, bloquea el plan y rechaza sobrepago antes de insertar registro y actualizar acumulados en la misma transacción.

## Grants y matriz resumida

| Actor                | Resultado esperado                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `anon`               | Sin acceso a tablas, funciones RPC ni Storage privado                                                        |
| Personal activo      | Operación general; sin perfiles/pagos/agenda administrativos, sin deletes, tareas propias y RPC claim/return |
| Administrador activo | Operaciones administrativas y RPC de pagos/normalización                                                     |
| Usuario inactivo     | Helpers falsos; ninguna policy de negocio concede filas                                                      |
| `service_role`       | Acceso backend completo; debe permanecer solo en servidor                                                    |

Las tablas `google_calendar_oauth_states` y `google_calendar_sync_requests` tienen RLS habilitada pero cero policies/grants para `authenticated`; son internas de backend. El token de actualización se almacena en `encrypted_refresh_token`, pero el bootstrap no define el mecanismo criptográfico: la aplicación/gestor de secretos debe documentar algoritmo, clave, rotación y recuperación.

## Riesgos que requieren prueba dinámica posterior

- Bootstrap del primer Administrador sin usar metadata de signup.
- Propietario real de funciones y tablas en la distribución self-hosted.
- Bypass RLS efectivo de las RPC definer bajo los roles reales de Supabase.
- Carreras de claim/return y pago en dos conexiones simultáneas.
- Límites HTTP y del servicio Storage, aunque el bucket no impone cuota/MIME.
- Custodia de `service_role`, secretos Google y clave de cifrado de refresh tokens.
- Pruebas E2E de recuperación de contraseña y redirecciones con la URL self-hosted.
