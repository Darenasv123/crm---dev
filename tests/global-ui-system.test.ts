import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "../src/components/ui/button";
import { EmptyState } from "../src/components/ui/data-state";
import { FormField } from "../src/components/ui/form-layout";
import { Input } from "../src/components/ui/input";
import { NativeSelect } from "../src/components/ui/native-select";
import { Textarea } from "../src/components/ui/textarea";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("sistema visual global del CRM", () => {
  it("renderiza controles editables con altura, fondo, borde y foco compartidos", () => {
    const input = renderToStaticMarkup(
      createElement(Input, { id: "name", "aria-invalid": true, readOnly: true }),
    );
    const textarea = renderToStaticMarkup(createElement(Textarea, { id: "notes" }));
    const select = renderToStaticMarkup(
      createElement(
        NativeSelect,
        { id: "status", defaultValue: "active" },
        createElement("option", { value: "active" }, "Activo"),
      ),
    );

    for (const control of [input, textarea, select]) {
      expect(control).toContain("border-input");
      expect(control).toContain("bg-card");
      expect(control).toContain("focus-visible:ring");
    }
    expect(input).toContain("aria-invalid");
    expect(input).toContain("read-only:");
    expect(select).toContain("appearance-none");
  });

  it("asocia etiquetas, opcionalidad y errores con controles reales", () => {
    const html = renderToStaticMarkup(
      createElement(FormField, {
        id: "client-email",
        label: "Correo",
        optional: true,
        description: "Canal de contacto",
        error: "El correo no es válido",
        children: createElement(Input, {
          id: "client-email",
          "aria-invalid": true,
          "aria-describedby": "client-email-description client-email-error",
        }),
      }),
    );

    expect(html).toContain('for="client-email"');
    expect(html).toContain("Opcional");
    expect(html).toContain('role="alert"');
    expect(html).toContain("El correo no es válido");
  });

  it("expone variantes reconocibles y estado vacío accionable", () => {
    expect(buttonVariants({ variant: "destructive" })).toContain("bg-destructive");
    expect(buttonVariants({ variant: "success" })).toContain("bg-success");
    expect(buttonVariants({ variant: "outline" })).toContain("border-input");

    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "Todavía no hay clientes",
        description: "Registra el primer cliente.",
        action: createElement("button", { type: "button" }, "Nuevo cliente"),
      }),
    );
    expect(html).toContain("Todavía no hay clientes");
    expect(html).toContain("Nuevo cliente");
  });

  it("define tokens claros, oscuros, movimiento reducido y bloqueo de scroll global", () => {
    const css = source("src/styles.css");
    for (const token of [
      "--control-height: 2.75rem",
      "--success:",
      "--warning:",
      "--info:",
      "--task-available:",
      "--task-blocked:",
      ".dark",
      "prefers-reduced-motion",
      "overflow-x: clip",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("usa el sistema compartido en formularios operativos y diálogos principales", () => {
    const files = [
      "src/routes/_app.clientes.index.tsx",
      "src/routes/_app.clientes.$id.tsx",
      "src/routes/_app.casos.index.tsx",
      // El formulario de tarea (crear/editar) vive en un componente propio,
      // reutilizado por tasks-page.tsx en vez de duplicar el diálogo.
      "src/components/tasks/task-form-dialog.tsx",
    ];
    for (const file of files) {
      const contents = source(file);
      expect(contents).toContain("<FormField");
      expect(contents).toContain("<Dialog");
      expect(contents).toContain("<Input");
      expect(contents).toContain("<NativeSelect");
    }
  });

  it("limita controles nativos a componentes base y tipos justificados", () => {
    const scanTargets = [
      "src/components/tasks/tasks-page.tsx",
      "src/components/tasks/task-form-dialog.tsx",
      "src/routes/_app.clientes.index.tsx",
      "src/routes/_app.clientes.$id.tsx",
      "src/routes/_app.configuracion.index.tsx",
      "src/routes/_app.documentos.index.tsx",
      "src/routes/_app.pagos.index.tsx",
      "src/components/csv-import.tsx",
      "src/components/document-folders/document-folder-browser.tsx",
    ];

    for (const file of scanTargets) {
      const nativeInputs = [...source(file).matchAll(/<input\b[\s\S]*?>/g)].map(([match]) => match);
      for (const input of nativeInputs) {
        expect(input).toMatch(/type="(?:checkbox|radio|file)"/);
      }
    }

    expect(source("src/components/ui/native-select.tsx")).toContain("<select");
    expect(source("src/components/ui/input.tsx")).toContain("<input");
  });

  it("mantiene el catálogo fuera de rutas y marcado como evidencia ficticia", () => {
    const catalog = source("dev/ui-catalog-main.tsx");
    expect(catalog).toContain("Datos ficticios");
    expect(catalog).toContain("no consulta servicios remotos");
    expect(source("dev/ui-catalog.html")).toContain("noindex,nofollow");
    expect(source("src/routeTree.gen.ts")).not.toContain("ui-catalog");
  });
});
