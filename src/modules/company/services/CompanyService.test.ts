// src/modules/company/services/CompanyService.test.ts
//
// Contrato nuevo (auditoría MP-4 — ADR-043 / ADR-042 D-13):
//   createCompany(tx, input)  · updateSeniatData(id, userId, data, net)
//   archiveCompany(id, userId, net) · reactivateCompany(id, userId, net)
//
// ⚠️ Nota de diseño del mock — sin esto los tests del secreto serían un falso
// positivo: `applySelect` EMULA la semántica de `select` de Prisma. Con `select`
// proyecta; SIN `select` devuelve la fila ENTERA, que es exactamente lo que hacía
// el `findUniqueOrThrow` sin proyección del código anterior. Así, si alguien
// quita `select: AUDITABLE_COMPANY_FIELDS`, `digitalInvoiceApiKeyEnc` vuelve a
// aparecer en `oldValue`/`newValue` y los tests se ponen rojos.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  default: {
    company: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    companyMember: { count: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    expenseCategory: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { CompanyService, PlanLimitError, COMPANY_LIMIT_PER_USER } from "./CompanyService";

// ─── Tipos y utilidades del doble de Prisma ───────────────────────────────────

type SelectArg = Record<string, boolean> | undefined;
type QueryArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  select?: SelectArg;
};

/** Emula `select` de Prisma. Sin `select` → fila entera (el bug original). */
function applySelect(row: Record<string, unknown>, select: SelectArg): Record<string, unknown> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [field, wanted] of Object.entries(select)) {
    if (wanted) out[field] = row[field];
  }
  return out;
}

/** Centinela: si este string aparece en un AuditLog, el secreto se fugó. */
const SECRET_ENC = "ENC:AES-256-GCM:NUNCA-EN-AUDITLOG";

/**
 * Fila de `Company` tal como vive en BD: campos auditables + los que NUNCA deben
 * salir de la capa de datos (`digitalInvoiceApiKeyEnc`, schema.prisma:262).
 */
const COMPANY_ROW: Record<string, unknown> = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  country: "VEN",
  address: null,
  status: "ACTIVE",
  plan: "FREE",
  scopeProfile: null,
  isSpecialContributor: false,
  telefono: "0412-1234567",
  email: null,
  ciiu: null,
  actividad: null,
  paymentTermDays: 30,
  resultAccountId: null,
  retainedEarningsAccountId: null,
  inflationBaseYear: null,
  inflationBaseMonth: null,
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  updatedAt: new Date("2026-01-15T10:00:00.000Z"),
  // ── NO auditables ───────────────────────────────────────────────────────────
  digitalInvoiceProvider: "HKA",
  digitalInvoiceApiKeyEnc: SECRET_ENC,
};

/** R-6: valores concretos, nunca `expect.anything()`. */
const NET = { ipAddress: "203.0.113.9", userAgent: "vitest-agent/1.0" };

// Registro global de operaciones: qué se llamó, con qué args y sobre QUÉ tx.
type Recorded = { tx: string; op: string; args: QueryArgs };
let calls: Recorded[] = [];
let txSeq = 0;

function opsOf(op: string): Recorded[] {
  return calls.filter((c) => c.op === op);
}

function firstOf(op: string): Recorded {
  const found = calls.find((c) => c.op === op);
  if (!found) throw new Error(`No se registró ninguna llamada a ${op}. Registradas: ${calls.map((c) => c.op).join(", ") || "(ninguna)"}`);
  return found;
}

type TxConfig = {
  /** filas OWNER no archivadas que "ve" el count dentro de esta tx */
  ownedCount?: () => number;
  /** dueño existente del RIF buscado (null = libre) */
  rifOwner?: { id: string } | null;
  row?: Record<string, unknown>;
};

/**
 * Cliente de transacción de mentira. Cada instancia lleva un id propio: eso es lo
 * que permite afirmar que el guard de límite y el `create` ocurren sobre la MISMA
 * transacción (si el guard vuelve a salirse de la tx, el bug regresa).
 */
