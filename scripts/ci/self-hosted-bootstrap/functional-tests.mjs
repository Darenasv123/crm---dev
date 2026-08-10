import { createClient } from "@supabase/supabase-js";

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const suffix = (process.env.CI_RUN_SUFFIX ?? "local-ci").replace(/[^a-zA-Z0-9-]/g, "-");

if (!url || !anonKey || !serviceKey) throw new Error("Disposable Supabase credentials are missing");

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const anon = createClient(url, anonKey, options);
const service = createClient(url, serviceKey, options);
const password = "Ci-only-Password-47!";

function pass(label) {
  console.log(`PASS ${label}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  pass(label);
}

async function required(label, operation) {
  const result = await operation;
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  pass(label);
  return result.data;
}

async function signedIn(email) {
  const client = createClient(url, anonKey, options);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Disposable user sign-in failed");
  return client;
}

async function createTestUser(label, metadata = {}) {
  const email = `crm-ci-${label}-${suffix}@example.invalid`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `CI ${label}`, ...metadata },
  });
  if (error || !data.user) throw new Error(`Could not create disposable ${label} user`);
  return { id: data.user.id, email };
}

async function profile(id) {
  return required(
    "service_role reads profile",
    service.from("profiles").select("id, role, status").eq("id", id).single(),
  );
}

async function expectNoVisibleRows(label, query) {
  const { data, error } = await query;
  assert(Boolean(error) || !data || data.length === 0, label);
}

const health = await fetch(`${url}/auth/v1/health`);
assert(health.ok, "Auth health endpoint is operational");

const adminUser = await createTestUser("admin", { role: "Administrador" });
const personalUser = await createTestUser("personal");
const personalTwoUser = await createTestUser("personal-two");

assert(
  (await profile(adminUser.id)).role === "Personal",
  "malicious signup metadata cannot grant Admin",
);

await required(
  "service_role performs first-admin bootstrap",
  service
    .from("profiles")
    .update({ role: "Administrador" })
    .eq("id", adminUser.id)
    .select()
    .single(),
);

const admin = await signedIn(adminUser.email);
const personal = await signedIn(personalUser.email);
const personalTwo = await signedIn(personalTwoUser.email);

await personal
  .from("profiles")
  .update({ role: "Administrador", status: "Activo" })
  .eq("id", personalUser.id)
  .select();
assert(
  (await profile(personalUser.id)).role === "Personal",
  "Personal cannot escalate profile role",
);

const clientA = await required(
  "Admin creates Client A",
  admin
    .from("clients")
    .insert({ name: "CI Client A", initials: "CA", created_by: adminUser.id })
    .select()
    .single(),
);
const clientB = await required(
  "Admin creates Client B",
  admin
    .from("clients")
    .insert({ name: "CI Client B", initials: "CB", created_by: adminUser.id })
    .select()
    .single(),
);

const personalClient = await required(
  "Personal creates operational client",
  personal
    .from("clients")
    .insert({ name: "CI Personal Client", initials: "PC", created_by: personalUser.id })
    .select()
    .single(),
);
await required(
  "Personal updates operational client",
  personal
    .from("clients")
    .update({ phone: "000000000" })
    .eq("id", personalClient.id)
    .select()
    .single(),
);
await personal.from("clients").delete().eq("id", personalClient.id);
const retainedClient = await required(
  "service_role verifies Personal delete was denied",
  service.from("clients").select("id").eq("id", personalClient.id).single(),
);
assert(retainedClient.id === personalClient.id, "Personal cannot delete clients");

await required(
  "Admin can manage another profile",
  admin
    .from("profiles")
    .update({ status: "Inactivo" })
    .eq("id", personalTwoUser.id)
    .select()
    .single(),
);
await expectNoVisibleRows(
  "inactive user receives no operational rows",
  personalTwo.from("clients").select("id"),
);
await required(
  "Admin reactivates test profile",
  admin
    .from("profiles")
    .update({ status: "Activo" })
    .eq("id", personalTwoUser.id)
    .select()
    .single(),
);

await expectNoVisibleRows("anon cannot read private clients", anon.from("clients").select("id"));

const caseA = await required(
  "Admin creates Case A",
  admin
    .from("cases")
    .insert({
      client_id: clientA.id,
      expediente: "CI-A-001",
      process_type: "Civil",
      created_by: adminUser.id,
    })
    .select()
    .single(),
);
const caseB = await required(
  "Personal creates Case B",
  personal
    .from("cases")
    .insert({
      client_id: clientB.id,
      expediente: "CI-B-001",
      process_type: "Familia",
      created_by: personalUser.id,
    })
    .select()
    .single(),
);

const task = await required(
  "Admin creates available task",
  admin
    .from("case_tasks")
    .insert({
      case_id: caseA.id,
      client_id: clientA.id,
      title: "CI task",
      created_by: adminUser.id,
    })
    .select()
    .single(),
);
const claimed = await required(
  "Personal claims task",
  personal.rpc("claim_case_task", { p_task_id: task.id }),
);
assert(
  claimed.length === 1 &&
    claimed[0].assigned_to === personalUser.id &&
    claimed[0].claimed_by === personalUser.id &&
    claimed[0].claimed_at &&
    claimed[0].started_at,
  "claim populates assignment, claim and start fields",
);
const returned = await required(
  "Personal returns task",
  personal.rpc("return_case_task", { p_task_id: task.id }),
);
assert(
  returned[0].status === "pending" && returned[0].assigned_to === null,
  "return restores pending queue state",
);
await required("Personal reclaims task", personal.rpc("claim_case_task", { p_task_id: task.id }));
const completed = await required(
  "Personal completes own task",
  personal
    .from("case_tasks")
    .update({ status: "completed", description: "CI complete" })
    .eq("id", task.id)
    .select()
    .single(),
);
assert(
  completed.completed_at && completed.completed_by === personalUser.id,
  "completion populates completed_at and completed_by",
);
const taskHistory = await required(
  "task history is recorded",
  service.from("case_task_history").select("id").eq("task_id", task.id),
);
assert(taskHistory.length >= 3, "claim, return and completion produced task history");

const concurrentTask = await required(
  "Admin creates concurrent-claim task",
  admin
    .from("case_tasks")
    .insert({
      case_id: caseA.id,
      client_id: clientA.id,
      title: "CI concurrent",
      created_by: adminUser.id,
    })
    .select()
    .single(),
);
const claimAttempts = await Promise.all([
  personal.rpc("claim_case_task", { p_task_id: concurrentTask.id }),
  personalTwo.rpc("claim_case_task", { p_task_id: concurrentTask.id }),
]);
assert(
  claimAttempts.filter((attempt) => !attempt.error).length === 1,
  "concurrent claim has exactly one winner",
);

const invalidTask = await admin.from("case_tasks").insert({
  case_id: caseB.id,
  client_id: clientA.id,
  title: "CI invalid relationship",
  created_by: adminUser.id,
});
assert(Boolean(invalidTask.error), "task client/case mismatch is rejected");

const document = await required(
  "Admin creates document metadata",
  admin
    .from("documents")
    .insert({
      name: "CI document.pdf",
      type: "Demanda",
      document_type: "Demanda",
      size: "12 KB",
      storage_path: `ci/${suffix}/document.pdf`,
      client_id: clientA.id,
      case_id: caseA.id,
      created_by: adminUser.id,
    })
    .select()
    .single(),
);
await required(
  "Admin edits document metadata",
  admin
    .from("documents")
    .update({
      name: "CI document edited.pdf",
      type: "Resolución",
      document_type: "Resolución",
      verification_status: "edited",
    })
    .eq("id", document.id)
    .select()
    .single(),
);
const documentHistory = await required(
  "document metadata history is recorded",
  service.from("document_change_history").select("id").eq("document_id", document.id),
);
assert(documentHistory.length === 1, "document audit creates one non-recursive history row");
const invalidDocument = await admin.from("documents").insert({
  name: "CI invalid.pdf",
  type: "Otros",
  size: "1 KB",
  storage_path: `ci/${suffix}/invalid.pdf`,
  client_id: clientA.id,
  case_id: caseB.id,
});
assert(Boolean(invalidDocument.error), "document client/case mismatch is rejected");

const payment = await required(
  "Admin creates payment plan",
  admin
    .from("payments")
    .insert({ client_id: clientA.id, case_id: caseA.id, service: "CI service", fees: 100 })
    .select()
    .single(),
);
const personalPayment = await personal.rpc("register_payment_record_atomic", {
  p_payment_id: payment.id,
  p_amount: 10,
  p_method: "CI",
});
assert(Boolean(personalPayment.error), "Personal cannot register payments");
await required(
  "Admin registers atomic payment",
  admin.rpc("register_payment_record_atomic", {
    p_payment_id: payment.id,
    p_amount: 25,
    p_method: "CI",
  }),
);
const overpayment = await admin.rpc("register_payment_record_atomic", {
  p_payment_id: payment.id,
  p_amount: 100,
  p_method: "CI",
});
assert(Boolean(overpayment.error), "overpayment is rejected");

const lockedPayment = await required(
  "Admin creates locking payment plan",
  admin
    .from("payments")
    .insert({ client_id: clientA.id, case_id: caseA.id, service: "CI locking", fees: 100 })
    .select()
    .single(),
);
const concurrentPayments = await Promise.all([
  admin.rpc("register_payment_record_atomic", {
    p_payment_id: lockedPayment.id,
    p_amount: 60,
    p_method: "CI-A",
  }),
  admin.rpc("register_payment_record_atomic", {
    p_payment_id: lockedPayment.id,
    p_amount: 60,
    p_method: "CI-B",
  }),
]);
assert(
  concurrentPayments.filter((attempt) => !attempt.error).length === 1,
  "payment row locking prevents concurrent overpay",
);

const adminPath = `ci/${suffix}/admin.txt`;
const personalPath = `ci/${suffix}/personal.txt`;
await required(
  "Admin uploads Storage object",
  admin.storage
    .from("documents")
    .upload(adminPath, new Blob(["admin-ci"]), { contentType: "text/plain" }),
);
await required(
  "Personal reads Storage object",
  personal.storage.from("documents").download(adminPath),
);
await required(
  "Personal uploads Storage object",
  personal.storage
    .from("documents")
    .upload(personalPath, new Blob(["personal-ci"]), { contentType: "text/plain" }),
);
await required(
  "Personal updates Storage object",
  personal.storage.from("documents").upload(personalPath, new Blob(["personal-ci-updated"]), {
    contentType: "text/plain",
    upsert: true,
  }),
);
await personal.storage.from("documents").remove([personalPath]);
await required(
  "Personal delete is ineffective and object remains",
  service.storage.from("documents").download(personalPath),
);
const anonDownload = await anon.storage.from("documents").download(adminPath);
assert(Boolean(anonDownload.error), "anon cannot download private Storage objects");
await required(
  "Admin deletes Storage objects",
  admin.storage.from("documents").remove([adminPath, personalPath]),
);

const connection = await required(
  "Admin creates Google Calendar connection structure",
  admin
    .from("google_calendar_connections")
    .insert({
      connected_by: adminUser.id,
      calendar_id: "ci-calendar",
      encrypted_refresh_token: "ci-not-a-real-token",
    })
    .select()
    .single(),
);
await expectNoVisibleRows(
  "Personal cannot read Google Calendar connection",
  personal.from("google_calendar_connections").select("id"),
);
for (const table of [
  "google_calendar_connections",
  "google_calendar_channels",
  "google_calendar_sync_log",
  "google_calendar_oauth_states",
  "google_calendar_sync_requests",
]) {
  await required(
    `service_role can inspect ${table}`,
    service.from(table).select("*", { head: true, count: "exact" }),
  );
}
await required(
  "service_role writes internal OAuth state",
  service.from("google_calendar_oauth_states").insert({
    state_hash: `ci-${suffix}`,
    requested_by: adminUser.id,
    calendar_id: connection.calendar_id,
    code_verifier: "ci-verifier",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }),
);
await expectNoVisibleRows(
  "authenticated Admin cannot read service-only OAuth state",
  admin.from("google_calendar_oauth_states").select("state_hash"),
);

const reset = await anon.auth.resetPasswordForEmail(personalUser.email, {
  redirectTo: "http://127.0.0.1:3000/restablecer-contrasena",
});
assert(!reset.error, "password recovery request is accepted by local Auth");

console.log("PASS all disposable functional tests");
