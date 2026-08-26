import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH =
  "supabase/migrations/20260824110000_google_drive_client_folder_onboarding.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");
const foundation = readFileSync(
  "supabase/migrations/20260824100000_google_drive_sync_foundation.sql",
  "utf8",
);
const settingsRoute = readFileSync("src/routes/_app.configuracion.index.tsx", "utf8");
const sections = readFileSync("src/lib/settings-sections.ts", "utf8");
const driveSettings = readFileSync("src/components/settings/google-drive-settings.tsx", "utf8");
const browser = readFileSync("src/components/settings/drive-folder-browser-dialog.tsx", "utf8");
const onboarding = readFileSync("src/components/settings/drive-onboarding-dialog.tsx", "utf8");
const driveClient = readFileSync("src/lib/google-drive-client.ts", "utf8");
const server = readFileSync("src/lib/google-drive/google-drive.server.ts", "utf8");
const folders = readFileSync("src/lib/google-drive/drive-folders.ts", "utf8");
const foldersRoute = readFileSync("src/routes/api.google-drive.folders.ts", "utf8");

describe("Fase 8C — migración incremental: no toca la de Fase 8B ni crea tablas", () => {
  // Fase 8D añadió su propia migración incremental; la de 8C sigue siendo
  // única y sin tocar. Lo que esta prueba protege es que el onboarding no se
  // reparta entre varios archivos, no que Drive deje de evolucionar.
  it("el onboarding de 8C vive en una sola migración, y las anteriores siguen intactas", () => {
    const driveMigrations = readdirSync("supabase/migrations")
      .filter((name) => name.includes("google_drive"))
      .sort();
    expect(driveMigrations).toContain("20260824100000_google_drive_sync_foundation.sql");
    expect(driveMigrations.filter((name) => name.includes("client_folder_onboarding"))).toEqual([
      "20260824110000_google_drive_client_folder_onboarding.sql",
    ]);
  });

  it("no crea ni altera ninguna tabla: la estructura ya la puso Fase 8B", () => {
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/alter table/i);
    expect(migration).not.toMatch(/drop table/i);
  });

  it("la migración de Fase 8B conserva las dos constraints UNIQUE que este flujo asume", () => {
    expect(foundation).toContain("google_drive_client_folders_client_unique unique (client_id)");
    expect(foundation).toContain(
      "google_drive_client_folders_folder_unique unique (connection_id, drive_folder_id)",
    );
  });

  it("va envuelta en una transacción explícita", () => {
    const statements = migration
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    expect(statements[0]).toBe("begin;");
    expect(statements[statements.length - 1]).toBe("commit;");
  });
});

describe("Fase 8C — RPC de apply: atomicidad, permisos y search_path", () => {
  it("crea la función de apply en plpgsql, sin SECURITY DEFINER y con search_path fijo", () => {
    expect(migration).toContain(
      "create or replace function public.apply_google_drive_client_folder_mappings",
    );
    expect(migration).toContain("language plpgsql");
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).toContain("set search_path = public");
  });

  it("es server-only: revoke a public/anon/authenticated y grant solo a service_role", () => {
    expect(migration).toMatch(
      /revoke all on function public\.apply_google_drive_client_folder_mappings\(uuid, uuid, text, jsonb\)\s*\n\s*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.apply_google_drive_client_folder_mappings\(uuid, uuid, text, jsonb\)\s*\n\s*to service_role;/,
    );
    expect(migration).not.toMatch(/grant execute[\s\S]{0,200}to (anon|authenticated)/);
  });

  it("recorre el lote completo en un solo bucle, de modo que una excepción revierte todo", () => {
    expect(migration).toContain("jsonb_array_elements(p_mappings)");
    expect(migration).toContain("raise exception 'CLIENT_ALREADY_LINKED'");
    expect(migration).toContain("raise exception 'DRIVE_FOLDER_ALREADY_LINKED'");
  });

  it("acepta solo exact/normalized/manual: 'created' queda fuera porque esta fase no crea carpetas", () => {
    expect(migration).toContain("not in ('exact', 'normalized', 'manual')");
    expect(migration).toContain("raise exception 'INVALID_MATCH_TYPE'");
  });

  it("usa sync_status 'pending', un valor que el CHECK de Fase 8B admite", () => {
    expect(migration).toContain("'pending'");
    expect(foundation).toContain("sync_status text not null default 'pending'");
    // La inserción fija sync_status a 'pending'; nunca a un estado inventado
    // como 'linked', que el CHECK de Fase 8B rechazaría.
    expect(migration).not.toMatch(/sync_status[^;]*=\s*'linked'/);
    // El bloque VALUES del insert no contiene 'linked' en ninguna posición.
    const valuesStart = migration.indexOf(") values (");
    const valuesBlock = migration.slice(valuesStart, migration.indexOf(");", valuesStart));
    expect(valuesBlock).toContain("'pending'");
    expect(valuesBlock).not.toContain("'linked'");
  });

  it("el mismo par cliente-carpeta se cuenta como sin cambios, no como error", () => {
    expect(migration).toContain("v_unchanged := v_unchanged + 1");
    expect(migration).toContain(
      "jsonb_build_object('created', v_created, 'unchanged', v_unchanged)",
    );
  });

  it("no llama a Google desde PostgreSQL", () => {
    expect(migration).not.toMatch(/http|googleapis|net\./i);
  });
});

