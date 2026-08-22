import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_TEMPLATE_SIZE_BYTES, validateTemplateFile } from "@/hooks/use-templates";
import { resolveTemplatePermissions } from "@/lib/permissions";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("validateTemplateFile — validación real de archivo (no solo extensión declarada)", () => {
  it("acepta PDF, DOC y DOCX dentro del límite de tamaño", () => {
    expect(() =>
      validateTemplateFile({ name: "demanda.pdf", size: 1024, type: "application/pdf" }),
    ).not.toThrow();
    expect(() =>
      validateTemplateFile({ name: "demanda.docx", size: 2048, type: "application/msword" }),
    ).not.toThrow();
    expect(() =>
      validateTemplateFile({ name: "demanda.doc", size: 512, type: "application/msword" }),
    ).not.toThrow();
  });

  it("rechaza formatos no permitidos aunque el tipo MIME diga otra cosa", () => {
    expect(() =>
      validateTemplateFile({ name: "imagen.jpg", size: 1024, type: "application/pdf" }),
    ).toThrow(/formato no permitido/i);
    expect(() =>
      validateTemplateFile({ name: "hoja.xlsx", size: 1024, type: "application/pdf" }),
    ).toThrow(/formato no permitido/i);
  });

  it("rechaza un archivo vacío", () => {
    expect(() =>
      validateTemplateFile({ name: "vacio.pdf", size: 0, type: "application/pdf" }),
    ).toThrow(/vacío/i);
  });

  it("rechaza un archivo que supera el límite de tamaño", () => {
    expect(() =>
      validateTemplateFile({
        name: "grande.pdf",
        size: MAX_TEMPLATE_SIZE_BYTES + 1,
        type: "application/pdf",
      }),
    ).toThrow(/10 MB/);
  });

  it("rechaza un nombre de archivo vacío", () => {
    expect(() => validateTemplateFile({ name: "", size: 1024, type: "application/pdf" })).toThrow(
      /nombre válido/i,
    );
  });

  it("el límite exportado coincide con el usado en la validación (10 MB)", () => {
    expect(MAX_TEMPLATE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("resolveTemplatePermissions — regla de producto (Sección F)", () => {
  it("Administrador puede ver, descargar, crear y eliminar", () => {
    const perms = resolveTemplatePermissions("Administrador");
    expect(perms.canViewTemplates).toBe(true);
    expect(perms.canDownloadTemplates).toBe(true);
    expect(perms.canCreateTemplates).toBe(true);
    expect(perms.canDeleteTemplates).toBe(true);
  });

  it("Personal puede ver y descargar, pero no crear ni eliminar", () => {
    const perms = resolveTemplatePermissions("Personal");
    expect(perms.canViewTemplates).toBe(true);
    expect(perms.canDownloadTemplates).toBe(true);
    expect(perms.canCreateTemplates).toBe(false);
    expect(perms.canDeleteTemplates).toBe(false);
  });

  it("un rol ausente/desconocido se trata como no-administrador", () => {
    const perms = resolveTemplatePermissions(null);
    expect(perms.canCreateTemplates).toBe(false);
    expect(perms.canDeleteTemplates).toBe(false);
  });

  it("usePermissions combina resolveTemplatePermissions", () => {
    const permissionsSource = source("src/lib/permissions.ts");
    expect(permissionsSource).toContain("...resolveTemplatePermissions(profile?.role)");
  });
});

describe("Plantillas — Storage reutiliza el bucket 'documents' (Sección E, opción A)", () => {
  const hookSource = source("src/hooks/use-templates.ts");

  it("sube y borra archivos en el bucket 'documents', no en un bucket nuevo", () => {
    expect(hookSource).toContain('supabase.storage\n        .from("documents")');
    expect(hookSource).not.toMatch(/storage\.from\(["']templates["']\)/);
  });

  it("usa un prefijo de ruta 'templates/' dentro del bucket compartido", () => {
    expect(hookSource).toContain('TEMPLATES_STORAGE_PREFIX = "templates"');
  });

  it("si falla la metadata tras subir el archivo, borra el Storage subido (evita basura)", () => {
    const createBlock = hookSource.slice(
      hookSource.indexOf("export function useCreateTemplate"),
      hookSource.indexOf("export function useDeleteTemplate"),
    );
    expect(createBlock).toContain("if (error) {");
    expect(createBlock).toContain('await supabase.storage.from("documents").remove([path]);');
  });

  it("si falla el Storage, no simula éxito silenciosamente al crear", () => {
    const createBlock = hookSource.slice(
      hookSource.indexOf("export function useCreateTemplate"),
      hookSource.indexOf("export function useDeleteTemplate"),
    );
    expect(createBlock).toContain("if (uploadError) throw new Error(uploadError.message);");
  });

  it("al eliminar, refresca el listado incluso si la limpieza de Storage falla después (onSettled)", () => {
    const deleteBlock = hookSource.slice(hookSource.indexOf("export function useDeleteTemplate"));
    expect(deleteBlock).toContain("onSettled: () => qc.invalidateQueries");
    expect(deleteBlock).not.toContain("onSuccess: () => qc.invalidateQueries");
  });
});

describe("Plantillas — migración (Sección AA)", () => {
  const migration = source("supabase/migrations/20260822110000_add_templates.sql");
  // El DDL real empieza en "begin;" -- el comentario de cabecera explica a
  // propósito por qué la UI mock anterior mostraba "variables" (para
  // documentar que este modelo real NO las incluye), así que buscar esa
  // palabra en el archivo completo daría un falso positivo.
  const ddl = migration.slice(migration.indexOf("begin;"));

  it("es una migración incremental nueva con solo los campos necesarios", () => {
    expect(ddl).toContain("create table if not exists public.templates");
    for (const column of [
      "id uuid primary key",
      "name text not null",
      "description text",
      "storage_path text not null",
      "file_name text not null",
      "mime_type text not null",
      "size bigint not null",
      "created_by uuid references public.profiles",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]) {
      expect(ddl).toContain(column);
    }
    // No inventa campos ficticios como "variables" que solo existían en el mock de UI.
    expect(ddl).not.toMatch(/variables/i);
  });

  it("RLS: ver es para todo el staff; crear/editar/eliminar son solo Administrador", () => {
    expect(migration).toContain("for select to authenticated\n  using (public.is_staff());");
    expect(migration).toContain("for insert to authenticated\n  with check (public.is_admin());");
    expect(migration).toContain(
      "for update to authenticated\n  using (public.is_admin())\n  with check (public.is_admin());",
    );
    expect(migration).toContain("for delete to authenticated\n  using (public.is_admin());");
  });

  it("SELECT y DELETE de Storage no necesitaron policy nueva; INSERT/UPDATE sí (hardening de Fase 5B, ver tests/templates-access-hardening.test.ts)", () => {
    // Auditoría original (Fase 5): SELECT/DELETE del bucket "documents" ya
    // acotaban correctamente por rol para cualquier ruta, templates/
    // incluido. Auditoría de hardening (Fase 5B): INSERT/UPDATE eran
    // staff-wide sin distinguir ruta, así que SÍ hicieron falta dos
    // policies RESTRICTIVE nuevas y aditivas para templates/ -- no se
    // tocó ninguna policy histórica del bucket. La cobertura detallada de
    // esas dos policies vive en tests/templates-access-hardening.test.ts.
    expect(ddl).toContain('create policy "crm_templates_insert_admin_only" on storage.objects');
    expect(ddl).toContain('create policy "crm_templates_update_admin_only" on storage.objects');
  });

  it("no se aplica remotamente como parte de esta fase", () => {
    expect(migration).toContain("NO se aplica remotamente");
  });

  it("no modifica ninguna migración histórica (es un archivo nuevo, begin/commit propios)", () => {
    expect(migration.trim().includes("begin;")).toBe(true);
    expect(migration.trim().endsWith("commit;")).toBe(true);
  });
});

describe("Plantillas — UI reutiliza el visor/descarga de Documentos, no crea uno nuevo (Sección I)", () => {
  const panel = source("src/components/settings/templates-settings.tsx");

  it("reutiliza DocumentViewerDialog y las funciones de document-actions.ts", () => {
    expect(panel).toContain(
      'import { DocumentViewerDialog } from "@/components/documents/document-viewer-dialog"',
    );
    expect(panel).toContain('from "@/lib/document-actions"');
    expect(panel).toContain("previewDocument(");
    expect(panel).toContain("downloadDocument(");
  });

  it("no reimplementa un visor propio", () => {
    expect(panel).not.toContain("function DocumentPreviewDialog");
    expect(panel).not.toContain("<iframe");
  });

  it("el botón Eliminar solo se renderiza si el permiso lo permite; RLS es la garantía final, no ocultar el botón", () => {
    expect(panel).toContain("permissions.canDeleteTemplates &&");
    const migration = source("supabase/migrations/20260822110000_add_templates.sql");
    expect(migration).toContain("using (public.is_admin());");
  });

  it("el botón Nueva plantilla está gateado por canCreateTemplates", () => {
    expect(panel).toContain("permissions.canCreateTemplates &&");
  });

  it("confirma antes de eliminar", () => {
    expect(panel).toContain("window.confirm(");
  });
});

describe("Configuración → estado final (Plantillas/Correo reales, WhatsApp fuera)", () => {
  const route = source("src/routes/_app.configuracion.index.tsx");

  it("no queda ningún array hardcodeado de 6 plantillas ni el texto '12 variables'", () => {
    expect(route).not.toContain("Demanda de divorcio");
    expect(route).not.toContain("12 variables");
    expect(route).not.toContain("Plantilla DOCX ·");
  });

  it("el tab de Plantillas renderiza el componente real", () => {
    expect(route).toContain('{tab === "plantillas" && <TemplatesSettings />}');
  });

  it("el tab de Correo renderiza el componente real, sin credenciales ficticias", () => {
    expect(route).toContain('{tab === "correo" && <EmailSettings />}');
    expect(route).not.toContain("smtp.abogados.pe");
    expect(route).not.toContain("notificaciones@abogados.pe");
  });

  it("no existe ningún tab de WhatsApp", () => {
    expect(route).not.toMatch(/id:\s*"whatsapp"/);
    expect(route).not.toContain('tab === "whatsapp"');
    expect(route).not.toContain("MessageCircle");
    expect(route).not.toContain("WhatsApp Business");
  });
});
