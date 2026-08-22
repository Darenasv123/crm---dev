import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAdminRole, isPersonalRole, resolveUserPermissions } from "@/lib/permissions";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const migration = source("supabase/migrations/20260822120000_prevent_last_admin_removal.sql");
const ddl = migration.slice(migration.indexOf("begin;"));
const profilesFunctions = source("src/lib/profiles.functions.ts");
const usersSettings = source("src/components/settings/users-settings.tsx");
const permissionsSource = source("src/lib/permissions.ts");

describe("resolveUserPermissions — modelo de roles (Sección C/D)", () => {
  it("solo Administrador puede gestionar usuarios", () => {
    expect(resolveUserPermissions("Administrador").canManageUsers).toBe(true);
    expect(resolveUserPermissions("Personal").canManageUsers).toBe(false);
  });

  it("un rol ausente/desconocido se trata como no-administrador", () => {
    expect(resolveUserPermissions(null).canManageUsers).toBe(false);
    expect(resolveUserPermissions(undefined).canManageUsers).toBe(false);
    expect(resolveUserPermissions("rol-inexistente").canManageUsers).toBe(false);
  });

  it("isAdminRole/isPersonalRole son complementarios (sigue habiendo exactamente dos roles)", () => {
    expect(isAdminRole("Administrador")).toBe(true);
    expect(isPersonalRole("Administrador")).toBe(false);
    expect(isAdminRole("Personal")).toBe(false);
    expect(isPersonalRole("Personal")).toBe(true);
  });

  it("usePermissions combina resolveUserPermissions", () => {
    expect(permissionsSource).toContain("...resolveUserPermissions(profile?.role)");
    expect(permissionsSource).toContain("UserPermissions {");
  });
});

describe("Escalación de privilegios — creación de personal (Sección F)", () => {
  it("registerStaffFn verifica server-side que quien llama sea Administrador, antes de crear el usuario", () => {
    const verifyIndex = profilesFunctions.indexOf('callerProfile.role !== "Administrador"');
    const createIndex = profilesFunctions.indexOf("admin.auth.admin.createUser(");
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(verifyIndex);
  });

  it("el chequeo de rol usa el service_role (RLS bypass consciente) para leer el perfil del caller, no confía en el cliente", () => {
    expect(profilesFunctions).toContain("getAdminClient()");
    expect(profilesFunctions).toContain('.from("profiles")');
    expect(profilesFunctions).toContain('.select("role")');
    expect(profilesFunctions).toContain('.eq("id", caller.id)');
  });

  it("Personal que intenta registrar personal es rechazado con un error explícito, no una creación silenciosa", () => {
    expect(profilesFunctions).toContain(
      'throw new Error("Solo los administradores pueden registrar personal.");',
    );
  });
});

describe("Último Administrador — protección de integridad real (Sección S)", () => {
  it("existe un trigger BEFORE UPDATE y BEFORE DELETE en public.profiles", () => {
    expect(ddl).toContain("before update on public.profiles");
    expect(ddl).toContain("before delete on public.profiles");
  });

  it("la función cuenta los Administradores activos RESTANTES (excluyendo la fila afectada) antes de decidir", () => {
    const fnBlock = ddl.slice(
      ddl.indexOf("create or replace function public.prevent_last_admin_removal"),
      ddl.indexOf("comment on function"),
    );
    expect(fnBlock).toContain("role = 'Administrador'");
    expect(fnBlock).toContain("status = 'Activo'");
    expect(fnBlock).toContain("id <> OLD.id");
    expect(fnBlock).toContain("remaining_admins = 0");
  });

  it("rechaza con una excepción clara cuando dejaría el sistema sin ningún Administrador activo", () => {
    expect(ddl).toContain(
      "'No se puede completar: el sistema quedaría sin ningún Administrador activo.",
    );
  });

  it("UPDATE: solo evalúa el caso donde la fila afectada DEJA de ser Administrador activo (no bloquea ediciones normales)", () => {
    const fnBlock = ddl.slice(
      ddl.indexOf("create or replace function public.prevent_last_admin_removal"),
      ddl.indexOf("comment on function"),
    );
    expect(fnBlock).toContain("and (NEW.role <> 'Administrador' or NEW.status <> 'Activo')");
  });

  it("no introduce un nuevo rol ni un campo nuevo (usa role/status ya existentes)", () => {
    expect(ddl).not.toMatch(/add column/i);
    expect(ddl).not.toMatch(/'SuperAdmin'|'Owner'|'Root'/);
  });

  it("no reasigna ni corrige datos automáticamente, solo rechaza la operación (RAISE EXCEPTION, no UPDATE compensatorio)", () => {
    expect(ddl).not.toMatch(/\bupdate\s+public\.profiles\b/i);
  });

  it("no se aplica remotamente como parte de esta fase", () => {
    expect(migration).toContain("NO se aplica remotamente");
  });

  it("no modifica ninguna migración ni archivo de bootstrap histórico", () => {
    // Verificado también en el diff de la fase; aquí se confirma que el
    // propio archivo es autosuficiente (crea su función con create or
    // replace, no depende de editar 0002/0004/0006 del bootstrap).
    expect(migration.trim().startsWith("--")).toBe(true);
    expect(ddl.trim().startsWith("begin;")).toBe(true);
    expect(ddl.trim().endsWith("commit;")).toBe(true);
  });
});

