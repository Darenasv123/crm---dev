# Auth and Permissions

## Autenticacion y sesiones

El cliente Supabase se define en `src/lib/supabase.ts`. `AuthProvider` escucha `supabase.auth.onAuthStateChange`, guarda `session`, `user` y carga `profile` (`src/hooks/use-auth.tsx:32` a `:55`). Login usa `signInWithPassword` (`src/hooks/use-auth.tsx:64`). Logout usa `supabase.auth.signOut()` (`src/hooks/use-auth.tsx:70`).

La ruta `/_app` redirige a `/login` si no hay usuario (`src/routes/_app.tsx:15` a `:19`). `/login` redirige al dashboard si ya hay usuario (`src/routes/login.tsx:20` a `:25`).

## Roles

Roles: `Administrador` y `Personal` (`supabase/schema.sql:57`). `public.is_admin()` y `public.is_staff()` revisan `profiles.role` y `profiles.status='Activo'` (`supabase/schema.sql:421` a `:449`). El execute de esas funciones se revoca a public/anon y se concede a authenticated (`supabase/schema.sql:451` a `:454`).

## RLS final relevante

- Perfiles: staff select, admin insert/update (`supabase/schema.sql:459` a `:462`).
- Clientes: staff select/insert/update, admin delete (`:468` a `:472`).
- Casos: staff select/insert/update, admin delete (`:478` a `:482`).
- Pagos: staff select, admin insert/update (`:487` a `:490`).
- Historial pagos: admin select/insert (`:494` a `:497`).
- Agenda: staff CRUD (`:503` a `:507`).
- Documentos: staff select/insert, admin delete (`:512` a `:514`).
- Reportes: staff select/insert, author/admin update, admin delete (`:520` a `:526`).
- Storage: staff insert/select, admin delete (`:531` a `:536`).

Tablas nuevas de expediente/import/IA aplican politicas genericas staff/admin mediante bloque dinamico (`supabase/migrations/20260721090000_legal_case_foundation.sql:370` a `:400`).

## SERVICE_ROLE

`SUPABASE_SERVICE_ROLE_KEY` se usa en funciones server/admin para registrar personal. `profiles.functions.ts` exige service key y access token; la variable se lee desde server env, no debe estar en frontend. La presencia de `VITE_SUPABASE_SERVICE_ROLE_KEY` en `.env` fue detectada por nombre, pero no se imprimio valor; riesgo si se usa en cliente. No confirmado que se use en bundle.

## Frontend vs backend

La mayoria de CRUD usa cliente autenticado desde navegador (`getAuthClient`). Importacion ZIP tambien persiste desde navegador (`src/components/zip-import.tsx:545` a `:647`). No hay backend transaccional para importacion masiva.

## Tenant/organizacion

No existe filtro por organizacion confirmado. Una importacion masiva, si el usuario es staff activo, opera sobre todo el dataset accesible por ese rol. En un despliegue multi-tenant futuro esto permitiria cruces si no se agrega `organization_id`.

## Riesgo en importacion masiva

- Puede fallar por RLS si usuario no tiene perfil activo/staff.
- Puede crear clientes/casos/documentos si es staff activo.
- Puede continuar tras fallos parciales porque ZIP no usa transacciones y traga errores por documento (`src/components/zip-import.tsx:667` a `:669`).
- No se detecta acceso a otra organizacion porque no hay modelo de organizacion.

