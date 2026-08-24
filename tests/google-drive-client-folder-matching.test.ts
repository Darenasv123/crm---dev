import { describe, expect, it } from "vitest";
import {
  computeOnboardingPreview,
  matchClientToFolders,
  type DriveFolderCandidate,
} from "@/lib/google-drive/client-folder-matching";

/**
 * Fase 8A — pruebas de diseño puro para el clasificador de matching
 * Cliente CRM ↔ Carpeta Drive. Sin conexión real a Drive; `folders` aquí
 * son siempre fixtures en memoria.
 */
describe("matchClientToFolders — EXACT_MATCH", () => {
  it("una única carpeta con el nombre idéntico es EXACT_MATCH", () => {
    const folders: DriveFolderCandidate[] = [{ id: "f1", name: "Juan Pérez" }];
    const result = matchClientToFolders("Juan Pérez", folders);
    expect(result.type).toBe("EXACT_MATCH");
    expect(result.candidates).toEqual([{ id: "f1", name: "Juan Pérez" }]);
  });

  it("dos carpetas con el nombre EXACTO idéntico son AMBIGUOUS, no se elige una arbitrariamente", () => {
    const folders: DriveFolderCandidate[] = [
      { id: "f1", name: "Juan Pérez" },
      { id: "f2", name: "Juan Pérez" },
    ];
    const result = matchClientToFolders("Juan Pérez", folders);
    expect(result.type).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });
});

describe("matchClientToFolders — NORMALIZED_MATCH (acentos, mayúsculas, espacios)", () => {
  it("sin acento coincide por nombre normalizado (Perez vs Pérez)", () => {
    const result = matchClientToFolders("Juan Pérez", [{ id: "f1", name: "Juan Perez" }]);
    expect(result.type).toBe("NORMALIZED_MATCH");
  });

  it("mayúsculas distintas coinciden por nombre normalizado", () => {
    const result = matchClientToFolders("Juan Pérez", [{ id: "f1", name: "JUAN PEREZ" }]);
    expect(result.type).toBe("NORMALIZED_MATCH");
  });

  it("espacios repetidos/extra coinciden por nombre normalizado", () => {
    const result = matchClientToFolders("Juan Pérez", [{ id: "f1", name: "Juan   Pérez  " }]);
    expect(result.type).toBe("NORMALIZED_MATCH");
  });

  it("EXACT_MATCH tiene prioridad sobre NORMALIZED_MATCH cuando ambos existen", () => {
    const folders: DriveFolderCandidate[] = [
      { id: "f1", name: "Juan Pérez" },
      { id: "f2", name: "juan perez" },
    ];
    const result = matchClientToFolders("Juan Pérez", folders);
    expect(result.type).toBe("EXACT_MATCH");
    expect(result.candidates).toEqual([{ id: "f1", name: "Juan Pérez" }]);
  });
});

describe("matchClientToFolders — AMBIGUOUS (el caso de seguridad central)", () => {
  it("Juan Pérez / Juan Perez / JUAN PEREZ / 'Juan Pérez 2025' -- ninguna es exacta, y solo 3 de 4 normalizan igual: AMBIGUOUS", () => {
    const folders: DriveFolderCandidate[] = [
      { id: "f1", name: "Juan Perez" },
      { id: "f2", name: "JUAN PEREZ" },
      { id: "f3", name: "Juan Pérez 2025" },
    ];
    const result = matchClientToFolders("Juan Pérez", folders);
    // "Juan Pérez 2025" normaliza distinto ("juan perez 2025" != "juan perez"),
    // así que el nivel NORMALIZED_MATCH solo ve f1 y f2 -- pero son 2
    // candidatos, por lo tanto AMBIGUOUS, nunca se elige uno solo.
    expect(result.type).toBe("AMBIGUOUS");
    expect(result.candidates.map((c) => c.id).sort()).toEqual(["f1", "f2"]);
  });

  it("nunca hace matching parcial/por token: 'Juan Pérez 2025' no coincide con 'Juan Pérez' salvo texto idéntico", () => {
    const result = matchClientToFolders("Juan Pérez", [{ id: "f1", name: "Juan Pérez 2025" }]);
    expect(result.type).toBe("NO_MATCH");
  });
});

