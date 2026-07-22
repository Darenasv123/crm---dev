import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const allowRemote = process.env.ALLOW_REMOTE_TESTS === "true";
const projectRef = process.env.SUPABASE_PROJECT_REF;
const remoteConfirmation = process.env.REMOTE_TEST_CONFIRMATION;

const EXPECTED_PROJECT_REF = "pnqdgwpxcxngeueosmnh";
const EXPECTED_CONFIRMATION = "WRITE_TO_REMOTE_SUPABASE";

const isAuthorized =
  allowRemote &&
  projectRef === EXPECTED_PROJECT_REF &&
  remoteConfirmation === EXPECTED_CONFIRMATION;

describe.runIf(isAuthorized)("Validación remota de Fase 2A contra Supabase", () => {
  const url = process.env.VITE_SUPABASE_URL || `https://${EXPECTED_PROJECT_REF}.supabase.co`;
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBucWRnd3B4Y3huZ2V1ZW9zbW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDEwMTMsImV4cCI6MjA5ODMxNzAxM30._IQph5gAHaCwdOEDlG-uGmjiciZ1aJQxxCsQAk9GZiY";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBucWRnd3B4Y3huZ2V1ZW9zbW5oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjc0MTAxMywiZXhwIjoyMDk4MzE3MDEzfQ.CeRyOo1oexbAktyvRADPYKD3qDviLknQb8lu_4jYcvo";

  const adminClient = createClient(url, serviceKey);
  const anonClient = createClient(url, anonKey);

  const TEST_PREFIX = `TEST_RUN_${Date.now()}`;
  const TEST_JOB_ID = crypto.randomUUID();
  const TEST_RUN_ID = crypto.randomUUID();
  const TEST_FINDING_1 = crypto.randomUUID();
  const TEST_FINDING_2 = crypto.randomUUID();
  const TEST_REF_ID = crypto.randomUUID();

  it("inserta registros técnicos controlados de prueba con UUID dinámicos", async () => {
    try {
      // 1. import_jobs
      const { data: job, error: jobErr } = await adminClient
        .from("import_jobs")
        .insert({
          id: TEST_JOB_ID,
          name: `${TEST_PREFIX}_JOB`,
          status: "completed",
        })
        .select()
        .single();
      expect(jobErr).toBeNull();
      expect(job.id).toBe(TEST_JOB_ID);

      // 2. ai_analysis_runs
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

      // 3. ai_findings
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

      // 4. source_references
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
      // Limpieza garantizada en teardown
      await adminClient.from("source_references").delete().eq("id", TEST_REF_ID);
      await adminClient.from("ai_findings").delete().in("id", [TEST_FINDING_1, TEST_FINDING_2]);
      await adminClient.from("ai_analysis_runs").delete().eq("id", TEST_RUN_ID);
      await adminClient.from("import_jobs").delete().eq("id", TEST_JOB_ID);
    }
  });

  it("persiste actualizaciones de decisión humana (Aprobación, Edición, Rechazo, Conflicto)", async () => {
    try {
      // Setup para decisión
      await adminClient.from("import_jobs").insert({ id: TEST_JOB_ID, name: `${TEST_PREFIX}_JOB2`, status: "completed" });
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

      // Aprobar
      const { data: approved, error: appErr } = await adminClient
        .from("ai_findings")
        .update({
          verification_status: "approved",
          reviewed_at: now,
          review_notes: "Aprobado en prueba técnica",
        })
        .eq("id", TEST_FINDING_1)
        .select()
        .single();
      expect(appErr).toBeNull();
      expect(approved.verification_status).toBe("approved");

      // Editar
      const { data: edited, error: edErr } = await adminClient
        .from("ai_findings")
        .update({
          verification_status: "edited",
          normalized_value: JSON.stringify("Juan Pérez Test Editado"),
          reviewed_at: now,
          review_notes: "Editado en prueba técnica",
        })
        .eq("id", TEST_FINDING_1)
        .select()
        .single();
      expect(edErr).toBeNull();
      expect(edited.verification_status).toBe("edited");

      // Rechazar
      const { data: rejected, error: rejErr } = await adminClient
        .from("ai_findings")
        .update({
          verification_status: "rejected",
          review_notes: "Rechazado en prueba técnica",
        })
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

  it("verifica que el rol anon recibe 42501 permission denied al intentar consultar o modificar datos", async () => {
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
