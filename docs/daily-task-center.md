# Centro de trabajo diario

## Alcance

La Fase 4 consolida la gestión operativa en `public.case_tasks`. No crea una tabla
`daily_tasks` ni copia vencimientos a `agenda_events`: el calendario compone ambas
fuentes al consultar.

La migración local preparada es
`supabase/migrations/20260729130000_daily_task_center.sql`. No fue aplicada a
Supabase remoto durante esta fase.

## Flujo de trabajo

La ruta `/agenda` abre en **Mi día** y ofrece tres vistas:

- **Mi día**: atrasadas, tareas para la fecha seleccionada y terminadas ese día.
- **Próximas**: vencimientos posteriores, agrupados en los siguientes siete días
  y más adelante.
- **Calendario**: eventos de `agenda_events` y plazos de `case_tasks` diferenciados
  visualmente.

La lista es la vista operativa predeterminada y el tablero permite cambiar estados
sin duplicar registros. Los filtros se aplican en servidor y las consultas tienen
límites explícitos.

## Modelo

Estados operativos:

1. Pendiente (`pending`)
2. En proceso (`in_progress`)
3. Listo para ingresar (`ready_to_file`)
4. Terminado (`completed`)
5. Bloqueado (`blocked`)

Prioridades: Baja, Normal, Alta y Urgente. Los valores heredados `Media`,
`cancelled` y `overdue` siguen admitidos para compatibilidad y se normalizan en la
interfaz sin una reescritura masiva.

Una tarea puede ser general, depender directamente de un cliente o depender de un
expediente. Cuando existe expediente, el cliente se deriva de éste. La base de
datos rechaza una combinación incoherente si ambas claves fueran enviadas.

Las fechas se interpretan en `America/Lima`. Una tarea de día completo se almacena
al final del día local y una tarea con hora conserva la hora elegida.

## Permisos

- Administrador: crear, editar todos los campos, reasignar, cambiar estado y
  eliminar.
- Personal: crear tareas propias y modificar únicamente estado y observaciones de
  tareas que tenga asignadas.
- Personal inicia en el filtro **Mis tareas**. La lectura general que ya tenía el
  personal del CRM se conserva; la restricción de mutaciones se aplica también en
  RLS y mediante un trigger de campos protegidos.

La base de datos establece `completed_at` y `completed_by` al terminar una tarea y
los limpia al reabrirla. Los cambios importantes de una tarea asociada a un
expediente generan una sola entrada en `case_events`.

## Aplicación segura de la migración

Antes de aplicar en un entorno remoto:

1. Confirmar que las migraciones remotas pendientes de fases anteriores estén
   conciliadas.
2. Ejecutar la migración en una base local o de staging.
3. Comprobar valores heredados de prioridad y estado.
4. Probar con usuarios Administrador y Personal las políticas de insertar,
   actualizar, reasignar y eliminar.
5. Verificar que completar y reabrir mantiene la auditoría esperada.
6. Confirmar que el calendario muestra una tarea una sola vez y que
   `agenda_events` no recibe copias.
7. Aplicar a producción únicamente con respaldo confirmado y una ventana de
   reversión acordada.

## Validación local

Los contratos puros y SQL están cubiertos por `tests/daily-tasks.test.ts`. La
validación completa requiere:

```text
npm test
npm run lint
npm run build
```

Las suites `test:remote` y `test:staging` no forman parte de esta fase y no deben
ejecutarse sin autorización y credenciales específicas.