function makeTx(cfg: TxConfig = {}) {
  const id = `tx-${++txSeq}`;
  const row = cfg.row ?? COMPANY_ROW;
  const rec = (op: string, args: QueryArgs) => {
    calls.push({ tx: id, op, args });
  };

  const client = {
    companyMember: {
      count: vi.fn(async (args: QueryArgs) => {
        rec("companyMember.count", args);
        return cfg.ownedCount ? cfg.ownedCount() : 0;
      }),
    },
    company: {
      findUnique: vi.fn(async (args: QueryArgs) => {
        rec("company.findUnique", args);
        return cfg.rifOwner ?? null;
      }),
      create: vi.fn(async (args: QueryArgs) => {
        rec("company.create", args);
        return applySelect({ ...row, ...(args.data ?? {}) }, args.select);
      }),
      update: vi.fn(async (args: QueryArgs) => {
        rec("company.update", args);
        return applySelect({ ...row, ...(args.data ?? {}) }, args.select);
      }),
    },
    expenseCategory: {
      createMany: vi.fn(async (args: QueryArgs) => {
        rec("expenseCategory.createMany", args);
        return { count: 9 };
      }),
    },
    auditLog: {
      create: vi.fn(async (args: QueryArgs) => {
        rec("auditLog.create", args);
        return { id: "audit-1" };
      }),
    },
  };

  return { id, client, asTx: client as unknown as Prisma.TransactionClient };
}

function auditData(): Record<string, unknown> {
  return (firstOf("auditLog.create").args.data ?? {}) as Record<string, unknown>;
}

/**
 * El AuditLog se renderiza con `JSON.stringify` (AuditLogTable:106) y se exporta a
 * CSV/PDF firmado (audit.actions:221). Serializar aquí es la forma exacta de
 * preguntar "¿el secreto llega al usuario?".
 */
function expectNoSecretInAudit() {
  const data = auditData();
  const dump = JSON.stringify({ old: data.oldValue ?? null, new: data.newValue ?? null });
  expect(dump).not.toContain(SECRET_ENC);
  expect(dump).not.toContain("digitalInvoiceApiKeyEnc");
}

/** El AuditLog escribe la red que le pasaron, no `null` hardcodeado (R-6). */
function expectNetInAudit(net = NET) {
  const data = auditData();
  expect(data.ipAddress).toBe(net.ipAddress);
  expect(data.userAgent).toBe(net.userAgent);
}

// ─── Doble del `prisma` de módulo (lecturas fuera de tx + $transaction) ────────

/** Dueño del RIF consultado por `updateSeniatData` (null = libre). */
let rifOwner: { id: string } | null = null;
/** Fila "en BD" que devuelven las lecturas de módulo. */
let dbRow: Record<string, unknown> = COMPANY_ROW;
/** tx que usará `prisma.$transaction` en esta prueba. */
let writeTx: ReturnType<typeof makeTx>;

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  rifOwner = null;
  dbRow = { ...COMPANY_ROW };
  writeTx = makeTx();

  vi.mocked(prisma.company.findUnique).mockImplementation((async (args: QueryArgs) => {
    calls.push({ tx: "prisma", op: "prisma.company.findUnique", args });
    // updateSeniatData busca por rif (duplicados); archive/reactivate por id.
    if (args?.where && "rif" in args.where) return rifOwner;
    return dbRow === null ? null : applySelect(dbRow, args.select);
  }) as never);

  vi.mocked(prisma.company.findUniqueOrThrow).mockImplementation((async (args: QueryArgs) => {
    calls.push({ tx: "prisma", op: "prisma.company.findUniqueOrThrow", args });
    return applySelect(dbRow, args.select);
  }) as never);

  vi.mocked(prisma.companyMember.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);

  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
    fn(writeTx.client)) as never);
});

// ══════════════════════════════════════════════════════════════════════════════
// createCompany(tx, input)
// ══════════════════════════════════════════════════════════════════════════════

