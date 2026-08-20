// src/modules/inventory/__tests__/InventoryOperationsService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    account: { findFirstOrThrow: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },  // R-09: bloqueo períodos cerrados
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    inventoryMovement: {
      // `findUnique` NO se declara a proposito: el lookup de idempotencia debe
      // ser `findFirst` acotado por companyId. Si alguien vuelve a
      // `findUnique({ where: { idempotencyKey } })` (el IDOR cross-tenant),
      // estos tests revientan en vez de pasar en verde.
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    invoice: { findFirstOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  createInventoryItem,
  updateInventoryItem,
  createDraftMovement,
  voidDraftMovement,
  getInventoryItems,
  getItemMovements,
} from "../services/InventoryOperationsService";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const COMPANY_ID = "company-001";
const USER_ID = "user-test";

const makeItem = (overrides = {}) => ({
  id: "item-001",
  companyId: COMPANY_ID,
  sku: "PROD-001",
  name: "Producto Test",
  averageCost: new Decimal("100.00"),
  stockQuantity: new Decimal("10.00"),
  deletedAt: null,
  accountId: "acc-inv",
  cogsAccountId: "acc-cogs",
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: USER_ID,
  description: null,
  ...overrides,
});

const makeTx = () => ({
  inventoryItem: {
    create: vi.fn().mockResolvedValue(makeItem()),
    update: vi.fn().mockResolvedValue(makeItem()),
    findFirstOrThrow: vi.fn().mockResolvedValue(makeItem()),
  },
  inventoryMovement: {
    create: vi.fn().mockResolvedValue({
      id: "mov-001",
      status: "DRAFT",
      itemId: "item-001",
      type: "ENTRADA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("100"),
      totalCost: new Decimal("500"),
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    }),
    update: vi.fn().mockResolvedValue({ id: "mov-001", status: "VOIDED" }),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

let currentTx: ReturnType<typeof makeTx>;

beforeEach(() => {
  vi.clearAllMocks();
  currentTx = makeTx();

  vi.mocked(prisma.account.findFirstOrThrow).mockResolvedValue({ id: "acc-inv" } as never);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never); // R-09: no hay período cerrado
  vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValue(makeItem() as never);
  vi.mocked(prisma.inventoryMovement.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.inventoryMovement.findFirstOrThrow).mockResolvedValue({
    id: "mov-001",
    status: "DRAFT",
    companyId: COMPANY_ID,
  } as never);
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.inventoryMovement.count).mockResolvedValue(0 as never);  // R-05: sin movimientos POSTED
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof currentTx) => unknown) => fn(currentTx)) as never
  );
});

// ─── createInventoryItem ──────────────────────────────────────────────────────

