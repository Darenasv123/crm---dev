import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, isValidSection, SECTIONS } from "@/lib/settings-sections";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const routeSource = source("src/routes/_app.configuracion.index.tsx");

describe("QA-006 — validación real de ?seccion= (ejecución directa, no solo grep)", () => {
  it("el valor por defecto es 'usuarios' y es una sección válida", () => {
    expect(DEFAULT_SECTION).toBe("usuarios");
    expect(isValidSection(DEFAULT_SECTION)).toBe(true);
  });

  // Fase 8C añadió "google-drive" reutilizando este mismo sistema de
  // ?seccion= en lugar de crear estado paralelo, que es justo lo que QA-006
  // exige. La lista sube de 7 a 8 secciones; ninguna anterior desaparece.
  it("acepta cada una de las 8 secciones reales tras el retiro de WhatsApp", () => {
    expect(SECTIONS).toEqual([
      "usuarios",
      "backup",
      "herramientas",
      "google-calendar",
      "google-drive",
      "notificaciones",
      "correo",
      "plantillas",
    ]);
    for (const section of SECTIONS) {
      expect(isValidSection(section)).toBe(true);
    }
  });

  it("una URL con sección válida se honra tal cual (simulando validateSearch)", () => {
    const search = { seccion: "correo" };
    const resolved = isValidSection(search.seccion) ? search.seccion : DEFAULT_SECTION;
    expect(resolved).toBe("correo");
  });

  it("una URL con sección inválida cae al valor por defecto seguro, no a una pantalla rota", () => {
    for (const bad of ["whatsapp", "inexistente", "", "<script>", 123, null, undefined, {}]) {
      const search = { seccion: bad };
      const resolved = isValidSection(search.seccion) ? search.seccion : DEFAULT_SECTION;
      expect(resolved).toBe(DEFAULT_SECTION);
    }
  });

  it("sin ningún search param (?  vacío) cae al valor por defecto", () => {
    const search: Record<string, unknown> = {};
    const resolved = isValidSection(search.seccion) ? search.seccion : DEFAULT_SECTION;
    expect(resolved).toBe(DEFAULT_SECTION);
  });
});

describe("QA-006 — la ruta usa validateSearch real, no solo estado interno", () => {
  it("validateSearch está declarado en createFileRoute, ya no hay useState para el tab", () => {
    expect(routeSource).toContain("validateSearch: (search: Record<string, unknown>)");
    expect(routeSource).not.toContain('useState("usuarios")');
    expect(routeSource).not.toContain("const [tab, setTab]");
  });

  it("el tab activo se lee de Route.useSearch(), no de un estado local", () => {
    expect(routeSource).toContain("const { seccion: tab } = Route.useSearch();");
  });

  it("cambiar de tab usa enlaces reales (Link) con search tipado, no solo un botón con onClick", () => {
    expect(routeSource).toContain('to="/configuracion"');
    expect(routeSource).toContain("search={{ seccion: t.id } as never}");
    expect(routeSource).toContain('aria-current={active ? "page" : undefined}');
  });

  it("no crea una ruta nueva por cada tab (sigue siendo una sola ruta con search param)", () => {
    expect(routeSource.match(/createFileRoute\(/g)).toHaveLength(1);
    expect(routeSource).toContain('createFileRoute("/_app/configuracion/")');
  });
});

describe("QA-006 — refresh y Back/Forward (comportamiento nativo del navegador vía URL)", () => {
  it("al no usar estado local para el tab, un refresh de página vuelve a leer la misma URL (?seccion=) y resuelve al mismo tab", () => {
    // No hay ningún useEffect ni localStorage que reconstruya el tab tras
    // un refresh -- la fuente de verdad es exclusivamente la URL, que el
    // navegador ya conserva de forma nativa en un refresh/reload.
    expect(routeSource).not.toMatch(/localStorage\.(get|set)Item\(["']tab/);
  });

  it("los cambios de tab quedan en el historial del navegador (Link real, no navigate con replace)", () => {
    // Un <Link> de TanStack Router hace push por defecto (no replace), así
    // que Back/Forward navegan naturalmente entre secciones visitadas,
    // igual que ya se estableció para /tareas/todas?tarea=.
    const linkBlock = routeSource.slice(
      routeSource.indexOf("{TABS.map((t) => {"),
      routeSource.indexOf("</nav>"),
    );
    expect(linkBlock).not.toContain("replace");
  });
});
