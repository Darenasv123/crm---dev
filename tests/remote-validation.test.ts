/**
 * remote-validation.test.ts
 *
 * Validación técnica de tablas AI y flujos de análisis contra Supabase.
 * Solo se ejecuta cuando se proveen explícitamente las variables de entorno
 * de autorización — nunca durante CI ni npm run test estándar.
 *
 * Uso:
 *   $env:ALLOW_REMOTE_TESTS="true"
 *   $env:SUPABASE_PROJECT_REF="<ref del proyecto>"
 *   $env:REMOTE_TEST_CONFIRMATION="WRITE_TO_REMOTE_SUPABASE"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service role key>"
 *   $env:VITE_SUPABASE_URL="https://<ref>.supabase.co"
 *   $env:VITE_SUPABASE_ANON_KEY="<anon key>"
 *   npm run test:remote
 *
 * IMPORTANTE: Todas las credenciales deben provenir de variables de entorno.
 * Nunca hardcodear URLs, claves ni referencias de proyecto en este archivo.
 */

import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const allowRemote = process.env.ALLOW_REMOTE_TESTS === "true";
const projectRef = process.env.SUPABASE_PROJECT_REF ?? "";
const remoteConfirmation = process.env.REMOTE_TEST_CONFIRMATION ?? "";
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const EXPECTED_CONFIRMATION = "WRITE_TO_REMOTE_SUPABASE";

// Todas las condiciones deben cumplirse explícitamente
const isAuthorized =
  allowRemote &&
  remoteConfirmation === EXPECTED_CONFIRMATION &&
  projectRef.length > 0 &&
  supabaseUrl.length > 0 &&
  anonKey.length > 0 &&
  serviceKey.length > 0;

