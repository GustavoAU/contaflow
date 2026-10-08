// TDD SPEC — SPEC-014 secciones 3-D y 4 (RN-2). Resolución de la URL de BD de los scripts verify:*.
// Riesgo: en CI estos scripts corren con credenciales de infraestructura a mano. Si caen a
// DATABASE_URL o a .env.local pueden terminar leyendo PRODUCCIÓN en un job de PR. La resolución
// debe fallar CERRADA: sin DATABASE_URL_TEST (o VERIFY_DATABASE_URL) en CI, se lanza.
//
// Orden: 1) VERIFY_DATABASE_URL  2) DATABASE_URL_TEST  3) DATABASE_URL (solo fuera de CI)
//        4) línea `DATABASE_URL=` de .env.local (solo fuera de CI).
// Vacío o solo espacios cuenta como ausente (misma regla que `||` en CLAUDE.md para env vars).
//
// Todo se inyecta (`env`, `readEnvLocal`): ningún test toca el process.env real ni el disco,
// salvo los dos de "por defecto", que usan vi.stubEnv y no leen archivos.
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveDatabaseUrl } from "../lib/db-url.mjs";

// Contraseñas marcador: distintas por origen, para saber quién ganó y para detectar fugas.
const PW_VERIFY = "pw-VERIFY-s3cr3t";
const PW_TEST = "pw-TEST-s3cr3t";
const PW_DB = "pw-DBURL-s3cr3t";
const PW_LOCAL = "pw-LOCAL-s3cr3t";
const ALL_PASSWORDS = [PW_VERIFY, PW_TEST, PW_DB, PW_LOCAL];

const mkUrl = (user: string, pw: string, host: string) =>
  `postgresql://${user}:${pw}@${host}.example.neon.tech/neondb?sslmode=require`;
const U_VERIFY = mkUrl("verify_user", PW_VERIFY, "verify");
const U_TEST = mkUrl("test_user", PW_TEST, "test");
const U_DB = mkUrl("db_user", PW_DB, "db");
const U_LOCAL = mkUrl("local_user", PW_LOCAL, "local");

type Env = Record<string, string | undefined>;

/** Contenido plausible de un .env.local con la línea DATABASE_URL entre otras claves. */
const envLocal = (url: string) =>
  ["# Local", "CLERK_SECRET_KEY=sk_test_x", `DATABASE_URL=${url}`, "OTRA=1", ""].join("\n");

/** `readEnvLocal` espía: devuelve `content` y deja constancia de si se consultó. */
function setup(env: Env, content: string | null = null) {
  const readEnvLocal = vi.fn<() => string | null>(() => content);
  return { readEnvLocal, run: () => resolveDatabaseUrl({ env, readEnvLocal }) };
}