describe("Fase 8C.1 — serialización sobre la fila de la conexión", () => {
  const functions = ["set_google_drive_root_folder", "apply_google_drive_client_folder_mappings"];

  function bodyOf(name: string) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    expect(start).toBeGreaterThan(-1);
    const end = migration.indexOf("\n$$;", start);
    return migration.slice(start, end);
  }

  it("existe una RPC dedicada para fijar la carpeta raíz", () => {
    expect(migration).toContain("create or replace function public.set_google_drive_root_folder");
  });

  it("las DOS funciones bloquean la MISMA fila con SELECT ... FOR UPDATE", () => {
    for (const name of functions) {
      const body = bodyOf(name);
      expect(body).toContain("from public.google_drive_connections");
      expect(body).toMatch(/where id = p_connection_id\s*\n\s*for update;/);
    }
  });

  it("las DOS funciones rechazan si la raíz cambió respecto a la que validó el llamante", () => {
    for (const name of functions) {
      expect(bodyOf(name)).toContain("raise exception 'DRIVE_ROOT_CHANGED_RETRY'");
    }
  });

  it("usa IS DISTINCT FROM para que una raíz aún no configurada (NULL) se compare bien", () => {
    expect(bodyOf("set_google_drive_root_folder")).toContain(
      "v_connection.root_folder_id is distinct from p_expected_current_root_folder_id",
    );
    expect(bodyOf("apply_google_drive_client_folder_mappings")).toContain(
      "v_connection.root_folder_id is distinct from p_expected_root_folder_id",
    );
  });

  it("las DOS funciones exigen que la conexión siga conectada", () => {
    for (const name of functions) {
      expect(bodyOf(name)).toContain("raise exception 'DRIVE_NOT_CONNECTED'");
    }
  });

  it("el bloqueo por vinculaciones existentes solo aplica a un cambio REAL de raíz", () => {
    const body = bodyOf("set_google_drive_root_folder");
    expect(body).toContain("if not v_unchanged then");
    expect(body).toContain("raise exception 'ROOT_FOLDER_HAS_EXISTING_MAPPINGS'");
  });

  it("la RPC de raíz también es server-only y sin SECURITY DEFINER", () => {
    expect(migration).toMatch(
      /revoke all on function public\.set_google_drive_root_folder\(uuid, text, text, text, text\)\s*\n\s*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.set_google_drive_root_folder\(uuid, text, text, text, text\)\s*\n\s*to service_role;/,
    );
    expect(bodyOf("set_google_drive_root_folder")).not.toMatch(/security definer/i);
    expect(bodyOf("set_google_drive_root_folder")).toContain("set search_path = public");
  });
});

