// src/modules/income-distribution/__tests__/IncomeDistributionService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    incomeDistribution: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      // `count` NO se mockea a propósito. El correlativo se deriva de
      // MÁXIMO + 1 sobre `referenceNumber`; derivarlo de `count` colisionaba sin
      // ninguna carrera (count cuenta FILAS y aplicar no crea filas). Si alguien
      // vuelve a introducir `count`, este mock revienta con "is not a function"
      // en vez de volver a verde silenciosamente.
      findMany: vi.fn(),
    },
    incomeDistributionAudit: { create: vi.fn() },
    transaction: { create: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  buildIdempotencyKey,
  computeTotalVes,
  distributeAmounts,
} from "../services/IncomeDistributionService";
import { CreateIncomeDistributionSchema } from "../schemas/income-distribution.schema";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";

const BASE_LINES = [
  { recipientCompanyId: "rc-1", accountId: "acc-1", percentageShare: new Decimal("60") },
  { recipientCompanyId: "rc-2", accountId: "acc-2", percentageShare: new Decimal("40") },
];

// ─── Utilidades puras ─────────────────────────────────────────────────────────

describe("computeTotalVes", () => {
  it("multiplica amount × rate con 2 decimales", () => {
    expect(computeTotalVes(new Decimal("1000"), new Decimal("36.50")).toFixed(2)).toBe("36500.00");
  });

  it("redondea HALF_UP en el segundo decimal", () => {
    const result = computeTotalVes(new Decimal("100"), new Decimal("1.005"));
    expect(result.toFixed(2)).toBe("100.50");
  });
});

describe("distributeAmounts", () => {
  it("distribuye correctamente 60/40 de 1000", () => {
    const amounts = distributeAmounts(new Decimal("1000"), BASE_LINES);
    expect(amounts[0].toFixed(2)).toBe("600.00");
    expect(amounts[1].toFixed(2)).toBe("400.00");
  });

  it("la suma siempre iguala el total (la última línea absorbe el residuo)", () => {
    const total = new Decimal("1000.01");
    const lines = [
      { percentageShare: new Decimal("33.33") },
      { percentageShare: new Decimal("33.33") },
      { percentageShare: new Decimal("33.34") },
    ];
    const amounts = distributeAmounts(total, lines);
    const sum = amounts.reduce((acc, a) => acc.plus(a), new Decimal(0));
    expect(sum.toFixed(2)).toBe("1000.01");
  });

  it("funciona con 2 líneas 50/50", () => {
    const amounts = distributeAmounts(new Decimal("100"), [
      { percentageShare: new Decimal("50") },
      { percentageShare: new Decimal("50") },
    ]);
    expect(amounts[0].toFixed(2)).toBe("50.00");
    expect(amounts[1].toFixed(2)).toBe("50.00");
  });
});

describe("buildIdempotencyKey", () => {
  it("produce hash SHA256 de 64 caracteres", () => {
    const key = buildIdempotencyKey(COMPANY_ID, new Date("2026-05-12"), new Decimal("1000"), BASE_LINES);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[a-f0-9]+$/);
  });

  it("produce el mismo hash para el mismo input (determinista)", () => {
    const date = new Date("2026-05-12T00:00:00.000Z");
    const k1 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    const k2 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    expect(k1).toBe(k2);
  });

  it("produce hashes distintos para inputs distintos", () => {
    const date = new Date("2026-05-12T00:00:00.000Z");
    const k1 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    const k2 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("2000"), BASE_LINES);
    expect(k1).not.toBe(k2);
  });

  it("normaliza el orden de líneas (sort por recipientCompanyId)", () => {
    const date = new Date("2026-05-12T00:00:00.000Z");
    const reversed = [...BASE_LINES].reverse();
    const k1 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), BASE_LINES);
    const k2 = buildIdempotencyKey(COMPANY_ID, date, new Decimal("1000"), reversed);
    expect(k1).toBe(k2);
  });
});

// ─── createDistribution ───────────────────────────────────────────────────────