/** Ejecuta `fn` y devuelve el error lanzado. Si no lanza, el test falla (no puede pasar en falso). */
function errorOf(fn: () => unknown): Error {
  let value: unknown;
  try {
    value = fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error(`se esperaba un error pero devolvió ${JSON.stringify(value)}`);
}

/** El error "ningún origen disponible": en español, dice QUÉ definir y NO filtra ningún valor. */
function expectClearNoOriginError(err: Error) {
  expect(err.message).toMatch(/VERIFY_DATABASE_URL/);
  expect(err.message).toMatch(/DATABASE_URL_TEST/);
  // Heurística de idioma: al menos una palabra funcional del español. El mensaje es para una
  // persona que lee un log de CI; un "No database URL available" no cumple lo pedido.
  expect(err.message).toMatch(/\b(de|la|el|una?|para|ninguna?|falta)\b/i);
  expectNoSecrets(err);
}

function expectNoSecrets(err: Error) {
  for (const pw of ALL_PASSWORDS) expect(err.message).not.toContain(pw);
  expect(err.message).not.toMatch(/postgres(ql)?:\/\//i);
  expect(err.message).not.toContain("example.neon.tech");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDatabaseUrl — orden de resolución fuera de CI", () => {
  it.each([
    [
      "VERIFY_DATABASE_URL gana a todos los demás",
      { VERIFY_DATABASE_URL: U_VERIFY, DATABASE_URL_TEST: U_TEST, DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
      U_VERIFY,
    ],
    [
      "DATABASE_URL_TEST gana a DATABASE_URL y a .env.local",
      { DATABASE_URL_TEST: U_TEST, DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
      U_TEST,
    ],
    [
      "DATABASE_URL gana a .env.local",
      { DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
      U_DB,
    ],
    [".env.local es el último recurso", {}, envLocal(U_LOCAL), U_LOCAL],
    [
      "VERIFY_DATABASE_URL gana a .env.local (sin los intermedios)",
      { VERIFY_DATABASE_URL: U_VERIFY },
      envLocal(U_LOCAL),
      U_VERIFY,
    ],
    [
      "DATABASE_URL_TEST gana a .env.local (sin DATABASE_URL)",
      { DATABASE_URL_TEST: U_TEST },
      envLocal(U_LOCAL),
      U_TEST,
    ],
    [
      "VERIFY_DATABASE_URL gana a DATABASE_URL_TEST (sin los demás)",
      { VERIFY_DATABASE_URL: U_VERIFY, DATABASE_URL_TEST: U_TEST },
      null,
      U_VERIFY,
    ],
  ] as [string, Env, string | null, string][])("%s", (_n, env, local, expected) => {
    expect(setup(env, local).run()).toBe(expected);
  });

  it.each([
    ["VERIFY_DATABASE_URL", { VERIFY_DATABASE_URL: U_VERIFY, DATABASE_URL: U_DB }],
    ["DATABASE_URL_TEST", { DATABASE_URL_TEST: U_TEST, DATABASE_URL: U_DB }],
    ["DATABASE_URL", { DATABASE_URL: U_DB }],
  ] as [string, Env][])(
    "si resuelve %s no se lee .env.local (no se toca el disco sin necesidad)",
    (_n, env) => {
      const { run, readEnvLocal } = setup(env, envLocal(U_LOCAL));
      expect(run()).toMatch(/^postgresql:\/\//);
      expect(readEnvLocal).not.toHaveBeenCalled();
    },
  );

  it("DATABASE_URL_DIRECT en env no es un origen (solo los cuatro de la spec)", () => {
    const { run } = setup({ DATABASE_URL_DIRECT: U_DB }, null);
    expectClearNoOriginError(errorOf(run));
  });
});

describe("resolveDatabaseUrl — vacío o solo espacios cuenta como ausente", () => {
  const EMPTY_LIKES = [
    ["cadena vacía", ""],
    ["solo espacios", "   "],
    ["tabulador, salto y espacio", "\t\n "],
    ["undefined (clave presente sin valor)", undefined],
  ] as [string, string | undefined][];

  it.each(EMPTY_LIKES)("VERIFY_DATABASE_URL %s -> gana DATABASE_URL_TEST", (_n, empty) => {
    const { run } = setup({ VERIFY_DATABASE_URL: empty, DATABASE_URL_TEST: U_TEST }, null);
    expect(run()).toBe(U_TEST);
  });

  it.each(EMPTY_LIKES)("DATABASE_URL_TEST %s -> gana DATABASE_URL", (_n, empty) => {
    const { run } = setup({ DATABASE_URL_TEST: empty, DATABASE_URL: U_DB }, null);
    expect(run()).toBe(U_DB);
  });

  it.each(EMPTY_LIKES)("DATABASE_URL %s -> gana .env.local", (_n, empty) => {
    const { run } = setup({ DATABASE_URL: empty }, envLocal(U_LOCAL));
    expect(run()).toBe(U_LOCAL);
  });

  it("los tres de env vacíos + .env.local sin URL -> error claro", () => {
    const { run } = setup(
      { VERIFY_DATABASE_URL: "", DATABASE_URL_TEST: " ", DATABASE_URL: "\t" },
      "OTRA=1\n",
    );
    expectClearNoOriginError(errorOf(run));
  });
});

describe("resolveDatabaseUrl — lectura de .env.local (fuera de CI, sin env)", () => {
  const U_LOCAL_QS = `${U_LOCAL}&channel_binding=require`;

  it.each([
    ["sin comillas", `DATABASE_URL=${U_LOCAL}\n`, U_LOCAL],
    ["comillas dobles envolventes", `DATABASE_URL="${U_LOCAL}"\n`, U_LOCAL],
    ["comillas simples envolventes", `DATABASE_URL='${U_LOCAL}'\n`, U_LOCAL],
    [
      "saltos de línea CRLF (Windows)",
      `OTRA=1\r\nDATABASE_URL=${U_LOCAL}\r\nULTIMA=2\r\n`,
      U_LOCAL,
    ],
    ["CRLF con comillas", `DATABASE_URL="${U_LOCAL}"\r\n`, U_LOCAL],
    ["CRLF sin salto final", `A=1\r\nDATABASE_URL=${U_LOCAL}`, U_LOCAL],
    ["última línea sin salto final", `A=1\nDATABASE_URL=${U_LOCAL}`, U_LOCAL],
    ["espacios tras el valor entrecomillado", `DATABASE_URL="${U_LOCAL}"   \n`, U_LOCAL],
    ["conserva '=' y '&' internos de la query", `DATABASE_URL=${U_LOCAL_QS}\n`, U_LOCAL_QS],
    [
      "ignora una línea comentada previa",
      `# DATABASE_URL=${U_DB}\nDATABASE_URL=${U_LOCAL}\n`,
      U_LOCAL,
    ],
    [
      "ignora DATABASE_URL_DIRECT y DATABASE_URL_TEST que vengan ANTES",
      `DATABASE_URL_DIRECT=${U_DB}\nDATABASE_URL_TEST=${U_TEST}\nDATABASE_URL=${U_LOCAL}\n`,
      U_LOCAL,
    ],
    [
      "ignora DATABASE_URL_DIRECT y DATABASE_URL_TEST que vengan DESPUÉS",
      `DATABASE_URL=${U_LOCAL}\nDATABASE_URL_DIRECT=${U_DB}\nDATABASE_URL_TEST=${U_TEST}\n`,
      U_LOCAL,
    ],
  ])("%s", (_n, content, expected) => {
    expect(setup({}, content).run()).toBe(expected);
  });

  it.each([
    ["archivo vacío", ""],
    ["sin la línea DATABASE_URL", "CLERK_SECRET_KEY=sk_test_x\nOTRA=1\n"],
    [
      "solo DATABASE_URL_DIRECT y DATABASE_URL_TEST (no coinciden: exige `DATABASE_URL=`)",
      `DATABASE_URL_DIRECT=${U_DB}\nDATABASE_URL_TEST=${U_TEST}\n`,
    ],
    ["solo una línea comentada", `# DATABASE_URL=${U_DB}\n`],
    ["valor vacío", "DATABASE_URL=\n"],
    ["comillas vacías", 'DATABASE_URL=""\n'],
    ["solo espacios (CRLF)", "DATABASE_URL=   \r\n"],
  ])("sin URL utilizable: %s -> error claro, sin filtrar valores", (_n, content) => {
    expectClearNoOriginError(errorOf(setup({}, content).run));
  });

  it(".env.local inexistente (readEnvLocal devuelve null) -> error claro", () => {
    const { run, readEnvLocal } = setup({}, null);
    expectClearNoOriginError(errorOf(run));
    expect(readEnvLocal).toHaveBeenCalled();
  });
});

describe("resolveDatabaseUrl — error cuando no hay ningún origen", () => {
  it("fuera de CI, sin nada en env y sin .env.local -> nombra VERIFY_DATABASE_URL y DATABASE_URL_TEST", () => {
    expectClearNoOriginError(errorOf(setup({}, null).run));
  });

  it.each([
    ["CI y solo DATABASE_URL", { CI: "true", DATABASE_URL: U_DB }, null],
    [
      "CI con DATABASE_URL y .env.local legible",
      { CI: "true", DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
    ],
    [
      "CI con otras URLs de BD en env que no son origen",
      {
        CI: "true",
        DATABASE_URL: U_DB,
        DATABASE_URL_DIRECT: U_VERIFY,
        DATABASE_URL_UNPOOLED: U_TEST,
      },
      null,
    ],
    [
      "fuera de CI, .env.local sin la línea pero con otras URLs",
      {},
      `DATABASE_URL_DIRECT=${U_DB}\nDATABASE_URL_TEST=${U_TEST}\n`,
    ],
    [
      "fuera de CI, vacíos en env y una URL bajo otra clave en .env.local",
      { VERIFY_DATABASE_URL: "", DATABASE_URL_TEST: " ", DATABASE_URL: "" },
      `OTRA=${U_LOCAL}\n`,
    ],
  ] as [string, Env, string | null][])(
    "el mensaje no contiene el valor de ninguna URL ni sus contraseñas: %s",
    (_n, env, local) => {
      expectClearNoOriginError(errorOf(setup(env, local).run));
    },
  );
});

describe("resolveDatabaseUrl — en CI nunca cae a DATABASE_URL ni a .env.local (RN-2)", () => {
  it("CI=true y solo DATABASE_URL en env -> lanza (NO cae)", () => {
    const { run } = setup({ CI: "true", DATABASE_URL: U_DB }, null);
    expectClearNoOriginError(errorOf(run));
  });

  it("CI=true y solo .env.local -> lanza y NO llama a readEnvLocal", () => {
    const { run, readEnvLocal } = setup({ CI: "true" }, envLocal(U_LOCAL));
    expectClearNoOriginError(errorOf(run));
    expect(readEnvLocal).not.toHaveBeenCalled();
  });

  it("CI=true con DATABASE_URL y .env.local -> lanza y NO consulta .env.local", () => {
    const { run, readEnvLocal } = setup({ CI: "true", DATABASE_URL: U_DB }, envLocal(U_LOCAL));
    expectClearNoOriginError(errorOf(run));
    expect(readEnvLocal).not.toHaveBeenCalled();
  });

  it("CI=true y DATABASE_URL_TEST -> devuelve ese, aunque haya DATABASE_URL y .env.local", () => {
    const { run, readEnvLocal } = setup(
      { CI: "true", DATABASE_URL_TEST: U_TEST, DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
    );
    expect(run()).toBe(U_TEST);
    expect(readEnvLocal).not.toHaveBeenCalled();
  });

  it("CI=true y VERIFY_DATABASE_URL -> devuelve ese, aunque haya DATABASE_URL_TEST", () => {
    const { run } = setup(
      { CI: "true", VERIFY_DATABASE_URL: U_VERIFY, DATABASE_URL_TEST: U_TEST, DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
    );
    expect(run()).toBe(U_VERIFY);
  });

  it("CI=true: vacío cuenta como ausente, así que VERIFY/TEST vacíos NO habilitan DATABASE_URL", () => {
    const { run, readEnvLocal } = setup(
      { CI: "true", VERIFY_DATABASE_URL: "", DATABASE_URL_TEST: "  ", DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
    );
    expectClearNoOriginError(errorOf(run));
    expect(readEnvLocal).not.toHaveBeenCalled();
  });

  it("CI=true y DATABASE_URL_DIRECT (lo exporta ci-neon-branch) no es un origen", () => {
    const { run } = setup({ CI: "true", DATABASE_URL_DIRECT: U_TEST }, null);
    expectClearNoOriginError(errorOf(run));
  });

  describe("valores de CI que cuentan como CI (no vacío y distinto de 'false' y '0')", () => {
    it.each(["true", "1", "yes", "TRUE"])("CI=%j + solo DATABASE_URL -> lanza", (ci) => {
      const { run, readEnvLocal } = setup({ CI: ci, DATABASE_URL: U_DB }, envLocal(U_LOCAL));
      expectClearNoOriginError(errorOf(run));
      expect(readEnvLocal).not.toHaveBeenCalled();
    });
  });

  describe("valores de CI que NO cuentan como CI ('false', '0', vacío, ausente)", () => {
    const NOT_CI = [
      ["false", "false"],
      ["0", "0"],
      ["cadena vacía", ""],
      ["ausente", undefined],
    ] as [string, string | undefined][];

    it.each(NOT_CI)("CI=%s + solo DATABASE_URL -> devuelve DATABASE_URL", (_n, ci) => {
      expect(setup({ CI: ci, DATABASE_URL: U_DB }, null).run()).toBe(U_DB);
    });

    it.each(NOT_CI)("CI=%s + solo .env.local -> lee .env.local", (_n, ci) => {
      const { run, readEnvLocal } = setup({ CI: ci }, envLocal(U_LOCAL));
      expect(run()).toBe(U_LOCAL);
      expect(readEnvLocal).toHaveBeenCalled();
    });

    it.each(NOT_CI)("CI=%s + nada disponible -> error claro", (_n, ci) => {
      expectClearNoOriginError(errorOf(setup({ CI: ci }, null).run));
    });
  });
});

describe("resolveDatabaseUrl — por defecto usa process.env", () => {
  it("sin opts.env lee process.env (VERIFY_DATABASE_URL)", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("VERIFY_DATABASE_URL", U_VERIFY);
    const readEnvLocal = vi.fn<() => string | null>(() => null);
    expect(resolveDatabaseUrl({ readEnvLocal })).toBe(U_VERIFY);
  });

  it("sin opts.env deduce CI de process.env.CI: con CI=true no cae a DATABASE_URL", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("VERIFY_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL_TEST", "");
    vi.stubEnv("DATABASE_URL", U_DB);
    const readEnvLocal = vi.fn<() => string | null>(() => envLocal(U_LOCAL));
    expectClearNoOriginError(errorOf(() => resolveDatabaseUrl({ readEnvLocal })));
    expect(readEnvLocal).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Revisión de seguridad de SPEC-014 (security-agent, L-1 y L-2).
// ─────────────────────────────────────────────────────────────────────────────

// L-1: `neon()` incluye el valor ENTERO en su error cuando no es una URL ("Connection string:
// <valor>"); con un secreto mal pegado eso vuelca una contraseña al log. Por eso la forma se
// valida AQUÍ y el mensaje es fijo: nombra el origen, nunca el valor.
const LEAK = "pw-LEAK-s3cr3t";

describe("resolveDatabaseUrl — valida la forma de la URL sin filtrar el valor (L-1)", () => {
  const BAD = [
    ["texto que no es una URL", `no-es-una-url ${LEAK}`],
    ["esquema que no es PostgreSQL", `mysql://u:${LEAK}@host.example.neon.tech/db`],
    ["URL de PostgreSQL sin host", `postgresql://u:${LEAK}@/db`],
    ["esquema http", `https://u:${LEAK}@host.example.neon.tech/db`],
  ] as [string, string][];

  const ORIGINS = [
    ["VERIFY_DATABASE_URL", (v: string) => setup({ VERIFY_DATABASE_URL: v }, null)],
    ["DATABASE_URL_TEST", (v: string) => setup({ DATABASE_URL_TEST: v }, null)],
    ["DATABASE_URL", (v: string) => setup({ DATABASE_URL: v }, null)],
    [".env.local", (v: string) => setup({}, `DATABASE_URL=${v}\n`)],
  ] as [string, (v: string) => ReturnType<typeof setup>][];

  for (const [origin, make] of ORIGINS) {
    it.each(BAD)(`${origin}: %s -> error fijo, sin el valor`, (_n, value) => {
      const err = errorOf(make(value).run);
      expect(err.message).not.toContain(LEAK);
      expect(err.message).not.toContain(value);
      expect(err.message).toContain(origin);
      expect(err.message).toMatch(/\b(de|la|el|una?|no|se)\b/i);
    });
  }

  it("acepta los esquemas postgres:// y postgresql://", () => {
    const pg = "postgres://u:pw-ok@host.example.neon.tech/db";
    expect(setup({ DATABASE_URL_TEST: pg }, null).run()).toBe(pg);
    expect(setup({ DATABASE_URL_TEST: U_TEST }, null).run()).toBe(U_TEST);
  });

  it("un origen de mayor prioridad inválido NO cae al siguiente (no oculta el error)", () => {
    const { run } = setup({ VERIFY_DATABASE_URL: `basura ${LEAK}`, DATABASE_URL_TEST: U_TEST }, null);
    expect(errorOf(run).message).toContain("VERIFY_DATABASE_URL");
  });
});

// L-2: `CI=false` / `CI=0` es una convención común para "apagar" la detección. Dentro de GitHub
// Actions, `GITHUB_ACTIONS=true` siempre está puesto y no se puede apagar por accidente, así
// que también cuenta como CI. El job que usará VERIFY_DATABASE_URL contra producción (SPEC-015)
// tendrá una DATABASE_URL de producción a mano: aquí no puede caer a ella.
describe("resolveDatabaseUrl — GITHUB_ACTIONS cuenta como CI aunque CI diga lo contrario (L-2)", () => {
  it.each([
    ["CI=false", { CI: "false" }],
    ["CI=0", { CI: "0" }],
    ["CI vacío", { CI: "" }],
    ["CI ausente", {}],
  ] as [string, Env][])("GITHUB_ACTIONS=true + %s + solo DATABASE_URL -> lanza, sin leer .env.local", (_n, ci) => {
    const { run, readEnvLocal } = setup(
      { ...ci, GITHUB_ACTIONS: "true", DATABASE_URL: U_DB },
      envLocal(U_LOCAL),
    );
    expectClearNoOriginError(errorOf(run));
    expect(readEnvLocal).not.toHaveBeenCalled();
  });

  it("GITHUB_ACTIONS=true + CI=false + DATABASE_URL_TEST -> devuelve ese", () => {
    const env = { GITHUB_ACTIONS: "true", CI: "false", DATABASE_URL_TEST: U_TEST, DATABASE_URL: U_DB };
    expect(setup(env, null).run()).toBe(U_TEST);
  });

  it.each(["false", "0", "", undefined])("GITHUB_ACTIONS=%j no cuenta como CI", (ga) => {
    expect(setup({ GITHUB_ACTIONS: ga, DATABASE_URL: U_DB }, null).run()).toBe(U_DB);
  });
});
