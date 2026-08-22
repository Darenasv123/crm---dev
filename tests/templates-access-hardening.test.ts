import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveTemplatePermissions } from "@/lib/permissions";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const migration = source("supabase/migrations/20260822110000_add_templates.sql");
const ddl = migration.slice(migration.indexOf("begin;"));

describe("Fase 5B — Personal puede alcanzar Plantillas (Sección 2)", () => {
  const navSource = source("src/components/app-layout.tsx");
  const routeSource = source("src/routes/_app.plantillas.index.tsx");
  const configSource = source("src/routes/_app.configuracion.index.tsx");

  it("existe una ruta dedicada /plantillas, sin adminOnly en la navegación", () => {
    const navBlock = navSource.slice(
      navSource.indexOf("const nav: NavItem[]"),
      navSource.indexOf("];") + 2,
    );
    expect(navBlock).toContain('{ to: "/plantillas", label: "Plantillas"');
    const plantillasLine = navBlock.split("\n").find((line) => line.includes('to: "/plantillas"'));
    expect(plantillasLine).toBeDefined();
    expect(plantillasLine).not.toContain("adminOnly");
  });

  it("/plantillas reutiliza exactamente TemplatesSettings, sin una segunda implementación", () => {
    expect(routeSource).toContain(
      'import { TemplatesSettings } from "@/components/settings/templates-settings"',
    );
    expect(routeSource.match(/<TemplatesSettings/g)).toHaveLength(1);
    expect(routeSource).not.toContain("function TemplateLibrary");
  });

  it("/plantillas no redirige ni bloquea por rol (a diferencia de /configuracion y /pagos)", () => {
    // El comentario de cabecera menciona "Administrador" solo para explicar
    // la decisión de diseño; lo que importa es que el COMPONENTE en sí no
    // tenga ningún check de rol ni redirección.
    const componentBody = routeSource.slice(routeSource.indexOf("function PlantillasPage"));
    expect(componentBody).not.toContain("Administrador");
    expect(componentBody).not.toContain("navigate({");
    expect(componentBody).not.toContain("useAuth");
  });

  it("Configuración sigue mostrando Plantillas para Administrador reutilizando el mismo componente (sin duplicar)", () => {
    expect(configSource).toContain('{tab === "plantillas" && <TemplatesSettings />}');
  });
});

describe("Fase 5B — Configuración administrativa sigue protegida (Sección C)", () => {
  const configSource = source("src/routes/_app.configuracion.index.tsx");

  it("la página completa de Configuración sigue redirigiendo a no-Administradores (sin cambios)", () => {
    expect(configSource).toContain('currentProfile.role !== "Administrador"');
    expect(configSource).toContain('navigate({ to: "/", replace: true })');
  });

  it("las queries administrativas (Usuarios, Backup, Pagos, Agenda) siguen gateadas por canLoadAdminData", () => {
    expect(configSource).toContain("useProfiles({ enabled: canLoadAdminData })");
    expect(configSource).toContain("useClients({ enabled: canLoadAdminData })");
    expect(configSource).toContain("usePayments({ enabled: canLoadAdminData })");
  });

  it("no se abrió ningún otro tab administrativo a Personal (Usuarios/Backup/Herramientas/Google Calendar siguen dentro del gate de página)", () => {
    // El componente entero retorna null antes de renderizar ningún tab si
    // el rol no es Administrador -- confirmado arriba. No se introdujo
    // ningún tab-level bypass adicional.
    const earlyReturnIndex = configSource.indexOf(
      'if (authLoading || !currentProfile || currentProfile.role !== "Administrador") return null;',
    );
    expect(earlyReturnIndex).toBeGreaterThan(-1);
  });
});