describe("CompanyService.createCompany — camino feliz", () => {
  it("crea la empresa, siembra categorías de gastos y escribe AuditLog CREATE", async () => {
    const tx = makeTx();

    const created = await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      rif: "J-12345678-9",
      address: "Av. Principal",
      scopeProfile: "EMPRESA",
      ...NET,
    });

    expect(created.id).toBe("company-1");
    expect(tx.client.company.create).toHaveBeenCalledOnce();
    expect(tx.client.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Empresa Test C.A.",
          rif: "J-12345678-9",
          country: "VEN",
          telefono: "0412-1234567",
          address: "Av. Principal",
          scopeProfile: "EMPRESA",
          status: "ACTIVE",
          members: { create: { userId: "user-1", role: "OWNER" } },
        }),
      }),
    );
    // Fase 37B: el seed va en la MISMA tx que el create
    expect(tx.client.expenseCategory.createMany).toHaveBeenCalledOnce();
    expect(firstOf("expenseCategory.createMany").tx).toBe(tx.id);

    const audit = auditData();
    expect(audit.entityName).toBe("Company");
    expect(audit.action).toBe("CREATE");
    expect(audit.entityId).toBe("company-1");
    expect(audit.companyId).toBe("company-1");
    expect(audit.userId).toBe("user-1");
  });

  it("MEDIUM-2: canonicaliza el RIF ANTES de buscar duplicado y de persistir", async () => {
    const tx = makeTx();

    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      rif: "  j123456789  ", // mismo RIF, escrito distinto
      ...NET,
    });

    // El @unique de Postgres compara strings crudos: si la búsqueda va sin
    // normalizar, dos identidades fiscales idénticas entran como empresas distintas.
    expect(tx.client.company.findUnique).toHaveBeenCalledWith({
      where: { rif: "J-12345678-9" },
      select: { id: true },
    });
    expect(tx.client.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rif: "J-12345678-9" }) }),
    );
  });

  it("sin RIF → no consulta duplicados y persiste rif null", async () => {
    const tx = makeTx();

    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Sin RIF C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      ...NET,
    });

    expect(tx.client.company.findUnique).not.toHaveBeenCalled();
    expect(tx.client.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rif: null }) }),
    );
  });
});

describe("CompanyService.createCompany — país (ADR-042 D-13)", () => {
  it("país NO soportado → LANZA; nunca degrada a VEN ni escribe nada", async () => {
    const tx = makeTx();

    await expect(
      CompanyService.createCompany(tx.asTx, {
        name: "Empresa COL S.A.S.",
        userId: "user-1",
        // Un caller sin TypeScript (seed, importador, job) puede mandar esto.
        country: "COL" as never,
        telefono: "0412-1234567",
        ...NET,
      }),
    ).rejects.toThrow(/País no soportado/);

    // La escritura es la última frontera: nada se persiste, ni siquiera se cuenta.
    expect(tx.client.companyMember.count).not.toHaveBeenCalled();
    expect(tx.client.company.create).not.toHaveBeenCalled();
    expect(tx.client.auditLog.create).not.toHaveBeenCalled();
  });

  it("el país validado es el que se persiste (no un default del servicio)", async () => {
    const tx = makeTx();

    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa VEN C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      ...NET,
    });

    expect(tx.client.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ country: "VEN" }) }),
    );
  });
});

