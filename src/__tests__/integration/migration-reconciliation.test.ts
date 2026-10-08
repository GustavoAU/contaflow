// src/__tests__/integration/migration-reconciliation.test.ts
//
// @integration — requiere DATABASE_URL_TEST apuntando a una DB de test aislada (job `integration`
// del CI: branch efímero de Neon con TODAS las migraciones aplicadas desde cero por
// `prisma migrate deploy`, es decir, en orden LEXICOGRÁFICO del nombre del directorio).
//
// SPEC-022 / ADR-057: una base reconstruida desde las migraciones debe ser equivalente a
// producción. En producción las migraciones se aplicaron a mano, en orden CRONOLÓGICO; en una base
// nueva, dos migraciones del mismo día se estorban y sobreviven tres objetos que producción no
// tiene: la columna `Employee.workShift`, el tipo `WorkShiftType` y el índice único parcial
// `PayrollRun_companyId_period_active_key`. Este último es el bug de fondo (CA-3): impide un segundo
// proceso de nómina del mismo período aunque sea de otra moneda, justo lo que `currency_segment`
// quería habilitar. `migrate diff` y `verify:drift` no lo ven (es un índice parcial), así que solo
// una prueba contra una base real lo demuestra.
//
// Cubre CA-2 (catálogo), CA-3 (comportamiento de la nómina), CA-4 (idempotencia de la migración
// correctiva) y CA-5 (default de EmployeeLoan.status). Los cambios solo-de-schema de SPEC-022
// (onUpdate, @updatedAt, Timestamptz, ivaRetentionAmount) NO cambian la BD y por eso no se prueban
// aquí: los vigilan `migrate diff --exit-code` y `tsc`.
//
// ESTADO: TDD, paso 1 de SPEC-022 (RED). Sobre una base reconstruida de HOY (sin la migración
// correctiva) se espera:
//   · RED  CA-2: workShift, WorkShiftType y PayrollRun_companyId_period_active_key EXISTEN;
//          Account_companyId_isPostable_idx NO existe; BenefitAdvance_companyId_idx EXISTE; los dos
//          índices a renombrar siguen con su nombre antiguo.
//   · GREEN CA-2: CompanySettings_ivaRetentionReceivableAccountId_idx ya existe (guarda: el cambio de
//          schema B.2 no requiere migración).
//   · RED  CA-3 (el bug): el 2.º proceso vigente del mismo período con otra moneda (USD junto a VES) se
//          rechaza por el índice único parcial PayrollRun_companyId_period_active_key (SQLSTATE 23505
//          / P2002).
//   · GREEN CA-3 (guarda): un 2.º proceso con el MISMO segmento y período se rechaza (por el único o por
//          la exclusión PayrollRun_no_overlap_active, SQLSTATE 23P01) y no deja fila.
//   · RED  CA-4: no existe prisma/migrations/<AAAAMMDD>_reconciliar_deriva_schema.
//   · RED  CA-5: el default de EmployeeLoan.status es 'ACTIVE', no 'PENDING'.
//
// Solo lectura de catálogos (`$queryRaw` con plantillas etiquetadas, nunca interpolación de texto).
// CA-3 siembra una empresa y sus procesos con ids `spec022-…` únicos por corrida y los borra en
// `afterAll` (onDelete: Restrict obliga: primero los procesos, después la empresa). CA-4 ejecuta el
// SQL de la migración correctiva con `pg` en protocolo simple (varias sentencias por `query`); los
// otros archivos de integración no tocan Employee, BenefitAdvance ni PayrollRun, así que no hay
// riesgo de interbloqueo con los bloqueos de DDL.
//
// Correr con:
//   DATABASE_URL_TEST=postgresql://... npx vitest run --config vitest.integration.config.ts \
//     src/__tests__/integration/migration-reconciliation.test.ts

import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";

const DB_URL = process.env.DATABASE_URL_TEST;
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

// ─────────────────────────────────────────────────────────────────────────────
// Consultas de catálogo (solo lectura)
// ─────────────────────────────────────────────────────────────────────────────

async function columnExists(db: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name::text = ${table}
         AND column_name::text = ${column}
    ) AS present`;
  return rows[0]?.present === true;
}

async function typeExists(db: PrismaClient, name: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typname::text = ${name}
    ) AS present`;
  return rows[0]?.present === true;
}

