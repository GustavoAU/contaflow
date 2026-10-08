// src/__tests__/architecture/ci-workflow-invariants.test.ts
//
// Guard arquitectónico (SPEC-014 + SPEC-002): las garantías de SEGURIDAD del workflow de CI
// viven como código verificable, no como comentarios que un cambio futuro pueda borrar.
//
// Qué protege
// ───────────
// El job `integration` recibe la NEON_API_KEY (alcanza el proyecto de CI) y ejecuta código del
// propio PR (tests, scripts, dependencias). SPEC-002 lo dejó acotado con la revisión de seguridad
// del 2026-10-02 y SPEC-014 lo amplía (acción compuesta, `build`, `migrate diff`, `verify:*`).
// Cada invariante de abajo es una condición de esas revisiones:
//   · la key de Neon SOLO en los pasos "Verificar secretos", "Crear branch efímero" y
//     "Borrar branch efímero" — nunca en el env del job ni en ningún otro job;
//   · `integration` instala con `--ignore-scripts` (acción compuesta con `ignore-scripts: "true"`);
//   · el job `build` no usa secretos (corre en PRs de Dependabot y de forks);
//   · el job `test` no recibe los secretos de Clerk/Groq en el env del job (solo en el paso de tests);
//   · nunca `pull_request_target` (ejecutaría código del PR con el contexto del repo base);
//   · `cancel-in-progress` solo en PRs (SPEC-015 migrará producción desde `main`);
//   · `ci-result` exige `build` y no acepta `skipped` más que para `integration`;
//   · la acción compuesta falla SEGURO: solo el valor exacto "false" instala con scripts.
//
// El análisis es de TEXTO (el repo aún no tiene un parser YAML como dependencia directa; SPEC-020
// lo añadirá). Por eso cada comprobación se prueba también contra fixtures MALOS: un guard que no
// puede fallar no protege nada.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const WORKFLOWS_DIR = path.join(ROOT, ".github", "workflows");
const CI = path.join(WORKFLOWS_DIR, "ci.yml");
const SETUP_ACTION = path.join(ROOT, ".github", "actions", "setup", "action.yml");

/** Únicos pasos de `integration` que pueden recibir la key de Neon. */
export const NEON_ALLOWED_STEPS = [
  "Verificar secretos",
  "Crear branch efímero",
  "Borrar branch efímero",
] as const;

const REQUIRED_JOBS = ["test", "architecture", "security", "build", "integration", "ci-result"];

// ─── Análisis de texto ────────────────────────────────────────────────────────

/** Jobs de `jobs:` (clave a 2 espacios de sangría) con su texto completo. */
export function parseJobs(yml: string): Map<string, string> {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => l === "jobs:");
  const jobs = new Map<string, string>();
  if (start < 0) return jobs;
  let name: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (name) jobs.set(name, buf.join("\n"));
  };
  for (const line of lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      flush();
      name = m[1]!;
      buf = [];
    } else if (name) {
      buf.push(line);
    }
  }
  flush();
  return jobs;
}

/** Texto del job anterior a su lista de pasos (`env:`, `permissions:`, `environment:`…). */
export function jobHeader(job: string): string {
  const i = job.split("\n").findIndex((l) => /^ {4}steps:\s*$/.test(l));
  return i < 0 ? job : job.split("\n").slice(0, i).join("\n");
}

export type Step = { name: string; text: string };

