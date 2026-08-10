import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/self-hosted-bootstrap-validation.yml", "utf8");
const runner = readFileSync("scripts/ci/self-hosted-bootstrap/run-validation.sh", "utf8");
const preflight = readFileSync("scripts/ci/self-hosted-bootstrap/preflight.sql", "utf8");
const functional = readFileSync("scripts/ci/self-hosted-bootstrap/functional-tests.mjs", "utf8");

describe("CI desechable del bootstrap self-hosted", () => {
  it("usa runner estándar, CLI oficial fijada y disparo exclusivamente manual", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("uses: supabase/setup-cli@v3");
    expect(workflow).toContain("SUPABASE_CLI_VERSION: 2.113.0");
    expect(workflow).toMatch(/permissions:\r?\n {2}contents: read/);
  });

  it("no enlaza ni despliega proyectos remotos y no consume GitHub Secrets", () => {
    const ci = `${workflow}\n${runner}`;
    expect(ci).not.toContain("${{ secrets.");
    expect(ci).not.toMatch(/supabase\s+(?:link|db push|migration up|functions deploy)/i);
    expect(ci).not.toMatch(/SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|PROJECT_REF/);
  });

  it("mantiene el proyecto fuera de las migraciones históricas", () => {
    expect(workflow).not.toContain("${{ runner.temp }}");
    expect(workflow).toContain("- name: Configure disposable paths");
    expect(workflow).toContain('echo "STACK_ROOT=$RUNNER_TEMP/crm-bootstrap-ci" >> "$GITHUB_ENV"');
    expect(workflow).toContain(
      'echo "ARTIFACT_DIR=$RUNNER_TEMP/crm-bootstrap-artifacts" >> "$GITHUB_ENV"',
    );
    expect(runner).toContain('(cd "$STACK_ROOT" && supabase init --force)');
    expect(runner).toContain('"$REPO_ROOT"/supabase/self-hosted/000[1-7]_*.sql');
    expect(runner).not.toContain("supabase/migrations");
    expect(runner).not.toContain("tests/daily-tasks.test.ts");
    expect(runner).not.toContain("tests/crm-improvements.test.ts");
    expect(runner).not.toContain("npm run lint");
    expect(runner).toContain("./node_modules/.bin/eslint");
  });

  it("detiene el bootstrap cuando PostgreSQL no es 17.x", () => {
    expect(preflight).toContain("server_version_num");
    expect(preflight).toContain("RUNTIME_MISMATCH");
    expect(runner).toContain('fail "RUNTIME_MISMATCH"');
    expect(runner.indexOf("check_runtime_major")).toBeLessThan(runner.indexOf("apply_bootstrap 1"));
  });

  it("comprueba Supabase base y ausencia previa del CRM", () => {
    for (const expected of [
      "auth.users",
      "storage.objects",
      "storage.buckets",
      "anon",
      "authenticated",
      "service_role",
      "plpgsql",
      "gen_random_uuid",
    ]) {
      expect(preflight).toContain(expected);
    }
    expect(preflight).toContain("CRM tables already exist before bootstrap");
  });

  it("ejecuta verify y una segunda reconstrucción desde cero", () => {
    expect(runner).toContain("supabase stop --no-backup");
    expect(runner).toContain("start_stack 1");
    expect(runner).toContain("run_verify 1");
    expect(runner).toContain("start_stack 2");
    expect(runner).toContain("run_preflight 2");
    expect(runner).toContain("apply_bootstrap 2");
    expect(runner).toContain("run_verify 2");
  });

  it("clasifica resultados y conserva los cinco artifacts sanitizados", () => {
    for (const result of [
      "PASS",
      "BOOTSTRAP_FAILED",
      "VERIFY_FAILED",
      "TEST_FAILED",
      "RUNTIME_MISMATCH",
    ]) {
      expect(workflow).toContain(result);
      expect(runner).toContain(result);
    }
    for (const artifact of [
      "bootstrap-validation.log",
      "verify-output.txt",
      "runtime.txt",
      "test-results.txt",
      "result.txt",
    ]) {
      expect(workflow).toContain(artifact);
    }
    expect(runner).not.toMatch(/echo\s+.*(?:ANON_KEY|SERVICE_ROLE_KEY|status_json)/i);
  });

  it("incluye pruebas funcionales reales con datos exclusivamente ficticios", () => {
    for (const behavior of [
      "malicious signup metadata cannot grant Admin",
      "Personal cannot escalate profile role",
      "inactive user receives no operational rows",
      "concurrent claim has exactly one winner",
      "task client/case mismatch is rejected",
      "document client/case mismatch is rejected",
      "overpayment is rejected",
      "payment row locking prevents concurrent overpay",
      "anon cannot download private Storage objects",
      "authenticated Admin cannot read service-only OAuth state",
      "password recovery request is accepted by local Auth",
    ]) {
      expect(functional).toContain(behavior);
    }
    expect(functional).toContain("example.invalid");
    expect(functional).toContain("ci-not-a-real-token");
  });
});
