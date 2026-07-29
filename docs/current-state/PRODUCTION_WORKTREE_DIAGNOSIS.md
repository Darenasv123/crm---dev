# Diagnóstico del worktree de producción

Fecha: 2026-07-29.

Worktree revisado: `C:\Users\daren\advocate-nest-production`.

## Hallazgo

Git muestra `src/routeTree.gen.ts` como modificado en la rama
`production-maintenance`, pero no existe una diferencia de contenido:

- `git diff -- src/routeTree.gen.ts` no produce líneas;
- `git diff --quiet -- src/routeTree.gen.ts` termina con código `0`;
- el blob del índice y el archivo filtrado del worktree tienen el mismo objeto
  Git;
- `git update-index --refresh` mantiene la marca de modificación.

El origen más probable es una discrepancia de metadatos o normalización de
finales de línea en un archivo generado, no una edición manual con contenido
pendiente. El archivo quedó incluido por separado en el respaldo externo antes
del diagnóstico.

## Acción segura

No se copió, descartó, regeneró ni confirmó el archivo, y no se mezclaron ramas.
Antes de limpiar esa marca conviene ejecutar el generador oficial en el propio
worktree, comprobar otra vez que el diff sea vacío y refrescar su índice. No se
debe trasladar manualmente el archivo entre ramas porque su contenido depende
del árbol de rutas de cada rama.
