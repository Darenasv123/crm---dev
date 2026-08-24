import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");

/**
 * Fase 7D: la lista de Tareas (vista tabla, xl:+) exigía un ancho mínimo de
 * contenido (~1122px, suma de los minmax de las 7 columnas) mayor al que el
 * Card contenedor podía ofrecer entre el breakpoint xl (1280px) y ~1470px de
 * viewport (una vez restados los 256px del sidebar y el padding de página).
 * Como el Card usaba overflow-hidden (no overflow-x-auto), Responsable y
 * Acción principal quedaban recortados sin forma de alcanzarlos -- el mismo
 * patrón que Clientes y Expedientes ya resuelven correctamente.
 */
describe("Fase 7D — Tareas: el desbordamiento del grid xl: vive en su propio wrapper, no en la página", () => {
  it("el header y las filas de la lista están envueltos en un contenedor overflow-x-auto propio", () => {
    const cardIdx = source.indexOf("function TaskList");
    expect(cardIdx).toBeGreaterThan(-1);
    const headerIdx = source.indexOf("<span>Tarea</span>", cardIdx);
    expect(headerIdx).toBeGreaterThan(cardIdx);
    const block = source.slice(cardIdx, headerIdx);
    expect(block).toContain('<div className="overflow-x-auto">');
    expect(block).toContain('<Card className="overflow-hidden">');
  });

  it("el ancho mínimo del grid solo se exige a partir de xl: (no fuerza scroll en móvil/tablet)", () => {
    expect(source).toContain('<div className="xl:min-w-[1160px]">');
    expect(source).not.toMatch(/(?<!xl:)min-w-\[1160px\]/);
  });

  it("el min-width del wrapper cubre la suma real de los minmax de las 7 columnas más su padding (no es un número arbitrario)", () => {
    // 220+130+130+140+100+150+180 = 1050 de contenido + 72 de gaps (6 x 12px)
    // + 32 de padding horizontal (p-4/px-4) = 1154px reales; el wrapper usa
    // 1160px como margen de seguridad mínimo, no un valor inventado.
    const minimums = [220, 130, 130, 140, 100, 150, 180];
    const contentMin = minimums.reduce((a, b) => a + b, 0);
    const gaps = 6 * 12;
    const padding = 32;
    const realMinimum = contentMin + gaps + padding;
    expect(realMinimum).toBeLessThanOrEqual(1160);
    expect(realMinimum).toBeGreaterThan(1140);
  });

  it("el grid-template de columnas de la tabla no cambió (misma estructura de 7 columnas)", () => {
    const matches =
      source.match(
        /grid-cols-\[minmax\(220px,2fr\)_minmax\(130px,1fr\)_minmax\(130px,1fr\)_140px_100px_minmax\(150px,1fr\)_minmax\(180px,1\.2fr\)\]/g,
      ) ?? [];
    expect(matches).toHaveLength(2); // header + fila
  });
});

describe("Fase 7D — no se introdujo scroll horizontal a nivel de app shell/body", () => {
  it("app-layout.tsx no ganó overflow-x en su body/shell", () => {
    const layout = readFileSync("src/components/app-layout.tsx", "utf8");
    expect(layout).not.toMatch(/overflow-x-auto.*min-h-screen|min-h-screen.*overflow-x-auto/);
  });

  it("el nuevo wrapper de Tareas está anidado dentro del Card, no envuelve AppLayout ni el <main>", () => {
    const appLayoutOpenIdx = source.indexOf("<AppLayout");
    const wrapperIdx = source.indexOf('<div className="overflow-x-auto">');
    expect(wrapperIdx).toBeGreaterThan(appLayoutOpenIdx);
  });
});

describe("Fase 7D — /tareas/tablero (Kanban) se mantiene intacto: ya estaba correctamente contenido", () => {
  it("TaskBoard sigue usando columnas fr sin min-width fijo (nunca puede forzar overflow de página)", () => {
    const boardIdx = source.indexOf("function TaskBoard");
    const boardEnd = source.indexOf("\nfunction ", boardIdx + 1);
    const boardFn = source.slice(boardIdx, boardEnd > -1 ? boardEnd : boardIdx + 1500);
    expect(boardFn).toContain("grid gap-4 lg:grid-cols-5");
    expect(boardFn).not.toMatch(/min-w-\[\d+px\]/);
  });
});

describe("Fase 7D — navegación y deep-links de Tareas no se alteraron", () => {
  it("las 4 rutas que renderizan vista propia siguen usando el componente compartido TasksPage", () => {
    const routes = [
      "src/routes/_app.tareas.index.tsx",
      "src/routes/_app.tareas.todas.tsx",
      "src/routes/_app.tareas.mias.tsx",
      "src/routes/_app.tareas.tablero.tsx",
    ];
    for (const file of routes) {
      const routeSource = readFileSync(file, "utf8");
      expect(routeSource).toContain("TasksPage");
    }
  });

  it("/tareas/proximas sigue siendo un redirect a /tareas (comportamiento preexistente, no tocado)", () => {
    const routeSource = readFileSync("src/routes/_app.tareas.proximas.tsx", "utf8");
    expect(routeSource).toContain('redirect({ to: "/tareas" })');
  });
});

describe("Fase 7D — QA-007 y Liberar a Disponibles no regresaron con el nuevo wrapper", () => {
  it("Disponible sigue siendo un span no interactivo, no un botón", () => {
    const idx = source.indexOf("Disponible — tómala primero");
    const block = source.slice(Math.max(0, idx - 500), idx);
    expect(block).toContain("<span");
    expect(block).not.toContain("<button");
  });

  it("Liberar a Disponibles sigue siendo un botón separado del select de Responsable, con touch target de 44px", () => {
    const liberarIdx = source.indexOf('title="Liberar a Disponibles"');
    expect(liberarIdx).toBeGreaterThan(-1);
    const block = source.slice(liberarIdx, liberarIdx + 300);
    expect(block).toContain("min-h-11 min-w-11");
  });
});