describe("CompanyService.createCompany — límite de plan (ADR-043 D-1)", () => {
  it(`count >= COMPANY_LIMIT_PER_USER (${COMPANY_LIMIT_PER_USER}) → PlanLimitError sin crear nada`, async () => {
    const tx = makeTx({ ownedCount: () => COMPANY_LIMIT_PER_USER });

    await expect(
      CompanyService.createCompany(tx.asTx, {
        name: "Segunda Empresa C.A.",
        userId: "user-1",
        country: "VEN",
        telefono: "0412-1234567",
        ...NET,
      }),
    ).rejects.toBeInstanceOf(PlanLimitError);

    expect(tx.client.company.create).not.toHaveBeenCalled();
    expect(tx.client.auditLog.create).not.toHaveBeenCalled();
  });

  it("count == límite - 1 → deja crear", async () => {
    const tx = makeTx({ ownedCount: () => COMPANY_LIMIT_PER_USER - 1 });

    await expect(
      CompanyService.createCompany(tx.asTx, {
        name: "Primera Empresa C.A.",
        userId: "user-1",
        country: "VEN",
        telefono: "0412-1234567",
        ...NET,
      }),
    ).resolves.toBeDefined();

    expect(tx.client.company.create).toHaveBeenCalledOnce();
  });

  it("cuenta SOLO empresas propias no archivadas del usuario (OWNER + status != ARCHIVED)", async () => {
    const tx = makeTx();

    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-42",
      country: "VEN",
      telefono: "0412-1234567",
      ...NET,
    });

    expect(tx.client.companyMember.count).toHaveBeenCalledWith({
      where: {
        userId: "user-42",
        role: "OWNER",
        company: { status: { not: "ARCHIVED" } },
      },
    });
  });

  it("INVARIANTE: el count ocurre DENTRO de la misma tx que el create (nunca en el action)", async () => {
    const tx = makeTx();

    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      ...NET,
    });

    const countCall = firstOf("companyMember.count");
    const createCall = firstOf("company.create");
    // Mismo cliente transaccional…
    expect(countCall.tx).toBe(tx.id);
    expect(createCall.tx).toBe(tx.id);
    // …y en ese orden (contar después de crear no protege de nada).
    expect(calls.indexOf(countCall)).toBeLessThan(calls.indexOf(createCall));
    // Si el guard vuelve a salirse de la transacción, esto se dispara:
    expect(prisma.companyMember.count).not.toHaveBeenCalled();
  });

  it("CARRERA: dos altas concurrentes → una crea, la otra recibe PlanLimitError", async () => {
    // Emula lo que garantiza Serializable (ADR-043 D-1): la segunda transacción
    // ya no observa 0 empresas. El servicio debe REACCIONAR a esa observación —
    // si el guard se moviera fuera de la tx, ambas leerían 0 y crearían.
    const observed = [0, 1];
    const nextCount = () => observed.shift() ?? 1;
    const txA = makeTx({ ownedCount: nextCount });
    const txB = makeTx({ ownedCount: nextCount });

    const input = {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN" as const,
      telefono: "0412-1234567",
      ...NET,
    };

    const [a, b] = await Promise.allSettled([
      CompanyService.createCompany(txA.asTx, input),
      CompanyService.createCompany(txB.asTx, input),
    ]);

    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
    if (b.status === "rejected") expect(b.reason).toBeInstanceOf(PlanLimitError);

    // Exactamente UNA empresa creada en total
    expect(opsOf("company.create")).toHaveLength(1);
    expect(txA.client.company.create).toHaveBeenCalledOnce();
    expect(txB.client.company.create).not.toHaveBeenCalled();
  });
});

describe("CompanyService.createCompany — RIF duplicado (LOW-4)", () => {
  it("RIF ya registrado → lanza sin crear", async () => {
    const tx = makeTx({ rifOwner: { id: "otra-empresa" } });

    await expect(
      CompanyService.createCompany(tx.asTx, {
        name: "Otra Empresa",
        userId: "user-1",
        country: "VEN",
        telefono: "0412-1234567",
        rif: "J-12345678-9",
        ...NET,
      }),
    ).rejects.toThrow("Ese RIF ya está registrado.");

    expect(tx.client.company.create).not.toHaveBeenCalled();
  });

  it("el mensaje NO interpola el RIF (Company.rif es único global → oráculo cross-tenant)", async () => {
    const tx = makeTx({ rifOwner: { id: "otra-empresa" } });

    const error = await CompanyService.createCompany(tx.asTx, {
      name: "Otra Empresa",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      rif: "J-30684267-8",
      ...NET,
    }).catch((e: Error) => e);

    expect((error as Error).message).not.toContain("J-30684267-8");
    expect((error as Error).message).not.toContain("30684267");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updateSeniatData / archiveCompany / reactivateCompany
// ══════════════════════════════════════════════════════════════════════════════

const SENIAT_DATA = {
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: "Av. Principal",
  telefono: "0412-1234567",
  email: "fiscal@test.com",
  ciiu: "4711",
  actividad: "Comercio",
  isSpecialContributor: true,
};

describe("CompanyService.updateSeniatData", () => {
  it("actualiza y escribe AuditLog UPDATE con oldValue y newValue", async () => {
    const updated = await CompanyService.updateSeniatData("company-1", "user-1", SENIAT_DATA, NET);

    expect(updated.id).toBe("company-1");
    expect(writeTx.client.company.update).toHaveBeenCalledOnce();

    const audit = auditData();
    expect(audit.action).toBe("UPDATE");
    expect(audit.entityName).toBe("Company");
    expect(audit.companyId).toBe("company-1");
    expect(audit.userId).toBe("user-1");
    expect(audit.oldValue).toBeDefined();
    expect(audit.newValue).toBeDefined();
  });

  it("MEDIUM-2: canonicaliza el RIF antes de comparar y de persistir", async () => {
    await CompanyService.updateSeniatData(
      "company-1",
      "user-1",
      { ...SENIAT_DATA, rif: "j123456789" },
      NET,
    );

    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { rif: "J-12345678-9" },
      select: { id: true },
    });
    expect(writeTx.client.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rif: "J-12345678-9" }) }),
    );
  });

  it("RIF de OTRA empresa → lanza sin interpolar el RIF", async () => {
    rifOwner = { id: "otra-empresa" };

    const error = await CompanyService.updateSeniatData(
      "company-1",
      "user-1",
      { ...SENIAT_DATA, rif: "J-30684267-8" },
      NET,
    ).catch((e: Error) => e);

    expect((error as Error).message).toBe("Ese RIF ya está registrado.");
    expect((error as Error).message).not.toContain("30684267");
    expect(writeTx.client.company.update).not.toHaveBeenCalled();
  });

  it("el RIF ya es de ESTA empresa → no bloquea la edición", async () => {
    rifOwner = { id: "company-1" };

    await expect(
      CompanyService.updateSeniatData("company-1", "user-1", SENIAT_DATA, NET),
    ).resolves.toBeDefined();
    expect(writeTx.client.company.update).toHaveBeenCalledOnce();
  });
});

