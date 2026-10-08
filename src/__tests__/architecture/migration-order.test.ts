// src/__tests__/architecture/migration-order.test.ts
//
// Guard arquitectónico (SPEC-022 punto E, RN-6): dos migraciones no pueden depender de un orden
// que su nombre no garantice.
//
// Por qué existe este archivo
// ───────────────────────────
// Prisma aplica las migraciones en orden LEXICOGRÁFICO del nombre del directorio. En producción se
// aplicaron a mano, en orden CRONOLÓGICO. Cuando dos migraciones del mismo día se estorban, una
// base reconstruida (CI, un entorno nuevo, una recuperación desde migraciones) y producción
// divergen:
//   · un `DROP … IF EXISTS` sobre un objeto que aún no existe es un no-op SILENCIOSO;
//   · si una migración que ordena DESPUÉS crea ese mismo objeto, el objeto SOBREVIVE en la base
//     reconstruida aunque en producción nunca existió.
// Hay 3 casos reales hoy (barrido de SPEC-022 sobre 170 migraciones: 33 `DROP … IF EXISTS`):
//   · columna `Employee.workShift`  (drop en 20260829_drop_duplicate_workshift,
//     creación en 20260829_overtime_entry_art183);
//   · tipo `WorkShiftType`           (ídem);
//   · índice `PayrollRun_companyId_period_active_key` (drop en 20260830_payrollrun_currency_segment,
//     creación en 20260830_payrollrun_period_partial_unique). Es un índice PARCIAL: `migrate diff`
//     y `verify:drift` no lo ven, y en una base reconstruida impide el segundo proceso de nómina
//     del mismo período (el caso de dos monedas que `currency_segment` quería habilitar).
//
// Qué detecta (definición)
// ────────────────────────
// `migrations` llega YA en orden lexicográfico (como las aplica Prisma); la posición en la lista
// es el orden de aplicación. Los comentarios `--` y `/* */` se ignoran. Las sentencias se parten
// por `;` y la tabla de un `ALTER TABLE` se toma de SU PROPIA sentencia.
//   · drop (solo con IF EXISTS; sin IF EXISTS falla en voz alta y no cuenta):
//       ALTER TABLE "T" … DROP COLUMN IF EXISTS "C"        -> kind "column",     key `T.C`
//       DROP TYPE IF EXISTS "X"                            -> kind "type",       key `X`
//       DROP TABLE IF EXISTS "T"                           -> kind "table",      key `T`
//       DROP INDEX [CONCURRENTLY] IF EXISTS "I"            -> kind "index",      key `I`
//       ALTER TABLE "T" … DROP CONSTRAINT IF EXISTS "K"    -> kind "constraint", key `T.K`
//   · creación:
//       ALTER TABLE "T" … ADD COLUMN [IF NOT EXISTS] "C"
//       CREATE TYPE "X"
//       CREATE TABLE [IF NOT EXISTS] "T"
//       CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] "I"
//       ALTER TABLE "T" … ADD CONSTRAINT "K"
//   · hazard = un drop en la migración de posición i y una creación del mismo (kind, key) en una
//     migración de posición j > i (`createdIn` lista esas migraciones, en orden de aplicación).
//     Drop y creación en la MISMA migración no son un hazard.
//   · `neutralizedBy` = nombre de una migración de posición k > (la ÚLTIMA posición de
//     `createdIn`) que contiene un drop —con o sin IF EXISTS— del mismo (kind, key); si no hay,
//     null. Un hazard con `neutralizedBy` null es el bug: el objeto sobrevive en una base nueva.
//
// El detector se TESTEA A SÍ MISMO (misma filosofía que correlativo-serializable.test.ts):
//   · cada rama de la definición vive abajo como fixture sintético;
//   · las pruebas de "no hay hazard" llevan SIEMPRE un hazard de CONTROL en la misma lista y
//     exigen que sea lo único que se reporta: un detector vacío (el stub) no puede pasarlas;
//   · el centinela exige que el detector VEA el repo real (los 3 casos conocidos y >= 33 drops);
//   · la prueba real es "ningún hazard sin neutralizar" acompañada de "y el detector encuentra
//     >= 3": con un detector que no encuentra nada, un "cero hazards" sería un test que no puede
//     fallar.
//
// LÍMITES CONOCIDOS (deliberados; ver la spec)
//   · El análisis es de TEXTO: no ve `DO $$ … $$` ni SQL generado dinámicamente.
//   · Solo cubre columna, tipo, tabla, índice y constraint. Políticas, triggers y funciones
//     (`DROP POLICY IF EXISTS`, …) no cuentan: se recrean con CREATE OR REPLACE o por nombre.
//
// ESTADO: SPEC-022 paso 3 (GREEN). El detector (`findOrderHazards`, `countIfExistsDrops`) está
// implementado sobre el análisis de texto de `scanOps`. El repo real queda sin hazards abiertos gracias
// a la migración correctiva `<AAAAMMDD>_reconciliar_deriva_schema`, que vuelve a eliminar los tres objetos
// después de su última creación.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");

export type HazardKind = "column" | "type" | "table" | "index" | "constraint";

export type Hazard = {
  kind: HazardKind;
  /** `Tabla.columna`, `Tipo`, `Tabla`, `Indice` o `Tabla.constraint`, sin comillas. */
  key: string;
  /** Migración con el `DROP … IF EXISTS` que ordena antes de la creación. */
  dropIn: string;
  /** Migraciones POSTERIORES a `dropIn` que crean el mismo objeto, en orden de aplicación. */
  createdIn: string[];
  /** Migración posterior a la última creación que vuelve a eliminarlo, o null si no hay. */
  neutralizedBy: string | null;
};

export type Migration = { name: string; sql: string };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Detector (paso 3 de SPEC-022: implementado sobre el análisis de texto de las migraciones).
// ─────────────────────────────────────────────────────────────────────────────