describe("createDistribution (mocked)", () => {
  const mockDist = {
    id: "dist-1",
    companyId: COMPANY_ID,
    referenceNumber: null,
    description: null,
    date: new Date("2026-05-12"),
    status: "DRAFT" as const,
    currencyCode: "VES",
    totalAmountOriginal: new Decimal("1000"),
    totalAmountVes: new Decimal("1000"),
    exchangeRate: new Decimal("1"),
    originAccountId: "acc-origin",
    originAccount: { code: "1100", name: "Caja" },
    transactionId: null,
    idempotencyKey: "key-1",
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: USER_ID,
    lines: [
      {
        id: "line-1",
        distributionId: "dist-1",
        recipientCompanyId: "rc-1",
        recipientCompany: { name: "Sucursal A" },
        accountId: "acc-1",
        account: { code: "2100", name: "CxP Sucursal A" },
        percentageShare: new Decimal("60"),
        amountVes: new Decimal("600"),
        lineDescription: null,
        lineNumber: 1,
      },
      {
        id: "line-2",
        distributionId: "dist-1",
        recipientCompanyId: "rc-2",
        recipientCompany: { name: "Sucursal B" },
        accountId: "acc-2",
        account: { code: "2101", name: "CxP Sucursal B" },
        percentageShare: new Decimal("40"),
        amountVes: new Decimal("400"),
        lineDescription: null,
        lineNumber: 2,
      },
    ],
    deletedAt: null,
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
    );
    vi.mocked(prisma.incomeDistribution.create).mockResolvedValue(mockDist as never);
    vi.mocked(prisma.incomeDistributionAudit.create).mockResolvedValue({} as never);
  });

  it("retorna IncomeDistributionSummary serializado", async () => {
    const { createDistribution } = await import("../services/IncomeDistributionService");
    const result = await createDistribution({
      companyId: COMPANY_ID,
      date: new Date("2026-05-12"),
      currencyCode: "VES",
      totalAmountOriginal: new Decimal("1000"),
      exchangeRate: new Decimal("1"),
      originAccountId: "acc-origin",
      lines: BASE_LINES,
      createdBy: USER_ID,
      idempotencyKey: "key-1",
    });

    expect(result.id).toBe("dist-1");
    expect(result.status).toBe("DRAFT");
    expect(result.totalAmountVes).toBe("1000");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].recipientCompanyName).toBe("Sucursal A");
  });

  it("crea la distribución SIN referenceNumber (el correlativo nace al aplicar)", async () => {
    const { createDistribution } = await import("../services/IncomeDistributionService");
    await createDistribution({
      companyId: COMPANY_ID,
      date: new Date("2026-05-12"),
      currencyCode: "VES",
      totalAmountOriginal: new Decimal("1000"),
      exchangeRate: new Decimal("1"),
      originAccountId: "acc-origin",
      lines: BASE_LINES,
      createdBy: USER_ID,
      idempotencyKey: "key-1",
    });

    // Premisa del bug del `count`: crear SÍ inserta fila, pero NO emite
    // correlativo. Por eso contar filas nunca pudo aproximar el correlativo.
    const data = (
      vi.mocked(prisma.incomeDistribution.create).mock.calls.at(-1)?.[0] as unknown as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.referenceNumber).toBeUndefined();
  });

  it("lanza error de negocio cuando P2002 en idempotencyKey", async () => {
    const p2002 = Object.assign(new Error("Unique"), { code: "P2002", meta: { target: ["idempotencyKey"] } });
    vi.mocked(prisma.incomeDistribution.create).mockRejectedValue(p2002);

    const { createDistribution } = await import("../services/IncomeDistributionService");
    await expect(
      createDistribution({
        companyId: COMPANY_ID,
        date: new Date("2026-05-12"),
        currencyCode: "VES",
        totalAmountOriginal: new Decimal("1000"),
        exchangeRate: new Decimal("1"),
        originAccountId: "acc-origin",
        lines: BASE_LINES,
        createdBy: USER_ID,
        idempotencyKey: "key-1",
      })
    ).rejects.toThrow("ya fue creada");
  });
});

// ─── applyDistribution ────────────────────────────────────────────────────────