describe("CompanyService.archiveCompany", () => {
  it("archiva y escribe AuditLog ARCHIVE", async () => {
    const result = await CompanyService.archiveCompany("company-1", "user-1", NET);

    expect(result.status).toBe("ARCHIVED");
    expect(writeTx.client.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "company-1" },
        data: { status: "ARCHIVED" },
      }),
    );
    expect(auditData().action).toBe("ARCHIVE");
  });

  it("R-3/Z-3: período contable abierto → bloquea sin tocar la empresa", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);

    await expect(
      CompanyService.archiveCompany("company-1", "user-1", NET),
    ).rejects.toThrow("período contable abierto");

    expect(writeTx.client.company.update).not.toHaveBeenCalled();
    expect(writeTx.client.auditLog.create).not.toHaveBeenCalled();
  });

  it("empresa ya archivada → lanza", async () => {
    dbRow = { ...COMPANY_ROW, status: "ARCHIVED" };

    await expect(
      CompanyService.archiveCompany("company-1", "user-1", NET),
    ).rejects.toThrow("ya está archivada");
  });

  it("empresa inexistente → lanza 'Empresa no encontrada.'", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null as never);

    await expect(
      CompanyService.archiveCompany("company-404", "user-1", NET),
    ).rejects.toThrow("Empresa no encontrada.");
  });
});