/** Pasos de un job (elementos de la lista a 6 espacios de sangría). */
export function parseSteps(job: string): Step[] {
  const lines = job.split("\n");
  const first = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (first < 0) return [];
  const steps: Step[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.join("\n");
    const m = /^ {6}- name:\s*"?(.*?)"?\s*$/m.exec(text);
    steps.push({ name: m ? m[1]! : "(sin nombre)", text });
  };
  for (const line of lines.slice(first + 1)) {
    if (/^ {6}- /.test(line)) {
      flush();
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  flush();
  return steps;
}

// ─── Invariantes ──────────────────────────────────────────────────────────────

/** Violaciones de las invariantes de seguridad de `ci.yml`. Vacío = todo en orden. */
export function ciViolations(ci: string): string[] {
  const out: string[] = [];
  const jobs = parseJobs(ci);

  for (const j of REQUIRED_JOBS) {
    if (!jobs.has(j)) out.push(`falta el job "${j}"`);
  }

  // La key de Neon: solo en 3 pasos de `integration`, nunca en otro job ni en un env de job.
  for (const [name, text] of jobs) {
    if (name !== "integration") {
      if (text.includes("secrets.NEON_")) out.push(`el job "${name}" referencia secrets.NEON_*`);
      continue;
    }
    if (jobHeader(text).includes("secrets.NEON_")) {
      out.push(
        '"integration" pone secrets.NEON_* en el env/cabecera del job (debe ir solo en sus pasos)'
      );
    }
    for (const step of parseSteps(text)) {
      if (
        step.text.includes("secrets.NEON_") &&
        !(NEON_ALLOWED_STEPS as readonly string[]).includes(step.name)
      ) {
        out.push(`el paso "${step.name}" de integration recibe secrets.NEON_* y no está permitido`);
      }
    }
  }

  // `integration`: instalación sin scripts (RN-6).
  const integration = jobs.get("integration");
  if (integration) {
    const setup = parseSteps(integration).find((s) =>
      s.text.includes("uses: ./.github/actions/setup")
    );
    if (!setup) {
      out.push('"integration" no usa la acción compuesta ./.github/actions/setup');
    } else if (!/ignore-scripts:\s*"true"/.test(setup.text)) {
      out.push('"integration" instala sin ignore-scripts: "true" (RN-6, SPEC-002)');
    }
    // Solo líneas de código: los comentarios del job nombran `pnpm install` para explicar por qué
    // no ven la key, y eso no es una instalación.
    const code = integration
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    if (/pnpm install(?![^\n]*--ignore-scripts)/.test(code)) {
      out.push('"integration" ejecuta `pnpm install` sin --ignore-scripts');
    }
  }

  // `build`: sin secretos (corre en PRs de Dependabot y de forks).
  const build = jobs.get("build");
  if (build && build.includes("secrets."))
    out.push('el job "build" usa secrets.* (debe usar valores ficticios)');

  // `test`: los secretos de Clerk/Groq no van en el env del job.
  const test = jobs.get("test");
  if (test && jobHeader(test).includes("secrets.")) {
    out.push('el job "test" pone secrets.* en el env del job (deben ir solo en el paso de tests)');
  }

  // Nunca pull_request_target.
  if (/\bpull_request_target\b/.test(ci)) out.push("el workflow usa pull_request_target");

  // Ningún paso en modo informativo (revisión de seguridad de SPEC-014, M-1): con
  // `continue-on-error: true` un paso fallido deja el job en verde Y la API de GitHub lo muestra
  // como "success"; en la primera corrida real `migrate diff` devolvió exit 2 y figuraba en
  // verde. Un gate que no falla no existe (SPEC-014 RN-1).
  const informative = ci
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && /continue-on-error:\s*true/.test(l));
  if (informative.length > 0) {
    out.push(
      `hay ${informative.length} línea(s) con continue-on-error: true (los gates no pueden ser informativos)`
    );
  }

  // El chequeo schema <-> migraciones compara contra la línea base versionada.
  if (!ci.includes("scripts/ci/migrate-diff-baseline.sql")) {
    out.push("el paso de migrate diff no compara contra scripts/ci/migrate-diff-baseline.sql");
  }

  // concurrency: cancelar solo en PRs.
  if (!/cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/.test(ci)) {
    out.push("cancel-in-progress debe ser `${{ github.event_name == 'pull_request' }}`");
  }
  if (/cancel-in-progress:\s*true\b/.test(ci))
    out.push("cancel-in-progress: true cancelaría corridas de main");

  // ci-result: necesita todos los jobs y valida build; skipped solo para integration.
  const result = jobs.get("ci-result");
  if (result) {
    const needs = /needs:\s*\[([^\]]*)\]/.exec(result)?.[1] ?? "";
    for (const j of ["test", "architecture", "security", "build", "integration"]) {
      if (!new RegExp(`\\b${j}\\b`).test(needs)) out.push(`ci-result no depende de "${j}"`);
    }
    if (!result.includes("needs.build.result"))
      out.push("ci-result no comprueba needs.build.result");
    const skippedOk = result.match(/"skipped"/g)?.length ?? 0;
    if (skippedOk !== 1)
      out.push(`ci-result acepta skipped ${skippedOk} veces (solo debe aceptarlo integration)`);
  }

  return out;
}