describe("applyDistribution (mocked)", () => {
  const draftDist = {
    id: "dist-1",
    companyId: COMPANY_ID,
    status: "DRAFT" as const,
    referenceNumber: null,
    description: "Test",
    date: new Date("2026-05-12"),
    currencyCode: "VES",
    totalAmountOriginal: new Decimal("1000"),
    totalAmountVes: new Decimal("1000"),
    exchangeRate: new Decimal("1"),
    originAccountId: "acc-origin",
    originAccount: { code: "1100", name: "Caja" },
    transactionId: null,
    idempotencyKey: "key-1",
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: USER_ID,
    deletedAt: null,
    updatedAt: new Date(),
    lines: [
      { id: "l1", distributionId: "dist-1", recipientCompanyId: "rc-1", recipientCompany: { name: "A" }, accountId: "acc-1", account: { code: "2100", name: "CxP A" }, percentageShare: new Decimal("60"), amountVes: new Decimal("600"), lineDescription: null, lineNumber: 1 },
      { id: "l2", distributionId: "dist-1", recipientCompanyId: "rc-2", recipientCompany: { name: "B" }, accountId: "acc-2", account: { code: "2101", name: "CxP B" }, percentageShare: new Decimal("40"), amountVes: new Decimal("400"), lineDescription: null, lineNumber: 2 },
    ],
  };

  /** Fila mínima de la tabla falsa que alimenta el lookup del correlativo. */
  type FakeRow = { companyId: string; referenceNumber: string | null };

  type FindFirstArgs = {
    where?: { id?: string; companyId?: string; referenceNumber?: { startsWith?: string } };
    orderBy?: { referenceNumber?: "asc" | "desc" };
  };

  /**
   * Instala `incomeDistribution.findFirst` con los DOS comportamientos que le
   * pide producción, discriminados por la forma del `where`:
   *
   *   1. `where.id` presente → lookup de la distribución a aplicar
   *   2. resto               → lookup del correlativo (MÁXIMO + 1)
   *
   * El lookup del correlativo NO devuelve un literal: recorre `rows` respetando
   * `where.companyId`, `where.referenceNumber.startsWith` y `orderBy`. Es
   * deliberado — un mock de valor fijo devuelve lo mismo con la fórmula correcta
   * y con la equivocada, que fue exactamente el agujero por el que se colaron
   * los correlativos duplicados. Con la tabla falsa, si producción pierde el
   * `orderBy: desc` o el filtro de empresa, sale otra fila y el test muere.
   */
  function installFindFirst(rows: FakeRow[], dist: unknown = draftDist) {
    vi.mocked(prisma.incomeDistribution.findFirst).mockImplementation((async (
      args: FindFirstArgs,
    ) => {
      if (args?.where?.id !== undefined) return dist;

      const prefix = args?.where?.referenceNumber?.startsWith ?? "";
      const tenant = args?.where?.companyId;
      const matches = rows.filter(
        (r) =>
          r.referenceNumber !== null &&
          r.referenceNumber.startsWith(prefix) &&
          (tenant === undefined || r.companyId === tenant),
      );
      const direction = args?.orderBy?.referenceNumber;
      let chosen: FakeRow | undefined;
      if (direction === undefined) {
        // Sin ORDER BY el motor no promete ningún orden: emulamos el de inserción.
        chosen = matches[0];
      } else {
        const sorted = [...matches].sort((a, b) =>
          (a.referenceNumber as string).localeCompare(b.referenceNumber as string),
        );
        chosen = direction === "desc" ? sorted[sorted.length - 1] : sorted[0];
      }
      return chosen ? { referenceNumber: chosen.referenceNumber } : null;
    }) as never);
  }

  /** `data` con el que el código llamó a `incomeDistribution.update`. */
  function updateData() {
    const call = vi.mocked(prisma.incomeDistribution.update).mock.calls.at(-1);
    if (!call) throw new Error("incomeDistribution.update no fue llamado");
    return (call[0] as unknown as {
      data: { status?: string; referenceNumber?: string | null; transactionId?: string | null };
    }).data;
  }

  /** `data` con el que el código llamó a `transaction.create`. */
  function transactionData() {
    const call = vi.mocked(prisma.transaction.create).mock.calls.at(-1);
    if (!call) throw new Error("transaction.create no fue llamado");
    return (call[0] as unknown as { data: { number?: string; description?: string } }).data;
  }

  /** `changesSummary` del AuditLog del módulo. */
  function auditSummary() {
    const call = vi.mocked(prisma.incomeDistributionAudit.create).mock.calls.at(-1);
    if (!call) throw new Error("incomeDistributionAudit.create no fue llamado");
    return (call[0] as unknown as { data: { changesSummary: { referenceNumber?: string } } }).data
      .changesSummary;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
    );
    installFindFirst([]);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    // El update DEVUELVE lo que se le pasó (como un `RETURNING` real): así el
    // objeto que sale del servicio refleja el correlativo que calculó el código
    // y no un literal escrito en el mock.
    vi.mocked(prisma.incomeDistribution.update).mockImplementation((async (args: {
      data: { status?: string; referenceNumber?: string | null; transactionId?: string | null };
    }) => ({
      ...draftDist,
      status: args.data.status ?? draftDist.status,
      referenceNumber: args.data.referenceNumber ?? null,
      transactionId: args.data.transactionId ?? null,
    })) as never);
    vi.mocked(prisma.incomeDistributionAudit.create).mockResolvedValue({} as never);
  });

  it("cambia estado a APPLIED y asigna referenceNumber", async () => {
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    const result = await applyDistribution("dist-1", COMPANY_ID, USER_ID);

    // Se afirma el argumento que recibió el UPDATE — ahí es donde el código
    // produce el correlativo. Leerlo del valor de retorno del mock era un test
    // que no podía fallar.
    expect(updateData().status).toBe("APPLIED");
    expect(updateData().referenceNumber).toBe("DIST-000001");
    expect(updateData().transactionId).toBe("tx-1");
    expect(result.status).toBe("APPLIED");
    expect(result.referenceNumber).toBe("DIST-000001");
  });

  it("lanza error si la distribución no existe", async () => {
    installFindFirst([], null);
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    await expect(applyDistribution("dist-x", COMPANY_ID, USER_ID)).rejects.toThrow("no encontrada");
  });

  it("lanza error si el estado no es DRAFT", async () => {
    installFindFirst([], { ...draftDist, status: "APPLIED" });
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    await expect(applyDistribution("dist-1", COMPANY_ID, USER_ID)).rejects.toThrow("no puede aplicarse");
  });

  it("no persiste nada si el estado no es DRAFT", async () => {
    installFindFirst([], { ...draftDist, status: "APPLIED" });
    const { applyDistribution } = await import("../services/IncomeDistributionService");
    await expect(applyDistribution("dist-1", COMPANY_ID, USER_ID)).rejects.toThrow();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.incomeDistribution.update).not.toHaveBeenCalled();
  });

  // ─── Correlativo DIST- (Z-1) ────────────────────────────────────────────────

  describe("correlativo DIST- (MÁXIMO + 1)", () => {
    /** Aplica y devuelve el correlativo tal como se lo pasó el código al UPDATE. */
    async function applyAndReadReference(): Promise<string | null | undefined> {
      const { applyDistribution } = await import("../services/IncomeDistributionService");
      await applyDistribution("dist-1", COMPANY_ID, USER_ID);
      return updateData().referenceNumber;
    }

    it("sin distribuciones previas con referencia → DIST-000001", async () => {
      installFindFirst([]);
      expect(await applyAndReadReference()).toBe("DIST-000001");
    });

    it("último = DIST-000002 → siguiente DIST-000003", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-000002" }]);
      expect(await applyAndReadReference()).toBe("DIST-000003");
    });

    it("toma el MÁXIMO, no la primera fila que devuelve la tabla", async () => {
      // Las filas llegan desordenadas a propósito: si el lookup pierde el
      // `orderBy: { referenceNumber: "desc" }`, el motor no promete ningún orden
      // y el máximo deja de ser el que se lee. Sin desc esto daría DIST-000002.
      installFindFirst([
        { companyId: COMPANY_ID, referenceNumber: "DIST-000001" },
        { companyId: COMPANY_ID, referenceNumber: "DIST-000003" },
        { companyId: COMPANY_ID, referenceNumber: "DIST-000002" },
      ]);
      expect(await applyAndReadReference()).toBe("DIST-000004");
    });

    it("REGRESIÓN (bug del count): 2 borradores creados y el último aplicado con DIST-000002 → aplicar el otro da DIST-000003, no DIST-000002", async () => {
      // Estado exacto que reventaba en producción, SIN NINGUNA CARRERA:
      //   crear D1 → 1 fila · crear D2 → 2 filas
      //   aplicar D2 → count = 2 → DIST-000002
      //   aplicar D1 → count = 2 → DIST-000002   ← duplicado
      // `count` cuenta FILAS y aplicar no crea filas: la fila nace en
      // createDistribution como DRAFT y aquí sólo se hace update. El duplicado
      // reventaba antes con P2002 sobre Transaction.number
      // (@@unique([companyId, number])), no sobre referenceNumber.
      installFindFirst([
        { companyId: COMPANY_ID, referenceNumber: "DIST-000002" }, // D2, ya aplicada
        { companyId: COMPANY_ID, referenceNumber: null }, // D1, la que se aplica ahora
      ]);
      expect(await applyAndReadReference()).toBe("DIST-000003");
    });

    it("último = DIST-000009 → DIST-000010 (el relleno de ceros no se rompe)", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-000009" }]);
      expect(await applyAndReadReference()).toBe("DIST-000010");
    });

    it("último = DIST-000099 → DIST-000100 (relleno a 6 dígitos)", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-000099" }]);
      expect(await applyAndReadReference()).toBe("DIST-000100");
    });

    it("referenceNumber con basura no numérica → no lanza, cae a DIST-000001", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-ABCDEF" }]);
      expect(await applyAndReadReference()).toBe("DIST-000001");
    });

    it("referenceNumber con sufijo vacío → no lanza, cae a DIST-000001", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-" }]);
      expect(await applyAndReadReference()).toBe("DIST-000001");
    });

    it("ignora correlativos de otra empresa (ADR-004)", async () => {
      installFindFirst([{ companyId: "otra-empresa", referenceNumber: "DIST-000007" }]);
      expect(await applyAndReadReference()).toBe("DIST-000001");
    });

    it("consulta el máximo con prefijo DIST-, filtro de empresa y orderBy desc", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-000002" }]);
      await applyAndReadReference();

      const sequenceCall = vi
        .mocked(prisma.incomeDistribution.findFirst)
        .mock.calls.map((c) => c[0] as unknown as FindFirstArgs)
        .find((a) => a?.where?.referenceNumber !== undefined);

      expect(sequenceCall).toBeDefined();
      expect(sequenceCall?.where?.companyId).toBe(COMPANY_ID);
      expect(sequenceCall?.where?.referenceNumber?.startsWith).toBe("DIST-");
      expect(sequenceCall?.orderBy?.referenceNumber).toBe("desc");
    });

    it("Transaction.number recibe el MISMO valor que referenceNumber", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-000041" }]);
      const { applyDistribution } = await import("../services/IncomeDistributionService");
      await applyDistribution("dist-1", COMPANY_ID, USER_ID);

      // Un desajuste aquí es el que reventaba con P2002 sobre
      // @@unique([companyId, number]) de Transaction.
      expect(transactionData().number).toBe("DIST-000042");
      expect(transactionData().number).toBe(updateData().referenceNumber);
    });

    it("la auditoría registra el mismo correlativo que se persistió (R-6)", async () => {
      installFindFirst([{ companyId: COMPANY_ID, referenceNumber: "DIST-000002" }]);
      const { applyDistribution } = await import("../services/IncomeDistributionService");
      await applyDistribution("dist-1", COMPANY_ID, USER_ID);

      expect(auditSummary().referenceNumber).toBe("DIST-000003");
      expect(auditSummary().referenceNumber).toBe(updateData().referenceNumber);
    });
  });

  // ─── Concurrencia: el retry P2034 es lo que hace seguro el MÁXIMO + 1 ───────

  describe("reintento P2034 (Serializable)", () => {
    it("tras un abort de SSI relee el máximo NUEVO: DIST-000004, no el que ya tomó el otro", async () => {
      // MÁXIMO + 1 es seguro bajo concurrencia precisamente porque la
      // transacción rival ESCRIBE un referenceNumber dentro del predicado que
      // aquí se lee, así que SSI aborta con P2034 y el retry relee. Si el retry
      // reusara el número leído en el primer intento, volvería el duplicado.
      const rows = [{ companyId: COMPANY_ID, referenceNumber: "DIST-000002" }];
      installFindFirst(rows);

      let attempt = 0;
      vi.mocked(prisma.$transaction).mockImplementation((async (
        fn: (tx: typeof prisma) => unknown,
      ) => {
        attempt++;
        if (attempt === 1) {
          await fn(prisma); // el primer intento calcula DIST-000003…
          // …pero la rival ya lo escribió y el commit aborta.
          rows.push({ companyId: COMPANY_ID, referenceNumber: "DIST-000003" });
          throw Object.assign(new Error("could not serialize access"), { code: "P2034" });
        }
        return fn(prisma);
      }) as never);

      const { applyDistribution } = await import("../services/IncomeDistributionService");
      const result = await applyDistribution("dist-1", COMPANY_ID, USER_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(updateData().referenceNumber).toBe("DIST-000004");
      expect(transactionData().number).toBe("DIST-000004");
      expect(result.referenceNumber).toBe("DIST-000004");
    });

    it("agotados los 3 intentos devuelve mensaje de negocio, no el P2034 crudo", async () => {
      vi.mocked(prisma.$transaction).mockRejectedValue(
        Object.assign(new Error("could not serialize access"), { code: "P2034" }),
      );

      const { applyDistribution } = await import("../services/IncomeDistributionService");
      await expect(applyDistribution("dist-1", COMPANY_ID, USER_ID)).rejects.toThrow(
        "Conflicto de concurrencia",
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });
});

// ─── voidDistribution ─────────────────────────────────────────────────────────

describe("voidDistribution (mocked)", () => {
  const draftDist = {
    id: "dist-1",
    companyId: COMPANY_ID,
    status: "DRAFT" as const,
    referenceNumber: null,
    description: null,
    date: new Date("2026-05-12"),
    currencyCode: "VES",
    totalAmountOriginal: new Decimal("1000"),
    totalAmountVes: new Decimal("1000"),
    exchangeRate: new Decimal("1"),
    originAccountId: "acc-origin",
    originAccount: { code: "1100", name: "Caja" },
    transactionId: null,
    idempotencyKey: "key-1",
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    createdAt: new Date(),
    createdBy: USER_ID,
    deletedAt: null,
    updatedAt: new Date(),
    lines: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
    );
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue(draftDist as never);
    vi.mocked(prisma.incomeDistribution.update).mockResolvedValue({ ...draftDist, status: "VOID" } as never);
    vi.mocked(prisma.incomeDistributionAudit.create).mockResolvedValue({} as never);
  });

  it("anula una distribución DRAFT", async () => {
    const { voidDistribution } = await import("../services/IncomeDistributionService");
    const result = await voidDistribution("dist-1", COMPANY_ID, "Error de entrada", USER_ID);
    expect(result.status).toBe("VOID");
  });

  it("bloquea anular una distribución APPLIED", async () => {
    vi.mocked(prisma.incomeDistribution.findFirst).mockResolvedValue({ ...draftDist, status: "APPLIED" } as never);
    const { voidDistribution } = await import("../services/IncomeDistributionService");
    await expect(
      voidDistribution("dist-1", COMPANY_ID, "Error", USER_ID)
    ).rejects.toThrow("Solo se pueden anular distribuciones en DRAFT");
  });
});

