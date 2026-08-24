import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fase 7 — el primitivo <Dialog>/<DialogContent> ya protegía la altura
 * (max-h + overflow-y-auto) desde antes de esta fase; el problema real
 * estaba en los modales construidos a mano (fixed inset-0 + Card) que no
 * reutilizan ese primitivo. Se aplicó el mismo patrón que ya usaba
 * ReportPreviewModal (max-h acotado + overflow-y-auto) a cada uno, en vez
 * de reescribirlos para usar <Dialog>.
 */
const HAND_ROLLED_MODALS: Array<{ file: string; label: string; cardMarker: string }> = [
  {
    file: "src/routes/_app.documentos.index.tsx",
    label: "Documentos — Subir archivo",
    cardMarker:
      'Card className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl"',
  },
  {
    file: "src/routes/_app.documentos.index.tsx",
    label: "Documentos — Editar documento",
    cardMarker:
      'Card className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl"',
  },
  {
    file: "src/routes/_app.agenda.index.tsx",
    label: "Agenda — evento",
    cardMarker:
      'Card className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl"',
  },
  {
    file: "src/routes/_app.pagos.index.tsx",
    label: "Pagos — ModalWrapper (compartido por Nuevo pago y edición)",
    cardMarker:
      'Card className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl"',
  },
  {
    file: "src/components/settings/templates-settings.tsx",
    label: "Plantillas — CreateTemplateDialog",
    cardMarker:
      'Card className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl"',
  },
  {
    file: "src/components/settings/users-settings.tsx",
    label: "Usuarios — Registrar personal",
    cardMarker: "max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl",
  },
];

describe("Fase 7 — modales manuales: Guardar/Cancelar nunca queda inalcanzable", () => {
  for (const modal of HAND_ROLLED_MODALS) {
    it(`${modal.label} tiene max-height acotada + overflow-y-auto`, () => {
      const source = readFileSync(modal.file, "utf8");
      expect(source).toContain(modal.cardMarker);
    });
  }

  it("cada modal manual con overlay a pantalla completa reserva margen (p-4) para no tocar el borde en móvil", () => {
    const files = [
      "src/routes/_app.documentos.index.tsx",
      "src/routes/_app.agenda.index.tsx",
      "src/routes/_app.pagos.index.tsx",
      "src/components/settings/templates-settings.tsx",
      "src/components/settings/users-settings.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const overlayLines = source
        .split("\n")
        .filter((l) => l.includes("fixed inset-0") && l.includes("items-center justify-center"));
      expect(overlayLines.length).toBeGreaterThan(0);
      for (const line of overlayLines) {
        expect(line).toContain("p-4");
      }
    }
  });
});

describe("Fase 7 — el primitivo <Dialog> sigue protegiendo altura y cierre (no se regresionó al tocar otros modales)", () => {
  const dialogSource = readFileSync("src/components/ui/dialog.tsx", "utf8");

  it("DialogContent sigue teniendo max-height acotada y overflow-y-auto", () => {
    expect(dialogSource).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(dialogSource).toContain("overflow-y-auto");
  });

  it("DialogContent sigue exponiendo un control de cierre", () => {
    expect(dialogSource).toContain("DialogPrimitive.Close");
  });
});

describe("Fase 7 — Usuarios: la tabla ya no puede provocar scroll horizontal a nivel de página", () => {
  it("la tabla de personal está envuelta en un contenedor overflow-x-auto", () => {
    const source = readFileSync("src/components/settings/users-settings.tsx", "utf8");
    const tableIndex = source.indexOf('<table className="w-full min-w-[560px]');
    expect(tableIndex).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, tableIndex - 60), tableIndex);
    expect(before).toContain('className="overflow-x-auto"');
  });
});
