# Testing Status

## Comandos ejecutados el 2026-07-22

`npm test`

Resultado: exit code 0. 10 archivos, 137 tests pasaron.

- `tests/csv-import.test.ts`: 39 tests.
- `tests/mass-import-dry-run.test.ts`: 2 tests.
- `tests/legal-domain.test.ts`: 6 tests.
- `tests/mock-providers.test.ts`: 4 tests.
- `tests/ai-findings.test.ts`: 6 tests.
- `tests/zip-import.test.ts`: 61 tests.
- `tests/ai-review.test.ts`: 3 tests.
- `tests/zip-persistence.test.ts`: 9 tests.
- `tests/supabase-errors.test.ts`: 2 tests.
- `tests/validation-safety.test.ts`: 5 tests.

`npx tsc --noEmit --pretty false`

Resultado: exit code 0, sin salida de error.

`npm run lint`

Resultado: exit code 0; 7 warnings Fast Refresh preexistentes:

- `src/components/ui/badge.tsx:32`
- `src/components/ui/button.tsx:49`
- `src/components/ui/form.tsx:163`
- `src/components/ui/navigation-menu.tsx:111`
- `src/components/ui/sidebar.tsx:743`
- `src/components/ui/toggle.tsx:42`
- `src/hooks/use-auth.tsx:89`

`npm run build`

Resultado: exit code 0. Build client, SSR y Nitro Cloudflare completado. Warnings no bloqueantes: `vite-tsconfig-paths`, chunks mayores a 500 kB, tiempos altos de plugins e `inlineDynamicImports` ignorado por `codeSplitting`.

## Cobertura por modulo

CSV/XLSX: cubierto por `tests/csv-import.test.ts`.

ZIP: cubierto por `tests/zip-import.test.ts`, `tests/zip-persistence.test.ts` y `tests/mass-import-dry-run.test.ts`.

Dominio legal: `tests/legal-domain.test.ts`.

IA/revision: `tests/ai-review.test.ts`, `tests/ai-findings.test.ts`, `tests/mock-providers.test.ts`.

Errores schema Supabase: `tests/supabase-errors.test.ts`.

Validaciones operativas: `tests/validation-safety.test.ts` cubre archivos no permitidos/vacios/sobredimensionados y pagos invalidos.

Remoto Supabase: `tests/remote-validation.test.ts` existe, pero `npm test` lo excluye. Se ejecuta con `npm run test:remote` y requiere variables/credenciales de entorno.

## No cubierto o no confirmado

- Browser/E2E autenticado con usuario real.
- Google Calendar end-to-end con OAuth real.
- Google Drive real.
- OCR real.
- Flujo de importacion ZIP masiva en produccion; por decision operativa queda detenido.
- Reglas finales de auditoria persistida en base de datos.

Importante: no se debe afirmar que un flujo externo funciona en produccion solo porque los tests unitarios pasan.