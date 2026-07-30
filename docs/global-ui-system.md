# Sistema visual global del CRM

## Origen de la regresión

Los formularios simplificados de Clientes, Expedientes y Tareas empezaron a utilizar
`className="field"`, pero la clase no existía en `src/styles.css`. A la vez, los controles
compartidos conservaban una altura de 36 px y, en algunos casos, fondo transparente. La mezcla
con `input`, `select` y `textarea` nativos provocó que teléfono, correo y estado parecieran texto
plano o controles del navegador.

La corrección se realizó en el sistema global, no mediante estilos aislados por ruta:

- tokens semánticos claros y oscuros;
- altura táctil de 44 px;
- normalización defensiva de controles nativos;
- componentes compartidos para controles, formularios, diálogos, tablas y estados;
- patrones reutilizados en módulos operativos.

## Tokens

Los tokens viven en `src/styles.css`. Los colores funcionales deben usar `primary`,
`destructive`, `success`, `warning`, `info` y los tokens `task-*`. No se deben introducir
colores Tailwind arbitrarios para estados nuevos.

`--control-height` define la altura base. Las superficies usan `background`, `card`, `muted`,
`border` y las sombras `soft`, `card` o `elevated`. El bloque `.dark` mantiene los mismos roles
semánticos en modo oscuro.

## Componentes

- `Input`, `Textarea`, `NativeSelect` y `Select`: controles editables.
- `Button`: variantes primaria, secundaria, outline, ghost, destructiva y success; admite
  `loading`.
- `FormSection`, `FormField`, `FormActions`, `FormErrorSummary` y `RequiredIndicator`:
  estructura de formularios.
- `Dialog`: tamaños `sm`, `md`, `lg` y `xl`, foco gestionado por Radix, cierre accesible y scroll
  interno.
- `LoadingState`, `EmptyState` y `ErrorState`: estados de página o sección.
- `Table`, `Card` y `Badge`: superficies administrativas densas y estados.

Los `select` breves y estables pueden usar `NativeSelect`, que encapsula y normaliza el elemento
nativo. Para listas extensas o con búsqueda se debe usar el `Select` de Radix o un patrón de
comando.

## Reglas de formularios

- Cada control debe tener `id` y una etiqueta asociada.
- Los campos no obligatorios muestran “Opcional” fuera del valor.
- Los errores de campo usan `aria-invalid` y `aria-describedby`.
- La mutación fallida conserva el estado del formulario.
- La acción secundaria aparece antes de la principal.
- `loading` deshabilita el botón y evita el doble envío.

## Responsive y accesibilidad

El sistema usa una columna en móvil y dos cuando hay espacio. Los controles mantienen 44 px,
los diálogos ocupan el ancho disponible y las tablas operativas conservan tarjetas móviles
donde ya existe esa alternativa.

No se eliminan outlines sin reemplazo. Los componentes compartidos incluyen foco visible,
estados disabled/read-only y movimiento reducido. `html` bloquea el desbordamiento horizontal
global.

## Catálogo local

`dev/ui-catalog.html` es una entrada Vite separada del router y de la navegación del CRM. Solo
se utiliza durante desarrollo:

```powershell
npm.cmd run dev -- --open /dev/ui-catalog.html
```

El catálogo no consulta Supabase ni otros servicios, está marcado `noindex` y contiene únicamente
datos ficticios. No forma parte del árbol de rutas generado ni de la navegación de producción.
