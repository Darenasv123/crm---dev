/**
 * bootstrap-staging-first-admin.test.ts
 *
 * Pruebas de scripts/bootstrap-staging-first-admin.mjs (Fase
 * 8I-B2B-0B2B-I2-I3/I3H). CERO llamadas de red reales: el cliente Admin de
 * Supabase se sustituye siempre por un mock encadenable que registra cada
 * operación y resuelve con respuestas preconfiguradas, en el mismo orden
 * en que el flujo real las invoca:
 *
 *   1. from("profiles") select count           -> prestate: profiles vacío
 *   2. from("profiles") select count eq eq      -> prestate: admins activos
 *   3. auth.admin.listUsers(...)                -> búsqueda de huérfano por email
 *   4. auth.admin.createUser(...)               -> (solo si no es dry-run)
 *   5. from("profiles") select eq maybeSingle   -> verificación del trigger
 *   6. from("profiles") update eq select        -> promoción
 *   7. from("profiles") select count eq eq      -> predicado global final
 */

import { describe, expect, it, vi } from "vitest";
import {
  AUTH_LOOKUP_MAX_PAGES,
  AUTH_LOOKUP_PAGE_SIZE,
  BootstrapGuardError,
  DRY_RUN_TRUE_VALUE,
  EMAIL_MUST_CONTAIN_SUBSTRING,
  EXECUTION_CONFIRMATION_VALUE,
  MIGRATION_WINDOW_CONFIRMATION_VALUE,
  MIN_PASSWORD_LENGTH,
  STAGING_HOST,
  STAGING_PROJECT_REF,
  bootstrapFirstAdmin,
  buildCreateUserPayload,
  findExistingAuthUserByEmail,
  validateEmail,
  validateExecutionConfirmation,
  validateMigrationWindowConfirmation,
  validatePassword,
  validateTargetGuard,
  verifyInitialProfileShape,
} from "../scripts/bootstrap-staging-first-admin.mjs";

const VALID_ENV = {
  SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-for-tests",
  EXPECTED_STAGING_SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
  STAGING_BOOTSTRAP_CONFIRM: EXECUTION_CONFIRMATION_VALUE,
  STAGING_BOOTSTRAP_MIGRATION_WINDOW: MIGRATION_WINDOW_CONFIRMATION_VALUE,
};

const VALID_PASSWORD = "a-very-long-transient-password-123";
const VALID_EMAIL = "bootstrap+staging@example.com";

type FromResponse = { data?: unknown; error?: { message: string } | null; count?: number | null };
type ListUsersResponse = {
  data: { users: Array<{ id: string; email?: string }> } | null;
  error: { message: string } | null;
};

interface RecordedOp {
  table: string;
  ops: Array<{ method: string; args: unknown[] }>;
}

interface MockChain extends PromiseLike<FromResponse> {
  select: (...args: unknown[]) => MockChain;
  eq: (...args: unknown[]) => MockChain;
  update: (...args: unknown[]) => MockChain;
  maybeSingle: () => Promise<FromResponse>;
}

function makeMockAdminClient(options: {
  fromResponses: FromResponse[];
  createUserResponse?: { data: { user: { id: string } | null }; error: { message: string } | null };
  deleteUserResponse?: { error: { message: string } | null };
  listUsersResponses?: ListUsersResponse[];
}) {
  const calls: RecordedOp[] = [];
  let fromCallIndex = 0;
  let listUsersCallIndex = 0;

  function chain(response: FromResponse, record: RecordedOp): MockChain {
    const obj: MockChain = {
      select: (...args: unknown[]) => {
        record.ops.push({ method: "select", args });
        return obj;
      },
      eq: (...args: unknown[]) => {
        record.ops.push({ method: "eq", args });
        return obj;
      },
      update: (...args: unknown[]) => {
        record.ops.push({ method: "update", args });
        return obj;
      },
      maybeSingle: () => {
        record.ops.push({ method: "maybeSingle", args: [] });
        return Promise.resolve(response);
      },
      then: (onfulfilled, onrejected) => Promise.resolve(response).then(onfulfilled, onrejected),
    };
    return obj;
  }

  const client = {
    from: (table: string) => {
      const record: RecordedOp = { table, ops: [] };
      calls.push(record);
      const response = options.fromResponses[fromCallIndex] ?? {
        data: null,
        error: null,
        count: 0,
      };
      fromCallIndex += 1;
      return chain(response, record);
    },
    auth: {
      admin: {
        createUser: vi.fn(
          async () => options.createUserResponse ?? { data: { user: null }, error: null },
        ),
        deleteUser: vi.fn(async () => options.deleteUserResponse ?? { error: null }),
        listUsers: vi.fn(async () => {
          const response = options.listUsersResponses?.[listUsersCallIndex] ?? {
            data: { users: [] },
            error: null,
          };
          listUsersCallIndex += 1;
          return response;
        }),
      },
    },
    __calls: calls,
  };
  return client;
}