describe("CompanyService.reactivateCompany", () => {
  beforeEach(() => {
    dbRow = { ...COMPANY_ROW, status: "ARCHIVED" };
  });

  it("reactiva y escribe AuditLog REACTIVATE", async () => {
    const result = await CompanyService.reactivateCompany("company-1", "user-1", NET);

    expect(result.status).toBe("ACTIVE");
    expect(writeTx.client.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "company-1" },
        data: { status: "ACTIVE" },
      }),
    );
    expect(auditData().action).toBe("REACTIVATE");
  });

  it("empresa ya activa → lanza", async () => {
    dbRow = { ...COMPANY_ROW, status: "ACTIVE" };

    await expect(
      CompanyService.reactivateCompany("company-1", "user-1", NET),
    ).rejects.toThrow("ya está activa");
  });

  it("empresa inexistente → lanza 'Empresa no encontrada.'", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null as never);

    await expect(
      CompanyService.reactivateCompany("company-404", "user-1", NET),
    ).rejects.toThrow("Empresa no encontrada.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SEGURIDAD — el secreto NUNCA llega al AuditLog (misma clase que Z-5)
// ══════════════════════════════════════════════════════════════════════════════

describe("AuditLog — `digitalInvoiceApiKeyEnc` fuera del volcado (las 4 mutaciones)", () => {
  it("createCompany: newValue no contiene el secreto aunque la fila lo traiga", async () => {
    const tx = makeTx();

    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      ...NET,
    });

    expectNoSecretInAudit();
    // Y sí conserva lo que la auditoría necesita para ser útil
    const created = auditData().newValue as Record<string, unknown>;
    expect(created.name).toBe("Empresa Test C.A.");
    expect(created.country).toBe("VEN");
  });

  it("updateSeniatData: ni oldValue ni newValue contienen el secreto", async () => {
    await CompanyService.updateSeniatData("company-1", "user-1", SENIAT_DATA, NET);
    expectNoSecretInAudit();
  });

  it("archiveCompany: ni oldValue ni newValue contienen el secreto", async () => {
    await CompanyService.archiveCompany("company-1", "user-1", NET);
    expectNoSecretInAudit();
  });

  it("reactivateCompany: ni oldValue ni newValue contienen el secreto", async () => {
    dbRow = { ...COMPANY_ROW, status: "ARCHIVED" };
    await CompanyService.reactivateCompany("company-1", "user-1", NET);
    expectNoSecretInAudit();
  });

  it("CAUSA RAÍZ: toda lectura/escritura de Company pide `select` explícito y sin el secreto", async () => {
    // El bug no era el volcado, era leer la fila entera. Esta prueba vigila la
    // causa: un `findUniqueOrThrow` sin proyección la reintroduce entera.
    const tx = makeTx();
    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      rif: "J-12345678-9",
      ...NET,
    });
    await CompanyService.updateSeniatData("company-1", "user-1", SENIAT_DATA, NET);
    await CompanyService.archiveCompany("company-1", "user-1", NET);
    dbRow = { ...COMPANY_ROW, status: "ARCHIVED" };
    await CompanyService.reactivateCompany("company-1", "user-1", NET);

    const companyOps = calls.filter((c) => /company\.(findUnique|findUniqueOrThrow|create|update)$/.test(c.op));
    expect(companyOps.length).toBeGreaterThanOrEqual(8);
    for (const call of companyOps) {
      expect(call.args.select, `${call.op} sin select explícito`).toBeDefined();
      expect(Object.keys(call.args.select ?? {})).not.toContain("digitalInvoiceApiKeyEnc");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R-6 — trazabilidad de red en las 4 mutaciones
// ══════════════════════════════════════════════════════════════════════════════

describe("R-6 — ipAddress/userAgent recibidos llegan al AuditLog", () => {
  it("createCompany", async () => {
    const tx = makeTx();
    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      ...NET,
    });
    expectNetInAudit();
  });

  it("updateSeniatData", async () => {
    await CompanyService.updateSeniatData("company-1", "user-1", SENIAT_DATA, NET);
    expectNetInAudit();
  });

  it("archiveCompany", async () => {
    await CompanyService.archiveCompany("company-1", "user-1", NET);
    expectNetInAudit();
  });

  it("reactivateCompany", async () => {
    dbRow = { ...COMPANY_ROW, status: "ARCHIVED" };
    await CompanyService.reactivateCompany("company-1", "user-1", NET);
    expectNetInAudit();
  });

  it("net con valores nulos (caller sin request scope) se propaga tal cual, no se inventa", async () => {
    const tx = makeTx();
    await CompanyService.createCompany(tx.asTx, {
      name: "Empresa Test C.A.",
      userId: "user-1",
      country: "VEN",
      telefono: "0412-1234567",
      ipAddress: null,
      userAgent: null,
    });
    expectNetInAudit({ ipAddress: null, userAgent: null } as unknown as typeof NET);
  });
});


describe("CompanyService.updateSeniatData — sin RIF", () => {
  it("rif null → no consulta duplicados (rama que no debe disparar el oráculo)", async () => {
    await CompanyService.updateSeniatData(
      "company-1",
      "user-1",
      { ...SENIAT_DATA, rif: null },
      NET,
    );

    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(writeTx.client.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rif: null }) }),
    );
  });
});
