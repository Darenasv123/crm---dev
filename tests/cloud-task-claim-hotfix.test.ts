import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSql = (path: string) => readFileSync(path, "utf8");

const migration = readSql("supabase/migrations/20260811103000_align_cloud_task_claim_contract.sql");
const tables = readSql("supabase/self-hosted/0003_domain_tables.sql");
const functions = readSql("supabase/self-hosted/0004_functions_and_rpc.sql");
const grants = readSql("supabase/self-hosted/0006_rls_and_grants.sql");

function functionBlock(sql: string, name: string) {
  return sql.match(
    new RegExp(`create(?: or replace)? function public\\.${name}\\([^]*?\\n\\$\\$;`, "i"),
  )?.[0];
}

function normalizeFunction(sql: string | undefined) {
  return sql
    ?.replace(/^create or replace function/i, "create function")
    .replace(/\s+/g, " ")
    .trim();
}

describe("hotfix Cloud del contrato de toma de tareas", () => {
  it("serializa la migración, limita esperas y recarga el esquema PostgREST", () => {
    expect(migration).toContain("set local lock_timeout = '10s'");
    expect(migration).toContain("set local statement_timeout = '120s'");
    expect(migration).toContain("hashtext('crm_align_cloud_task_claim_contract_20260811')");
    expect(migration).toContain("notify pgrst, 'reload schema'");
    expect(migration.indexOf("set local lock_timeout")).toBeGreaterThan(
      migration.indexOf("begin;"),
    );
    expect(migration.indexOf("notify pgrst")).toBeLessThan(migration.lastIndexOf("commit;"));
  });

  it("añade las columnas, FK e índice del modelo canónico de forma idempotente", () => {
    expect(tables).toContain("claimed_at timestamptz");
    expect(tables).toContain("claimed_by uuid references public.profiles(id) on delete set null");
    expect(migration).toContain("add column if not exists claimed_at timestamptz");
    expect(migration).toContain("add column if not exists claimed_by uuid");
    expect(migration).toContain("constraint case_tasks_claimed_by_fkey");
    expect(migration).toContain("references public.profiles(id)");
    expect(migration).toContain("on delete set null");
    expect(migration).toContain("create index if not exists case_tasks_claimed_by_idx");
    expect(migration).toContain("where claimed_by is not null");
  });

  it.each(["guard_case_task_update", "claim_case_task", "return_case_task"])(
    "mantiene %s semánticamente idéntica al bootstrap canónico",
    (name) => {
      expect(normalizeFunction(functionBlock(migration, name))).toBe(
        normalizeFunction(functionBlock(functions, name)),
      );
    },
  );

  it("reemplaza sólo firmas RPC incompatibles y usa CREATE OR REPLACE", () => {
    expect(migration).toContain("to_regprocedure('public.claim_case_task(uuid)')");
    expect(migration).toContain("to_regprocedure('public.return_case_task(uuid)')");
    expect(migration).toContain("execute 'drop function public.claim_case_task(uuid)'");
    expect(migration).toContain("execute 'drop function public.return_case_task(uuid)'");
    expect(migration).toContain("create or replace function public.claim_case_task");
    expect(migration).toContain("create or replace function public.return_case_task");
    expect(migration).not.toMatch(/drop function[^;]+cascade/i);
    expect(migration).toContain("returns setof public.case_tasks");
  });

  it("replica las ACL canónicas sin exponer las RPC a PUBLIC ni anon", () => {
    for (const name of ["claim_case_task", "return_case_task"]) {
      expect(grants).toContain(`grant execute on function public.${name}(uuid) to authenticated`);
      expect(migration).toContain(
        `revoke all on function public.${name}(uuid) from public, anon, authenticated`,
      );
      expect(migration).toContain(
        `grant execute on function public.${name}(uuid) to authenticated`,
      );
      expect(migration).toContain(`grant execute on function public.${name}(uuid) to service_role`);
      expect(migration).not.toMatch(
        new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to (?:public|anon)`, "i"),
      );
    }
  });

  it("no contiene operaciones destructivas de datos", () => {
    expect(migration).not.toMatch(/^\s*(?:delete|truncate|drop table)\b/gim);
    expect(migration).not.toMatch(/^\s*update\s+public\.case_tasks(?!\s+t)/gim);
    expect(migration).not.toMatch(/^\s*drop function[^;]+\bcascade\b/gim);
  });
});
