# Testing Status

## Comandos ejecutados el 2026-07-22

`npm.cmd test`

Resultado: 7 archivos, 107 tests pasaron.

- `tests/csv-import.test.ts`: 39 tests.
- `tests/supabase-errors.test.ts`: 2 tests.
- `tests/legal-domain.test.ts`: 6 tests.
- `tests/ai-review.test.ts`: 3 tests.
- `tests/mock-providers.test.ts`: 4 tests.
- `tests/ai-findings.test.ts`: 6 tests.
- `tests/zip-import.test.ts`: 47 tests.

`npx.cmd tsc --noEmit`

Resultado: exit code 0, sin salida de error.

`npm.cmd run lint`

Resultado: exit code 0; 7 warnings Fast Refresh preexistentes:

- `src/components/ui/badge.tsx:32`
- `src/components/ui/button.tsx:49`
- `src/components/ui/form.tsx:163`
- `src/components/ui/navigation-menu.tsx:111`
- `src/components/ui/sidebar.tsx:743`
- `src/components/ui/toggle.tsx:42`
- `src/hooks/use-auth.tsx:89`

`npm.cmd run build`

Resultado: exit code 0. Build client, SSR y Nitro Cloudflare completado. Warnings: `vite-tsconfig-paths` obsoleto frente a `resolve.tsconfigPaths`, chunks mayores a 500 kB, tiempos altos de plugins, `inlineDynamicImports` ignorado por codeSplitting.

## Cobertura por modulo

CSV/XLSX: cubierto por `tests/csv-import.test.ts` (parseo, validacion, headers, errores).

ZIP: cubierto por `tests/zip-import.test.ts` (normalizacion, extensiones, texto, duplicados, ZIP corrupto, multiples carpetas, vacios). No prueba integracion real con Supabase/Storage.

Dominio legal: `tests/legal-domain.test.ts`.

IA/revision: `tests/ai-review.test.ts`, `tests/ai-findings.test.ts`, `tests/mock-providers.test.ts`.

Errores schema Supabase: `tests/supabase-errors.test.ts`.

Remoto Supabase: `tests/remote-validation.test.ts` existe, pero `npm test` lo excluye (`package.json:14`). Se ejecuta con `npm run test:remote` (`package.json:15`) y requiere autorizacion/env segun `README.md:46`.

## No cubierto o no confirmado

- Browser/E2E real autenticado.
- Importacion ZIP escribiendo en Supabase real.
- Storage real bajo RLS.
- Transacciones o compensaciones de ZIP.
- Google Calendar end-to-end.
- OCR real.
- Google Drive real.
- Reglas de carpetas contenedoras.
- Asociacion correcta documento-expediente en importacion masiva.

Importante: no se debe afirmar que un flujo funciona en produccion solo porque los tests unitarios pasan.