/** Definición del índice (`pg_get_indexdef`) o null si no existe en el esquema public. */
async function indexDefinition(db: PrismaClient, name: string): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef::text AS indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname::text = ${name}`;
  return rows[0]?.indexdef ?? null;
}

async function columnDefault(
  db: PrismaClient,
  table: string,
  column: string
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ column_default: string | null }>>`
    SELECT column_default::text AS column_default FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name::text = ${table}
       AND column_name::text = ${column}`;
  return rows[0]?.column_default ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de errores (Prisma + adapter-pg): código, constraint y texto, a cualquier profundidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todos los strings de un error —`code`, `message`, `cause`, `meta`…— hasta 5 niveles y con
 * protección contra ciclos. La forma del error depende del driver (adapter-pg aquí, el adaptador de
 * Neon en producción, ver LL-014) y de si Prisma conoce el SQLSTATE: el 23505 llega como P2002; el
 * 23P01 (exclusión) no tiene código propio y llega con el texto de Postgres.
 */
function signalsOf(error: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown, depth: number) => {
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    // `message` y `cause` de un Error no son propiedades enumerables: se leen a mano.
    for (const child of [record.message, record.cause, record.meta, ...Object.values(record)]) {
      walk(child, depth + 1);
    }
  };
  walk(error, 0);
  return out;
}

/** Resumen corto y legible de un error, para el mensaje de una aserción. */
function summary(error: unknown): string {
  const text = [...new Set(signalsOf(error))]
    .flatMap((s) => s.split("\n"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("Invalid `"))
    .join(" | ");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/** Rechazo por unicidad (23505 / P2002) o por la exclusión de solape (23P01) de PayrollRun. */
const OVERLAP_SIGNALS = [
  "23505",
  "23P01",
  "P2002",
  "PayrollRun_no_overlap_active",
  "PayrollRun_companyId_period_active_key",
];

function isOverlapRejection(error: unknown): boolean {
  return signalsOf(error).some((s) => OVERLAP_SIGNALS.some((sig) => s.includes(sig)));
}

/** El error que lanza `fn`, o null si resuelve. */
async function rejectionOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migración correctiva (CA-4)
// ─────────────────────────────────────────────────────────────────────────────

/** Directorios `<AAAAMMDD>_reconciliar_deriva_schema` de prisma/migrations. */
function reconciliationDirs(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[0-9]{8}_reconciliar_deriva_schema$/.test(e.name))
    .map((e) => e.name);
}

const MISSING_MIGRATION =
  "falta la migración correctiva de SPEC-022 (prisma/migrations/<AAAAMMDD>_reconciliar_deriva_schema)";

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

type CatalogCheck = {
  name: string;
  /** Descripción del problema, o null si el catálogo está como debe. */
  problem: () => Promise<string | null>;
};

