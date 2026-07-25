import { describe, expect, it } from "vitest";
import { formatCount, hasMojibake, repairMojibake, stripUtf8Bom } from "../src/lib/text-utils";

describe("UTF-8 text utilities", () => {
  const corruptedExecution = "DEMANDA DE EJECUCI\u00c3\u0192\u00e2\u20ac\u0153N";
  const corruptedPension = "Pensi\u00c3\u00b3n de alimentos";

  it("detects unequivocal mojibake", () => {
    expect(hasMojibake(corruptedExecution)).toBe(true);
    expect(hasMojibake("EJECUCIÓN DE ACTA")).toBe(false);
  });

  it("repairs mojibake without changing already correct text", () => {
    expect(repairMojibake(corruptedExecution)).toBe("DEMANDA DE EJECUCIÓN");
    expect(repairMojibake(corruptedPension)).toBe("Pensión de alimentos");
    expect(repairMojibake("Ejecución de acta de conciliación")).toBe(
      "Ejecución de acta de conciliación",
    );
  });

  it("preserves names with ñ and accents", () => {
    expect(repairMojibake("ÑUÑEZ LÓPEZ MARÍA")).toBe("ÑUÑEZ LÓPEZ MARÍA");
    expect(repairMojibake("García Núñez")).toBe("García Núñez");
  });

  it("formats singular and plural counts naturally", () => {
    expect(formatCount(1, "cliente", "clientes")).toBe("1 cliente");
    expect(formatCount(2, "cliente", "clientes")).toBe("2 clientes");
    expect(formatCount(1, "carpeta activa", "carpetas activas")).toBe("1 carpeta activa");
    expect(formatCount(3, "carpeta activa", "carpetas activas")).toBe("3 carpetas activas");
    expect(formatCount(1, "acción", "acciones")).toBe("1 acción");
    expect(formatCount(4, "acción", "acciones")).toBe("4 acciones");
  });

  it("strips a UTF-8 BOM at the beginning of CSV text", () => {
    expect(stripUtf8Bom("\uFEFFnombre,dni")).toBe("nombre,dni");
  });
});