/** Respuestas felices por defecto para las dos lecturas de prestate + verificación + promoción + predicado final. */
function happyPathFromResponses(userId: string): FromResponse[] {
  return [
    { count: 0, error: null }, // 1. profiles count (vacío)
    { count: 0, error: null }, // 2. active admins precount (vacío)
    { data: { id: userId, role: "Personal", status: "Activo" }, error: null }, // 5. trigger verify
    { data: [{ id: userId, role: "Administrador", status: "Activo" }], error: null }, // 6. promoción
    { count: 1, error: null }, // 7. predicado global final
  ];
}

describe("validateTargetGuard()", () => {
  it("acepta el entorno de staging válido", () => {
    expect(validateTargetGuard(VALID_ENV)).toEqual({ ok: true, errors: [] });
  });

  it("rechaza un host de producción/legacy", () => {
    const result = validateTargetGuard({
      ...VALID_ENV,
      SUPABASE_URL: "https://supabase.consoldi.com",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /denylist/i.test(e))).toBe(true);
  });

  it("rechaza un ref de staging incorrecto (wrong staging ref)", () => {
    const result = validateTargetGuard({
      ...VALID_ENV,
      SUPABASE_URL: "https://some-other-project.supabase.co",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(STAGING_HOST))).toBe(true);
  });

  it("rechaza si EXPECTED_STAGING_SUPABASE_PROJECT_REF falta (ahora requerido, no opcional)", () => {
    const { EXPECTED_STAGING_SUPABASE_PROJECT_REF, ...rest } = VALID_ENV;
    const result = validateTargetGuard(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("EXPECTED_STAGING_SUPABASE_PROJECT_REF"))).toBe(
      true,
    );
  });

  it("rechaza EXPECTED_STAGING_SUPABASE_PROJECT_REF inconsistente", () => {
    const result = validateTargetGuard({
      ...VALID_ENV,
      EXPECTED_STAGING_SUPABASE_PROJECT_REF: "pnqdgwpxcxngeueosmnh",
    });
    expect(result.ok).toBe(false);
  });

  it("rechaza si falta SUPABASE_SERVICE_ROLE_KEY (missing service role)", () => {
    const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = VALID_ENV;
    const result = validateTargetGuard(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
  });

  it("no expone ningún parámetro de anulación (--force-production no existe en la firma)", () => {
    expect(validateTargetGuard.length).toBe(1);
  });
});

describe("validateExecutionConfirmation() / validateMigrationWindowConfirmation()", () => {
  it("rechaza si STAGING_BOOTSTRAP_CONFIRM falta", () => {
    const { STAGING_BOOTSTRAP_CONFIRM, ...rest } = VALID_ENV;
    expect(validateExecutionConfirmation(rest).ok).toBe(false);
  });

  it("rechaza si STAGING_BOOTSTRAP_CONFIRM no es exactamente el valor esperado", () => {
    const result = validateExecutionConfirmation({
      ...VALID_ENV,
      STAGING_BOOTSTRAP_CONFIRM: "yes please",
    });
    expect(result.ok).toBe(false);
  });

  it("acepta el valor exacto de confirmación", () => {
    expect(validateExecutionConfirmation(VALID_ENV)).toEqual({ ok: true, errors: [] });
  });

  it("rechaza si STAGING_BOOTSTRAP_MIGRATION_WINDOW falta o no coincide exactamente", () => {
    const { STAGING_BOOTSTRAP_MIGRATION_WINDOW, ...rest } = VALID_ENV;
    expect(validateMigrationWindowConfirmation(rest).ok).toBe(false);
    expect(
      validateMigrationWindowConfirmation({
        ...VALID_ENV,
        STAGING_BOOTSTRAP_MIGRATION_WINDOW: "wrong",
      }).ok,
    ).toBe(false);
  });

  it("acepta el valor exacto de ventana de migración", () => {
    expect(validateMigrationWindowConfirmation(VALID_ENV)).toEqual({ ok: true, errors: [] });
  });
});

