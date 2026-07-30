# Cola de trabajo de Tareas

## Vistas

Personal:

- `/tareas`: Disponibles.
- `/tareas/mias`: Mis tareas.
- `/tareas/tablero`: Tablero.

Administrador:

- `/tareas`: Disponibles.
- `/tareas/mias`: En ejecución.
- `/tareas/todas`: Todas.
- `/tareas/tablero`: Tablero.

La ruta heredada `/tareas/proximas` redirige a `/tareas`.

## Reglas

- Sólo el Administrador crea tareas.
- Toda tarea nueva inicia pendiente y sin responsable.
- Personal y Administrador pueden tomar una tarea disponible mediante la RPC atómica
  `claim_case_task`.
- Personal actualiza únicamente tareas propias y puede devolverlas a la cola.
- El Administrador reasigna, libera, cambia estado y elimina.
- Los cambios de estado y asignación se registran en la cronología del expediente.

## Independencia de Agenda

Las tareas no tienen programación temporal, no aparecen en el calendario y no invalidan consultas
de Agenda. Los filtros se limitan a búsqueda, vista, estado, prioridad, cliente, expediente,
responsable y relaciones ausentes.
