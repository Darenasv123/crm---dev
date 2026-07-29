# Remediación de privacidad del repositorio

Fecha: 2026-07-29
Alcance: working tree de la rama de estabilización.

## Resultado

Se anonimizaron:

- `docs/current-state/TEST_IMPORT_CLEANUP_REPORT.md`;
- `docs/current-state/PHASE_0_DATA_REVIEW.md`.

Ambos contenían datos derivados de revisiones operativas de importaciones. No se
copiaron valores personales a este informe.

## Categorías detectadas

- nombres y referencias a clientes;
- documentos de identidad y datos de contacto;
- identificadores de registros;
- rutas y metadatos de Storage;
- nombres de documentos jurídicos;
- hashes y marcas temporales correlacionables.

Los ejemplos ficticios usados por pruebas automatizadas y datos demo se
mantuvieron cuando estaban claramente aislados y no correspondían a registros
operativos.

## Alcance de la corrección

La corrección protege el contenido visible del working tree actual. El respaldo
externo de estabilización conserva el estado anterior en una ubicación local
separada para fines de recuperación y debe tratarse como material restringido.

## Riesgo histórico pendiente

El contenido anterior puede continuar en commits ya existentes, clones, ramas,
respaldos o servicios conectados. Esta fase no reescribió el historial.

Una eventual depuración histórica requeriría:

1. aprobación legal, de seguridad y de los responsables del repositorio;
2. inventario de ramas, tags, clones, forks, respaldos y despliegues;
3. respaldo inmutable previo y plan de restauración;
4. reescritura coordinada mediante una herramienta especializada;
5. invalidación o rotación de referencias compartidas cuando corresponda;
6. resincronización obligatoria de clones y ramas;
7. verificación posterior en Git remoto, Lovable y artefactos publicados.

Reescribir el historial puede invalidar commits, romper ramas abiertas y hacer
que otros clones vuelvan a introducir el contenido. También puede afectar la
sincronización histórica con Lovable. No debe realizarse como una limpieza local
ordinaria.