describe("Fase 5B — RLS exacta de public.templates (Sección 3)", () => {
  // Se ancla en "create policy ..." (no en el nombre entrecomillado suelto)
  // porque cada policy aparece dos veces en el archivo: una vez en su
  // "drop policy if exists" (agrupadas todas al principio) y otra en su
  // "create policy" real -- anclar en el nombre suelto encuentra el DROP,
  // que precede a TODOS los CREATE y rompe el troceado por bloques.
  function policyBlock(name: string, nextName: string) {
    const start = ddl.indexOf(`create policy "${name}"`);
    const end = ddl.indexOf(`create policy "${nextName}"`, start);
    expect(start, `no se encontró create policy "${name}"`).toBeGreaterThan(-1);
    expect(end, `no se encontró create policy "${nextName}" después de "${name}"`).toBeGreaterThan(
      start,
    );
    return ddl.slice(start, end);
  }

  it("SELECT usa is_staff() (Administrador + Personal)", () => {
    const block = policyBlock("templates_select", "templates_insert");
    expect(block).toContain("using (public.is_staff());");
    expect(block).not.toContain("is_admin()");
  });

  it("INSERT usa is_admin() (solo Administrador)", () => {
    const block = policyBlock("templates_insert", "templates_update");
    expect(block).toContain("with check (public.is_admin());");
    expect(block).not.toContain("is_staff()");
  });

  it("UPDATE usa is_admin() en using y with check (solo Administrador)", () => {
    const block = policyBlock("templates_update", "templates_delete");
    expect(block).toContain("using (public.is_admin())");
    expect(block).toContain("with check (public.is_admin());");
    expect(block).not.toContain("is_staff()");
  });

  it("DELETE usa is_admin() (solo Administrador)", () => {
    const start = ddl.indexOf('create policy "templates_delete"');
    const end = ddl.indexOf("comment on policy", start);
    const block = ddl.slice(start, end);
    expect(block).toContain("using (public.is_admin());");
    expect(block).not.toContain("is_staff()");
  });
});

