type EnvRecord = Record<string, string | boolean | undefined>;

function envRecord(): EnvRecord {
  return import.meta.env as EnvRecord;
}

/**
 * Reads a server secret across Node dev, Vite build injection, and Cloudflare Workers.
 * Lovable injects VITE_* at build time; Cloudflare may expose secrets via process.env at runtime.
 */
export function readServerEnv(name: string): string {
  const viteName = `VITE_${name}`;
  const meta = envRecord();

  const fromMeta =
    (typeof meta[name] === "string" ? meta[name] : undefined) ??
    (typeof meta[viteName] === "string" ? meta[viteName] : undefined);

  return (
    fromMeta ??
    process.env[name] ??
    process.env[viteName] ??
    ""
  ).trim();
}
