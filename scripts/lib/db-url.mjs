// scripts/lib/db-url.mjs — resolución de la URL de BD de los scripts verify:* (SPEC-014 D).
//
// Antes cada verify-*.mjs leía `.env.local` a mano y lanzaba si no existía. Eso servía en la
// máquina del dueño, pero en CI era un riesgo: con credenciales de infraestructura a mano, un
// script que cae a `DATABASE_URL` o a `.env.local` puede terminar leyendo PRODUCCIÓN en un job
// de PR (RN-2). Por eso la resolución FALLA CERRADA cuando está en CI.
//
// Orden:
//   1. VERIFY_DATABASE_URL   destino explícito (lo usa solo `migrate-production`, SPEC-015,
//                            que es de solo lectura y vive en un environment protegido)
//   2. DATABASE_URL_TEST     el branch efímero que exporta scripts/ci-neon-branch.mjs
//   3. DATABASE_URL          solo fuera de CI
//   4. línea `DATABASE_URL=` de .env.local   solo fuera de CI (comportamiento histórico)
//
// Un valor vacío o de solo espacios cuenta como ausente (misma regla que `||` en CLAUDE.md
// para variables de entorno: una variable declarada vacía en un panel no es "no definida").
// Las variables DATABASE_URL_DIRECT / DATABASE_URL_UNPOOLED NO son orígenes: ci-neon-branch.mjs
// exporta DATABASE_URL_DIRECT en el job de integración y aquí no debe colarse.
//
// El mensaje de error nombra QUÉ definir y nunca incluye el valor de ninguna URL: acaba en
// logs de CI compartidos.
import { readFileSync } from "node:fs";

/**
 * ¿Estamos en CI? `CI` cuenta si no está vacío y no es "false" ni "0". Además,
 * `GITHUB_ACTIONS=true` cuenta SIEMPRE: `CI=false` es una forma común de apagar la detección
 * y dentro de Actions no debe poder apagarse por accidente (revisión de seguridad de SPEC-014,
 * L-2): el job de SPEC-015 tendrá a mano una DATABASE_URL de producción.
 */
function isCI(env) {
  if ((env.GITHUB_ACTIONS ?? "").trim().toLowerCase() === "true") return true;
  const raw = (env.CI ?? "").trim().toLowerCase();
  return raw !== "" && raw !== "false" && raw !== "0";
}

/**
 * Valida que `value` sea una URL de PostgreSQL y lo devuelve. Si no lo es, lanza un mensaje
 * FIJO que nombra el origen y nunca el valor (L-1): `neon()` incluye el valor entero en su
 * propio error cuando no es una URL ("Connection string: <valor>"), y un secreto mal pegado
 * acabaría con su contraseña en un log de CI.
 */
function validUrl(value, origin) {
  let ok = false;
  try {
    const u = new URL(value);
    ok = (u.protocol === "postgresql:" || u.protocol === "postgres:") && u.hostname !== "";
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(
      `El valor de ${origin} no es una URL de PostgreSQL válida (se espera ` +
        "postgresql://usuario:clave@host/base). Por seguridad no se muestra el valor."
    );
  }
  return value;
}

/** Valor de la variable `name`, recortado, o null si falta o está vacía. */
function fromEnv(env, name) {
  const value = (env[name] ?? "").trim();
  return value === "" ? null : value;
}

/** Lee `<raíz del repo>/.env.local`; null solo si no existe (cualquier otro error se propaga). */
function defaultReadEnvLocal() {
  try {
    return readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
}

/** Valor de la primera línea `DATABASE_URL=` (exacta: no DATABASE_URL_DIRECT/_TEST), sin comillas. */
function parseDatabaseUrl(content) {
  const line = content.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) return null;
  let value = line.slice("DATABASE_URL=".length).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  value = value.trim();
  return value === "" ? null : value;
}

/**
 * @param {{ env?: Record<string, string | undefined>, readEnvLocal?: () => string | null }} [opts]
 *   `env` por defecto `process.env`; `readEnvLocal` por defecto lee `.env.local` del repo
 *   (nunca se invoca en CI ni cuando ya hay un origen de mayor prioridad).
 * @returns {string}
 */
export function resolveDatabaseUrl({ env = process.env, readEnvLocal = defaultReadEnvLocal } = {}) {
  // Un origen presente pero inválido es un error, no una razón para probar el siguiente:
  // saltarlo ocultaría un secreto mal configurado y podría acabar usando otra BD.
  const verify = fromEnv(env, "VERIFY_DATABASE_URL");
  if (verify) return validUrl(verify, "VERIFY_DATABASE_URL");

  const test = fromEnv(env, "DATABASE_URL_TEST");
  if (test) return validUrl(test, "DATABASE_URL_TEST");

  const ci = isCI(env);
  if (!ci) {
    const fromDatabaseUrl = fromEnv(env, "DATABASE_URL");
    if (fromDatabaseUrl) return validUrl(fromDatabaseUrl, "DATABASE_URL");

    const content = readEnvLocal();
    const fromFile = content === null ? null : parseDatabaseUrl(content);
    if (fromFile) return validUrl(fromFile, "la línea DATABASE_URL= de .env.local");
  }

  throw new Error(
    ci
      ? "No hay URL de base de datos para verificar. En CI define VERIFY_DATABASE_URL o " +
          "DATABASE_URL_TEST (el branch efímero). En CI nunca se usa DATABASE_URL ni .env.local " +
          "para no apuntar a producción por error."
      : "No hay URL de base de datos para verificar. Define VERIFY_DATABASE_URL o " +
          "DATABASE_URL_TEST, o DATABASE_URL en el entorno, o una línea DATABASE_URL= en " +
          ".env.local."
  );
}
