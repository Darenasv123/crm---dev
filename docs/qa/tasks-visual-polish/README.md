# QA visual de Tareas — 2026-07-29

## Alcance y autenticación

La aplicación local respondió en `http://localhost:8080` y redirigió correctamente a `/login`.
El navegador integrado no conservaba una sesión autenticada y el proyecto no dispone de una
cuenta de prueba configurada ni de un modo demo para Tareas. No se crearon usuarios, no se
leyeron credenciales y no se simuló silenciosamente una sesión.

Por esta razón, la revisión autenticada de datos, mutaciones y paneles abiertos quedó bloqueada.
Se completó la revisión pública de acceso, la matriz de viewports y una auditoría estructural de
los componentes protegidos.

## Matriz pública revisada

Se comprobó `/login` en:

- 1366 × 768
- 1440 × 900
- 1920 × 1080
- 1280 × 720
- 768 × 1024
- 1024 × 768
- 390 × 844
- 412 × 915

No se detectó desbordamiento horizontal ni errores o advertencias de consola en la pantalla de
acceso.

## Hallazgos estructurales corregidos

1. La tabla se activaba desde 768 px y comprimía demasiadas columnas. Ahora se usan tarjetas por
   debajo de 1280 px y la información secundaria se oculta hasta 1536 px.
2. La tabla priorizaba responsable antes que tarea. Ahora el orden comienza con Tarea, Cliente,
   Expediente y Estado.
3. Los títulos móviles se limitaban a una sola línea. Ahora admiten hasta tres líneas.
4. `Limpiar todo` se mostraba incluso sin filtros activos. Ahora aparece solo cuando corresponde.
5. Los botones del formulario y de filtros podían quedar fuera de vista durante el scroll. Sus
   pies son ahora persistentes.
6. Los paneles de formulario y detalle declaran ancho completo en móvil.

## Evidencia

Las capturas públicas anonimizadas se guardaron fuera del repositorio:

`C:\Users\daren\.codex\visualizations\2026\07\29\019fae07-da74-7f51-b592-25139c5358ba\tasks-visual-polish`

- `auth-block-1366x768.png`
- `auth-block-390x844.png`

No se generaron capturas de Tareas, Agenda o Dashboard porque hacerlo habría requerido inventar
una autenticación o utilizar datos remotos no anonimizados.

## Pendiente para aprobación de staging

Ejecutar una segunda revisión con una cuenta de prueba segura ya existente y datos ficticios. Debe
cubrir creación y edición, filtros, cambios de estado, detalle, Agenda, Dashboard, consola y red.