type Op = { kind: HazardKind; key: string; idx: number; name: string; ifExists: boolean };

/** Quita comentarios `--` y `/* *​/` (un `;` o un `DROP` dentro de un comentario no cuenta). */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const ID = '"?([A-Za-z0-9_]+)"?';

/**
 * Operaciones de creación y de eliminación de objetos de cada migración, en orden de aplicación.
 * `ifExists` marca los `DROP … IF EXISTS`: solo ellos son silenciosos y por tanto candidatos a
 * hazard; los demás `DROP` se registran igualmente porque SÍ pueden neutralizar un hazard.
 * Análisis de TEXTO: no entiende `DO $$ … $$` (límite conocido).
 */
function scanOps(migrations: Migration[]): { creates: Op[]; drops: Op[] } {
  const creates: Op[] = [];
  const drops: Op[] = [];
  migrations.forEach((mig, idx) => {
    const sql = stripComments(mig.sql);
    const add = (list: Op[], kind: HazardKind, key: string, ifExists: boolean) =>
      list.push({ kind, key, idx, name: mig.name, ifExists });

    // ALTER TABLE "T" <acción>[, <acción>...]: la tabla sale de la propia sentencia.
    for (const stmt of sql.split(";")) {
      const t = new RegExp(
        String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${ID}`,
        "i"
      ).exec(stmt);
      if (!t) continue;
      const table = t[1]!;
      for (const m of stmt.matchAll(
        new RegExp(String.raw`ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}`, "gi")
      )) {
        add(creates, "column", `${table}.${m[1]}`, false);
      }
      for (const m of stmt.matchAll(
        new RegExp(String.raw`DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?${ID}`, "gi")
      )) {
        add(drops, "column", `${table}.${m[2]}`, Boolean(m[1]));
      }
      for (const m of stmt.matchAll(new RegExp(String.raw`ADD\s+CONSTRAINT\s+${ID}`, "gi"))) {
        add(creates, "constraint", `${table}.${m[1]}`, false);
      }
      for (const m of stmt.matchAll(
        new RegExp(String.raw`DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?${ID}`, "gi")
      )) {
        add(drops, "constraint", `${table}.${m[2]}`, Boolean(m[1]));
      }
    }

    for (const m of sql.matchAll(new RegExp(String.raw`CREATE\s+TYPE\s+${ID}`, "gi")))
      add(creates, "type", m[1]!, false);
    for (const m of sql.matchAll(
      new RegExp(String.raw`DROP\s+TYPE\s+(IF\s+EXISTS\s+)?${ID}`, "gi")
    )) {
      add(drops, "type", m[2]!, Boolean(m[1]));
    }
    for (const m of sql.matchAll(
      new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}`, "gi")
    )) {
      add(creates, "table", m[1]!, false);
    }
    for (const m of sql.matchAll(
      new RegExp(String.raw`DROP\s+TABLE\s+(IF\s+EXISTS\s+)?${ID}`, "gi")
    )) {
      add(drops, "table", m[2]!, Boolean(m[1]));
    }
    for (const m of sql.matchAll(
      new RegExp(
        String.raw`CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${ID}`,
        "gi"
      )
    )) {
      add(creates, "index", m[1]!, false);
    }
    for (const m of sql.matchAll(
      new RegExp(String.raw`DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(IF\s+EXISTS\s+)?${ID}`, "gi")
    )) {
      add(drops, "index", m[2]!, Boolean(m[1]));
    }
  });
  return { creates, drops };
}

/**
 * Los `DROP … IF EXISTS` que ordenan antes de una migración que crea el mismo objeto, con la
 * migración que (si existe) los neutraliza. `migrations` va en orden de aplicación.
 */
export function findOrderHazards(migrations: Migration[]): Hazard[] {
  const { creates, drops } = scanOps(migrations);
  const hazards: Hazard[] = [];
  for (const d of drops) {
    if (!d.ifExists) continue; // un DROP sin IF EXISTS falla en voz alta: no es silencioso
    const later = creates.filter((c) => c.kind === d.kind && c.key === d.key && c.idx > d.idx);
    if (later.length === 0) continue;
    const lastCreate = Math.max(...later.map((c) => c.idx));
    const neutralizer = drops.find(
      (x) => x.kind === d.kind && x.key === d.key && x.idx > lastCreate
    );
    hazards.push({
      kind: d.kind,
      key: d.key,
      dropIn: d.name,
      createdIn: [...new Set(later.map((c) => c.name))],
      neutralizedBy: neutralizer ? neutralizer.name : null,
    });
  }
  return hazards;
}

/**
 * Nº de `DROP … IF EXISTS` de columna, tipo, tabla, índice o constraint en `migrations`
 * (comentarios excluidos; `DROP` sin IF EXISTS y otros objetos —policy, trigger, function— no
 * cuentan; una sentencia `ALTER TABLE` con varios `DROP … IF EXISTS` suma uno por cada uno). Es el
 * centinela de que el detector VE el repo real.
 */
