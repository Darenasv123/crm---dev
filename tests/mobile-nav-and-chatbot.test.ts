import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("src/components/app-layout.tsx", "utf8");
const chatbot = readFileSync("src/components/chatbot.tsx", "utf8");

describe("Fase 7 — Navegación móvil: rutas de la barra inferior y roles preservados", () => {
  it("la barra inferior sigue teniendo exactamente sus 4 rutas originales (Inicio, Clientes, Tareas, Agenda)", () => {
    const bottomNavBlock = layout.slice(
      layout.indexOf("const bottomNav ="),
      layout.indexOf('<div className="flex min-h-screen'),
    );
    expect(bottomNavBlock).toContain('to: "/"');
    expect(bottomNavBlock).toContain('to: "/clientes"');
    expect(bottomNavBlock).toContain('to: "/tareas"');
    expect(bottomNavBlock).toContain('to: "/agenda"');
  });

  it("Plantillas es visible para cualquier rol (no tiene adminOnly)", () => {
    const navLine = layout.split("\n").find((l) => l.includes('to: "/plantillas"'));
    expect(navLine).toBeDefined();
    expect(navLine).not.toContain("adminOnly");
  });

  it("Configuración sigue siendo admin-only (no se regresionó QA-006/QA-009)", () => {
    const navLine = layout.split("\n").find((l) => l.includes('to: "/configuracion"'));
    expect(navLine).toBeDefined();
    expect(navLine).toContain("adminOnly: true");
  });

  it("el filtrado de nav por rol sigue teniendo una única fuente reutilizada (sidebar y drawer)", () => {
    expect(layout.match(/visibleNav\.map/g)).toHaveLength(2);
  });
});

describe("Fase 7C — Gaveta móvil: modal real vía primitive Radix (Sheet/Dialog), no solo atributos ARIA", () => {
  it("usa el primitive Sheet (Radix Dialog) en vez de un overlay manual con role/aria-modal a mano", () => {
    expect(layout).toContain(
      'import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"',
    );
    expect(layout).toContain("<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>");
    expect(layout).not.toMatch(/role="dialog"\s*\n\s*aria-modal="true"/);
  });

  it("ya no reimplementa Escape/foco a mano (delegado al Dialog.Root de Radix, que ya trae focus trap, scroll lock, Escape, click-fuera y restauración de foco)", () => {
    expect(layout).not.toContain("drawerCloseRef");
    expect(layout).not.toMatch(/e\.key === "Escape"/);
  });

  it("declara un título accesible (SheetTitle) para el lector de pantalla, aunque esté oculto visualmente", () => {
    expect(layout).toContain("<SheetTitle");
    const titleIdx = layout.indexOf("<SheetTitle");
    const titleTag = layout.slice(titleIdx, titleIdx + 60);
    expect(titleTag).toContain("sr-only");
  });

  it("el sheet primitivo sigue montando la navegación de rol filtrada dentro del contenido", () => {
    const sheetContentIdx = layout.indexOf("<SheetContent");
    const sheetCloseIdx = layout.indexOf("</SheetContent>");
    const sheetBlock = layout.slice(sheetContentIdx, sheetCloseIdx);
    expect(sheetBlock).toContain("visibleNav.map");
  });
});

describe("Fase 7C — el primitive Sheet reutilizado sigue siendo el mismo que usa el resto del CRM (sin fork paralelo)", () => {
  it("sheet.tsx sigue construido sobre @radix-ui/react-dialog (focus trap y scroll lock nativos)", () => {
    const sheetSource = readFileSync("src/components/ui/sheet.tsx", "utf8");
    expect(sheetSource).toContain('from "@radix-ui/react-dialog"');
  });
});

describe("Fase 7 — safe-area: la clase referenciada en la barra inferior existe realmente", () => {
  it("app-layout referencia safe-area-inset-bottom en la nav inferior", () => {
    expect(layout).toContain("safe-area-inset-bottom");
  });

  it("la clase está definida en styles.css con env(safe-area-inset-bottom)", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    expect(styles).toMatch(/\.safe-area-inset-bottom\s*\{[^}]*env\(safe-area-inset-bottom/);
  });
});

describe("QA-015 — Chatbot: no se superpone con la barra inferior móvil, sin coordenadas mágicas por dispositivo", () => {
  it("el FAB usa un offset distinto en móvil (donde existe la barra inferior) vs. escritorio (lg:)", () => {
    const fabButton = chatbot.slice(chatbot.indexOf("<button"), chatbot.indexOf("</button>"));
    expect(fabButton).toMatch(/bottom-\[calc\(5rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(fabButton).toMatch(/lg:bottom-\[calc\(1\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it("el offset del FAB está derivado del tamaño real de la barra inferior (4rem) más margen, no un valor arbitrario de un modelo de teléfono específico", () => {
    // La barra inferior mide h-16 (4rem). 5rem = 4rem + 1rem de margen: una
    // composición basada en el layout real, no un breakpoint de dispositivo.
    expect(chatbot).toContain("bottom-[calc(5rem+env(safe-area-inset-bottom))]");
  });

  it("el panel del chat es de ancho responsivo (no un [380px] fijo que desborde pantallas de 360-375px)", () => {
    const panelDiv = chatbot.slice(
      chatbot.indexOf("w-[calc(100vw"),
      chatbot.indexOf("w-[calc(100vw") + 40,
    );
    expect(panelDiv).toContain("w-[calc(100vw-3rem)]");
    expect(chatbot).toContain("sm:w-[380px]");
  });

  it("el panel del chat también respeta el safe-area inferior", () => {
    expect(chatbot).toMatch(/bottom-\[calc\(9\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it("el FAB y el botón de cerrar tienen aria-label (antes solo tenían title o nada)", () => {
    const fabButton = chatbot.slice(chatbot.indexOf("<button"), chatbot.indexOf("</button>"));
    expect(fabButton).toMatch(/aria-label=/);
    const closeButtonIndex = chatbot.indexOf("setOpen(false)");
    const closeButtonBlock = chatbot.slice(closeButtonIndex, closeButtonIndex + 150);
    expect(closeButtonBlock).toMatch(/aria-label=/);
  });

  it("el chatbot se renderiza exactamente una vez en el layout (sin duplicación)", () => {
    expect(layout.match(/<Chatbot \/>/g)).toHaveLength(1);
  });
});
