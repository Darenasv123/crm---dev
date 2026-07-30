let runtimeBindings: Record<string, unknown> = {};

export function setServerRuntimeEnv(bindings: unknown) {
  if (bindings && typeof bindings === "object") {
    runtimeBindings = bindings as Record<string, unknown>;
  }
}

export function readServerRuntimeEnv(name: string) {
  const binding = runtimeBindings[name];
  if (typeof binding === "string" && binding.trim()) return binding.trim();
  return (process.env[name] ?? "").trim();
}