describe("createInventoryItem", () => {
  it("crea un ítem con los datos correctos", async () => {
    const result = await createInventoryItem(
      { companyId: COMPANY_ID, sku: "PROD-001", name: "Test", itemType: "GOODS", defaultTaxRate: "GENERAL" },
      USER_ID
    );
    expect(result).toBeDefined();
    expect(currentTx.inventoryItem.create).toHaveBeenCalledOnce();
    expect(currentTx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("CRITICAL-2: verifica ownership de accountId antes de crear", async () => {
    vi.mocked(prisma.account.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Account not found")
    );
    await expect(
      createInventoryItem(
        {
          companyId: COMPANY_ID,
          sku: "X",
          name: "Test",
          itemType: "GOODS",
          defaultTaxRate: "GENERAL",
          accountId: "acc-other-company",
          cogsAccountId: "acc-cogs",
        },
        USER_ID
      )
    ).rejects.toThrow("Account not found");
  });

  it("CRITICAL-2: verifica ownership de cogsAccountId", async () => {
    vi.mocked(prisma.account.findFirstOrThrow)
      .mockResolvedValueOnce({ id: "acc-inv" } as never)
      .mockRejectedValueOnce(new Error("COGS account not found"));
    await expect(
      createInventoryItem(
        {
          companyId: COMPANY_ID,
          sku: "X",
          name: "Test",
          itemType: "GOODS",
          defaultTaxRate: "GENERAL",
          accountId: "acc-inv",
          cogsAccountId: "acc-other-company-cogs",
        },
        USER_ID
      )
    ).rejects.toThrow("COGS account not found");
  });

  it("no verifica accounts si no se proporcionan (SERVICE)", async () => {
    await createInventoryItem(
      { companyId: COMPANY_ID, sku: "NO-ACCS", name: "Sin cuentas", itemType: "SERVICE", defaultTaxRate: "EXEMPT" },
      USER_ID
    );
    expect(vi.mocked(prisma.account.findFirstOrThrow)).not.toHaveBeenCalled();
  });
});

// ─── updateInventoryItem ──────────────────────────────────────────────────────

describe("updateInventoryItem", () => {
  it("CRITICAL-1: usa findFirstOrThrow con companyId para verificar ownership", async () => {
    await updateInventoryItem({ itemId: "item-001", companyId: COMPANY_ID, name: "Nuevo" }, USER_ID);
    expect(vi.mocked(prisma.inventoryItem.findFirstOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "item-001", companyId: COMPANY_ID }),
      })
    );
  });

  it("lanza error si el ítem no pertenece a la empresa (CRITICAL-1)", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockRejectedValueOnce(
      new Error("No InventoryItem found")
    );
    await expect(
      updateInventoryItem({ itemId: "item-other", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow();
  });

  it("actualiza solo los campos proporcionados", async () => {
    await updateInventoryItem({ itemId: "item-001", companyId: COMPANY_ID, name: "Nuevo" }, USER_ID);
    const updateCall = currentTx.inventoryItem.update.mock.calls[0]![0];
    expect(updateCall.data).toMatchObject({ name: "Nuevo" });
    expect(updateCall.data.sku).toBeUndefined();
  });
});

// ─── createDraftMovement ──────────────────────────────────────────────────────

describe("createDraftMovement", () => {
  const BASE = {
    companyId: COMPANY_ID,
    itemId: "item-001",
    type: "ENTRADA" as const,
    quantity: 5,
    unitCost: "120",
    reference: "REF-TEST-001",  // R-03: referencia obligatoria (min 3 chars)
    date: new Date().toISOString(),
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
  };

  it("crea movimiento DRAFT con unitCost del input para ENTRADA", async () => {
    await createDraftMovement(BASE, USER_ID);
    const createCall = currentTx.inventoryMovement.create.mock.calls[0]![0];
    expect(createCall.data.unitCost.toString()).toBe("120");
    expect(createCall.data.totalCost.toString()).toBe("600"); // 5 × 120
  });

  it("MEDIUM-2: para SALIDA usa CPP del ítem — ignora unitCost del cliente", async () => {
    await createDraftMovement({ ...BASE, type: "SALIDA", unitCost: "999" }, USER_ID);
    const createCall = currentTx.inventoryMovement.create.mock.calls[0]![0];
    // unitCost debe ser 100 (averageCost del ítem), no 999
    expect(createCall.data.unitCost.toString()).toBe("100");
  });

  it("lanza error si SALIDA con stock insuficiente", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValueOnce(
      makeItem({ stockQuantity: new Decimal("3") }) as never
    );
    await expect(
      createDraftMovement({ ...BASE, type: "SALIDA", quantity: 5 }, USER_ID)
    ).rejects.toThrow("Stock insuficiente");
  });

  it("CRITICAL-1: usa findFirstOrThrow con companyId para verificar ítem", async () => {
    await createDraftMovement(BASE, USER_ID);
    expect(vi.mocked(prisma.inventoryItem.findFirstOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "item-001", companyId: COMPANY_ID }),
      })
    );
  });

  it("es idempotente — retorna movimiento existente si ya existe idempotencyKey", async () => {
    const existingMovement = { id: "mov-existing", status: "DRAFT", companyId: COMPANY_ID };
    // findFirst se llama en prisma directo (no en tx)
    vi.mocked(prisma.inventoryMovement.findFirst).mockResolvedValueOnce(
      existingMovement as never
    );
    const result = await createDraftMovement(BASE, USER_ID);
    expect(result).toEqual(existingMovement);
    expect(currentTx.inventoryMovement.create).not.toHaveBeenCalled();
    // ADR-004: el lookup va acotado a la empresa, no solo a la clave
    expect(vi.mocked(prisma.inventoryMovement.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idempotencyKey: BASE.idempotencyKey,
          companyId: COMPANY_ID,
        }),
      })
    );
  });

  it("verifica ownership de invoiceId si se proporciona", async () => {
    vi.mocked(prisma.invoice.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Invoice not found")
    );
    await expect(
      createDraftMovement({ ...BASE, invoiceId: "inv-other-company" }, USER_ID)
    ).rejects.toThrow("Invoice not found");
  });
});

