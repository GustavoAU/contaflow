// scripts/lib/neon-ci-guards.mjs — guardas del branch efímero de Neon para CI (SPEC-002)
//
// La NEON_API_KEY del CI es una key personal: alcanza el proyecto de producción
// completo, incluido el branch `production`. Nada de lo que hace el script de CI debe
// poder tocar otra cosa que branches creados por esa misma corrida. Estas funciones son
// PURAS a propósito: se prueban sin red (scripts/__tests__/neon-ci-guards.test.ts) y el
// script las usa antes de cada DELETE.
//
// Toda comprobación es de lista blanca y falla CERRADA: un campo ausente, nulo o de
// otro tipo cuenta como "no seguro", nunca como "no hay problema".

const DIGITS = /^\d+$/;
const CI_BRANCH_NAME = /^ci-\d+-\d+$/;

function isDigits(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0;
  return typeof value === "string" && DIGITS.test(value);
}

/** Nombre del branch efímero de esta corrida: `ci-<runId>-<runAttempt>`. */
export function ciBranchName({ runId, runAttempt } = {}) {
  if (!isDigits(runId)) throw new Error("runId inválido: debe ser numérico");
  if (!isDigits(runAttempt)) throw new Error("runAttempt inválido: debe ser numérico");
  return `ci-${runId}-${runAttempt}`;
}

/** El único branch `default` del proyecto. Nunca se hardcodea su id. */
export function resolveDefaultBranch(branches) {
  const defaults = Array.isArray(branches) ? branches.filter((b) => b?.default === true) : [];
  if (defaults.length === 0) throw new Error("No se encontró un branch default en el proyecto");
  if (defaults.length > 1) throw new Error("Hay más de un branch default: ambiguo, se aborta");
  return defaults[0];
}

/**
 * Lanza salvo que el branch sea, sin duda, uno efímero de CI de ESTE proyecto.
 * Se llama inmediatamente antes de cada DELETE.
 */
export function assertDeletableBranch({ branch, expectedProjectId, defaultBranchId } = {}) {
  const refuse = (reason) => {
    throw new Error(`Se rechaza borrar el branch (refusing to delete): ${reason}`);
  };
  if (!branch || typeof branch !== "object") refuse("branch ausente");
  if (typeof expectedProjectId !== "string" || expectedProjectId === "") {
    refuse("expectedProjectId ausente");
  }
  if (typeof defaultBranchId !== "string" || defaultBranchId === "") {
    refuse("defaultBranchId ausente");
  }
  if (typeof branch.name !== "string" || !CI_BRANCH_NAME.test(branch.name)) {
    refuse("el nombre no cumple ci-<run>-<intento>");
  }
  if (typeof branch.id !== "string" || branch.id === "") refuse("id ausente");
  if (branch.project_id !== expectedProjectId) refuse("pertenece a otro proyecto");
  if (branch.default !== false && branch.default !== undefined) refuse("es el branch default");
  if (branch.primary === true) refuse("es el branch primary");
  if (branch.protected === true) refuse("es un branch protegido");
  if (branch.id === defaultBranchId) refuse("su id coincide con el del branch default");
}

/** Comando de GitHub Actions que oculta `value` en los logs (CA-6). */
export function maskLine(value) {
  if (typeof value !== "string" || value === "") {
    throw new Error("maskLine: value debe ser un string no vacío");
  }
  // Un salto de línea dejaría inyectar un segundo comando de workflow (::set-output…).
  if (/[\r\n]/.test(value)) {
    throw new Error("maskLine: value no puede contener salto de línea");
  }
  return `::add-mask::${value}`;
}

export const CI_PROJECT_NAME = "contaflow-ci";

/**
 * El script solo opera sobre el proyecto dedicado al CI. Si NEON_PROJECT_ID apunta por
 * error (o por un secreto mal movido) al proyecto de producción, se aborta ANTES de crear
 * o borrar nada: sin esta guarda, una corrida clonaría producción con sus datos.
 */
export function assertCiProject(project) {
  if (!project || typeof project !== "object" || project.name !== CI_PROJECT_NAME) {
    throw new Error(
      `Se rechaza operar (refusing): el proyecto no es '${CI_PROJECT_NAME}'`
    );
  }
}
