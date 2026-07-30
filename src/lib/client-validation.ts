import { z } from "zod";
import type { Database } from "@/lib/database.types";

export const CLIENT_STATUS_OPTIONS = ["Activo", "En espera", "Cerrado"] as const;

export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

export type ClientFormValues = {
  name: string;
  phone: string;
  email: string;
  status: string;
};

export type ClientDuplicateMatch = {
  clientId: string;
  clientName: string;
  reason: string;
  strength: "exact" | "approximate";
};

const emailSchema = z.string().email("Ingresa un correo válido.").or(z.literal(""));

export function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeClientForm(input: ClientFormValues): ClientFormValues {
  return {
    name: input.name.trim().replace(/\s+/g, " "),
    phone: normalizeDigits(input.phone),
    email: input.email.trim().toLowerCase(),
    status: input.status.trim() || "Activo",
  };
}

export function buildClientInitials(name: string) {
  const words = name.trim().replace(/\s+/g, " ").split(" ");
  return (
    (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "CL").slice(0, 2))
      .toUpperCase()
      .slice(0, 2) || "CL"
  );
}

export function validateClientForm(input: ClientFormValues): ClientFormValues {
  const form = normalizeClientForm(input);
  if (!form.name) throw new Error("Ingresa el nombre completo o razón social.");
  if (form.phone && form.phone.length !== 9) {
    throw new Error("El teléfono principal debe tener 9 dígitos.");
  }
  const emailResult = emailSchema.safeParse(form.email);
  if (!emailResult.success) {
    throw new Error(emailResult.error.issues[0]?.message ?? "Ingresa un correo válido.");
  }
  return form;
}

export function findClientDuplicates(
  input: ClientFormValues,
  clients: ClientRow[],
  excludeId?: string,
): ClientDuplicateMatch[] {
  const form = normalizeClientForm(input);
  const matches = new Map<string, ClientDuplicateMatch>();

  function add(client: ClientRow, reason: string, strength: ClientDuplicateMatch["strength"]) {
    if (client.id === excludeId || matches.has(client.id)) return;
    matches.set(client.id, { clientId: client.id, clientName: client.name, reason, strength });
  }

  for (const client of clients) {
    const phone = normalizeDigits(client.phone);
    const email = (client.email ?? "").trim().toLowerCase();
    const name = normalizeText(client.name);

    if (form.phone && phone && form.phone === phone) {
      add(client, "Mismo teléfono", "exact");
      continue;
    }
    if (form.email && email && form.email === email) {
      add(client, "Mismo correo", "exact");
      continue;
    }
    if (normalizeText(form.name) === name) {
      add(client, "Mismo nombre normalizado", "exact");
      continue;
    }

    const inputTokens = new Set(
      normalizeText(form.name)
        .split(" ")
        .filter((token) => token.length > 2),
    );
    const clientTokens = new Set(name.split(" ").filter((token) => token.length > 2));
    const shared = [...inputTokens].filter((token) => clientTokens.has(token)).length;
    const denominator = Math.max(1, Math.min(inputTokens.size, clientTokens.size));
    if (shared >= 2 && shared / denominator >= 0.75) {
      add(client, "Nombre muy parecido", "approximate");
    }
  }

  return [...matches.values()];
}