describe("Fase 5B — Storage real: templates/ dentro de documents (Sección 4)", () => {
  it("SELECT y DELETE del bucket ya cubrían templates/ correctamente (staff lee, solo admin borra) — sin cambios necesarios", () => {
    const bucketRls = source("supabase/self-hosted/0007_storage.sql");
    expect(bucketRls).toContain("crm_documents_staff_select");
    expect(bucketRls).toContain("crm_is_active_staff()");
    expect(bucketRls).toContain("crm_documents_admin_delete");
    expect(bucketRls).toContain("crm_is_active_admin()");
  });

  it("INSERT/UPDATE del bucket eran staff-wide sin distinguir ruta -- el gap real que esta fase cierra", () => {
    const bucketRls = source("supabase/self-hosted/0007_storage.sql");
    expect(bucketRls).toContain("crm_documents_staff_insert");
    expect(bucketRls).toContain("crm_documents_staff_update");
  });

  it("se añaden policies RESTRICTIVE nuevas que exigen is_admin() bajo templates/, sin tocar ninguna policy histórica", () => {
    expect(ddl).toContain('create policy "crm_templates_insert_admin_only" on storage.objects');
    expect(ddl).toContain('create policy "crm_templates_update_admin_only" on storage.objects');
    expect(ddl.match(/as restrictive/g)).toHaveLength(2);
    // No se modifica ni se re-crea ninguna policy histórica (crm_documents_*).
    expect(ddl).not.toMatch(/drop policy.*crm_documents/);
    expect(ddl).not.toMatch(/create policy "crm_documents/);
  });

  it("las policies RESTRICTIVE son no-op para cualquier ruta fuera de templates/ o bucket fuera de documents", () => {
    const insertStart = ddl.indexOf(
      'create policy "crm_templates_insert_admin_only" on storage.objects',
    );
    const insertEnd = ddl.indexOf(
      'create policy "crm_templates_update_admin_only" on storage.objects',
      insertStart,
    );
    expect(insertStart).toBeGreaterThan(-1);
    expect(insertEnd).toBeGreaterThan(insertStart);
    const insertBlock = ddl.slice(insertStart, insertEnd);
    expect(insertBlock).toContain("bucket_id <> 'documents'");
    expect(insertBlock).toContain("name not like 'templates/%'");
    expect(insertBlock).toContain("crm_is_active_admin()");
  });

  it("no rompe los permisos existentes de Documentos: resolveDocumentPermissions sigue permitiendo subir a ambos roles", () => {
    const permissionsSource = source("src/lib/permissions.ts");
    const documentBlock = permissionsSource.slice(
      permissionsSource.indexOf("export function resolveDocumentPermissions"),
      permissionsSource.indexOf("export function resolveTemplatePermissions") > -1
        ? permissionsSource.indexOf(
            "// ---",
            permissionsSource.indexOf("export function resolveDocumentPermissions"),
          )
        : undefined,
    );
    expect(documentBlock).toContain("canUploadDocuments: true");
  });
});

describe("Fase 5B — path de Storage protegido (Sección 5)", () => {
  const hookSource = source("src/hooks/use-templates.ts");

  it("sanea el nombre de archivo eliminando cualquier carácter fuera de [a-zA-Z0-9._-] (sin '/', sin traversal posible)", () => {
    expect(hookSource).toContain('file.name.replace(/[^a-zA-Z0-9._-]/g, "_")');
  });

  it("el path se construye con timestamp del servidor + prefijo, no con el nombre original como única identidad", () => {
    expect(hookSource).toContain("`${TEMPLATES_STORAGE_PREFIX}/${Date.now()}_${safeName}`");
  });

  it("usa upsert:false para no sobrescribir silenciosamente ante colisión", () => {
    expect(hookSource).toContain("{ upsert: false }");
  });
});

describe("Fase 5B — eliminación y fallos parciales, semántica explícita (Sección 6)", () => {
  const hookSource = source("src/hooks/use-templates.ts");
  const deleteBlock = hookSource.slice(hookSource.indexOf("export function useDeleteTemplate"));

  it("borra primero la fila; el listado (fuente de verdad) queda correcto de inmediato", () => {
    expect(deleteBlock).toContain('await db.from("templates").delete().eq("id", id)');
  });

  it("el mensaje de error ante fallo de limpieza de Storage no afirma que la eliminación total falló", () => {
    expect(deleteBlock).toContain(
      "La plantilla se eliminó del listado, pero el archivo no pudo borrarse",
    );
  });

  it("refresca el listado incluso si la limpieza de Storage falla (onSettled, no onSuccess)", () => {
    expect(deleteBlock).toContain("onSettled: () => qc.invalidateQueries");
  });

  it("documenta cómo detectar huérfanos a futuro sin implementar infraestructura de jobs", () => {
    expect(hookSource).toContain("Detección futura de huérfanos");
    // No se implementa ningún mecanismo real de ejecución programada (el
    // propio comentario menciona "cron" solo para decir que NO se
    // construye uno, así que se comprueba ausencia de código real, no de
    // la palabra en la prosa explicativa).
    expect(hookSource).not.toMatch(/setInterval|setTimeout.*schedul|node-cron/i);
  });
});

describe("Fase 5B — upload + compensación no oculta errores dobles (Sección 7)", () => {
  const hookSource = source("src/hooks/use-templates.ts");
  const createBlock = hookSource.slice(
    hookSource.indexOf("export function useCreateTemplate"),
    hookSource.indexOf("export function useDeleteTemplate") > -1
      ? hookSource.indexOf("/**", hookSource.indexOf("export function useCreateTemplate"))
      : undefined,
  );

  it("si la limpieza compensatoria también falla, el error original no se oculta", () => {
    expect(createBlock).toContain("no se pudo limpiar el archivo subido en almacenamiento");
    // El error original de metadata sigue presente en el mensaje compuesto.
    expect(createBlock).toContain("${error.message} (además,");
  });
});

describe("Fase 5B — permisos y RLS coherentes end-to-end", () => {
  it("Personal: ver/descargar sí, crear/eliminar no (resolveTemplatePermissions)", () => {
    const perms = resolveTemplatePermissions("Personal");
    expect(perms.canViewTemplates).toBe(true);
    expect(perms.canDownloadTemplates).toBe(true);
    expect(perms.canCreateTemplates).toBe(false);
    expect(perms.canDeleteTemplates).toBe(false);
  });

  it("Administrador: los cuatro permisos en true", () => {
    const perms = resolveTemplatePermissions("Administrador");
    expect(perms.canViewTemplates).toBe(true);
    expect(perms.canDownloadTemplates).toBe(true);
    expect(perms.canCreateTemplates).toBe(true);
    expect(perms.canDeleteTemplates).toBe(true);
  });
});