/** Violaciones de la acción compuesta de setup. */
export function actionViolations(action: string): string[] {
  const out: string[] = [];
  if (!action.includes('[ "$IGNORE_SCRIPTS" = "false" ]')) {
    out.push(
      'la acción debe instalar CON scripts solo si ignore-scripts es exactamente "false" (falla seguro)'
    );
  }
  const runBlock = action.split(/\n\s*run:\s*\|/)[1] ?? "";
  if (runBlock.includes("${{"))
    out.push("el bloque run interpola ${{ ... }} (el input debe ir por env)");
  if (!/env:\s*\n\s*IGNORE_SCRIPTS:\s*\$\{\{\s*inputs\.ignore-scripts\s*\}\}/.test(action)) {
    out.push(
      "el input ignore-scripts debe llegar al script por la variable de entorno IGNORE_SCRIPTS"
    );
  }
  return out;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("Architecture: invariantes de seguridad del workflow de CI (ci.yml)", () => {
  const ci = read(CI);

  it("el parser ve los 6 jobs y los pasos de integration (no es un test que no puede fallar)", () => {
    const jobs = parseJobs(ci);
    for (const j of REQUIRED_JOBS) expect(jobs.has(j), `job ${j}`).toBe(true);
    const names = parseSteps(jobs.get("integration")!).map((s) => s.name);
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const allowed of NEON_ALLOWED_STEPS) expect(names, allowed).toContain(allowed);
  });

  it("ci.yml cumple todas las invariantes de seguridad", () => {
    expect(ciViolations(ci)).toEqual([]);
  });

  it("ningún workflow usa pull_request_target", () => {
    for (const f of fs.readdirSync(WORKFLOWS_DIR).filter((n) => /\.ya?ml$/.test(n))) {
      expect(read(path.join(WORKFLOWS_DIR, f)), f).not.toMatch(/\bpull_request_target\b/);
    }
  });

  it("la acción compuesta de setup falla seguro", () => {
    expect(actionViolations(read(SETUP_ACTION))).toEqual([]);
  });

  it("la línea base de migrate diff existe y solo contiene sentencias de Prisma", () => {
    const baseline = read(path.join(ROOT, "scripts", "ci", "migrate-diff-baseline.sql"));
    // No vacía: si algún día la deriva se resuelve del todo, se borra el archivo Y esta
    // comprobación junto con el paso (y el paso pasa a exigir un diff vacío).
    expect(baseline.trim().length).toBeGreaterThan(0);
    const statements = baseline.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("-- "));
    for (const s of statements) {
      expect(s, "la línea base solo debe tener SQL de Prisma").toMatch(
        /^(ALTER|DROP|CREATE|ADD)\b/
      );
    }
  });
});

// ─── El guard puede FALLAR: mutaciones sobre el ci.yml real (en memoria) ──────

