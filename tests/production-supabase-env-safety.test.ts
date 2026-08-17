import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const runtimeSupabaseFiles = [
  "src/lib/supabase.ts",
  "src/lib/auth-server.ts",
  "src/lib/profiles.functions.ts",
  "src/lib/zip-import/import-engine.server.ts",
];

describe("production Supabase environment safety", () => {
  it("does not contain the legacy Supabase Cloud project in runtime code", () => {
    for (const file of runtimeSupabaseFiles) {
      expect(source(file)).not.toContain("pnqdgwpxcxngeueosmnh");
    }
  });

  it("does not contain hardcoded JWT credentials in Supabase runtime modules", () => {
    const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

    for (const file of runtimeSupabaseFiles) {
      expect(source(file)).not.toMatch(jwtPattern);
    }
  });

  it("server environment reader never falls back automatically to VITE variables", () => {
    const envServer = source("src/lib/env-server.ts");

    expect(envServer).not.toContain("VITE_${name}");
    expect(envServer).not.toContain("process.env[viteName]");
    expect(envServer).not.toContain("meta[viteName]");
  });

  it("production validator requires the server anon key", () => {
    const validator = source("scripts/validate-production-env.mjs");

    expect(validator).toContain('name: "SUPABASE_ANON_KEY"');
  });
});
