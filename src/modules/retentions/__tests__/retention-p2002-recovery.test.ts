// src/modules/retentions/__tests__/retention-p2002-recovery.test.ts
//
// Recuperación P2002 de `createRetentionAction` — el camino REAL del `catch`.
//
// Por qué un archivo aparte: el test que hoy vive en
// `src/modules/retentions/actions/retention.actions.test.ts`
// («recupera la retención existente en race condition P2002 — con companyId»)
// NO ejerce este camino. Deja `retencion.findFirst` devolviendo la fila SIEMPRE,
// así que el FAST PATH de idempotencia —que corre antes del `$transaction`—
// retorna primero y el `catch` nunca se ejecuta. Encima el error con el que
// rechaza el `$transaction` es un `new Error("...P2002")` corriente, que
// `isPrismaError` descarta por no ser `PrismaClientKnownRequestError`. Ese test
// pasa en verde aunque se borre el bloque entero de recuperación.
//
// Aquí el pre-check devuelve `null` (la fila aún no existe) y la fila del
// ganador aparece DENTRO del `$transaction`, justo antes del P2002 — que es
// cómo ocurre la carrera de verdad.
//
// Además blinda el fix de la auditoría LOW: el `where` de esa consulta —cuyo
// resultado se DEVUELVE al cliente— se acota con el dato VALIDADO (`parsed.data`),
// no con el `input` crudo del cliente.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

vi.mock("@/lib/module-access", () => ({
  hasModuleAccess: vi.fn().mockResolvedValue(true),
  moduleAccessError: vi.fn().mockReturnValue("Módulo no habilitado"),
}));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (companyId: string, userId: string) => `${companyId}:${userId}`,
  limiters: { fiscal: {}, ocr: {} },
  redis: null,
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, tx: unknown, fn: (tx: unknown) => unknown) => fn(tx)
  ),
}));

vi.mock("@/modules/billing/services/SubscriptionService", () => ({
  assertWriteAllowed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/retentions/services/RetentionVoucherPDFService", () => ({
  generateRetentionVoucherPDF: vi.fn(),
}));