describe.skipIf(!DB_URL)("@integration migration-reconciliation (SPEC-022)", () => {
  let prisma: PrismaClient;
  const COMPANY_ID = `spec022-${Date.now()}`;

  beforeAll(async () => {
    if (!DB_URL) return;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
    await prisma.$connect();
    // PayrollRun.companyId tiene FK a Company (onDelete: Restrict). Solo `id` y `name` son
    // obligatorios; CA-2, CA-4 y CA-5 no necesitan filas.
    await prisma.company.create({ data: { id: COMPANY_ID, name: "integration-spec022" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Orden por FKs (Restrict): procesos de nómina -> empresa.
    await prisma.payrollRun.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.company.deleteMany({ where: { id: COMPANY_ID } });
    await prisma.$disconnect();
  });

  // ── Catálogo de una base reconstruida (CA-2, CA-5) ─────────────────────────────────────────

  const absentColumn = (table: string, column: string, why: string): CatalogCheck => ({
    name: `${table}.${column} no existe`,
    problem: async () =>
      (await columnExists(prisma, table, column))
        ? `la columna ${table}.${column} EXISTE en una base reconstruida: ${why}`
        : null,
  });

  const absentType = (name: string, why: string): CatalogCheck => ({
    name: `el tipo ${name} no existe`,
    problem: async () =>
      (await typeExists(prisma, name))
        ? `el tipo ${name} EXISTE en una base reconstruida: ${why}`
        : null,
  });

  const absentIndex = (name: string, why: string): CatalogCheck => ({
    name: `el índice ${name} no existe`,
    problem: async () =>
      (await indexDefinition(prisma, name)) !== null
        ? `el índice ${name} EXISTE en una base reconstruida: ${why}`
        : null,
  });

  /** El índice existe y, si se indica, su definición contiene `columns` (p. ej. `("a", "b")`). */
  const presentIndex = (name: string, why: string, columns?: string): CatalogCheck => ({
    name: columns ? `el índice ${name} existe sobre ${columns}` : `el índice ${name} existe`,
    problem: async () => {
      const def = await indexDefinition(prisma, name);
      if (def === null) return `el índice ${name} NO existe en una base reconstruida: ${why}`;
      if (columns && !def.includes(columns)) {
        return `el índice ${name} existe pero no cubre ${columns}: ${def}`;
      }
      return null;
    },
  });

  const ORPHANS =
    "20260829_drop_duplicate_workshift / 20260830_payrollrun_currency_segment lo eliminan, pero ordenan " +
    "ANTES de la migración que lo crea, así que el DROP IF EXISTS fue un no-op; la migración " +
    "correctiva debe eliminarlo al final";

  const CA2_CHECKS: CatalogCheck[] = [
    absentColumn("Employee", "workShift", ORPHANS),
    absentType("WorkShiftType", ORPHANS),
    absentIndex("PayrollRun_companyId_period_active_key", ORPHANS),
    presentIndex(
      "Account_companyId_isPostable_idx",
      "schema.prisma lo declara (Account.isPostable, ADR-053) y ninguna migración lo creó",
      '("companyId", "isPostable")'
    ),
    absentIndex(
      "BenefitAdvance_companyId_idx",
      "es prefijo de los otros dos índices del modelo y la migración correctiva lo elimina"
    ),
    presentIndex(
      "CompanySettings_ivaRetentionReceivableAccountId_idx",
      "lo crea 20260526_cobropago_ivaretention; el schema solo debe declararlo (sin migración)"
    ),
    presentIndex(
      "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriod_key",
      "es el nombre que calcula Prisma; la migración correctiva renombra el truncado a 63 caracteres"
    ),
    absentIndex(
      "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriodMont",
      "es el nombre antiguo, truncado a 63 caracteres; la migración correctiva lo renombra"
    ),
    presentIndex(
      "caja_caja_reimbursements_companyId_reimbursementNumber_key",
      "es el nombre que calcula Prisma; la migración correctiva renombra el antiguo"
    ),
    absentIndex(
      "caja_caja_reimbursements_reimbursementNumber_key",
      "es el nombre antiguo; la migración correctiva lo renombra"
    ),
  ];

  const CA5_CHECK: CatalogCheck = {
    name: "el default de EmployeeLoan.status es PENDING",
    problem: async () => {
      const def = await columnDefault(prisma, "EmployeeLoan", "status");
      return def !== null && def.includes("PENDING")
        ? null
        : `el default de EmployeeLoan.status es ${def === null ? "(ninguno)" : def}; schema.prisma declara PENDING ` +
            `(flujo de aprobación) y la migración correctiva debe fijarlo`;
    },
  };

  it.each(CA2_CHECKS)("CA-2: $name", async ({ problem }) => {
    expect(await problem()).toBeNull();
  });

  it("CA-5: el default de EmployeeLoan.status es PENDING (contiene 'PENDING')", async () => {
    expect(await CA5_CHECK.problem()).toBeNull();
  });

  // ── CA-3: el bug de fondo ──────────────────────────────────────────────────────────────────

  describe("CA-3: la ranura del período es (empresa, período, MONEDA)", () => {
    const MARCH = { start: "2026-03-01", end: "2026-03-15" };
    const APRIL = { start: "2026-04-01", end: "2026-04-15" };

    /** Un proceso vigente (status por defecto: DRAFT) con el mínimo que exige el modelo. */
    function createRun(args: {
      segment: "VES" | "USD";
      period: { start: string; end: string };
      key: string;
    }) {
      return prisma.payrollRun.create({
        data: {
          companyId: COMPANY_ID,
          periodStart: new Date(`${args.period.start}T00:00:00.000Z`),
          periodEnd: new Date(`${args.period.end}T00:00:00.000Z`),
          currencySegment: args.segment,
          totalEarnings: "0",
          totalDeductions: "0",
          totalNet: "0",
          employeeCount: 0,
          createdByUserId: "spec022-user",
          idempotencyKey: `${COMPANY_ID}-${args.key}`,
        },
      });
    }

    it("dos procesos vigentes del mismo período y empresa con currencySegment distinto (VES y USD) se pueden crear", async () => {
      await createRun({ segment: "VES", period: MARCH, key: "mar-ves" });

      // RED esperado HOY: en una base reconstruida sobrevive PayrollRun_companyId_period_active_key
      // (único parcial sobre companyId, periodStart, periodEnd, SIN la moneda) y este insert falla
      // con SQLSTATE 23505 / P2002. En producción no existe: la exclusión
      // PayrollRun_no_overlap_active (que SÍ incluye currencySegment) lo permite.
      const usdError = await rejectionOf(() =>
        createRun({ segment: "USD", period: MARCH, key: "mar-usd" })
      );
      expect(
        usdError,
        `El 2.º proceso vigente (USD) del mismo período y empresa fue RECHAZADO: ${summary(usdError)}. ` +
          `Una base reconstruida conserva PayrollRun_companyId_period_active_key (SPEC-022 3-C.4)`
      ).toBeNull();

      const segments = (
        await prisma.payrollRun.findMany({
          where: {
            companyId: COMPANY_ID,
            idempotencyKey: { in: [`${COMPANY_ID}-mar-ves`, `${COMPANY_ID}-mar-usd`] },
            status: { not: "CANCELLED" },
          },
          select: { currencySegment: true },
        })
      )
        .map((r) => r.currencySegment)
        .sort();
      expect(segments).toEqual(["USD", "VES"]);
    });

    it("un 2.º proceso vigente con el MISMO segmento y período es rechazado y no se crea", async () => {
      await createRun({ segment: "VES", period: APRIL, key: "abr-ves" });

      // Rechazado por el único parcial (23505 / P2002) o por la exclusión de solape (23P01): ambos
      // son válidos para esta guarda. Lo que se exige es que NO se cree.
      const duplicateError = await rejectionOf(() =>
        createRun({ segment: "VES", period: APRIL, key: "abr-ves-dup" })
      );
      expect(
        duplicateError,
        "el 2.º proceso VES del mismo período debió ser rechazado"
      ).not.toBeNull();
      expect(
        isOverlapRejection(duplicateError),
        `rechazado por una razón inesperada (se esperaba 23505/P2002 o 23P01): ${summary(duplicateError)}`
      ).toBe(true);

      expect(
        await prisma.payrollRun.findFirst({
          where: { companyId: COMPANY_ID, idempotencyKey: `${COMPANY_ID}-abr-ves-dup` },
        }),
        "el proceso rechazado no debe haber dejado fila"
      ).toBeNull();
      expect(
        await prisma.payrollRun.count({
          where: {
            companyId: COMPANY_ID,
            idempotencyKey: { in: [`${COMPANY_ID}-abr-ves`, `${COMPANY_ID}-abr-ves-dup`] },
          },
        })
      ).toBe(1);
    });
  });

  // ── CA-4: la migración correctiva (idempotente) ────────────────────────────────────────────
  // Va al final: es la única que ejecuta DDL sobre la base compartida con el resto de pruebas.

  describe("CA-4: la migración correctiva es idempotente", () => {
    it("existe prisma/migrations/<AAAAMMDD>_reconciliar_deriva_schema", () => {
      expect(reconciliationDirs(), MISSING_MIGRATION).toHaveLength(1);
    });

    it("su SQL se aplica DOS veces seguidas sin error y el catálogo queda como en CA-2 y CA-5", async () => {
      const dirs = reconciliationDirs();
      expect(dirs, MISSING_MIGRATION).toHaveLength(1);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, dirs[0]!, "migration.sql"), "utf-8");
      expect(sql.trim().length, "la migración correctiva está vacía").toBeGreaterThan(0);

      // `pg` sin parámetros usa el protocolo simple: admite varias sentencias en un solo `query`
      // (Prisma `$executeRaw` no). `migrate deploy` ya la aplicó una vez; estas son la 2.ª y la 3.ª.
      const client = new Client({ connectionString: DB_URL });
      await client.connect();
      try {
        for (const vuelta of [1, 2]) {
          const error = await rejectionOf(() => client.query(sql));
          expect(
            error,
            `la migración correctiva FALLÓ al aplicarla otra vez (vuelta ${vuelta} de 2): ${summary(error)}. ` +
              `Debe ser idempotente (IF [NOT] EXISTS, ALTER INDEX IF EXISTS)`
          ).toBeNull();
        }
      } finally {
        await client.end();
      }

      // Después de reaplicarla, el catálogo sigue como debe (CA-2 + CA-5).
      const problems: string[] = [];
      for (const check of [...CA2_CHECKS, CA5_CHECK]) {
        const problem = await check.problem();
        if (problem !== null) problems.push(problem);
      }
      expect(problems).toEqual([]);
    });
  });
});