export function countIfExistsDrops(migrations: Migration[]): number {
  return scanOps(migrations).drops.filter((d) => d.ifExists).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Helpers de test
// ─────────────────────────────────────────────────────────────────────────────

/** Une líneas de un fixture. */
const lines = (...l: string[]) => l.join("\n");

/** Una migración sintética: nombre y sentencias (una por argumento). */
const m = (name: string, ...statements: string[]): Migration => ({
  name,
  sql: lines(...statements),
});

const hazard = (
  kind: HazardKind,
  key: string,
  dropIn: string,
  createdIn: string[],
  neutralizedBy: string | null = null
): Hazard => ({ kind, key, dropIn, createdIn, neutralizedBy });

/** Orden estable para comparar listas sin depender del orden en que el detector las devuelva. */
const sortHazards = (hs: Hazard[]) =>
  [...hs].sort((a, b) =>
    `${a.kind}:${a.key}:${a.dropIn}`.localeCompare(`${b.kind}:${b.key}:${b.dropIn}`)
  );

/** Hazard de CONTROL: va en toda prueba de "no hay hazard" para que un detector vacío no pase. */
const CTL_DROP = m("0000_ctl_drop", 'DROP TYPE IF EXISTS "CtlType";');
const CTL_CREATE = m("9999_ctl_create", `CREATE TYPE "CtlType" AS ENUM ('A');`);
const CTL_HAZARD = hazard("type", "CtlType", "0000_ctl_drop", ["9999_ctl_create"]);

/** Exactamente estos hazards (sin importar el orden). */
function expectHazards(ms: Migration[], expected: Hazard[]) {
  expect(sortHazards(findOrderHazards(ms))).toEqual(sortHazards(expected));
}

/**
 * Los fixtures `ms` no producen NINGÚN hazard propio. Se les añade un hazard de control y se exige
 * que sea lo único que se reporta: si el detector no detecta nada, "sin hazard" no significaría
 * nada. Los nombres de los fixtures deben ordenar entre `0000_` y `9999_`.
 */
function expectNoHazards(...ms: Migration[]) {
  expect(
    sortHazards(findOrderHazards([CTL_DROP, ...ms, CTL_CREATE])),
    "solo debe reportarse el hazard de CONTROL; si sale vacío, el detector no detecta nada"
  ).toEqual([CTL_HAZARD]);
}

type KindCase = {
  label: string;
  kind: HazardKind;
  key: string;
  /** DROP … IF EXISTS. */
  drop: string;
  /** El mismo drop sin IF EXISTS (falla en voz alta si el objeto no existe: no cuenta). */
  dropNoIfExists: string;
  create: string;
};

const KIND_CASES: KindCase[] = [
  {
    label: "columna (ADD COLUMN IF NOT EXISTS)",
    kind: "column",
    key: "Employee.workShift",
    drop: 'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";',
    dropNoIfExists: 'ALTER TABLE "Employee" DROP COLUMN "workShift";',
    create: `ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "workShift" TEXT NOT NULL DEFAULT 'DIURNA';`,
  },
  {
    label: "columna (ADD COLUMN a secas)",
    kind: "column",
    key: "Employee.workShift",
    drop: 'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";',
    dropNoIfExists: 'ALTER TABLE "Employee" DROP COLUMN "workShift";',
    create: 'ALTER TABLE "Employee" ADD COLUMN "workShift" TEXT;',
  },
  {
    label: "tipo (CREATE TYPE)",
    kind: "type",
    key: "WorkShiftType",
    drop: 'DROP TYPE IF EXISTS "WorkShiftType";',
    dropNoIfExists: 'DROP TYPE "WorkShiftType";',
    create: `CREATE TYPE "WorkShiftType" AS ENUM ('DIURNA', 'NOCTURNA', 'MIXTA');`,
  },
  {
    label: "tabla (CREATE TABLE)",
    kind: "table",
    key: "RetentionSequence",
    drop: 'DROP TABLE IF EXISTS "RetentionSequence";',
    dropNoIfExists: 'DROP TABLE "RetentionSequence";',
    create:
      'CREATE TABLE "RetentionSequence" ("id" TEXT NOT NULL, CONSTRAINT "RetentionSequence_pkey" PRIMARY KEY ("id"));',
  },
  {
    label: "tabla (CREATE TABLE IF NOT EXISTS)",
    kind: "table",
    key: "RetentionSequence",
    drop: 'DROP TABLE IF EXISTS "RetentionSequence";',
    dropNoIfExists: 'DROP TABLE "RetentionSequence";',
    create: 'CREATE TABLE IF NOT EXISTS "RetentionSequence" ("id" TEXT NOT NULL);',
  },
  {
    label: "índice (CREATE INDEX)",
    kind: "index",
    key: "Account_companyId_name_key",
    drop: 'DROP INDEX IF EXISTS "Account_companyId_name_key";',
    dropNoIfExists: 'DROP INDEX "Account_companyId_name_key";',
    create: 'CREATE INDEX "Account_companyId_name_key" ON "Account" ("companyId", "name");',
  },
  {
    label: "índice (CREATE UNIQUE INDEX IF NOT EXISTS)",
    kind: "index",
    key: "PayrollRun_companyId_period_active_key",
    drop: 'DROP INDEX IF EXISTS "PayrollRun_companyId_period_active_key";',
    dropNoIfExists: 'DROP INDEX "PayrollRun_companyId_period_active_key";',
    create: lines(
      'CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_companyId_period_active_key"',
      '  ON "PayrollRun" ("companyId", "periodStart", "periodEnd")',
      "  WHERE status <> 'CANCELLED';"
    ),
  },
  {
    label: "índice (CONCURRENTLY en ambos lados)",
    kind: "index",
    key: "Account_companyId_name_key",
    drop: 'DROP INDEX CONCURRENTLY IF EXISTS "Account_companyId_name_key";',
    dropNoIfExists: 'DROP INDEX CONCURRENTLY "Account_companyId_name_key";',
    create:
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Account_companyId_name_key" ON "Account" ("companyId", "name");',
  },
  {
    label: "constraint (ADD CONSTRAINT, una línea)",
    kind: "constraint",
    key: "PayrollRun.PayrollRun_no_overlap_active",
    drop: 'ALTER TABLE "PayrollRun" DROP CONSTRAINT IF EXISTS "PayrollRun_no_overlap_active";',
    dropNoIfExists: 'ALTER TABLE "PayrollRun" DROP CONSTRAINT "PayrollRun_no_overlap_active";',
    create:
      'ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_no_overlap_active" EXCLUDE USING gist ("companyId" WITH =);',
  },
  {
    label: "constraint (ALTER TABLE con la acción en la línea siguiente, como en el repo)",
    kind: "constraint",
    key: "PayrollRun.PayrollRun_companyId_periodStart_periodEnd_key",
    drop: lines(
      'ALTER TABLE "PayrollRun"',
      '  DROP CONSTRAINT IF EXISTS "PayrollRun_companyId_periodStart_periodEnd_key";'
    ),
    dropNoIfExists: lines(
      'ALTER TABLE "PayrollRun"',
      '  DROP CONSTRAINT "PayrollRun_companyId_periodStart_periodEnd_key";'
    ),
    create: lines(
      'ALTER TABLE "PayrollRun"',
      '  ADD CONSTRAINT "PayrollRun_companyId_periodStart_periodEnd_key"',
      '  UNIQUE ("companyId", "periodStart", "periodEnd");'
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests — el detector contra fixtures sintéticos
// ─────────────────────────────────────────────────────────────────────────────

describe("Fixtures: drop ANTES de la creación (el hazard)", () => {
  it.each(KIND_CASES)("$label: hazard sin neutralizar", ({ kind, key, drop, create }) => {
    expectHazards(
      [m("0001_drop", drop), m("0002_create", create)],
      [hazard(kind, key, "0001_drop", ["0002_create"])]
    );
  });

  it("el nombre de la migración, no su posición, es lo que se reporta (dropIn / createdIn)", () => {
    expectHazards(
      [
        m("20260829_a_primera", "SELECT 1;"),
        m("20260829_b_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
        m("20260829_c_intermedia", "SELECT 2;"),
        m("20260829_d_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
      ],
      [hazard("type", "WorkShiftType", "20260829_b_drop", ["20260829_d_create"])]
    );
  });

  it("varias creaciones posteriores: createdIn las lista todas, en orden de aplicación", () => {
    expectHazards(
      [
        m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
        m("0002_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
        m("0003_otra", "SELECT 1;"),
        m("0004_create", `CREATE TYPE "WorkShiftType" AS ENUM ('B');`),
      ],
      [hazard("type", "WorkShiftType", "0001_drop", ["0002_create", "0004_create"])]
    );
  });

  it("el caso REAL de Employee.workShift: columna y tipo se reportan como dos hazards", () => {
    expectHazards(
      [
        m(
          "20260829_drop_duplicate_workshift",
          'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";',
          'DROP TYPE IF EXISTS "WorkShiftType";'
        ),
        m(
          "20260829_overtime_entry_art183",
          `CREATE TYPE "WorkShiftType" AS ENUM ('DIURNA', 'NOCTURNA', 'MIXTA');`,
          'ALTER TABLE "Employee"',
          `  ADD COLUMN IF NOT EXISTS "workShift" "WorkShiftType" NOT NULL DEFAULT 'DIURNA';`
        ),
      ],
      [
        hazard("column", "Employee.workShift", "20260829_drop_duplicate_workshift", [
          "20260829_overtime_entry_art183",
        ]),
        hazard("type", "WorkShiftType", "20260829_drop_duplicate_workshift", [
          "20260829_overtime_entry_art183",
        ]),
      ]
    );
  });
});

describe("Fixtures: lo que NO es un hazard", () => {
  describe("la creación ordena antes que el drop (el orden sano)", () => {
    it.each(KIND_CASES)("$label", ({ drop, create }) => {
      expectNoHazards(m("0001_create", create), m("0002_drop", drop));
    });
  });

  describe("drop y creación en la MISMA migración (reconstrucción del objeto)", () => {
    it.each(KIND_CASES)("$label", ({ drop, create }) => {
      expectNoHazards(m("0001_rebuild", drop, create));
    });
  });

  describe("DROP sin IF EXISTS (falla en voz alta: no es un no-op silencioso)", () => {
    it.each(KIND_CASES)("$label", ({ dropNoIfExists, create }) => {
      expectNoHazards(m("0001_drop", dropNoIfExists), m("0002_create", create));
    });
  });

  it("drop sin ninguna creación posterior (el caso normal de quitar algo)", () => {
    expectNoHazards(
      m("0001_create", 'CREATE TABLE "Viejo" ("id" TEXT NOT NULL);'),
      m("0002_drop", 'DROP TABLE IF EXISTS "Viejo";')
    );
  });

  it("una creación sin ningún drop no es un hazard", () => {
    expectNoHazards(m("0001_create", 'CREATE TABLE "Nueva" ("id" TEXT NOT NULL);'));
  });

  it("mismo nombre pero otro tipo de objeto: un índice no se mezcla con una columna", () => {
    expectNoHazards(
      m("0001_drop", 'DROP INDEX IF EXISTS "status";'),
      m("0002_create", 'ALTER TABLE "Employee" ADD COLUMN "status" TEXT;')
    );
  });
});

describe("Fixtures: neutralización (la migración correctiva que vuelve a eliminar el objeto)", () => {
  it.each(KIND_CASES)(
    "$label: un re-drop con IF EXISTS posterior a la creación lo neutraliza",
    ({ kind, key, drop, create }) => {
      expectHazards(
        [m("0001_drop", drop), m("0002_create", create), m("0003_redrop", drop)],
        [hazard(kind, key, "0001_drop", ["0002_create"], "0003_redrop")]
      );
    }
  );

  it.each(KIND_CASES)(
    "$label: un re-drop SIN IF EXISTS también lo neutraliza (con o sin IF EXISTS)",
    ({ kind, key, drop, dropNoIfExists, create }) => {
      expectHazards(
        [m("0001_drop", drop), m("0002_create", create), m("0003_redrop", dropNoIfExists)],
        [hazard(kind, key, "0001_drop", ["0002_create"], "0003_redrop")]
      );
    }
  );

  it("neutralizedBy es el NOMBRE de la migración que limpia, no el de las demás", () => {
    expectHazards(
      [
        m("20260829_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
        m("20260829_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
        m("20260901_otra", "SELECT 1;"),
        m("20261008_reconciliar", 'DROP TYPE IF EXISTS "WorkShiftType";'),
        m("20261009_posterior", "SELECT 2;"),
      ],
      [
        hazard(
          "type",
          "WorkShiftType",
          "20260829_drop",
          ["20260829_create"],
          "20261008_reconciliar"
        ),
      ]
    );
  });

  it("varias creaciones: lo neutraliza un drop posterior a la ÚLTIMA", () => {
    expectHazards(
      [
        m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
        m("0002_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
        m("0003_create", `CREATE TYPE "WorkShiftType" AS ENUM ('B');`),
        m("0004_redrop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      ],
      [hazard("type", "WorkShiftType", "0001_drop", ["0002_create", "0003_create"], "0004_redrop")]
    );
  });

  it("un re-drop ENTRE dos creaciones no neutraliza el primer drop (debe ser posterior a la última)", () => {
    // Se mira solo el hazard del PRIMER drop: la lista completa depende de si el segundo drop
    // (0003) se reporta además como hazard propio, que esta prueba no fija.
    const found = findOrderHazards([
      m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      m("0002_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
      m("0003_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      m("0004_create", `CREATE TYPE "WorkShiftType" AS ENUM ('B');`),
    ]).find((h) => h.dropIn === "0001_drop");
    expect(found, "el hazard del primer drop debe reportarse").toBeDefined();
    expect(found).toEqual(
      hazard("type", "WorkShiftType", "0001_drop", ["0002_create", "0004_create"])
    );
  });

  it("un re-drop ANTES de la creación no la neutraliza", () => {
    // Se mira solo el hazard del PRIMER drop (el segundo, 0002, se reporta o no según el detector).
    const found = findOrderHazards([
      m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      m("0002_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      m("0003_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
    ]).find((h) => h.dropIn === "0001_drop");
    expect(found, "el hazard del primer drop debe reportarse").toBeDefined();
    expect(found).toEqual(hazard("type", "WorkShiftType", "0001_drop", ["0003_create"]));
  });

  it("la neutralización es por objeto: limpiar uno no limpia al otro", () => {
    expectHazards(
      [
        m(
          "0001_drop",
          'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";',
          'DROP TYPE IF EXISTS "WorkShiftType";'
        ),
        m(
          "0002_create",
          `CREATE TYPE "WorkShiftType" AS ENUM ('A');`,
          'ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "workShift" TEXT;'
        ),
        m("0003_solo_el_tipo", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      ],
      [
        hazard("column", "Employee.workShift", "0001_drop", ["0002_create"]),
        hazard("type", "WorkShiftType", "0001_drop", ["0002_create"], "0003_solo_el_tipo"),
      ]
    );
  });
});

describe("Fixtures: la tabla de un ALTER TABLE se toma de SU sentencia", () => {
  it("la misma columna en OTRA tabla no se mezcla (drop en una, creación en la otra)", () => {
    expectNoHazards(
      m("0001_drop", 'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "status";'),
      m("0002_create", 'ALTER TABLE "Loan" ADD COLUMN "status" TEXT;')
    );
  });

  it("solo la tabla correcta aparece en el hazard cuando se crea la misma columna en dos tablas", () => {
    expectHazards(
      [
        m("0001_drop", 'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "status";'),
        m(
          "0002_create",
          'ALTER TABLE "Loan" ADD COLUMN "status" TEXT;',
          'ALTER TABLE "Employee" ADD COLUMN "status" TEXT;'
        ),
      ],
      [hazard("column", "Employee.status", "0001_drop", ["0002_create"])]
    );
  });

  it("el drop de la misma columna en OTRA tabla no neutraliza", () => {
    expectHazards(
      [
        m("0001_drop", 'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "status";'),
        m("0002_create", 'ALTER TABLE "Employee" ADD COLUMN "status" TEXT;'),
        m("0003_otra_tabla", 'ALTER TABLE "Loan" DROP COLUMN IF EXISTS "status";'),
      ],
      [hazard("column", "Employee.status", "0001_drop", ["0002_create"])]
    );
  });

  it("el mismo constraint en OTRA tabla no se mezcla", () => {
    expectNoHazards(
      m("0001_drop", 'ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "uniq_numero";'),
      m("0002_create", 'ALTER TABLE "Retencion" ADD CONSTRAINT "uniq_numero" UNIQUE ("numero");')
    );
  });

  it("dos ALTER TABLE en una migración: cada acción pertenece a SU tabla, no a la primera del archivo", () => {
    // Un detector que tomara la primera tabla del archivo atribuiría el drop de Beta.flag a Alpha.
    expectNoHazards(
      m(
        "0001_dos_tablas",
        'ALTER TABLE "Alpha" ADD COLUMN "flag" BOOLEAN;',
        'ALTER TABLE "Beta" DROP COLUMN IF EXISTS "flag";'
      ),
      m("0002_create", 'ALTER TABLE "Alpha" ADD COLUMN IF NOT EXISTS "flag" BOOLEAN;')
    );
  });

  it("dos ALTER TABLE en una migración: el drop se atribuye a la tabla de su propia sentencia", () => {
    expectHazards(
      [
        m(
          "0001_dos_tablas",
          'ALTER TABLE "Alpha" ADD COLUMN "flag" BOOLEAN;',
          'ALTER TABLE "Beta" DROP COLUMN IF EXISTS "flag";'
        ),
        m("0002_create", 'ALTER TABLE "Beta" ADD COLUMN IF NOT EXISTS "flag" BOOLEAN;'),
      ],
      [hazard("column", "Beta.flag", "0001_dos_tablas", ["0002_create"])]
    );
  });
});

describe("Fixtures: ALTER TABLE con varias acciones separadas por coma (el repo las usa)", () => {
  // 20260415_nom_c_payroll_run_engine y 20260601_payroll_employer_costs encadenan varios
  // ADD CONSTRAINT / ADD COLUMN en una sola sentencia.
  it("varios ADD COLUMN en una sentencia: cada columna cuenta como creación", () => {
    expectHazards(
      [
        m(
          "0001_drop",
          'ALTER TABLE "PayrollRun" DROP COLUMN IF EXISTS "bcvRateAtRun";',
          'ALTER TABLE "PayrollRun" DROP COLUMN IF EXISTS "totalEmployerCosts";'
        ),
        m(
          "0002_create",
          'ALTER TABLE "PayrollRun"',
          '  ADD COLUMN "bcvRateAtRun"       DECIMAL(16, 4),',
          '  ADD COLUMN "totalEmployerCosts" DECIMAL(18, 2) NOT NULL DEFAULT 0;'
        ),
      ],
      [
        hazard("column", "PayrollRun.bcvRateAtRun", "0001_drop", ["0002_create"]),
        hazard("column", "PayrollRun.totalEmployerCosts", "0001_drop", ["0002_create"]),
      ]
    );
  });

  it("varios ADD CONSTRAINT en una sentencia: cada constraint cuenta como creación", () => {
    expectHazards(
      [
        m(
          "0001_drop",
          'ALTER TABLE "PayrollRun" DROP CONSTRAINT IF EXISTS "PayrollRun_idempotencyKey_key";'
        ),
        m(
          "0002_create",
          'ALTER TABLE "PayrollRun"',
          '  ADD CONSTRAINT "PayrollRun_transactionId_key" UNIQUE ("transactionId"),',
          '  ADD CONSTRAINT "PayrollRun_idempotencyKey_key" UNIQUE ("idempotencyKey");'
        ),
      ],
      [
        hazard("constraint", "PayrollRun.PayrollRun_idempotencyKey_key", "0001_drop", [
          "0002_create",
        ]),
      ]
    );
  });

  it("varios DROP … IF EXISTS en una sentencia: cada uno cuenta como drop", () => {
    expectHazards(
      [
        m(
          "0001_drop",
          'ALTER TABLE "Employee"',
          '  DROP COLUMN IF EXISTS "workShift",',
          '  DROP COLUMN IF EXISTS "otraColumna";'
        ),
        m(
          "0002_create",
          'ALTER TABLE "Employee" ADD COLUMN "workShift" TEXT;',
          'ALTER TABLE "Employee" ADD COLUMN "otraColumna" TEXT;'
        ),
      ],
      [
        hazard("column", "Employee.workShift", "0001_drop", ["0002_create"]),
        hazard("column", "Employee.otraColumna", "0001_drop", ["0002_create"]),
      ]
    );
  });
});

describe("Fixtures: comentarios", () => {
  it("un DROP en un comentario `--` no cuenta como drop", () => {
    expectNoHazards(
      m("0001_comentario", '-- DROP TYPE IF EXISTS "WorkShiftType";'),
      m("0002_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`)
    );
  });

  it("un DROP en un comentario de bloque `/* */` (varias líneas) no cuenta como drop", () => {
    expectNoHazards(
      m(
        "0001_comentario",
        "/*",
        ' * Se descartó: ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";',
        " */"
      ),
      m("0002_create", 'ALTER TABLE "Employee" ADD COLUMN "workShift" TEXT;')
    );
  });

  it("una CREACIÓN en un comentario no cuenta como creación", () => {
    expectNoHazards(
      m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
      m(
        "0002_comentario",
        `-- CREATE TYPE "WorkShiftType" AS ENUM ('A');`,
        `/* CREATE TYPE "WorkShiftType" AS ENUM ('B'); */`
      )
    );
  });

  it("un re-drop en un comentario no neutraliza", () => {
    expectHazards(
      [
        m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType";'),
        m("0002_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A');`),
        m("0003_comentario", '-- DROP TYPE IF EXISTS "WorkShiftType";'),
      ],
      [hazard("type", "WorkShiftType", "0001_drop", ["0002_create"])]
    );
  });

  it("un `;` dentro de un comentario no parte la sentencia siguiente", () => {
    expectHazards(
      [
        m(
          "0001_drop",
          '-- nota; ALTER TABLE "Otra" ADD COLUMN "x" INT;',
          'ALTER TABLE "Employee"',
          "  -- quitar la columna; ver el ADR",
          '  DROP COLUMN IF EXISTS "workShift";'
        ),
        m("0002_create", 'ALTER TABLE "Employee" ADD COLUMN "workShift" TEXT;'),
      ],
      [hazard("column", "Employee.workShift", "0001_drop", ["0002_create"])]
    );
  });

  it("un comentario al final de la línea de una sentencia real no la oculta", () => {
    expectHazards(
      [
        m("0001_drop", 'DROP TYPE IF EXISTS "WorkShiftType"; -- huérfano de otra migración'),
        m("0002_create", `CREATE TYPE "WorkShiftType" AS ENUM ('A'); /* creado aquí */`),
      ],
      [hazard("type", "WorkShiftType", "0001_drop", ["0002_create"])]
    );
  });

  it("un comentario entre ALTER TABLE y su acción no oculta el drop (forma real del repo)", () => {
    expectHazards(
      [
        m(
          "0001_drop",
          'ALTER TABLE "PayrollRun"',
          "  -- quitar el único viejo",
          '  DROP CONSTRAINT IF EXISTS "PayrollRun_no_overlap_active";'
        ),
        m(
          "0002_create",
          'ALTER TABLE "PayrollRun"',
          "  /* exclusión de solape */",
          '  ADD CONSTRAINT "PayrollRun_no_overlap_active" EXCLUDE USING gist ("companyId" WITH =);'
        ),
      ],
      [
        hazard("constraint", "PayrollRun.PayrollRun_no_overlap_active", "0001_drop", [
          "0002_create",
        ]),
      ]
    );
  });
});

describe("countIfExistsDrops: el conteo que prueba que el detector VE el repo", () => {
  it("cuenta cada DROP … IF EXISTS de columna, tipo, tabla, índice y constraint", () => {
    expect(
      countIfExistsDrops([
        m(
          "0001",
          'ALTER TABLE "A" DROP COLUMN IF EXISTS "x";',
          'DROP TYPE IF EXISTS "T1";',
          'DROP TABLE IF EXISTS "T2";'
        ),
        m(
          "0002",
          'DROP INDEX CONCURRENTLY IF EXISTS "I";',
          'ALTER TABLE "A"',
          '  DROP CONSTRAINT IF EXISTS "K";'
        ),
      ])
    ).toBe(5);
  });

  it("NO cuenta: DROP sin IF EXISTS, comentarios, otros objetos ni creaciones", () => {
    expect(
      countIfExistsDrops([
        m(
          "0001",
          'DROP INDEX "J";',
          'ALTER TABLE "A" DROP COLUMN "y";',
          '-- DROP TYPE IF EXISTS "C";',
          '/* DROP TABLE IF EXISTS "D"; */',
          'DROP POLICY IF EXISTS company_isolation ON "A";',
          'DROP TRIGGER IF EXISTS trg_x ON "A";',
          "DROP FUNCTION IF EXISTS fn_x();",
          'CREATE INDEX IF NOT EXISTS "Z" ON "A" ("x");',
          // el único que cuenta
          'DROP TYPE IF EXISTS "UNO";'
        ),
      ])
    ).toBe(1);
  });

  it("una sentencia ALTER TABLE con varios DROP … IF EXISTS suma uno por cada uno", () => {
    expect(
      countIfExistsDrops([
        m(
          "0001",
          'ALTER TABLE "A"',
          '  DROP COLUMN IF EXISTS "x",',
          '  DROP COLUMN IF EXISTS "y",',
          '  DROP CONSTRAINT IF EXISTS "K";'
        ),
      ])
    ).toBe(3);
  });

  it("suma entre migraciones y es 0 sin ninguno", () => {
    expect(countIfExistsDrops([])).toBe(0);
    expect(countIfExistsDrops([m("0001", "SELECT 1;"), m("0002", "SELECT 2;")])).toBe(0);
    expect(
      countIfExistsDrops([
        m("0001", 'DROP TYPE IF EXISTS "A";'),
        m("0002", 'DROP TYPE IF EXISTS "B";'),
        m("0003", 'DROP TYPE IF EXISTS "C";'),
      ])
    ).toBe(3);
  });
});

describe("Extensiones NO explícitas en la spec (decisión a confirmar; borrar si se descartan)", () => {
  it("EXTENSIÓN — las palabras clave en minúsculas se reconocen (SQL es insensible a mayúsculas)", () => {
    expectHazards(
      [
        m("0001_drop", 'drop type if exists "WorkShiftType";'),
        m("0002_create", `create type "WorkShiftType" as enum ('A');`),
      ],
      [hazard("type", "WorkShiftType", "0001_drop", ["0002_create"])]
    );
  });

  it("EXTENSIÓN — finales de línea CRLF (archivos editados en Windows) no cambian el resultado", () => {
    const crlf = (...l: string[]) => l.join("\r\n");
    expectHazards(
      [
        {
          name: "0001_drop",
          sql: crlf(
            "-- huérfano",
            'ALTER TABLE "Employee"',
            '  DROP COLUMN IF EXISTS "workShift";'
          ),
        },
        {
          name: "0002_create",
          sql: crlf('ALTER TABLE "Employee"', '  ADD COLUMN IF NOT EXISTS "workShift" TEXT;'),
        },
      ],
      [hazard("column", "Employee.workShift", "0001_drop", ["0002_create"])]
    );
  });

  it.todo(
    "LÍMITE CONOCIDO — `DO $$ … $$` y SQL dinámico: el análisis es de texto y no los ve (la spec lo declara)"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Repo real
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las migraciones del repo en el orden en que las aplica Prisma: LEXICOGRÁFICO por nombre de
 * directorio, comparando unidades de código (el `sort()` por defecto). NO `localeCompare`: la
 * colación de la configuración regional ordena distinto el `_` frente a los dígitos.
 */
function loadMigrations(): Migration[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf-8"),
    }));
}

const MIGRATIONS = loadMigrations();

/** Cualquier migración llamada `<AAAAMMDD>_reconciliar_deriva_schema` (la correctiva de SPEC-022). */
const isReconciliation = (name: string) => /^[0-9]{8}_reconciliar_deriva_schema$/.test(name);

/** Los 3 objetos huérfanos que SPEC-022 sección 3-C.4 elimina al final. */
const KNOWN_HAZARDS: { kind: HazardKind; key: string; dropIn: string; createdIn: string[] }[] = [
  {
    kind: "column",
    key: "Employee.workShift",
    dropIn: "20260829_drop_duplicate_workshift",
    createdIn: ["20260829_overtime_entry_art183"],
  },
  {
    kind: "type",
    key: "WorkShiftType",
    dropIn: "20260829_drop_duplicate_workshift",
    createdIn: ["20260829_overtime_entry_art183"],
  },
  {
    kind: "index",
    key: "PayrollRun_companyId_period_active_key",
    dropIn: "20260830_payrollrun_currency_segment",
    createdIn: ["20260830_payrollrun_period_partial_unique"],
  },
];

const MIN_EXPECTED_DROPS = 33;

describe("Architecture: orden de migraciones (SPEC-022, RN-6)", () => {
  const hazards = findOrderHazards(MIGRATIONS);

  it("carga las migraciones del repo (>= 170, cada directorio con su migration.sql)", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(170);
    for (const mig of MIGRATIONS) expect(mig.sql.length, mig.name).toBeGreaterThan(0);
    // El orden es el lexicográfico estricto, el mismo en que Prisma las aplica.
    const names = MIGRATIONS.map((x) => x.name);
    expect(names).toEqual([...names].sort());
  });

  it.each(KNOWN_HAZARDS)(
    "centinela: el detector encuentra $kind $key (drop en $dropIn, creación después)",
    ({ kind, key, dropIn, createdIn }) => {
      const found = hazards.find((h) => h.kind === kind && h.key === key);
      expect(
        found,
        `el detector no encontró ${kind} ${key}: o no ve el repo real o cambió la forma de las migraciones`
      ).toBeDefined();
      expect(found!.dropIn).toBe(dropIn);
      expect(found!.createdIn).toEqual(createdIn);
    }
  );

  it(`centinela: el repo tiene >= ${MIN_EXPECTED_DROPS} DROP … IF EXISTS de columna, tipo, tabla, índice o constraint`, () => {
    const n = countIfExistsDrops(MIGRATIONS);
    expect(
      n,
      `El detector solo contó ${n} DROP … IF EXISTS (el barrido de SPEC-022 midió ${MIN_EXPECTED_DROPS}). ` +
        `Si la forma del SQL cambió, ajusta el detector — no bajes el mínimo.`
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_DROPS);
  });

  it("LA PRUEBA REAL: ningún DROP … IF EXISTS queda sin neutralizar frente a una creación posterior", () => {
    // Acompañado del centinela de arriba: solo vale porque se exige que el detector ENCUENTRE los 3
    // casos conocidos. Con un detector que no encuentra nada, "cero hazards sin neutralizar" pasaría
    // en falso.
    expect(
      hazards.length,
      `El detector solo encontró ${hazards.length} hazards; los 3 casos conocidos (Employee.workShift, ` +
        `WorkShiftType, PayrollRun_companyId_period_active_key) deben aparecer.`
    ).toBeGreaterThanOrEqual(3);

    const open = hazards
      .filter((h) => h.neutralizedBy === null)
      .map(
        (h) =>
          `${h.kind} ${h.key}: DROP IF EXISTS en ${h.dropIn}, pero se crea DESPUÉS en ` +
          `${h.createdIn.join(", ")} y ninguna migración posterior lo vuelve a eliminar`
      );
    expect(
      open,
      `Prisma aplica las migraciones en orden LEXICOGRÁFICO; un DROP IF EXISTS antes de la creación ` +
        `es un no-op silencioso y el objeto SOBREVIVE en una base reconstruida aunque en producción ` +
        `(orden cronológico) no exista. Añade una migración con fecha posterior a la última que lo ` +
        `elimine de nuevo (SPEC-022 3-C.4):\n\n${open.join("\n")}`
    ).toEqual([]);
  });

  it("la migración correctiva <AAAAMMDD>_reconciliar_deriva_schema neutraliza los 3 objetos conocidos", () => {
    const fix = MIGRATIONS.find((x) => isReconciliation(x.name));
    expect(
      fix,
      "falta la migración correctiva de SPEC-022 (prisma/migrations/<AAAAMMDD>_reconciliar_deriva_schema)"
    ).toBeDefined();
    for (const { kind, key } of KNOWN_HAZARDS) {
      const found = hazards.find((h) => h.kind === kind && h.key === key);
      expect(found, `${kind} ${key}: el detector no lo encontró`).toBeDefined();
      expect(
        found!.neutralizedBy,
        `${kind} ${key} debe quedar neutralizado por la correctiva`
      ).toBe(fix!.name);
    }
  });
});

describe("Meta: el guard PUEDE fallar y PUEDE pasar sobre las migraciones reales (en memoria)", () => {
  // Los fixtures prueban la lógica; esto prueba el circuito completo con el texto REAL del repo, sin
  // la migración correctiva (si ya existe se descarta, para que la prueba valga antes y después de
  // escribirla). No se escribe nada a disco.
  const base = MIGRATIONS.filter((x) => !isReconciliation(x.name));
  const FIX_NAME = "99999999_simulada_reconciliar";
  const openKeys = (ms: Migration[]) =>
    findOrderHazards(ms)
      .filter((h) => h.neutralizedBy === null)
      .map((h) => `${h.kind} ${h.key}`)
      .sort();

  it("sin la correctiva, los 3 objetos conocidos quedan sin neutralizar (el guard FALLARÍA)", () => {
    const keys = openKeys(base);
    for (const { kind, key } of KNOWN_HAZARDS) {
      expect(
        keys,
        `el guard NO detectó ${kind} ${key} en las migraciones reales: sería decorativo`
      ).toContain(`${kind} ${key}`);
    }
  });

  it("una correctiva simulada que vuelve a eliminar los 3 objetos al final deja el guard en verde", () => {
    const fixed = [
      ...base,
      m(
        FIX_NAME,
        'ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";',
        'DROP TYPE IF EXISTS "WorkShiftType";',
        'DROP INDEX IF EXISTS "PayrollRun_companyId_period_active_key";'
      ),
    ];
    const found = findOrderHazards(fixed);
    // Los 3 siguen siendo hazards (el orden de las migraciones antiguas no cambia), pero neutralizados.
    for (const { kind, key } of KNOWN_HAZARDS) {
      const h = found.find((x) => x.kind === kind && x.key === key);
      expect(h, `${kind} ${key} debe seguir reportándose`).toBeDefined();
      expect(h!.neutralizedBy, `${kind} ${key} debe quedar neutralizado`).toBe(FIX_NAME);
    }
    expect(openKeys(fixed)).toEqual([]);
  });

  it("una correctiva simulada que limpia solo uno de los 3 deja los otros dos abiertos", () => {
    const partial = [
      ...base,
      m(FIX_NAME, 'DROP INDEX IF EXISTS "PayrollRun_companyId_period_active_key";'),
    ];
    expect(openKeys(partial)).toEqual(["column Employee.workShift", "type WorkShiftType"]);
  });

  it("un objeto NUEVO con el mismo defecto en una migración posterior hace fallar el guard", () => {
    const withNewBug = [
      ...base,
      m("99999990_nuevo_drop", 'DROP INDEX IF EXISTS "Nuevo_idx";'),
      m("99999991_nuevo_create", 'CREATE INDEX "Nuevo_idx" ON "Account" ("id");'),
    ];
    expect(openKeys(withNewBug)).toContain("index Nuevo_idx");
  });
});
