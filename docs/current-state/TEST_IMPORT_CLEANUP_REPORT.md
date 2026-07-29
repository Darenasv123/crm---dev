# Informe anonimizado de revisión y limpieza de importaciones

> [!IMPORTANT]
> Este documento fue anonimizado el 2026-07-29. Se eliminaron nombres, documentos
> de identidad, teléfonos, identificadores, rutas de Storage, nombres de archivos
> jurídicos, hashes y marcas temporales que podían relacionarse con personas o
> expedientes reales.

## Objetivo original

La revisión evaluó registros creados durante pruebas de importación documental
para distinguir datos operativos de datos de prueba antes de cualquier limpieza.
El análisis utilizó un enfoque conservador: inventario previo, respaldo local,
plan de cambios y revisión separada de clientes, expedientes, documentos y
objetos de Storage.

## Conclusiones técnicas preservadas

- Se detectaron registros con procedencia de importación ZIP que requerían
  revisión manual antes de eliminarlos.
- La relación entre clientes, expedientes, documentos y objetos de Storage debía
  comprobarse como una unidad para evitar registros huérfanos.
- La sola presencia de metadatos de importación no era evidencia suficiente para
  eliminar un registro.
- El procedimiento de limpieza debía comenzar con un dry-run, generar un
  respaldo verificable y detenerse ante conflictos.
- Los objetos de Storage solo debían eliminarse después de confirmar que no eran
  compartidos ni utilizados por registros conservados.
- Los resultados operativos detallados no pertenecen al repositorio de código.
  Deben mantenerse en un almacenamiento privado con acceso controlado y política
  de retención.

## Datos retirados

Se retiraron del working tree actual:

- nombres y otras referencias personales;
- números de identificación y contacto;
- UUID y claves internas relacionadas con registros;
- rutas, nombres y URL de documentos;
- hashes de contenido y metadatos de archivos;
- listados completos de filas y objetos;
- marcas temporales que permitían correlacionar operaciones.

Los conteos detallados también se omitieron porque, combinados con otros datos,
podían facilitar la reidentificación.

## Riesgo histórico

La anonimización del archivo actual no elimina versiones anteriores que puedan
existir en commits, clones, ramas, respaldos o plataformas remotas. No se
reescribió el historial durante la estabilización.

Si una revisión legal y de seguridad determina que el historial debe depurarse,
será necesario coordinar una operación independiente de reescritura, rotación de
referencias compartidas y resincronización de todos los clones. Esa operación
puede invalidar ramas, enlaces a commits y el historial conectado con Lovable,
por lo que no debe ejecutarse sin aprobación y un plan de recuperación.

## Estado

El working tree conserva únicamente esta síntesis técnica anonimizada. Los datos
operativos originales no deben volver a añadirse al repositorio.