describe.runIf(isAuthorized)("Validación remota de tablas AI contra Supabase", () => {
  const adminClient = createClient(supabaseUrl, serviceKey);
  const anonClient = createClient(supabaseUrl, anonKey);

  const TEST_PREFIX = `TEST_RUN_${Date.now()}`;
  const TEST_JOB_ID = crypto.randomUUID();
  const TEST_RUN_ID = crypto.randomUUID();
  const TEST_FINDING_1 = crypto.randomUUID();
  const TEST_FINDING_2 = crypto.randomUUID();
  const TEST_REF_ID = crypto.randomUUID();

  it("inserta registros técnicos controlados de prueba con UUID dinámicos", async () => {
    try {
      const { data: job, error: jobErr } = await adminClient
        .from("import_jobs")
        .insert({ id: TEST_JOB_ID, name: `${TEST_PREFIX}_JOB`, status: "completed" })
        .select()
        .single();
      expect(jobErr).toBeNull();
      expect(job.id).toBe(TEST_JOB_ID);

      const { data: run, error: runErr } = await adminClient
        .from("ai_analysis_runs")
        .insert({
          id: TEST_RUN_ID,
          import_job_id: TEST_JOB_ID,
          analysis_type: "folder_consolidation",
          model_provider: "mock",
          model_name: "mock-v1",
          prompt_version: "1.0",
          status: "completed",
        })
        .select()
        .single();
      expect(runErr).toBeNull();
      expect(run.id).toBe(TEST_RUN_ID);

      const { data: finding1, error: f1Err } = await adminClient
        .from("ai_findings")
        .insert({
          id: TEST_FINDING_1,
          analysis_run_id: TEST_RUN_ID,
          finding_type: "client_name",
          field_name: "Nombre del Cliente",
          proposed_value: JSON.stringify(`${TEST_PREFIX}_CLIENT`),
          confidence_score: 0.95,
          verification_status: "pending",
        })
        .select()
        .single();
      expect(f1Err).toBeNull();
      expect(finding1.id).toBe(TEST_FINDING_1);

      const { data: finding2, error: f2Err } = await adminClient
        .from("ai_findings")
        .insert({
          id: TEST_FINDING_2,
          analysis_run_id: TEST_RUN_ID,
          finding_type: "case_number",
          field_name: "Número de Expediente",
          proposed_value: JSON.stringify(`${TEST_PREFIX}_EXP`),
          confidence_score: 0.88,
          verification_status: "pending",
        })
        .select()
        .single();
      expect(f2Err).toBeNull();
      expect(finding2.id).toBe(TEST_FINDING_2);

      const { data: ref, error: refErr } = await adminClient
        .from("source_references")
        .insert({
          id: TEST_REF_ID,
          entity_type: "ai_finding",
          entity_id: TEST_FINDING_1,
          field_name: "Nombre del Cliente",
          source_page: 1,
          source_excerpt: `${TEST_PREFIX}_EXCERPT`,
          confidence_score: 0.95,
        })
        .select()
        .single();
      expect(refErr).toBeNull();
      expect(ref.id).toBe(TEST_REF_ID);
    } finally {
      await adminClient.from("source_references").delete().eq("id", TEST_REF_ID);
      await adminClient.from("ai_findings").delete().in("id", [TEST_FINDING_1, TEST_FINDING_2]);
      await adminClient.from("ai_analysis_runs").delete().eq("id", TEST_RUN_ID);
      await adminClient.from("import_jobs").delete().eq("id", TEST_JOB_ID);
    }
  });

  it("persiste actualizaciones de decisión humana (Aprobación, Edición, Rechazo)", async () => {
    try {
      await adminClient
        .from("import_jobs")
        .insert({ id: TEST_JOB_ID, name: `${TEST_PREFIX}_JOB2`, status: "completed" });
      await adminClient.from("ai_analysis_runs").insert({
        id: TEST_RUN_ID,
        import_job_id: TEST_JOB_ID,
        analysis_type: "folder_consolidation",
        model_provider: "mock",
        model_name: "mock-v1",
        prompt_version: "1.0",
        status: "completed",
      });
      await adminClient.from("ai_findings").insert({
        id: TEST_FINDING_1,
        analysis_run_id: TEST_RUN_ID,
        finding_type: "client_name",
        field_name: "Nombre del Cliente",
        proposed_value: JSON.stringify(`${TEST_PREFIX}_CLIENT`),
        confidence_score: 0.95,
        verification_status: "pending",
      });
      await adminClient.from("ai_findings").insert({
        id: TEST_FINDING_2,
        analysis_run_id: TEST_RUN_ID,
        finding_type: "case_number",
        field_name: "Número de Expediente",
        proposed_value: JSON.stringify(`${TEST_PREFIX}_EXP`),
        confidence_score: 0.88,
        verification_status: "pending",
      });

      const now = new Date().toISOString();

      const { data: approved, error: appErr } = await adminClient
        .from("ai_findings")
        .update({ verification_status: "approved", reviewed_at: now, review_notes: "Aprobado" })
        .eq("id", TEST_FINDING_1)
        .select()
        .single();
      expect(appErr).toBeNull();
      expect(approved.verification_status).toBe("approved");

      const { data: edited, error: edErr } = await adminClient
        .from("ai_findings")
        .update({
          verification_status: "edited",
          normalized_value: JSON.stringify("Juan Pérez Test Editado"),
          reviewed_at: now,
        })
        .eq("id", TEST_FINDING_1)
        .select()
        .single();
      expect(edErr).toBeNull();
      expect(edited.verification_status).toBe("edited");

      const { data: rejected, error: rejErr } = await adminClient
        .from("ai_findings")
        .update({ verification_status: "rejected", review_notes: "Rechazado" })
        .eq("id", TEST_FINDING_2)
        .select()
        .single();
      expect(rejErr).toBeNull();
      expect(rejected.verification_status).toBe("rejected");
    } finally {
      await adminClient.from("ai_findings").delete().in("id", [TEST_FINDING_1, TEST_FINDING_2]);
      await adminClient.from("ai_analysis_runs").delete().eq("id", TEST_RUN_ID);
      await adminClient.from("import_jobs").delete().eq("id", TEST_JOB_ID);
    }
  });

  it("verifica que el rol anon recibe error de permisos al intentar consultar datos", async () => {
    const { error: anonReadErr } = await anonClient.from("ai_findings").select("*");
    expect(anonReadErr).not.toBeNull();
    expect(anonReadErr?.code).toBe("42501");

    const { error: anonWriteErr } = await anonClient
      .from("ai_findings")
      .update({ verification_status: "approved" })
      .eq("id", TEST_FINDING_1);
    expect(anonWriteErr).not.toBeNull();
    expect(anonWriteErr?.code).toBe("42501");
  });
});

describe("Estado de autorización para tests remotos", () => {
  it("informa si las variables de entorno de autorización están configuradas", () => {
    if (!isAuthorized) {
      const missing: string[] = [];
      if (process.env.ALLOW_REMOTE_TESTS !== "true") missing.push("ALLOW_REMOTE_TESTS=true");
      if (!projectRef) missing.push("SUPABASE_PROJECT_REF");
      if (remoteConfirmation !== EXPECTED_CONFIRMATION)
        missing.push(`REMOTE_TEST_CONFIRMATION=${EXPECTED_CONFIRMATION}`);
      if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
      if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
      if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

      console.info(
        "\n📋 Tests remotos omitidos. Variables faltantes:\n" +
          missing.map((v) => `   • ${v}`).join("\n") +
          "\n",
      );
    }
    expect(true).toBe(true);
  });
});