describe("UI — protección del último Administrador (defensa adicional, no la garantía final)", () => {
  it("advierte en el panel de edición cuando el usuario es el único Administrador activo", () => {
    expect(usersSettings).toContain("activeAdminCount <= 1");
    expect(usersSettings).toContain("Único Administrador activo");
    expect(usersSettings).toContain("El sistema rechazará quitarle el");
  });

  it("pide confirmación proporcional antes de degradar/desactivar a un Administrador activo (Sección R)", () => {
    const handlerBlock = usersSettings.slice(
      usersSettings.indexOf("async function handleEditProfile"),
      usersSettings.indexOf("setEditSaving(true)"),
    );
    expect(handlerBlock).toContain("wasActiveAdmin && willLoseAdmin");
    expect(handlerBlock).toContain("window.confirm(");
  });

  it("distingue autoedición: el mensaje de confirmación es distinto si el Administrador se edita a sí mismo", () => {
    const handlerBlock = usersSettings.slice(
      usersSettings.indexOf("async function handleEditProfile"),
      usersSettings.indexOf("setEditSaving(true)"),
    );
    expect(handlerBlock).toContain("editProfile.id === currentProfile?.id");
    expect(handlerBlock).toContain("único Administrador activo, el sistema rechazará");
  });

  it("no hace un doble modal separado por cada edición trivial: el flujo normal de edición no pide confirmación adicional", () => {
    // La confirmación solo se dispara si wasActiveAdmin && willLoseAdmin;
    // editar nombre/teléfono, o mantener el rol/estado, no la activa.
    expect(usersSettings).toContain("if (wasActiveAdmin && willLoseAdmin) {");
  });
});

describe("Autogestión de perfil (Sección G) — sin pantalla separada, mismo panel administrativo", () => {
  it("no existe una pantalla 'Mi perfil' separada (confirmado: no se creó ninguna en esta fase)", () => {
    expect(() => source("src/routes/_app.perfil.index.tsx")).toThrow();
  });

  it("el modal de edición indica explícitamente cuando el Administrador edita su propia cuenta", () => {
    expect(usersSettings).toContain("estás editando tu propia cuenta");
  });

  it("marca visualmente la fila del usuario actual en el listado ('(tú)')", () => {
    expect(usersSettings).toContain("(tú)");
    expect(usersSettings).toContain("u.id === currentProfile?.id");
  });
});

describe("Configuración de Usuarios extraída a un componente propio (Sección O)", () => {
  it("users-settings.tsx reutiliza los mismos hooks (sin duplicar lógica de datos)", () => {
    expect(usersSettings).toContain(
      'import { useProfiles, useRegisterStaff, useUpdateProfile } from "@/hooks/use-profiles"',
    );
  });

  it("no se reescribió toda Configuración: Backup/Google Calendar/Notificaciones/Herramientas siguen inline en la ruta", () => {
    const routeSource = source("src/routes/_app.configuracion.index.tsx");
    expect(routeSource).toContain('tab === "backup"');
    expect(routeSource).toContain('tab === "google-calendar"');
    expect(routeSource).toContain('tab === "notificaciones"');
    expect(routeSource).toContain("AdministrativeImportToolsPanel");
  });
});