// ─── createDraftMovement — idempotencia acotada a companyId (regresión IDOR) ──
//
// `InventoryMovement.idempotencyKey` es `@unique` GLOBAL y el valor lo suministra
// el CLIENTE. Sin `companyId` en el lookup, la empresa B que reusara la clave de
// la empresa A recibía de vuelta el movimiento de inventario de A (`return
// existing`) y su propio movimiento no se creaba nunca.

describe("createDraftMovement — idempotencia acotada a companyId (regresión IDOR)", () => {
  const SHARED_KEY = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_COMPANY = "company-ajena";

  const BASE = {
    companyId: COMPANY_ID,
    itemId: "item-001",
    type: "ENTRADA" as const,
    quantity: 5,
    unitCost: "120",
    reference: "REF-TEST-001",
    date: new Date().toISOString(),
    idempotencyKey: SHARED_KEY,
  };

  // Movimiento que YA existe en la BD, pero pertenece a OTRA empresa.
  const foreignMovement = {
    id: "mov-de-otra-empresa",
    companyId: OTHER_COMPANY,
    itemId: "item-ajeno",
    type: "SALIDA",
    quantity: new Decimal("999"),
    idempotencyKey: SHARED_KEY,
    status: "POSTED",
  };

  /**
   * `findFirst` falso que se comporta como la BD: filtra por TODAS las claves
   * escalares del `where`. Si el servicio omite `companyId`, la fila ajena hace
   * match y el test falla — un `mockResolvedValue(fila)` plano no detectaría nada.
   */
  function fakeFindFirst(rows: Array<Record<string, unknown>>) {
    return vi.fn(async (args?: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      const scalar = Object.entries(where).filter(
        ([, v]) => v === null || typeof v !== "object"
      );
      return rows.find((row) => scalar.every(([k, v]) => row[k] === v)) ?? null;
    });
  }

  it("NO devuelve el movimiento de otra empresa cuando reusan la misma idempotencyKey", async () => {
    vi.mocked(prisma.inventoryMovement.findFirst).mockImplementation(
      fakeFindFirst([foreignMovement]) as never
    );

    const result = await createDraftMovement(BASE, USER_ID);

    // No se filtra el movimiento ajeno...
    expect(result.id).not.toBe("mov-de-otra-empresa");
    // ...y el movimiento propio SÍ se crea (antes se perdía en silencio)
    expect(currentTx.inventoryMovement.create).toHaveBeenCalledOnce();
    expect(currentTx.inventoryMovement.create.mock.calls[0]![0].data.companyId).toBe(
      COMPANY_ID
    );
  });

  it("el where del lookup lleva companyId además de la clave", async () => {
    vi.mocked(prisma.inventoryMovement.findFirst).mockImplementation(
      fakeFindFirst([foreignMovement]) as never
    );

    await createDraftMovement(BASE, USER_ID);

    const where = vi.mocked(prisma.inventoryMovement.findFirst).mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({ idempotencyKey: SHARED_KEY, companyId: COMPANY_ID });
    expect(Object.keys(where)).toContain("companyId");
  });

  it("la idempotencia legítima sigue funcionando: misma clave + MISMA empresa devuelve la fila existente", async () => {
    const ownMovement = {
      id: "mov-propio-existente",
      companyId: COMPANY_ID,
      idempotencyKey: SHARED_KEY,
      status: "DRAFT",
    };
    vi.mocked(prisma.inventoryMovement.findFirst).mockImplementation(
      fakeFindFirst([foreignMovement, ownMovement]) as never
    );

    const result = await createDraftMovement(BASE, USER_ID);

    expect(result.id).toBe("mov-propio-existente");
    expect(currentTx.inventoryMovement.create).not.toHaveBeenCalled();
  });
});

