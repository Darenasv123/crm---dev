type EnvRecord = Record<string, string | boolean | undefined>;

function envRecord(): EnvRecord {
  return import.meta.env as EnvRecord;
}

/**
 * Reads a server-only environment variable.
 *
 * Runtime Node variables from process.env take precedence.
 * import.meta.env[name] is retained only for server-side/dev compatibility.
 *
 * Server variables NEVER fall back automatically to VITE_* because VITE_*
 * values can be embedded in the client bundle.
 */
export function readServerEnv(name: string): string {
  const fromProcess = process.env[name];

  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }

  const meta = envRecord();
  const fromMeta = typeof meta[name] === "string" ? meta[name] : undefined;

  return (fromMeta ?? "").trim();
}

/**
 * Reads a required server-only environment variable.
 * Fails explicitly instead of silently using another backend.
 */
export function requireServerEnv(name: string): string {
  const value = readServerEnv(name);

  if (!value) {
    throw new Error(`${name} no configurada en el entorno del servidor.`);
  }

  return value;
}