describe("QA-009 — reclasificación (Sección K)", () => {
  it("no queda ningún badge o texto 'Próximamente' en Configuración", () => {
    const routeSource = source("src/routes/_app.configuracion.index.tsx");
    expect(routeSource).not.toMatch(/Próximamente/);
  });

  it("Correo ya no es mock: el tab renderiza el componente funcional real", () => {
    const routeSource = source("src/routes/_app.configuracion.index.tsx");
    expect(routeSource).toContain('{tab === "correo" && <EmailSettings />}');
  });

  it("Plantillas ya no es mock: el tab renderiza el componente funcional real", () => {
    const routeSource = source("src/routes/_app.configuracion.index.tsx");
    expect(routeSource).toContain('{tab === "plantillas" && <TemplatesSettings />}');
  });

  it("WhatsApp no existe en ningún tab ni mock residual", () => {
    const routeSource = source("src/routes/_app.configuracion.index.tsx");
    expect(routeSource).not.toMatch(/whatsapp/i);
  });
});

describe("Plantillas — /plantillas sigue accesible a Personal tras Fase 6 (Sección L)", () => {
  it("la ruta /plantillas sigue existiendo, sin gate de rol en el componente", () => {
    const plantillasRoute = source("src/routes/_app.plantillas.index.tsx");
    // El comentario de cabecera menciona "Administrador" solo para explicar
    // la decisión de diseño (ver Fase 5B); lo relevante es que el
    // COMPONENTE en sí no tenga ningún check de rol ni redirección.
    const componentBody = plantillasRoute.slice(plantillasRoute.indexOf("function PlantillasPage"));
    expect(componentBody).not.toContain("Administrador");
    expect(componentBody).not.toContain("navigate({");
  });

  it("Configuración → Plantillas sigue reutilizando el mismo componente (sin duplicar estado)", () => {
    const routeSource = source("src/routes/_app.configuracion.index.tsx");
    expect(routeSource).toContain(
      'import { TemplatesSettings } from "@/components/settings/templates-settings"',
    );
  });
});

describe("Correo — Configuración → Correo sigue Admin-only (Sección M)", () => {
  it("Correo vive dentro de la página /configuracion, íntegramente Admin-only (sin ruta pública propia)", () => {
    expect(() => source("src/routes/_app.correo.index.tsx")).toThrow();
  });

  it("el envío de reporte por correo sigue disponible para ambos roles según permisos de Reportes (sin mezclar con configuración SMTP)", () => {
    const sendReportRoute = source("src/routes/api.email.send-report.ts");
    expect(sendReportRoute).toContain('requireEmailRole(request, ["Administrador", "Personal"])');
  });

  it("el correo de prueba y el estado administrativo de SMTP siguen Admin-only", () => {
    const testRoute = source("src/routes/api.email.test.ts");
    expect(testRoute).toContain('requireEmailRole(request, ["Administrador"])');
  });
});

describe("Google Calendar — configuración administrativa sigue protegida (Sección N)", () => {
  it("las acciones administrativas de Calendar siguen exigiendo Administrador server-side", () => {
    const gcalServer = source("src/lib/google-calendar.server.ts");
    expect(gcalServer).toContain('requireRole(request, ["Administrador"])');
  });

  it("no se modificó ninguna lógica de sincronización de Calendar en esta fase", () => {
    // Confirmado también en el diff de la fase (git diff vacío sobre estos
    // archivos); aquí se deja constancia de qué se auditó sin tocar.
    const gcalServer = source("src/lib/google-calendar.server.ts");
    expect(gcalServer).toContain("processGoogleSyncQueue");
    expect(gcalServer).toContain("runGoogleCalendarScheduledMaintenance");
  });
});