// ─── voidDraftMovement ────────────────────────────────────────────────────────

describe("voidDraftMovement", () => {
  it("anula movimiento DRAFT correctamente", async () => {
    vi.mocked(prisma.inventoryMovement.findFirstOrThrow).mockResolvedValue({
      id: "mov-001",
      status: "DRAFT",
      companyId: COMPANY_ID,
    } as never);
    const result = await voidDraftMovement(
      { movementId: "mov-001", companyId: COMPANY_ID },
      USER_ID
    );
    expect(result.status).toBe("VOIDED");
  });

  it("lanza error si el movimiento no está en DRAFT", async () => {
    vi.mocked(prisma.inventoryMovement.findFirstOrThrow).mockResolvedValue({
      id: "mov-001",
      status: "POSTED",
      companyId: COMPANY_ID,
    } as never);
    await expect(
      voidDraftMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Solo se pueden anular movimientos en DRAFT");
  });
});

// ─── getInventoryItems ────────────────────────────────────────────────────────

describe("getInventoryItems", () => {
  it("ADR-004: consulta siempre incluye companyId en el where", async () => {
    await getInventoryItems(COMPANY_ID);
    expect(vi.mocked(prisma.inventoryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID }),
      })
    );
  });
});

// ─── getItemMovements ─────────────────────────────────────────────────────────

describe("getItemMovements", () => {
  beforeEach(() => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValue({
      id: "item-001",
    } as never);
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([] as never);
  });

  it("CRITICAL-1: verifica ownership del ítem antes de consultar movimientos", async () => {
    await getItemMovements(COMPANY_ID, "item-001");
    expect(vi.mocked(prisma.inventoryItem.findFirstOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-001", companyId: COMPANY_ID },
      })
    );
  });

  it("consulta movimientos con companyId e itemId en el where", async () => {
    await getItemMovements(COMPANY_ID, "item-001");
    expect(vi.mocked(prisma.inventoryMovement.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, itemId: "item-001" },
        orderBy: { date: "desc" },
      })
    );
  });

  it("lanza error si el ítem no pertenece a la empresa (CRITICAL-1)", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockRejectedValueOnce(
      new Error("No encontrado")
    );
    await expect(getItemMovements(COMPANY_ID, "item-ajeno")).rejects.toThrow("No encontrado");
    expect(vi.mocked(prisma.inventoryMovement.findMany)).not.toHaveBeenCalled();
  });

  it("devuelve array vacío cuando no hay movimientos", async () => {
    const result = await getItemMovements(COMPANY_ID, "item-001");
    expect(result).toEqual([]);
  });
});