describe("validatePassword() / validateEmail()", () => {
  it("falla si falta la contraseña (missing password rejected)", () => {
    expect(() => validatePassword(undefined)).toThrow(BootstrapGuardError);
  });

  it("falla si la contraseña es más corta que el mínimo", () => {
    expect(() => validatePassword("short")).toThrow(BootstrapGuardError);
  });

  it(`acepta una contraseña de al menos ${MIN_PASSWORD_LENGTH} caracteres`, () => {
    expect(() => validatePassword(VALID_PASSWORD)).not.toThrow();
  });

  it("el mensaje de error de contraseña nunca contiene la contraseña en sí", () => {
    const secret = "super-secret-password-value-xyz";
    try {
      validatePassword(secret.slice(0, 3)); // demasiado corta
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });

  it("falla si el email no contiene el marcador de staging exigido", () => {
    expect(() => validateEmail("real.person@gmail.com")).toThrow(
      new RegExp(EMAIL_MUST_CONTAIN_SUBSTRING, "i"),
    );
  });

  it("falla si el email no es sintácticamente válido", () => {
    expect(() => validateEmail("not-an-email-staging")).toThrow(BootstrapGuardError);
  });

  it("acepta un email de staging sintácticamente válido", () => {
    expect(validateEmail(VALID_EMAIL)).toBe(VALID_EMAIL);
  });
});

describe("buildCreateUserPayload()", () => {
  it("nunca incluye role, status, ni la cadena 'Administrador' en el metadata", () => {
    const payload = buildCreateUserPayload({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
      fullName: "Staging Bootstrap",
      phone: "+51999999999",
    });
    const serialized = JSON.stringify(payload.user_metadata);
    expect(serialized).not.toContain("role");
    expect(serialized).not.toContain("status");
    expect(serialized).not.toContain("Administrador");
    expect(payload.email_confirm).toBe(true); // nunca se envía email de invitación
  });
});

describe("verifyInitialProfileShape()", () => {
  it("exige role=Personal y status=Activo (initial profile must be Personal/Activo)", () => {
    expect(() =>
      verifyInitialProfileShape({ id: "u1", role: "Administrador", status: "Activo" }, "u1"),
    ).toThrow(BootstrapGuardError);
    expect(() =>
      verifyInitialProfileShape({ id: "u1", role: "Personal", status: "Activo" }, "u1"),
    ).not.toThrow();
  });

  it("exige que el id coincida exactamente", () => {
    expect(() =>
      verifyInitialProfileShape({ id: "other", role: "Personal", status: "Activo" }, "u1"),
    ).toThrow();
  });

  it("falla si no se encontró ninguna fila", () => {
    expect(() => verifyInitialProfileShape(null, "u1")).toThrow(BootstrapGuardError);
  });
});

describe("findExistingAuthUserByEmail() — paginación y fallo cerrado", () => {
  it("encuentra una coincidencia exacta en la primera página", async () => {
    const client = makeMockAdminClient({
      fromResponses: [],
      listUsersResponses: [
        { data: { users: [{ id: "u1", email: "Bootstrap+Staging@Example.com" }] }, error: null },
      ],
    });
    const found = await findExistingAuthUserByEmail(client, VALID_EMAIL, { perPage: 1000 });
    expect(found?.id).toBe("u1"); // comparación normalizada (case-insensitive, trim)
  });

  it("recorre varias páginas hasta encontrar la coincidencia (pagination)", async () => {
    const client = makeMockAdminClient({
      fromResponses: [],
      listUsersResponses: [
        {
          data: {
            users: Array.from({ length: 2 }, (_, i) => ({
              id: `p1-${i}`,
              email: `other-${i}@example.com`,
            })),
          },
          error: null,
        },
        { data: { users: [{ id: "u2", email: VALID_EMAIL }] }, error: null },
      ],
    });
    const found = await findExistingAuthUserByEmail(client, VALID_EMAIL, { perPage: 2 });
    expect(found?.id).toBe("u2");
  });

  it("devuelve null si se agota la lista sin coincidencia", async () => {
    const client = makeMockAdminClient({
      fromResponses: [],
      listUsersResponses: [
        { data: { users: [{ id: "x", email: "someone-else@example.com" }] }, error: null },
      ],
    });
    const found = await findExistingAuthUserByEmail(client, VALID_EMAIL, { perPage: 1000 });
    expect(found).toBeNull();
  });

  it("falla cerrado (no adivina) si se excede maxPages sin llegar a la última página", async () => {
    const fullPage = {
      data: { users: [{ id: "x", email: "someone-else@example.com" }] },
      error: null,
    };
    const client = makeMockAdminClient({
      fromResponses: [],
      listUsersResponses: [fullPage, fullPage, fullPage],
    });
    await expect(
      findExistingAuthUserByEmail(client, VALID_EMAIL, { perPage: 1, maxPages: 2 }),
    ).rejects.toThrow(/Exceeded 2 page/i);
  });

  it("usa los valores por defecto exportados de página/máximo de páginas", () => {
    expect(AUTH_LOOKUP_PAGE_SIZE).toBeGreaterThan(0);
    expect(AUTH_LOOKUP_MAX_PAGES).toBeGreaterThan(0);
  });
});

describe("bootstrapFirstAdmin() — flujo feliz", () => {
  it("crea, verifica el trigger, promueve por ID exacto, y confirma exactamente un admin activo", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const client = makeMockAdminClient({
      fromResponses: happyPathFromResponses(userId),
      createUserResponse: { data: { user: { id: userId } }, error: null },
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "Staging Bootstrap",
    });

    expect(result).toEqual({ outcome: "CREATED", userId, email: VALID_EMAIL });
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(client.auth.admin.listUsers).toHaveBeenCalledTimes(1);

    // exact-ID promotion only: la llamada .eq() del update() debe usar userId
    const updateCall = client.__calls.find((c) => c.ops.some((o) => o.method === "update"));
    expect(updateCall).toBeDefined();
    const eqAfterUpdate = updateCall!.ops.find((o) => o.method === "eq");
    expect(eqAfterUpdate!.args).toEqual(["id", userId]);
  });
});

