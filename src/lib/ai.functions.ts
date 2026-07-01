import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "./auth-server";
import { readServerEnv } from "./env-server";
import { GROQ_MODEL } from "./ai";
import { generateChatResponse, formatGroqError } from "./ai.server";

const chatContextSchema = z.object({
  clientsCount: z.number(),
  activeCasesCount: z.number(),
  todayEvents: z.array(z.object({
    title: z.string(),
    time: z.string(),
    type: z.string(),
    client: z.string().optional(),
  })),
  upcomingEvents: z.array(z.object({
    title: z.string(),
    date: z.string(),
    time: z.string(),
    type: z.string(),
    client: z.string().optional(),
  })),
  recentClients: z.array(z.object({
    name: z.string(),
    process_type: z.string(),
    status: z.string(),
  })),
  recentCases: z.array(z.object({
    expediente: z.string(),
    process_type: z.string(),
    status: z.string(),
    juzgado: z.string(),
    client: z.string(),
  })).optional(),
  pendingPayments: z.array(z.object({
    client: z.string(),
    service: z.string(),
    pending: z.number(),
    status: z.string(),
  })).optional(),
});

const historyTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const sendChatSchema = z.object({
  accessToken: z.string().min(1),
  message: z.string().min(1).max(8000),
  history: z.array(historyTurnSchema).max(50),
  context: chatContextSchema,
});

/** Instant key-format check — no live API call. */
export const checkAIStatus = createServerFn({ method: "GET" }).handler(async () => {
  const key = readServerEnv("GROQ_API_KEY");
  if (!key) {
    return {
      configured: false,
      model: GROQ_MODEL,
      error: "GROQ_API_KEY no configurada. Agrégala en tu .env como VITE_GROQ_API_KEY=gsk_...",
    };
  }
  if (!key.startsWith("gsk_")) {
    return {
      configured: false,
      model: GROQ_MODEL,
      error: "GROQ_API_KEY inválida — debe empezar con gsk_. Verifica en console.groq.com.",
    };
  }
  return { configured: true, model: GROQ_MODEL };
});

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator(sendChatSchema)
  .handler(async ({ data }) => {
    await requireUser(data.accessToken);
    try {
      const text = await generateChatResponse(data.message, data.history, data.context);
      return { text };
    } catch (err) {
      throw new Error(formatGroqError(err));
    }
  });