describe("Architecture: las invariantes detectan su violación (mutaciones sobre ci.yml)", () => {
  const ci = read(CI);
  const mutate = (from: string | RegExp, to: string) => {
    const next = ci.replace(from, to);
    expect(next, `la mutación no cambió nada: ${String(from)}`).not.toBe(ci);
    return ciViolations(next);
  };

  it("la key de Neon en el env del job integration", () => {
    const v = mutate(
      "    environment: neon-ci\n",
      "    environment: neon-ci\n    env:\n      NEON_API_KEY: ${{ secrets.NEON_API_KEY }}\n"
    );
    expect(v.join("\n")).toMatch(/env\/cabecera del job/);
  });

  it("la key de Neon en un paso no permitido (migrate diff)", () => {
    const v = mutate(
      '      - name: "Schema ↔ migraciones (prisma migrate diff contra la línea base)"\n',
      '      - name: "Schema ↔ migraciones (prisma migrate diff contra la línea base)"\n        env:\n          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}\n'
    );
    expect(v.join("\n")).toMatch(/línea base\)" de integration recibe secrets\.NEON_/);
  });

  it("la key de Neon en otro job", () => {
    const v = mutate(
      '    timeout-minutes: 20\n    env:\n      DATABASE_URL: "postgresql://mock:mock@localhost:5432/mock"\n      NEXT_PUBLIC',
      '    timeout-minutes: 20\n    env:\n      NEON_API_KEY: ${{ secrets.NEON_API_KEY }}\n      DATABASE_URL: "postgresql://mock:mock@localhost:5432/mock"\n      NEXT_PUBLIC'
    );
    expect(v.join("\n")).toMatch(/job "build" referencia secrets\.NEON_/);
  });

  it("integration sin ignore-scripts", () => {
    const v = mutate('          ignore-scripts: "true"\n', "");
    expect(v.join("\n")).toMatch(/sin ignore-scripts/);
  });

  it("un `pnpm install` real (no comentado) en integration sin --ignore-scripts", () => {
    const v = mutate(
      "      - name: Generar cliente Prisma\n        if: steps.gate.outputs.enabled == 'true'\n        run: pnpm prisma generate\n\n      - name: Crear branch",
      "      - name: Generar cliente Prisma\n        if: steps.gate.outputs.enabled == 'true'\n        run: pnpm install --frozen-lockfile && pnpm prisma generate\n\n      - name: Crear branch"
    );
    expect(v.join("\n")).toMatch(/ejecuta `pnpm install` sin --ignore-scripts/);
  });

  it("integration con ignore-scripts mal escrito", () => {
    const v = mutate('ignore-scripts: "true"', 'ignore-scripts: "yes"');
    expect(v.join("\n")).toMatch(/sin ignore-scripts/);
  });

  it("secretos en el job build", () => {
    const v = mutate(
      'CLERK_SECRET_KEY: "sk_test_ci_build_dummy_not_a_real_key"',
      "CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}"
    );
    expect(v.join("\n")).toMatch(/"build" usa secrets/);
  });

  it("secretos de Clerk en el env del job test", () => {
    const v = mutate(
      "      NODE_ENV: test\n",
      "      NODE_ENV: test\n      CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}\n"
    );
    expect(v.join("\n")).toMatch(/"test" pone secrets/);
  });

  it("un paso en modo informativo (continue-on-error: true)", () => {
    const v = mutate(
      '      - name: "verify:enum-drift"\n',
      '      - name: "verify:enum-drift"\n        continue-on-error: true\n'
    );
    expect(v.join("\n")).toMatch(/continue-on-error: true/);
  });

  it("migrate diff sin comparar contra la línea base", () => {
    const v = mutate(/scripts\/ci\/migrate-diff-baseline\.sql/g, "scripts/ci/otra-cosa.sql");
    expect(v.join("\n")).toMatch(/migrate-diff-baseline\.sql/);
  });

  it("pull_request_target", () => {
    const v = mutate(
      "  pull_request:\n    branches: [main]\n",
      "  pull_request_target:\n    branches: [main]\n"
    );
    expect(v.join("\n")).toMatch(/pull_request_target/);
  });

  it("cancel-in-progress incondicional", () => {
    const v = mutate(/cancel-in-progress:.*\n/, "cancel-in-progress: true\n");
    expect(v.join("\n")).toMatch(/cancel-in-progress/);
  });

  it("ci-result sin build en needs", () => {
    const v = mutate(
      "needs: [test, architecture, security, build, integration]",
      "needs: [test, architecture, security, integration]"
    );
    expect(v.join("\n")).toMatch(/no depende de "build"/);
  });

  it("ci-result que acepta skipped en otro job", () => {
    const v = mutate(
      '          if [ "${{ needs.build.result }}" != "success" ]; then',
      '          if [ "${{ needs.build.result }}" != "success" ] && [ "${{ needs.build.result }}" != "skipped" ]; then'
    );
    expect(v.join("\n")).toMatch(/acepta skipped 2 veces/);
  });
});

describe("Architecture: la acción compuesta de setup detecta su violación", () => {
  const action = read(SETUP_ACTION);

  it("instalar con scripts salvo que el valor sea exactamente 'true' (falla inseguro)", () => {
    const bad = action.replace('[ "$IGNORE_SCRIPTS" = "false" ]', '[ "$IGNORE_SCRIPTS" = "true" ]');
    expect(bad).not.toBe(action);
    expect(actionViolations(bad).join("\n")).toMatch(/falla seguro/);
  });

  it("interpolar el input directamente en el script", () => {
    const bad = action.replace('if [ "$IGNORE_SCRIPTS"', 'if [ "${{ inputs.ignore-scripts }}"');
    expect(bad).not.toBe(action);
    expect(actionViolations(bad).join("\n")).toMatch(/interpola/);
  });
});
