# Importación de clientes

El flujo vigente acepta archivos CSV o XLSX desde la pantalla de Clientes.

Columnas reconocidas:

- nombre;
- teléfono;
- correo;
- estado.

El nombre es obligatorio. El correo puede quedar vacío; cuando existe se valida su formato.
Las cadenas vacías se persisten como `NULL`. El importador muestra una vista previa, marca filas
inválidas y sólo inserta filas válidas.

Los importadores jerárquicos anteriores fueron retirados porque dependían del modelo de datos
reemplazado. Los documentos continúan cargándose desde el módulo Documentos.
