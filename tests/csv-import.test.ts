import { describe, expect, it } from "vitest";
import { parseClientCsvText } from "@/lib/client-csv-import";

describe("importación compacta de clientes", () => {
  it("lee nombre, contacto, correo y estado", () => {
    const rows = parseClientCsvText(
      [
        "nombre,telefono,correo,estado",
        "Cliente Uno,987-654-321,CLIENTE@EXAMPLE.TEST,activo",
        "Cliente Dos,,,en espera",
      ].join("\n"),
    );
    expect(rows).toEqual([
      {
        name: "Cliente Uno",
        phone: "987654321",
        email: "cliente@example.test",
        status: "Activo",
        valid: true,
      },
      {
        name: "Cliente Dos",
        phone: "",
        email: "",
        status: "En espera",
        valid: true,
      },
    ]);
  });

  it("marca filas con correo inválido", () => {
    const [row] = parseClientCsvText("nombre,correo\nCliente Uno,correo-invalido");
    expect(row.valid).toBe(false);
    expect(row.error).toMatch(/correo válido/);
  });

  it("respeta comas dentro de valores entre comillas", () => {
    const [row] = parseClientCsvText('nombre,telefono\n"Cliente, Uno",987654321');
    expect(row.name).toBe("Cliente, Uno");
  });
});