describe("Fase 8C.1 — no queda ninguna escritura directa fuera de las RPC", () => {
  it("el servidor no hace UPDATE de root_folder_id/shared_drive_id por su cuenta", () => {
    expect(server).not.toMatch(/\.update\(\{[^}]*root_folder_id/);
    expect(server).not.toMatch(/\.update\(\{[^}]*shared_drive_id/);
    expect(server).toContain('db.rpc("set_google_drive_root_folder"');
  });

  it("el servidor no inserta en google_drive_client_folders con un bucle propio", () => {
    expect(server).not.toMatch(/from\("google_drive_client_folders"\)\s*\n\s*\.insert/);
    expect(server).not.toMatch(/from\("google_drive_client_folders"\)\s*\n\s*\.upsert/);
    expect(server).not.toMatch(/from\("google_drive_client_folders"\)\s*\n\s*\.delete/);
    expect(server).toContain('db.rpc("apply_google_drive_client_folder_mappings"');
  });

  it("la ruta envía a cada RPC la raíz contra la que validó", () => {
    expect(server).toContain("p_expected_current_root_folder_id: connection.root_folder_id");
    expect(server).toContain("p_expected_root_folder_id: rootFolderId");
  });
});

describe("Fase 8C.1 — match_type derivado en servidor", () => {
  it("existe un derivador que reutiliza el clasificador puro de 8A, sin una tercera normalización", () => {
    expect(server).toContain("function deriveMatchType");
    expect(server).toContain("matchClientToFolders(clientName, rootFolders)");
    // No se reimplementa normalización aquí: se importa la de 8A.
    expect(server).not.toContain("normalizeClientName");
    expect(server).not.toContain("toLowerCase().normalize");
  });

  it("manual se respeta tal cual; el resto se recalcula", () => {
    const start = server.indexOf("function deriveMatchType");
    const body = server.slice(start, server.indexOf("\n}", start));
    expect(body).toContain('if (mapping.matchType === "manual") return "manual"');
    expect(body).toContain('new DriveError("MATCH_CHANGED_REVIEW")');
    expect(body).toContain('match.type === "EXACT_MATCH" ? "exact" : "normalized"');
  });

  it("exige que la coincidencia derivada apunte a la MISMA carpeta que envió el navegador", () => {
    const start = server.indexOf("function deriveMatchType");
    const body = server.slice(start, server.indexOf("\n}", start));
    expect(body).toContain("match.candidates[0]?.id !== mapping.driveFolderId");
  });

  it("el match_type que se persiste sale del derivador, no del request", () => {
    const start = server.indexOf("validated.push({");
    const body = server.slice(start, start + 600);
    expect(body).toContain("match_type: deriveMatchType(");
    expect(body).not.toContain("match_type: mapping.matchType");
  });
});

describe("Fase 8C — decisión documentada: sin Google Picker", () => {
  it("el módulo servidor explica por qué no se usa Picker", () => {
    expect(server).toMatch(/NO se usa Google Picker/i);
  });

  it("ningún archivo del cliente carga scripts de Picker ni pide una API key de navegador", () => {
    for (const source of [driveClient, driveSettings, browser, onboarding]) {
      expect(source).not.toContain("picker");
      expect(source).not.toContain("apis.google.com");
      expect(source).not.toContain("developerKey");
      expect(source).not.toContain("VITE_GOOGLE");
    }
  });

  it("el cliente nunca maneja tokens ni secretos de Drive", () => {
    expect(driveClient).not.toContain("refresh_token");
    expect(driveClient).not.toContain("CLIENT_SECRET");
    expect(driveClient).not.toContain("encrypted");
    // El único access_token que aparece es el de la sesión de Supabase del
    // propio usuario, nunca uno de Google Drive.
    const accessTokenUses = driveClient.match(/access_token/g) ?? [];
    const sessionUses = driveClient.match(/session[?.]*\.access_token/g) ?? [];
    expect(accessTokenUses.length).toBe(sessionUses.length);
  });
});

describe("Fase 8C — el endpoint de carpetas no es un proxy genérico a Drive", () => {
  it("la ruta solo lee parentId de la query, nunca q/fields/pageSize/orderBy", () => {
    expect(foldersRoute).toContain('searchParams.get("parentId")');
    expect(foldersRoute).not.toContain('searchParams.get("q")');
    expect(foldersRoute).not.toContain('searchParams.get("fields")');
    expect(foldersRoute).not.toContain('searchParams.get("orderBy")');
  });

  it("la query y los campos los construye el servidor, en el módulo de carpetas", () => {
    expect(folders).toContain("export function buildChildFoldersQuery");
    expect(folders).toContain("export function buildFolderListSearchParams");
  });

  it("el módulo de carpetas es de solo lectura: sin create, update, trash ni descarga", () => {
    expect(folders).not.toMatch(/method:\s*"(POST|PATCH|PUT|DELETE)"/);
    expect(folders).not.toContain("alt=media");
    expect(folders).not.toContain("uploadType");
  });

  it("el módulo servidor tampoco implementa todavía sincronización de documentos", () => {
    // No hace ninguna llamada REST a Drive por su cuenta: toda la lectura de
    // carpetas pasa por drive-folders.ts, que es de solo lectura.
    expect(server).not.toContain("googleapis.com/drive");
    expect(server).not.toContain("/upload/drive");
    expect(server).not.toContain("changes.watch");
    expect(server).not.toContain("startPageToken");
  });
});

describe("Fase 8C — Configuración: la sección nueva reutiliza el sistema de QA-006", () => {
  it("google-drive es una sección válida de ?seccion=", () => {
    expect(sections).toContain('"google-drive"');
  });

  it("la sección por defecto no cambió: sigue siendo usuarios", () => {
    expect(sections).toContain('export const DEFAULT_SECTION: Section = "usuarios"');
  });

  it("google-calendar sigue existiendo: la sección nueva no la reemplaza", () => {
    expect(sections).toContain('"google-calendar"');
    expect(settingsRoute).toContain('id: "google-calendar"');
  });

  it("la pestaña se navega con search ?seccion=, sin estado paralelo", () => {
    expect(settingsRoute).toContain('id: "google-drive"');
    expect(settingsRoute).toContain("search={{ seccion: t.id } as never}");
    expect(settingsRoute).toContain('{tab === "google-drive" && <GoogleDriveSettings />}');
  });
});

describe("Fase 8C — UI: accesibilidad y honestidad de estados", () => {
  it("el navegador de carpetas usa el primitive Dialog (foco atrapado, Escape, scroll lock)", () => {
    expect(browser).toContain('from "@/components/ui/dialog"');
    expect(browser).toContain("<DialogTitle>");
    expect(browser).toContain("<DialogDescription>");
  });

  it("el navegador expone las migas como navegación etiquetada", () => {
    expect(browser).toContain('aria-label="Ruta de carpetas"');
    expect(browser).toContain("aria-current=");
  });

  it("subir un nivel usa el padre que devuelve el servidor, no un valor guardado en el cliente", () => {
    expect(browser).toContain("listing?.current.parentId");
  });

  it("estados de carga y error se anuncian con role, no solo con color", () => {
    for (const source of [browser, onboarding, driveSettings]) {
      expect(source).toContain('role="status"');
      expect(source).toContain('role="alert"');
    }
  });

  it("los ambiguos se resuelven con un select accesible y etiquetado", () => {
    expect(onboarding).toContain("NativeSelect");
    expect(onboarding).toContain("htmlFor={selectId}");
  });

  it("confirmar todas las sugerencias seguras nunca incluye los ambiguos", () => {
    const start = onboarding.indexOf("function confirmAllSafe");
    const end = onboarding.indexOf("const mappings", start);
    const body = onboarding.slice(start, end);
    expect(body).toContain("preview.suggested");
    expect(body).not.toContain("preview.ambiguous");
  });

  it("no se ofrece crear carpetas ni clientes desde el onboarding", () => {
    expect(onboarding).not.toMatch(/crear carpeta/i);
    expect(onboarding).not.toMatch(/crear cliente/i);
  });

  it("no se muestra el id técnico de la carpeta raíz al usuario, solo su nombre", () => {
    expect(driveSettings).toContain("status?.rootFolderName");
    expect(driveSettings).not.toMatch(/>\{status\?\.rootFolderId\}/);
  });

  it("el botón de conectar solo aparece cuando el servidor está realmente configurado", () => {
    expect(driveSettings).toContain("{configured && !connected && (");
  });

  it("revisar coincidencias solo aparece cuando ya hay carpeta raíz", () => {
    expect(driveSettings).toContain("{rootConfigured && (");
  });

  it("el onboarding se maqueta en tarjetas apilables, no en una tabla de 5 columnas", () => {
    expect(onboarding).not.toContain("<table");
    expect(onboarding).toContain("sm:flex-row");
  });
});
