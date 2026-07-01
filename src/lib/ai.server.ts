import OpenAI from "openai";
import { readServerEnv } from "./env-server";
import {
  buildSystemPrompt,
  GROQ_MODEL,
  type ChatContext,
  type ChatHistoryTurn,
} from "./ai";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function getGroqApiKey(): string {
  return readServerEnv("GROQ_API_KEY");
}

function getKeySetupError(): string | undefined {
  const key = getGroqApiKey();
  if (!key) return "GROQ_API_KEY no configurada en el servidor.";
  if (!key.startsWith("gsk_")) return "GROQ_API_KEY inválida — debe empezar con gsk_";
  return undefined;
}

export function isGroqConfigured(): boolean {
  return getKeySetupError() === undefined;
}

export function formatGroqError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (raw.includes("401") || raw.includes("invalid_api_key") || raw.includes("Unauthorized")) {
    return "API key de Groq inválida. Verifica que copiaste bien la clave desde console.groq.com.";
  }
  if (raw.includes("429") || raw.includes("rate_limit") || raw.includes("Rate limit")) {
    return "Límite de solicitudes alcanzado (Groq free: 30 rpm). Espera unos segundos e intenta de nuevo.";
  }
  if (raw.includes("model_not_found") || raw.includes("404")) {
    return `Modelo ${GROQ_MODEL} no disponible. Verifica tu cuenta en console.groq.com.`;
  }
  if (raw.includes("GROQ_API_KEY no configurada")) {
    return raw;
  }

  return raw;
}

export async function generateChatResponse(
  message: string,
  history: ChatHistoryTurn[],
  context: ChatContext,
): Promise<string> {
  const setupError = getKeySetupError();
  if (setupError) throw new Error(setupError);

  // Groq uses an OpenAI-compatible API — reuse the installed openai SDK
  const client = new OpenAI({
    apiKey: getGroqApiKey(),
    baseURL: GROQ_BASE_URL,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(context) },
    ...history.map(turn => ({
      role: turn.role as "user" | "assistant",
      content: turn.content,
    })),
    { role: "user", content: message },
  ];

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  });

  return completion.choices[0]?.message?.content ?? "";
}
