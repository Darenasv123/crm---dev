import { z } from "zod";
import type { Database } from "@/lib/database.types";

export const CLIENT_STATUS_OPTIONS = ["Activo", "En espera", "Cerrado"] as const;
export const DOCUMENT_TYPE_OPTIONS = ["DNI", "RUC", "CE", "Pasaporte", "Otro"] as const;

export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

export type ClientFormValues = {
  name: string;
  document_type: string;
  document_number: string;
  phone: string;
  whatsapp: string;
  email: string;
  occupation: string;
  process_type: string;
  status: string;
  address: string;
  notes: string;
};

export type ClientDuplicateMatch = {
  clientId: string;
  clientName: string;
  reason: string;
  strength: "exact" | "approximate";
};

const emailSchema = z.string().email("Ingresa un correo valido.").or(z.literal(""));

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
  const documentType = input.document_type.trim() || "DNI";
  return {
    name: input.name.trim().replace(/\s+/g, " "),
    document_type: documentType,
    document_number: normalizeDigits(input.document_number),
    phone: normalizeDigits(input.phone),
    whatsapp: normalizeDigits(input.whatsapp),
    email: input.email.trim().toLowerCase(),
    occupation: input.occupation.trim(),
    process_type: input.process_type.trim(),
    status: input.status.trim() || "Activo",
    address: input.address.trim(),
    notes: input.notes.trim(),
  };
}

export function buildClientInitials(name: string) {
  const words = normalizeClientForm({
    name,
    document_type: "DNI",
    document_number: "",
    phone: "",
    whatsapp: "",
    email: "",
    occupation: "",
    process_type: "",
    status: "Activo",
    address: "",
    notes: "",
  }).name.split(/\s+/);
  return (
    (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "CL").slice(0, 2))
      .toUpperCase()
      .slice(0, 2) || "CL"
  );
}

export function validateClientForm(input: ClientFormValues): ClientFormValues {
  const form = normalizeClientForm(input);
  if (!form.name) throw new Error("Ingresa el nombre completo o razon social.");
  if (!form.process_type) throw new Error("Describe el proceso o materia principal del cliente.");
  if (!form.document_number) throw new Error("Ingresa el DNI o RUC del cliente.");

  const docType = form.document_type.toUpperCase();
  if (docType === "DNI" && form.document_number.length !== 8) {
    throw new Error("El DNI debe tener exactamente 8 digitos.");
  }
  if (docType === "RUC" && form.document_number.length !== 11) {
    throw new Error("El RUC debe tener exactamente 11 digitos.");
  }
  if (docType !== "DNI" && docType !== "RUC" && form.document_number.length < 6) {
    throw new Error("El documento debe tener al menos 6 digitos.");
  }

  if (form.phone.length !== 9) throw new Error("El telefono principal debe tener 9 digitos.");
  if (form.whatsapp && form.whatsapp.length !== 9) {
    throw new Error("El telefono alternativo debe tener 9 digitos.");
  }
  const emailResult = emailSchema.safeParse(form.email);
  if (!emailResult.success) {
    throw new Error(emailResult.error.issues[0]?.message ?? "Ingresa un correo valido.");
  }
  return form;
}

export function findClientDuplicates(
  input: ClientFormValues,
  clients: ClientRow[],
  excludeId?: string,
): ClientDuplicateMatch[] {
  const form = normalizeClientForm(input);
  const documentNumber = form.document_number;
  const phone = form.phone;
  const whatsapp = form.whatsapp;
  const email = form.email;
  const name = normalizeText(form.name);
  const matches = new Map<string, ClientDuplicateMatch>();

  function add(client: ClientRow, reason: string, strength: ClientDuplicateMatch["strength"]) {
    if (client.id === excludeId || matches.has(client.id)) return;
    matches.set(client.id, { clientId: client.id, clientName: client.name, reason, strength });
  }

  for (const client of clients) {
    const clientDoc = normalizeDigits(client.document_number || client.dni);
    const clientPhone = normalizeDigits(client.phone);
    const clientWhatsapp = normalizeDigits(client.whatsapp);
    const clientEmail = (client.email ?? "").trim().toLowerCase();
    const clientName = normalizeText(client.name);

    if (documentNumber && clientDoc && documentNumber === clientDoc) {
      add(client, "Mismo DNI/RUC", "exact");
      continue;
    }
    if (phone && (phone === clientPhone || phone === clientWhatsapp)) {
      add(client, "Mismo telefono", "exact");
      continue;
    }
    if (whatsapp && (whatsapp === clientPhone || whatsapp === clientWhatsapp)) {
      add(client, "Mismo telefono alternativo", "exact");
      continue;
    }
    if (email && clientEmail && email === clientEmail) {
      add(client, "Mismo correo", "exact");
      continue;
    }
    if (name && clientName && name === clientName) {
      add(client, "Mismo nombre normalizado", "exact");
      continue;
    }

    const nameTokens = new Set(name.split(" ").filter((token) => token.length > 2));
    const clientTokens = new Set(clientName.split(" ").filter((token) => token.length > 2));
    const shared = [...nameTokens].filter((token) => clientTokens.has(token)).length;
    const denominator = Math.max(1, Math.min(nameTokens.size, clientTokens.size));
    if (shared >= 2 && shared / denominator >= 0.75) {
      add(client, "Nombre muy parecido", "approximate");
    }
  }

  return [...matches.values()];
}