// `retencion.findUnique` NO se declara a propósito: el lookup de idempotencia
// —tanto el fast path como la recuperación— debe ser `findFirst` acotado por
// companyId. Si alguien vuelve a `findUnique({ where: { idempotencyKey } })`,
// estos tests revientan en vez de pasar en verde.
vi.mock("@/lib/prisma", () => ({
  default: {
    retencion: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    companyMember: { findFirst: vi.fn() },
    fiscalYearClose: { findUnique: vi.fn() },
    invoice: { findFirst: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    companySettings: { findUnique: vi.fn() },
    transaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { createRetentionAction } from "../actions/retention.actions";
import type { CreateRetentionInput } from "../schemas/retention.schema";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const OTHER_COMPANY = "company-ajena";
const KEY = "550e8400-e29b-41d4-a716-446655440000";

const VALID_INPUT: CreateRetentionInput = {
  companyId: COMPANY_ID,
  providerName: "Distribuidora ABC C.A.",
  providerRif: "J-12345678-9",
  invoiceNumber: "B00000001",
  invoiceDate: new Date("2026-03-10"),
  invoiceAmount: "1160.00",
  taxBase: "1000.00",
  ivaAmount: "160.00",
  ivaRetentionPct: 75,
  type: "IVA",
  idempotencyKey: KEY,
};

const dec = (v: string) => ({ toString: () => v });

function makeRetention(overrides: Record<string, unknown> = {}) {
  return {
    id: "ret-del-ganador",
    companyId: COMPANY_ID,
    providerName: "Distribuidora ABC C.A.",
    providerRif: "J-12345678-9",
    invoiceNumber: "B00000001",
    invoiceDate: new Date("2026-03-10"),
    invoiceAmount: dec("1160.00"),
    taxBase: dec("1000.00"),
    ivaAmount: dec("160.00"),
    ivaRetention: dec("120.00"),
    ivaRetentionPct: dec("75"),
    islrAmount: null,
    islrRetentionPct: null,
    incesAmount: null,
    fatAmount: null,
    totalRetention: dec("120.00"),
    voucherNumber: "20260600000001",
    type: "IVA",
    status: "PENDING",
    enteradoAt: null,
    createdBy: "user-1",
    createdAt: new Date("2026-03-10"),
    deletedAt: null,
    idempotencyKey: KEY,
    ...overrides,
  };
}

const p2002 = (target: unknown) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: { target },
  });

// Forma real del target con el adaptador de Neon sobre @@unique([companyId, idempotencyKey]).
const IDEMPOTENCY_TARGET = ["companyId", "idempotencyKey"];

describe("createRetentionAction — recuperación P2002 con el dato VALIDADO", () => {
  /** "BD" mutable: el pre-check la lee vacía; el ganador inserta durante la carrera. */
  let db: Array<Record<string, unknown>>;

  /** `findFirst` que filtra por TODAS las claves escalares del `where`, como la BD. */
  function fakeFindFirst(rows: Array<Record<string, unknown>>) {
    return vi.fn(async (args?: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      const scalar = Object.entries(where).filter(([, v]) => v === null || typeof v !== "object");
      return rows.find((row) => scalar.every(([k, v]) => row[k] === v)) ?? null;
    });
  }

  /** El $transaction inserta la fila del ganador y lanza `err` — el TOCTOU exacto. */
  function raceThenThrow(row: Record<string, unknown> | null, err: unknown, onRace?: () => void) {
    vi.mocked(prisma.$transaction).mockImplementation((async () => {
      if (row) db.push(row);
      onRace?.();
      throw err;
    }) as never);
  }

  const whereOfCall = (i: number) =>
    vi.mocked(prisma.retencion.findFirst).mock.calls[i]![0]!.where!;

  beforeEach(() => {
    vi.clearAllMocks();
    db = [];
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.retencion.findFirst).mockImplementation(fakeFindFirst(db) as never);
  });

  it("devuelve la retención del ganador cuando el $transaction lanza P2002 (fast path NO aplica)", async () => {
    raceThenThrow(makeRetention(), p2002(IDEMPOTENCY_TARGET));

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("ret-del-ganador");
    expect(result.data.totalRetention).toBe("120.00");
    // Prueba de que se ejerció el CATCH y no el fast path: el $transaction corrió
    // y hubo DOS lecturas (pre-check vacío + recuperación).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.retencion.findFirst).toHaveBeenCalledTimes(2);
    expect(whereOfCall(0)).toEqual({ idempotencyKey: KEY, companyId: COMPANY_ID });
  });

  it("el where de la recuperación lleva companyId además de la clave (ADR-004)", async () => {
    raceThenThrow(makeRetention(), p2002(IDEMPOTENCY_TARGET));

    await createRetentionAction(VALID_INPUT);

    const where = whereOfCall(1);
    expect(where).toEqual({ idempotencyKey: KEY, companyId: COMPANY_ID });
    expect(Object.keys(where)).toContain("companyId");
  });

  // ── El fix de la auditoría LOW: `validated`, no `input` ─────────────────────
  //
  // El `catch` consulta una retención que DEVUELVE al cliente. Hacerlo con el
  // `input` crudo —sin pasar por el schema ni por el guard— sólo era equivalente
  // por casualidad. Para que el test DISTINGA de verdad entre ambas fuentes, el
  // `input` se envenena a mitad de vuelo: sus getters devuelven los valores
  // legítimos mientras Zod lo parsea y otros DISTINTOS a partir del momento en
  // que arranca la carrera. `parsed.data` es una copia inmune; `input` no.
  it("BONUS: usa el snapshot VALIDADO aunque el input mute después del parseo", async () => {
    let poisoned = false;
    const mutatingInput = {
      ...VALID_INPUT,
      get companyId() {
        return poisoned ? OTHER_COMPANY : COMPANY_ID;
      },
      get idempotencyKey() {
        return poisoned ? "00000000-0000-4000-8000-000000000000" : KEY;
      },
    } as CreateRetentionInput;

    // La retención ajena está en la "BD" con la clave envenenada: si la consulta
    // se hiciera con el `input` crudo, haría match y se devolvería al cliente.
    db.push(
      makeRetention({
        id: "ret-de-otra-empresa",
        companyId: OTHER_COMPANY,
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        totalRetention: dec("999999.00"),
      })
    );

    raceThenThrow(makeRetention(), p2002(IDEMPOTENCY_TARGET), () => {
      poisoned = true;
    });

    const result = await createRetentionAction(mutatingInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Devuelve la SUYA, no la que apuntan los valores envenenados.
    expect(result.data.id).toBe("ret-del-ganador");
    expect(result.data.totalRetention).not.toBe("999999.00");
    // Y la consulta se acotó con los valores validados, no con los del input.
    expect(whereOfCall(1)).toEqual({ idempotencyKey: KEY, companyId: COMPANY_ID });
    expect(whereOfCall(1)).not.toMatchObject({ companyId: OTHER_COMPANY });
  });

  it("NO devuelve la retención de otra empresa que reusó la clave — responde error", async () => {
    raceThenThrow(
      makeRetention({ id: "ret-de-otra-empresa", companyId: OTHER_COMPANY }),
      p2002(IDEMPOTENCY_TARGET)
    );

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).not.toContain("ret-de-otra-empresa");
  });

  it("P2002 sin fila recuperable → error de negocio, no un éxito inventado", async () => {
    raceThenThrow(null, p2002(IDEMPOTENCY_TARGET)); // la "BD" sigue vacía

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(prisma.retencion.findFirst).toHaveBeenCalledTimes(2);
  });

  it("sin idempotencyKey en el input, el P2002 no dispara recuperación", async () => {
    const { idempotencyKey: _omit, ...sinClave } = VALID_INPUT;
    raceThenThrow(makeRetention(), p2002(IDEMPOTENCY_TARGET));

    const result = await createRetentionAction(sinClave as CreateRetentionInput);

    expect(result.success).toBe(false);
    // Ni pre-check ni recuperación: no hay clave con la que acotar.
    expect(prisma.retencion.findFirst).not.toHaveBeenCalled();
  });

  it("un Error corriente cuyo mensaje menciona P2002 NO dispara recuperación", async () => {
    // Exactamente el error con el que rechaza el test antiguo de la carpeta
    // `actions/`: no es `PrismaClientKnownRequestError`, así que `isPrismaError`
    // lo descarta y el camino de recuperación no existe para él.
    raceThenThrow(makeRetention(), new Error("Unique constraint failed — P2002"));

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(false);
    // Solo el pre-check; el catch no volvió a consultar.
    expect(prisma.retencion.findFirst).toHaveBeenCalledTimes(1);
  });

  it("el fast path sigue devolviendo la fila propia sin tocar el $transaction", async () => {
    // Contraste con todo lo anterior: aquí la fila YA existe antes de empezar.
    db.push(makeRetention({ id: "ret-preexistente" }));

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("ret-preexistente");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
