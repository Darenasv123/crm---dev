# Auditoría UTF-8 y textos del CRM

Fecha: 2026-07-23

## Causa raíz

Los textos corruptos reportados no venían de una sola fuente. El patrón corresponde a mojibake: bytes UTF-8 interpretados como Windows-1252/Latin-1, además de algunos archivos con BOM UTF-8 al inicio. Por eso se corrigieron los textos visibles escritos en el código y también se agregó reparación defensiva en los puntos donde entran archivos externos.

## Fuentes separadas

1. Textos escritos en el código: se corrigieron copy visible, mensajes, etiquetas, accesibilidad y ejemplos del importador.
2. Nombres provenientes del ZIP: se conservan los nombres correctos y solo se repara mojibake detectable al normalizar rutas o nombres.
3. Texto extraído de DOCX, PDF y TXT: DOCX/PDF/TXT pasan por reparación de mojibake; TXT usa fallback Windows-1252 si la decodificación UTF-8 produce caracteres de reemplazo.
4. Datos almacenados en Supabase: no se modificaron datos reales. La limpieza de importaciones históricas sigue limitada a dry-run hasta ejecutar un plan revisado.

## Prevención de regresiones

- `tests/text-utils.test.ts` cubre reparación de mojibake, preservación de tildes correctas y pluralización.
- `tests/import-copy.test.ts` fija el copy UTF-8 del importador ZIP.
- `tests/zip-import.test.ts` cubre nombres de ZIP con tildes, texto PDF con mojibake, TXT Windows-1252 y pluralización natural.
- `tests/csv-import.test.ts` cubre BOM UTF-8 y encabezados acentuados/no acentuados.
- `tests/mass-import-dry-run.test.ts` conserva el dry-run para datos de importaciones ZIP masivas anteriores.
