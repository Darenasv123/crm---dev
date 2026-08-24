import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("src/routes/_app.index.tsx", "utf8");

describe("Fase 7C — QA-005: ClientRelatedPage (compartido por Cliente/documentos, /reportes, /expedientes, /tareas) expone texto completo", () => {
  const source = readFileSync("src/components/clients/client-related-page.tsx", "utf8");

  it("row.title y row.detail tienen title (cubre documentos/reportes/expedientes del cliente)", () => {
    expect(source).toContain("title={row.title}");
    expect(source).toContain("title={row.detail}");
  });

  it("task.title en la pestaña de tareas del cliente tiene title", () => {
    expect(source).toMatch(/<p className="truncate font-semibold" title=\{task\.title\}>/);
  });
});

describe("Fase 7C — QA-014: las secciones de 'trabajo pendiente' del Dashboard también distinguen loading de cero real", () => {
  it("WorkBucket acepta un prop loading y renderiza un skeleton en vez del estado vacío mientras carga", () => {
    const fnStart = dashboard.indexOf("function WorkBucket");
    const fnEnd = dashboard.indexOf("\nfunction ", fnStart + 1);
    const fn = dashboard.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 2000);
    expect(fn).toContain("loading = false");
    expect(fn).toContain("animate-pulse");
    expect(fn).toMatch(/role="status"/);
  });

  it("las 4 tarjetas de WorkBucket reciben su propio flag de loading (pagos, agenda de hoy, documentos sueltos, clientes sin contacto)", () => {
    const workBucketCalls = dashboard.match(/<WorkBucket[\s\S]*?\/>/g) ?? [];
    expect(workBucketCalls).toHaveLength(4);
    for (const call of workBucketCalls) {
      expect(call).toMatch(/loading=\{/);
    }
  });

  it("'Próximas actividades', 'Expedientes en revisión' y 'Documentos pendientes' no declaran su estado vacío antes de que termine la carga real", () => {
    expect(dashboard).toMatch(/eventsLoading \? \(\s*<div className="h-16 animate-pulse/);
    expect(dashboard).toMatch(/casesLoading \? \(\s*<div className="h-16 animate-pulse/);
    expect(dashboard).toMatch(/documentsLoading \? \(\s*<div className="h-16 animate-pulse/);
  });

  it("'Actividad reciente' espera a los 4 orígenes de datos que combina antes de declarar 'no hay actividad'", () => {
    const idx = dashboard.indexOf("recentActivity.length === 0");
    const guard = dashboard.slice(Math.max(0, idx - 300), idx);
    expect(guard).toContain("clientsLoading");
    expect(guard).toContain("casesLoading");
    expect(guard).toContain("documentsLoading");
    expect(guard).toContain("paymentsLoading");
  });

  it("no se introdujo ningún setTimeout en el Dashboard para simular carga", () => {
    expect(dashboard).not.toContain("setTimeout");
  });
});

describe("Fase 7C — Admin vs Personal: la navegación no ofrece acciones administrativas falsas a Personal", () => {
  const layout = readFileSync("src/components/app-layout.tsx", "utf8");

  it("Configuración y Pagos están marcados adminOnly en el arreglo de navegación", () => {
    const navBlock = layout.slice(layout.indexOf("const nav: NavItem[]"), layout.indexOf("];"));
    const configLine = navBlock.split("\n").find((l) => l.includes('to: "/configuracion"'));
    const pagosLine = navBlock.split("\n").find((l) => l.includes('to: "/pagos"'));
    expect(configLine).toContain("adminOnly: true");
    expect(pagosLine).toContain("adminOnly: true");
  });

  it("la barra inferior móvil (bottom nav) no incluye ninguna ruta admin-only", () => {
    const bottomNavBlock = layout.slice(
      layout.indexOf("const bottomNav ="),
      layout.indexOf('<div className="flex min-h-screen'),
    );
    expect(bottomNavBlock).not.toContain("/configuracion");
    expect(bottomNavBlock).not.toContain("/pagos");
  });

  it("Plantillas es accesible para cualquier rol (sin adminOnly) tanto en el arreglo de nav como en visibleNav", () => {
    const navBlock = layout.slice(layout.indexOf("const nav: NavItem[]"), layout.indexOf("];"));
    const plantillasLine = navBlock.split("\n").find((l) => l.includes('to: "/plantillas"'));
    expect(plantillasLine).not.toContain("adminOnly");
  });

  it("además de ocultarse en la navegación, /configuracion y /pagos también bloquean el acceso a nivel de ruta (defensa en profundidad, no solo ocultar el enlace)", () => {
    const configRoute = readFileSync("src/routes/_app.configuracion.index.tsx", "utf8");
    const pagosRoute = readFileSync("src/routes/_app.pagos.index.tsx", "utf8");
    expect(configRoute).toMatch(/role !== "Administrador"/);
    expect(pagosRoute).toMatch(/canViewPayments/);
  });
});

describe("Fase 7C — Touch targets: controles críticos móviles alcanzan ~44px sin agrandar el ícono visual", () => {
  it("Documentos: Editar/Visualizar/Descargar/Eliminar usan min-h-11 min-w-11 (icono se mantiene h-3.5 w-3.5)", () => {
    const source = readFileSync("src/routes/_app.documentos.index.tsx", "utf8");
    const matches = source.match(/min-h-11 min-w-11 grid place-items-center rounded/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("Agenda: navegación de mes, cerrar día, y acciones de evento alcanzan min-h-11/min-w-11", () => {
    const source = readFileSync("src/routes/_app.agenda.index.tsx", "utf8");
    expect(source).toContain('aria-label="Mes anterior"');
    expect(source).toContain('aria-label="Mes siguiente"');
    const matches = source.match(/min-h-11 min-w-11/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it("Reportes: Visualizar/Descargar/Enviar dejan de ser botones de 32px", () => {
    const source = readFileSync("src/routes/_app.reportes.index.tsx", "utf8");
    expect(source).not.toMatch(
      /grid h-8 w-8 place-items-center rounded-lg border border-border bg-card/,
    );
    expect(
      source.match(
        /grid min-h-11 min-w-11 place-items-center rounded-lg border border-border bg-card/g,
      )?.length,
    ).toBe(3);
  });

  it("Plantillas: Ver/Descargar/Eliminar dejan de ser botones de 28px", () => {
    const source = readFileSync("src/components/settings/templates-settings.tsx", "utf8");
    expect(source).not.toMatch(/inline-flex h-7 items-center/);
    expect(source.match(/inline-flex min-h-11 items-center/g)?.length).toBe(3);
  });

  it("Usuarios: Editar y los cierres de modal alcanzan min-h-11", () => {
    const source = readFileSync("src/components/settings/users-settings.tsx", "utf8");
    expect(source).toContain("min-h-11 px-3 rounded-md text-xs font-semibold text-primary");
    expect(
      source.match(/min-h-11 min-w-11 grid place-items-center rounded-lg hover:bg-muted\/60/g)
        ?.length,
    ).toBe(2);
  });

  it("Tareas: Ver detalle, Liberar y Eliminar tarea alcanzan min-h-11/min-w-11", () => {
    const source = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");
    expect(source).toContain('title="Liberar a Disponibles"');
    const liberarIdx = source.indexOf('title="Liberar a Disponibles"');
    const nearLiberar = source.slice(liberarIdx, liberarIdx + 300);
    expect(nearLiberar).toContain("min-h-11 min-w-11");
  });

  it("App shell: hamburguesa y campana de notificaciones alcanzan min-h-11/min-w-11", () => {
    const layout = readFileSync("src/components/app-layout.tsx", "utf8");
    expect(layout).toContain('aria-label="Abrir menú"');
    expect(layout).toContain('aria-label="Ver notificaciones"');
    const matches = layout.match(/min-h-11 min-w-11/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("Chatbot: cerrar y enviar alcanzan min-h-11/min-w-11 (el FAB ya medía 56px, sin cambio)", () => {
    const source = readFileSync("src/components/chatbot.tsx", "utf8");
    expect(source.match(/min-h-11 min-w-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("h-14 w-14");
  });
});

describe("Fase 7C — QA-005: gaps reales encontrados en Tareas ahora exponen el texto completo", () => {
  const source = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");

  it("el título de la tarea (fila de lista) tiene title", () => {
    expect(source).toMatch(/<h3 className="truncate font-semibold" title=\{task\.title\}>/);
  });

  it("el título de la tarea (tarjeta Kanban) tiene title", () => {
    expect(source).toMatch(
      /<p className="text-sm font-semibold line-clamp-2" title=\{task\.title\}>/,
    );
  });

  it("el enlace al cliente y al expediente en la fila de tarea tienen title", () => {
    expect(source).toContain("title={resolvedClientName ?? undefined}");
    expect(source).toContain("title={task.cases.case_number || task.cases.expediente}");
  });

  it("el nombre del responsable (fila y tarjeta Kanban) tiene title", () => {
    const matches = source.match(/title=\{task\.assignee\?\.full_name \?\? undefined\}/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

describe("Fase 7C — QA-005: gaps reales encontrados en Documentos ahora exponen el texto completo", () => {
  const source = readFileSync("src/routes/_app.documentos.index.tsx", "utf8");

  it("el nombre del archivo durante la subida tiene title", () => {
    expect(source).toContain("title={uploadFile.name}");
  });

  it("el nombre del documento en el panel de previsualización (icono y metadatos) tiene title", () => {
    const matches = source.match(/title=\{selected\.name\}/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

describe("Fase 7C — QA-005: el modal de previsualización de Reportes expone título y cliente completos", () => {
  it("preview.data.title y preview.data.clientName tienen title", () => {
    const source = readFileSync("src/routes/_app.reportes.index.tsx", "utf8");
    expect(source).toContain("title={preview.data.title}");
    expect(source).toContain("title={preview.data.clientName}");
  });
});
