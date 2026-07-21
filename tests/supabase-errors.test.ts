import { describe, expect, it } from "vitest";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";

describe("compatibilidad temporal con Supabase", () => {
  it("detecta una columna ausente en la caché del esquema", () => {
    expect(
      isMissingSchemaFieldError({
        code: "PGRST204",
        message: "Could not find the 'case_name' column in the schema cache",
      }),
    ).toBe(true);
  });

  it("no oculta errores de permisos", () => {
    expect(
      isMissingSchemaFieldError({
        code: "42501",
        message: "permission denied for table cases",
      }),
    ).toBe(false);
  });
});