// ─── Zod schema validations ───────────────────────────────────────────────────

describe("CreateIncomeDistributionSchema validations", () => {
  const valid = {
    companyId: "clh1234567890abcdefghijk",
    date: "2026-05-12",
    currencyCode: "VES",
    totalAmountOriginal: "1000",
    exchangeRate: "1",
    originAccountId: "clh1234567890abcdefghijk",
    lines: [
      { recipientCompanyId: "clh1234567890abcdefghijk", accountId: "clh1234567890abcdefghijk", percentageShare: "60" },
      { recipientCompanyId: "clhabcdefghijk1234567890", accountId: "clhabcdefghijk1234567890", percentageShare: "40" },
    ],
  };

  it("acepta input válido", () => {
    expect(CreateIncomeDistributionSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza suma de porcentajes ≠ 100", () => {
    const bad = { ...valid, lines: [
      { ...valid.lines[0], percentageShare: "50" },
      { ...valid.lines[1], percentageShare: "40" },
    ]};
    expect(CreateIncomeDistributionSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza destinatarios duplicados", () => {
    const bad = { ...valid, lines: [
      { ...valid.lines[0], percentageShare: "50" },
      { ...valid.lines[0], percentageShare: "50" },
    ]};
    expect(CreateIncomeDistributionSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza menos de 2 líneas", () => {
    const bad = { ...valid, lines: [valid.lines[0]] };
    expect(CreateIncomeDistributionSchema.safeParse(bad).success).toBe(false);
  });

  it("rechaza totalAmountOriginal <= 0", () => {
    expect(CreateIncomeDistributionSchema.safeParse({ ...valid, totalAmountOriginal: "0" }).success).toBe(false);
    expect(CreateIncomeDistributionSchema.safeParse({ ...valid, totalAmountOriginal: "-100" }).success).toBe(false);
  });
});