describe("matchClientToFolders — NO_MATCH", () => {
  it("ninguna carpeta relacionada: NO_MATCH con lista vacía de candidatos", () => {
    const result = matchClientToFolders("Juan Pérez", [{ id: "f1", name: "María López" }]);
    expect(result.type).toBe("NO_MATCH");
    expect(result.candidates).toEqual([]);
  });

  it("sin carpetas en absoluto: NO_MATCH", () => {
    const result = matchClientToFolders("Juan Pérez", []);
    expect(result.type).toBe("NO_MATCH");
  });
});

describe("computeOnboardingPreview — clasifica las 5 categorías sin mutar nada (dry-run)", () => {
  const folders: DriveFolderCandidate[] = [
    { id: "f1", name: "Ana Torres" }, // exact match con cliente c1
    { id: "f2", name: "maria lopez" }, // normalized match con cliente c2 ("María López")
    { id: "f3", name: "pedro ruiz" }, // ninguna es exacta con "Pedro Ruiz"; ambas
    { id: "f4", name: "PEDRO RUIZ" }, // normalizan igual -> ambiguo con cliente c3
    { id: "f5", name: "Carpeta huérfana sin cliente" },
  ];
  const clients = [
    { id: "c1", name: "Ana Torres", driveFolderId: null },
    { id: "c2", name: "María López", driveFolderId: null },
    { id: "c3", name: "Pedro Ruiz", driveFolderId: null },
    { id: "c4", name: "Cliente sin carpeta", driveFolderId: null },
  ];
  const preview = computeOnboardingPreview(clients, folders);

  it("Ana Torres cae en linked (EXACT_MATCH)", () => {
    expect(preview.linked).toHaveLength(1);
    expect(preview.linked[0].clientId).toBe("c1");
    expect(preview.linked[0].folder.id).toBe("f1");
  });

  it("María López cae en suggested (NORMALIZED_MATCH), no se autoconfirma", () => {
    expect(preview.suggested).toHaveLength(1);
    expect(preview.suggested[0].clientId).toBe("c2");
  });

  it("Pedro Ruiz cae en ambiguous con 2 candidatos, no se elige ninguno", () => {
    expect(preview.ambiguous).toHaveLength(1);
    expect(preview.ambiguous[0].clientId).toBe("c3");
    expect(preview.ambiguous[0].candidates).toHaveLength(2);
  });

  it("Cliente sin carpeta cae en withoutFolder", () => {
    expect(preview.withoutFolder).toEqual([{ clientId: "c4", clientName: "Cliente sin carpeta" }]);
  });

  it("la carpeta huérfana (f5) queda en unclaimedFolders", () => {
    expect(preview.unclaimedFolders.map((f) => f.id)).toContain("f5");
  });

  it("las carpetas ambiguas (f3/f4) NO se marcan como reclamadas: siguen visibles como huérfanas hasta que el Admin resuelva", () => {
    const unclaimedIds = preview.unclaimedFolders.map((f) => f.id);
    expect(unclaimedIds).toContain("f3");
    expect(unclaimedIds).toContain("f4");
  });
});

describe("computeOnboardingPreview — un cliente ya vinculado (drive_folder_id persistido) no se reclasifica", () => {
  it("respeta el vínculo existente aunque el nombre del cliente o de la carpeta ya no coincidan textualmente", () => {
    const folders: DriveFolderCandidate[] = [{ id: "f1", name: "Nombre cambiado en Drive" }];
    const clients = [{ id: "c1", name: "Nombre cambiado en el CRM", driveFolderId: "f1" }];
    const preview = computeOnboardingPreview(clients, folders);
    expect(preview.linked).toEqual([
      { clientId: "c1", clientName: "Nombre cambiado en el CRM", folder: folders[0] },
    ]);
    expect(preview.suggested).toEqual([]);
    expect(preview.ambiguous).toEqual([]);
  });
});