// ─── createDraftMovement — recuperación TOCTOU del P2002 (auditoría LOW) ──────
//
// Mismo caso que ExpenseService: el pre-check de idempotencia está FUERA de la
// transacción, así que dos submits con la misma clave lo pasan los dos y el
// perdedor chocaba con el `@@unique([companyId, idempotencyKey])` en vez de
// recibir el movimiento que ya se creó con su clave.
//
// La carrera se modela con un `db` mutable: el pre-check lo lee vacío y el
// `$transaction` inserta la fila del GANADOR justo antes de lanzar el P2002.
describe("createDraftMovement — recuperación TOCTOU del P2002 de idempotencia", () => {
  const KEY = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_COMPANY = "company-ajena";

  const BASE = {
    companyId: COMPANY_ID,
    itemId: "item-001",
    type: "ENTRADA" as const,
    quantity: 5,
    unitCost: "120",
    reference: "REF-TOCTOU-001",
    date: new Date().toISOString(),
    idempotencyKey: KEY,
  };

  const p2002 = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target },
    });

  // Forma REAL del target con el adaptador de Neon sobre @@unique compuesto.
  const IDEMPOTENCY_TARGET = ["companyId", "idempotencyKey"];

  const winner = {
    id: "mov-del-ganador",
    companyId: COMPANY_ID,
    itemId: "item-001",
    type: "ENTRADA",
    status: "DRAFT",
    idempotencyKey: KEY,
  };

  const foreignWinner = {
    id: "mov-de-otra-empresa",
    companyId: OTHER_COMPANY,
    itemId: "item-ajeno",
    type: "SALIDA",
    status: "POSTED",
    idempotencyKey: KEY,
  };

  let db: Array<Record<string, unknown>>;

  /** `findFirst` que filtra por TODAS las claves escalares del `where`, como la BD. */
  function fakeFindFirstOn(rows: Array<Record<string, unknown>>) {
    return vi.fn(async (args?: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      const scalar = Object.entries(where).filter(([, v]) => v === null || typeof v !== "object");
      return rows.find((row) => scalar.every(([k, v]) => row[k] === v)) ?? null;
    });
  }

  function raceThenThrow(row: Record<string, unknown> | null, err: unknown) {
    vi.mocked(prisma.$transaction).mockImplementation((async () => {
      if (row) db.push(row);
      throw err;
    }) as never);
  }

  beforeEach(() => {
    db = [];
    vi.mocked(prisma.inventoryMovement.findFirst).mockImplementation(fakeFindFirstOn(db) as never);
  });

  it("devuelve el movimiento del ganador en vez de propagar el P2002", async () => {
    raceThenThrow(winner, p2002(IDEMPOTENCY_TARGET));

    const result = await createDraftMovement(BASE, USER_ID);

    expect(result.id).toBe("mov-del-ganador");
    // Dos lecturas: pre-check (vacío) + recuperación del catch.
    expect(vi.mocked(prisma.inventoryMovement.findFirst)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1);
  });

  it("el findFirst de recuperación va acotado por companyId (ADR-004)", async () => {
    raceThenThrow(winner, p2002(IDEMPOTENCY_TARGET));

    await createDraftMovement(BASE, USER_ID);

    const recoveryWhere = vi.mocked(prisma.inventoryMovement.findFirst).mock.calls[1]![0]!.where!;
    expect(recoveryWhere).toEqual({ idempotencyKey: KEY, companyId: COMPANY_ID });
    expect(Object.keys(recoveryWhere)).toContain("companyId");
  });

  it("NO devuelve el movimiento de otra empresa que reusó la clave — relanza el P2002", async () => {
    const err = p2002(IDEMPOTENCY_TARGET);
    raceThenThrow(foreignWinner, err);

    await expect(createDraftMovement(BASE, USER_ID)).rejects.toBe(err);
  });

  it("P2002 de OTRO constraint se relanza aunque exista una fila con esa clave", async () => {
    const err = p2002(["transactionId"]);
    raceThenThrow(winner, err);

    await expect(createDraftMovement(BASE, USER_ID)).rejects.toBe(err);
    expect(vi.mocked(prisma.inventoryMovement.findFirst)).toHaveBeenCalledTimes(1);
  });

  it("P2002 sin `meta.target` se relanza (fail-closed)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: {},
    });
    raceThenThrow(winner, err);

    await expect(createDraftMovement(BASE, USER_ID)).rejects.toBe(err);
  });

  it("un error que no es P2002 se relanza intacto — no se disfraza de idempotencia", async () => {
    const err = new Error("Stock insuficiente: disponible 3, solicitado 5");
    raceThenThrow(winner, err);

    await expect(createDraftMovement(BASE, USER_ID)).rejects.toBe(err);
    expect(vi.mocked(prisma.inventoryMovement.findFirst)).toHaveBeenCalledTimes(1);
  });

  it("P2002 de idempotencyKey pero sin fila recuperable → relanza (no inventa respuesta)", async () => {
    const err = p2002(IDEMPOTENCY_TARGET);
    raceThenThrow(null, err);

    await expect(createDraftMovement(BASE, USER_ID)).rejects.toBe(err);
    expect(vi.mocked(prisma.inventoryMovement.findFirst)).toHaveBeenCalledTimes(2);
  });
});