describe("bootstrapFirstAdmin() — puerta de confirmación de ejecución (Sección 4/9)", () => {
  it("sin STAGING_BOOTSTRAP_CONFIRM: cero llamadas remotas de ningún tipo", async () => {
    const { STAGING_BOOTSTRAP_CONFIRM, ...envWithoutConfirm } = VALID_ENV;
    const client = makeMockAdminClient({ fromResponses: [] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: envWithoutConfirm,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_EXECUTION_NOT_CONFIRMED");
    expect(client.__calls).toHaveLength(0);
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
    expect(client.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("con STAGING_BOOTSTRAP_CONFIRM incorrecto: cero llamadas remotas", async () => {
    const client = makeMockAdminClient({ fromResponses: [] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: { ...VALID_ENV, STAGING_BOOTSTRAP_CONFIRM: "not-the-right-value" },
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_EXECUTION_NOT_CONFIRMED");
    expect(client.__calls).toHaveLength(0);
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("con la confirmación exacta, el flujo pasa la puerta y continúa (cubierto por el flujo feliz)", () => {
    expect(VALID_ENV.STAGING_BOOTSTRAP_CONFIRM).toBe(EXECUTION_CONFIRMATION_VALUE);
  });

  it("sin STAGING_BOOTSTRAP_MIGRATION_WINDOW correcto: cero llamadas remotas", async () => {
    const client = makeMockAdminClient({ fromResponses: [] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: { ...VALID_ENV, STAGING_BOOTSTRAP_MIGRATION_WINDOW: "wrong" },
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_MIGRATION_WINDOW_NOT_CONFIRMED");
    expect(client.__calls).toHaveLength(0);
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe("bootstrapFirstAdmin() — modo dry-run (Sección 5)", () => {
  it("ejecuta guards y lecturas pero nunca createUser/UPDATE/deleteUser", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null }, // profiles count
        { count: 0, error: null }, // active admins precount
      ],
    });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: { ...VALID_ENV, STAGING_BOOTSTRAP_DRY_RUN: DRY_RUN_TRUE_VALUE },
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("DRY_RUN_OK");
    if (result.outcome === "DRY_RUN_OK") {
      expect(result.wouldCreateEmail).toBe(VALID_EMAIL);
    }
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(client.__calls.some((c) => c.ops.some((o) => o.method === "update"))).toBe(false);
  });

  it("dry-run NO requiere STAGING_BOOTSTRAP_CONFIRM (no se gana seguridad exigiéndolo, ya no escribe)", async () => {
    const { STAGING_BOOTSTRAP_CONFIRM, ...envWithoutConfirm } = VALID_ENV;
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
    });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: { ...envWithoutConfirm, STAGING_BOOTSTRAP_DRY_RUN: DRY_RUN_TRUE_VALUE },
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("DRY_RUN_OK");
  });

  it("dry-run sigue reportando un aborto de prestate si profiles ya tiene filas", async () => {
    const client = makeMockAdminClient({ fromResponses: [{ count: 3, error: null }] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: { ...VALID_ENV, STAGING_BOOTSTRAP_DRY_RUN: DRY_RUN_TRUE_VALUE },
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_PRESTATE_NOT_EMPTY");
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe("bootstrapFirstAdmin() — detección de usuario Auth huérfano preexistente (Sección 6/7)", () => {
  it("aborta con BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS si ya existe un Auth user para el email, sin crear nada", async () => {
    const preexistingId = "99999999-9999-9999-9999-999999999999";
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null }, // profiles count
        { count: 0, error: null }, // active admins precount
      ],
      listUsersResponses: [
        { data: { users: [{ id: preexistingId, email: VALID_EMAIL }] }, error: null },
      ],
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    expect(result.outcome).toBe("BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS");
    if (result.outcome === "BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS") {
      expect(result.userId).toBe(preexistingId);
      expect(result.email).toBe(VALID_EMAIL);
    }
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("NUNCA borra automáticamente un usuario Auth preexistente", async () => {
    const preexistingId = "88888888-8888-8888-8888-888888888888";
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
      listUsersResponses: [
        { data: { users: [{ id: preexistingId, email: VALID_EMAIL }] }, error: null },
      ],
    });

    await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

describe("bootstrapFirstAdmin() — guards y aborts", () => {
  it("rechaza un objetivo de producción sin llamar a createUser (production target rejected)", async () => {
    const client = makeMockAdminClient({ fromResponses: [] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: { ...VALID_ENV, SUPABASE_URL: "https://supabase.consoldi.com" },
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_TARGET_GUARD");
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("aborta si public.profiles ya tiene filas, sin llamar a createUser (existing profile causes abort / idempotencia)", async () => {
    const client = makeMockAdminClient({ fromResponses: [{ count: 1, error: null }] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_PRESTATE_NOT_EMPTY");
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("un segundo re-run con profiles > 0 también aborta (no crea un segundo admin automáticamente)", async () => {
    const client = makeMockAdminClient({ fromResponses: [{ count: 1, error: null }] });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_PRESTATE_NOT_EMPTY");
  });

  it("aborta si profiles está vacío pero ya existe un admin activo (prestate inconsistente)", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 1, error: null },
      ],
    });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_PRESTATE_ADMIN_EXISTS");
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("un fallo de createUser no promueve nada (createUser failure causes no promotion)", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
      createUserResponse: {
        data: { user: null },
        error: { message: "simulated createUser failure" },
      },
    });
    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });
    expect(result.outcome).toBe("ABORTED_CREATE_USER_FAILED");
    // Solo dos llamadas a from() ocurrieron (prestate) — ninguna de
    // verificación/promoción, porque createUser falló antes.
    expect(client.__calls).toHaveLength(2);
  });
});

describe("bootstrapFirstAdmin() — compensación tras fallo entre createUser y promoción confirmada (scope: CURRENT_RUN)", () => {
  const userId = "22222222-2222-2222-2222-222222222222";

  it("si la verificación del trigger falla, compensa borrando el auth user creado EN ESTA CORRIDA (fail path)", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null }, // prestate profiles
        { count: 0, error: null }, // prestate active admins
        { data: null, error: null }, // trigger verify: NINGUNA fila -> falla
      ],
      createUserResponse: { data: { user: { id: userId } }, error: null },
      deleteUserResponse: { error: null },
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    if (result.outcome !== "COMPENSATED") throw new Error(`unexpected outcome: ${result.outcome}`);
    expect(result.scope).toBe("CURRENT_RUN");
    expect(result.deletedUserId).toBe(userId);
    expect(client.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
  });

  it("si la promoción falla, compensa borrando el auth user creado (promotion failure follows compensation path)", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 0, error: null },
        { data: { id: userId, role: "Personal", status: "Activo" }, error: null }, // trigger verify OK
        { data: [], error: null }, // promotion UPDATE afecta 0 filas -> falla
      ],
      createUserResponse: { data: { user: { id: userId } }, error: null },
      deleteUserResponse: { error: null },
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    expect(result.outcome).toBe("COMPENSATED");
    expect(client.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
  });

  it("si el conteo global de admins activos tras la promoción no es exactamente 1, compensa igualmente", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 0, error: null },
        { data: { id: userId, role: "Personal", status: "Activo" }, error: null },
        { data: [{ id: userId, role: "Administrador", status: "Activo" }], error: null },
        { count: 2, error: null }, // inesperado: no puede ser 2 en este bootstrap
      ],
      createUserResponse: { data: { user: { id: userId } }, error: null },
      deleteUserResponse: { error: null },
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    expect(result.outcome).toBe("COMPENSATED");
  });

  it("si la propia compensación (deleteUser) falla, reporta BOOTSTRAP_PARTIAL_USER_CREATED (scope CURRENT_RUN) sin adivinar más", async () => {
    const client = makeMockAdminClient({
      fromResponses: [
        { count: 0, error: null },
        { count: 0, error: null },
        { data: null, error: null }, // trigger verify falla
      ],
      createUserResponse: { data: { user: { id: userId } }, error: null },
      deleteUserResponse: { error: { message: "simulated deleteUser failure" } },
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    if (result.outcome !== "BOOTSTRAP_PARTIAL_USER_CREATED") {
      throw new Error(`unexpected outcome: ${result.outcome}`);
    }
    expect(result.scope).toBe("CURRENT_RUN");
    expect(result.userId).toBe(userId);
    expect(result.manualRecoverySteps.length).toBeGreaterThan(0);
    // Nunca debe incluir la contraseña en ninguna parte del resultado.
    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
  });
});

describe("bootstrapFirstAdmin() — nunca expone secretos", () => {
  it("el resultado serializado nunca contiene SUPABASE_SERVICE_ROLE_KEY ni la contraseña", async () => {
    const userId = "33333333-3333-3333-3333-333333333333";
    const client = makeMockAdminClient({
      fromResponses: happyPathFromResponses(userId),
      createUserResponse: { data: { user: { id: userId } }, error: null },
    });

    const result = await bootstrapFirstAdmin({
      adminClient: client,
      env: VALID_ENV,
      password: VALID_PASSWORD,
      email: VALID_EMAIL,
      fullName: "X",
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(VALID_PASSWORD);
    expect(serialized).not.toContain(VALID_ENV.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("STAGING_BOOTSTRAP_CONFIRM y STAGING_BOOTSTRAP_MIGRATION_WINDOW no son secretos: pueden aparecer en errores", () => {
    const result = validateExecutionConfirmation({
      ...VALID_ENV,
      STAGING_BOOTSTRAP_CONFIRM: "wrong",
    });
    expect(result.errors[0]).toContain(EXECUTION_CONFIRMATION_VALUE);
  });
});
