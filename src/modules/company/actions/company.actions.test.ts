// src/modules/company/actions/company.actions.test.ts
//
// Contrato nuevo (auditoría MP-4 — ADR-043 / ADR-042 D-13):
//   createCompanyAction → requireUserAction({ limiter: limiters.companyCreate, captureNet })
//                       → withDbRetry(withSerializableRetry(tx => CompanyService.createCompany(tx, …)))
//   Los otros tres actions piden captureNet:true y pasan `ctx` como `net` (R-6).
//
// `withSerializableRetry` NO se mockea: se ejecuta de verdad sobre el
// `prisma.$transaction` mockeado. Así el test puede afirmar el nivel de
// aislamiento real con el que se abre la transacción (ADR-043 D-1) — si alguien
// cambia el helper por un `$transaction` pelado, esto se pone rojo.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  // step-up: `@/lib/step-up` re-exporta este helper de Clerk
  reverificationError: (config: unknown) => ({
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: { reverification: config },
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// headers() configurable por test — netContext() real (R-6)
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  fiscalKey: (companyId: string, userId: string) => `${companyId}:${userId}`,
  // ADR-043 D-4: el alta de empresa tiene limiter PROPIO (fail-open), no `fiscal`.
  // Los dobles llevan marca: `{}` y `{}` son iguales para toHaveBeenCalledWith, así
  // que sin distinguirlos el test no notaría que alguien pone `fiscal` en el alta.
  limiters: { fiscal: { __limiter: "fiscal" }, companyCreate: { __limiter: "companyCreate" } },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    company: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    companyMember: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    accountingPeriod: { findFirst: vi.fn() },
    expenseCategory: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  withDbRetry: vi.fn((fn: () => unknown) => fn()),
}));

import prisma, { withDbRetry } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import {
  createCompanyAction,
  updateCompanySeniatDataAction,
  updateScopeProfileAction,
  archiveCompanyAction,
  reactivateCompanyAction,
} from "./company.actions";
import { COMPANY_LIMIT_PER_USER } from "../services/CompanyService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Centinela del secreto que NUNCA debe salir de la capa de datos (schema:262). */
const SECRET_ENC = "ENC:AES-256-GCM:NUNCA-EN-AUDITLOG";

const mockCompany = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  country: "VEN",
  address: null,
  status: "ACTIVE",
  telefono: "0412-1234567",
  scopeProfile: null,
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  updatedAt: new Date("2026-01-15T10:00:00.000Z"),
};

/** Proyecta como haría Prisma ante un `select`. Sin `select`, la fila entera. */
function project(
  row: Record<string, unknown>,
  args?: { select?: Record<string, boolean> },
): Record<string, unknown> {
  if (!args?.select) return row;
  return Object.fromEntries(
    Object.entries(args.select)
      .filter(([, on]) => on)
      .map(([k]) => [k, row[k]]),
  );
}

/** Fila cruda de BD: lo que devuelve un `findUniqueOrThrow` SIN `select`. */
const rawCompanyRow = {
  ...mockCompany,
  digitalInvoiceProvider: "HKA",
  digitalInvoiceApiKeyEnc: SECRET_ENC,
};

const IP = "203.0.113.9";
const UA = "vitest-agent/1.0";

/** Opciones con las que se abrió la última $transaction (isolationLevel…). */
let lastTxOptions: Record<string, unknown> | undefined;

function headersWith(map: Record<string, string>) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });
}

/** Datos del AuditLog escrito (la primera llamada). */
function auditData(): Record<string, unknown> {
  const call = vi.mocked(prisma.auditLog.create).mock.calls[0]?.[0] as
    | { data?: Record<string, unknown> }
    | undefined;
  if (!call?.data) throw new Error("No se escribió AuditLog");
  return call.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastTxOptions = undefined;

  vi.mocked(auth).mockResolvedValue({ userId: "user-1", has: () => true } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  headersWith({ "x-real-ip": IP, "user-agent": UA });

  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ADMIN",
    company: { country: "VEN" },
  } as never);
  vi.mocked(prisma.companyMember.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.company.findUnique).mockResolvedValue(null as never);
  // El mock RESPETA `select`, como Prisma de verdad. Sin esto el test no puede
  // distinguir "pedí solo los campos auditables" de "me devolvieron la fila
  // entera": devolvería siempre el secreto y el fix parecería no funcionar.
  vi.mocked(prisma.company.findUniqueOrThrow).mockImplementation(((args?: {
    select?: Record<string, boolean>;
  }) => Promise.resolve(project(rawCompanyRow, args))) as never);
  vi.mocked(prisma.company.create).mockResolvedValue(mockCompany as never);
  // Mismo motivo que findUniqueOrThrow: si `update` ignorara el `select`, la mitad
  // `newValue` del volcado nunca traería el secreto y el test lo daría por bueno.
  vi.mocked(prisma.company.update).mockImplementation(((args?: {
    select?: Record<string, boolean>;
  }) => Promise.resolve(project(rawCompanyRow, args))) as never);
  vi.mocked(prisma.expenseCategory.createMany).mockResolvedValue({ count: 9 } as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as never);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);

  vi.mocked(prisma.$transaction).mockImplementation(((
    fn: (tx: unknown) => unknown,
    options?: Record<string, unknown>,
  ) => {
    lastTxOptions = options;
    return fn({
      company: prisma.company,
      companyMember: prisma.companyMember,
      expenseCategory: prisma.expenseCategory,
      auditLog: prisma.auditLog,
    });
  }) as never);
});

// ══════════════════════════════════════════════════════════════════════════════
// createCompanyAction
// ══════════════════════════════════════════════════════════════════════════════

describe("createCompanyAction — camino feliz", () => {
  it("crea la empresa y devuelve id + name", async () => {
    const result = await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      rif: "J-12345678-9",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ id: "company-1", name: "Empresa Test C.A." });
    expect(prisma.company.create).toHaveBeenCalledOnce();
  });

  it("ADR-043 D-1: la creación abre la transacción en Serializable", async () => {
    await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    // El guard de límite es write skew: en Read Committed dos POST simultáneos
    // leen 0 y ambos crean. Sin Serializable, el invariante no existe.
    expect(lastTxOptions).toEqual(
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });

  it("ADR-043 D-3: la creación va envuelta en withDbRetry (cold start de Neon)", async () => {
    await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(withDbRetry).toHaveBeenCalledOnce();
  });

  it("R-6: el AuditLog lleva la IP y el user-agent de la petición, no null", async () => {
    await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    const audit = auditData();
    expect(audit.ipAddress).toBe(IP);
    expect(audit.userAgent).toBe(UA);
    expect(audit.action).toBe("CREATE");
    expect(audit.userId).toBe("user-1");
  });

  it("R-6/ADR-041 D-2: con x-forwarded-for toma la ÚLTIMA IP (la del proxy), no la del cliente", async () => {
    headersWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.9", "user-agent": UA });

    await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(auditData().ipAddress).toBe("203.0.113.9");
  });
});

describe("createCompanyAction — guard de usuario (requireUserAction, ADR-043 D-4)", () => {
  it("sin sesión → 'No autorizado' y no abre transacción", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(result).toEqual({ success: false, error: "No autorizado" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rate limit excedido → corta antes de crear, con el limiter propio y clave user:<userId>", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 42 segundos.",
    } as never);

    const result = await createCompanyAction({
      name: "Empresa Test C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(result).toEqual({
      success: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 42 segundos.",
    });
    // Clave por usuario de Clerk (no spoofeable) y limiter companyCreate — NO `fiscal`,
    // que falla cerrado y bloquearía el alta de alguien que acaba de pagar.
    expect(checkRateLimit).toHaveBeenCalledWith("user:user-1", limiters.companyCreate);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("createCompanyAction — validación", () => {
  it("nombre demasiado corto → error de Zod", async () => {
    const result = await createCompanyAction({
      name: "A",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("2 caracteres");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("sin teléfono → rechaza (obligatorio para recordatorios de renovación)", async () => {
    const result = await createCompanyAction({
      name: "Empresa Sin Tel C.A.",
      userId: "user-1",
      telefono: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/tel[eé]fono/i);
  });

  it("MP-4: el formato del ID tributario se valida contra la config del país", async () => {
    const result = await createCompanyAction({
      name: "Empresa RIF Malo C.A.",
      userId: "user-1",
      country: "VEN",
      rif: "J-1234",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    // Mensaje derivado de la config (taxIdLabel + taxIdPlaceholder), no hardcodeado
    if (!result.success) expect(result.error).toBe("RIF inválido (ej: J-12345678-9)");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("createCompanyAction — país (MP-4 / ADR-042 D-13)", () => {
  it("persiste el country elegido", async () => {
    const result = await createCompanyAction({
      name: "Empresa VEN C.A.",
      userId: "user-1",
      country: "VEN",
      rif: "J-12345678-9",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(true);
    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ country: "VEN" }) }),
    );
  });

  it("country ausente → VEN (callers legacy sin selector)", async () => {
    await createCompanyAction({
      name: "Empresa Legacy C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ country: "VEN" }) }),
    );
  });

  it("country no soportado → error explícito, NUNCA coerción silenciosa", async () => {
    const result = await createCompanyAction({
      name: "Empresa COL S.A.S.",
      userId: "user-1",
      country: "COL",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("País no soportado todavía.");
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
});

describe("createCompanyAction — errores de negocio del servicio", () => {
  it("límite de plan → mensaje comercial (PlanLimitError, no 'PLAN_LIMIT' crudo)", async () => {
    vi.mocked(prisma.companyMember.count).mockResolvedValue(1 as never);

    const result = await createCompanyAction({
      name: "Segunda Empresa C.A.",
      userId: "user-1",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("1 empresa");
      expect(result.error).not.toContain("PLAN_LIMIT");
    }
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it("RIF ya registrado → mensaje de negocio SIN el RIF (oráculo cross-tenant, LOW-4)", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ id: "otra-empresa" } as never);

    const result = await createCompanyAction({
      name: "Otra Empresa",
      userId: "user-1",
      rif: "J-30684267-8",
      telefono: "0412-1234567",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Ese RIF ya está registrado.");
      expect(result.error).not.toContain("30684267");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updateCompanySeniatDataAction
// ══════════════════════════════════════════════════════════════════════════════

const SENIAT_INPUT = {
  companyId: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: "Av. Principal",
  telefono: "0412-1234567",
  email: "fiscal@test.com",
  ciiu: "4711",
  actividad: "Comercio",
  isSpecialContributor: true,
};

describe("updateCompanySeniatDataAction", () => {
  beforeEach(() => {
    // Dos lecturas distintas contra el mismo modelo:
    //   where.id  → RIF actual, para el grandfathering del formato (assertRifEditable)
    //   where.rif → dueño del RIF, para el chequeo de duplicado global
    vi.mocked(prisma.company.findUnique).mockImplementation((async (args: {
      where?: Record<string, unknown>;
    }) => (args?.where && "rif" in args.where ? null : { rif: "J-12345678-9" })) as never);
  });

  it("actualiza y devuelve el id", async () => {
    const result = await updateCompanySeniatDataAction(SENIAT_INPUT);

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result.success).toBe(true);
    expect(prisma.company.update).toHaveBeenCalledOnce();
  });

  it("R-6: el AuditLog lleva IP y user-agent de la petición", async () => {
    await updateCompanySeniatDataAction(SENIAT_INPUT);

    const audit = auditData();
    expect(audit.ipAddress).toBe(IP);
    expect(audit.userAgent).toBe(UA);
    expect(audit.action).toBe("UPDATE");
  });

  it("Q2-3: sin step-up 2FA reciente → devuelve clerk_error y no toca la BD", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1", has: () => false } as never);

    const result = await updateCompanySeniatDataAction(SENIAT_INPUT);

    expect("clerk_error" in result).toBe(true);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("rol sin permiso (VIEWER) → 'No autorizado' sin escribir (ADR-006 D-1)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "VIEWER",
      company: { country: "VEN" },
    } as never);

    const result = await updateCompanySeniatDataAction(SENIAT_INPUT);

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result).toEqual({ success: false, error: "No autorizado" });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updateScopeProfileAction
// ══════════════════════════════════════════════════════════════════════════════

describe("updateScopeProfileAction", () => {
  it("actualiza el perfil de alcance y audita con R-6", async () => {
    const result = await updateScopeProfileAction({
      companyId: "company-1",
      scopeProfile: "DESPACHO",
    });

    expect(result.success).toBe(true);
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { scopeProfile: "DESPACHO" } }),
    );
    const audit = auditData();
    expect(audit.ipAddress).toBe(IP);
    expect(audit.userAgent).toBe(UA);
  });

  it("rol sin permiso (ACCOUNTANT) → 'No autorizado'", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
      company: { country: "VEN" },
    } as never);

    const result = await updateScopeProfileAction({
      companyId: "company-1",
      scopeProfile: "SOLO",
    });

    expect(result).toEqual({ success: false, error: "No autorizado" });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  // EXTRA-2 — regresión. `updateScopeProfileAction` es la QUINTA mutación de
  // `Company` y la única que vive en el action en vez del servicio; por eso se
  // escapó del primer barrido y test-agent la encontró. Volcaba la fila entera
  // —incluido `digitalInvoiceApiKeyEnc`— en `oldValue`/`newValue`, que
  // `AuditLogTable` renderiza con JSON.stringify y el exportador mete en un PDF
  // firmado. Misma clase que Z-5 (`encryptedP12`). Ya usa AUDITABLE_COMPANY_FIELDS.
  it("EXTRA-2: nunca vuelca digitalInvoiceApiKeyEnc al AuditLog", async () => {
    await updateScopeProfileAction({ companyId: "company-1", scopeProfile: "DESPACHO" });

    const audit = auditData();
    const dump = JSON.stringify({ old: audit.oldValue, new: audit.newValue });
    expect(dump).not.toContain(SECRET_ENC);
    expect(dump).not.toContain("digitalInvoiceApiKeyEnc");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// archiveCompanyAction / reactivateCompanyAction
// ══════════════════════════════════════════════════════════════════════════════

describe("archiveCompanyAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.company.update).mockResolvedValue({
      ...mockCompany,
      status: "ARCHIVED",
    } as never);
  });

  it("archiva correctamente", async () => {
    const result = await archiveCompanyAction("company-1", "user-1");

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result.success).toBe(true);
  });

  it("R-6: el AuditLog lleva IP y user-agent (ctx pasado como net)", async () => {
    await archiveCompanyAction("company-1", "user-1");

    const audit = auditData();
    expect(audit.action).toBe("ARCHIVE");
    expect(audit.ipAddress).toBe(IP);
    expect(audit.userAgent).toBe(UA);
  });

  it("período contable abierto → bloquea", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);

    const result = await archiveCompanyAction("company-1", "user-1");

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("período contable abierto");
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("Q2-3: sin step-up 2FA reciente → clerk_error y no archiva", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1", has: () => false } as never);

    const result = await archiveCompanyAction("company-1", "user-1");

    expect("clerk_error" in result).toBe(true);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });
});

describe("reactivateCompanyAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      ...mockCompany,
      status: "ARCHIVED",
    } as never);
    vi.mocked(prisma.company.update).mockResolvedValue(mockCompany as never);
  });

  it("reactiva una empresa archivada", async () => {
    const result = await reactivateCompanyAction("company-1", "user-1");
    expect(result.success).toBe(true);
  });

  it("R-6: el AuditLog lleva IP y user-agent (ctx pasado como net)", async () => {
    await reactivateCompanyAction("company-1", "user-1");

    const audit = auditData();
    expect(audit.action).toBe("REACTIVATE");
    expect(audit.ipAddress).toBe(IP);
    expect(audit.userAgent).toBe(UA);
  });

  it("empresa ya activa → error de negocio", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);

    const result = await reactivateCompanyAction("company-1", "user-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ya está activa");
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Condición de caducidad escrita en ADR-043 D-3 (test estático)
// ══════════════════════════════════════════════════════════════════════════════

describe("ADR-043 D-3 — caducidad de withDbRetry sobre una mutación no idempotente", () => {
  it("si COMPANY_LIMIT_PER_USER sube de 1, withDbRetry sale del alta (o entra idempotencyKey)", () => {
    // `withDbRetry` reintenta A CIEGAS. Hoy es seguro SOLO porque con límite 1 el
    // reintento choca contra el mismo guard y el usuario recibe el mensaje correcto.
    // Con límite > 1, ese reintento crea una segunda empresa fantasma. La nota está
    // escrita sobre la constante; esto la hace ejecutable.
    if (COMPANY_LIMIT_PER_USER <= 1) {
      expect(COMPANY_LIMIT_PER_USER).toBe(1);
      return;
    }

    const source = readFileSync(
      path.join(process.cwd(), "src/modules/company/actions/company.actions.ts"),
      "utf-8",
    );
    const createBlock = source.slice(source.indexOf("export async function createCompanyAction"));
    const usesBlindRetry = /withDbRetry\(/.test(createBlock);
    const hasIdempotencyKey = /idempotencyKey/.test(createBlock);

    expect(
      !usesBlindRetry || hasIdempotencyKey,
      "COMPANY_LIMIT_PER_USER > 1: quitar withDbRetry del alta o darle idempotencyKey (ADR-043 D-3)",
    ).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// Ramas de error de los actions (Zod vs. error de negocio del servicio)
// ══════════════════════════════════════════════════════════════════════════════

describe("updateCompanySeniatDataAction — manejo de errores", () => {
  it("input inválido → mensaje de Zod, sin llegar al guard", async () => {
    const result = await updateCompanySeniatDataAction({ ...SENIAT_INPUT, name: "A" });

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("2 caracteres");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
  });

  it("error de negocio del servicio → pasa saneado por toActionError, sin trazas técnicas", async () => {
    vi.mocked(prisma.company.findUnique).mockImplementation((async (args: {
      where?: Record<string, unknown>;
    }) =>
      args?.where && "rif" in args.where
        ? { id: "otra-empresa" } // el RIF es de otra empresa
        : { rif: "J-12345678-9" }) as never);

    const result = await updateCompanySeniatDataAction(SENIAT_INPUT);

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result).toEqual({ success: false, error: "Ese RIF ya está registrado." });
  });
});

describe("updateScopeProfileAction — manejo de errores", () => {
  it("scopeProfile fuera del enum → error de Zod sin tocar la BD", async () => {
    const result = await updateScopeProfileAction({
      companyId: "company-1",
      scopeProfile: "MEGACORP" as never,
    });

    expect(result.success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("fallo en la transacción → error saneado (nunca el mensaje crudo de Postgres)", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Error("permission denied for schema public") as never,
    );

    const result = await updateScopeProfileAction({
      companyId: "company-1",
      scopeProfile: "SOLO",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toContain("permission denied");
      expect(result.error).toContain("base de datos");
    }
  });
});


describe("Rol en acciones destructivas (ADR-006 D-1)", () => {
  beforeEach(() => {
    // VIEWER: puede mirar, no puede archivar ni reactivar una empresa
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "VIEWER",
      company: { country: "VEN" },
    } as never);
  });

  it("archiveCompanyAction con VIEWER → bloqueado antes del step-up y de la BD", async () => {
    const result = await archiveCompanyAction("company-1", "user-1");

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result).toEqual({ success: false, error: "No autorizado" });
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.accountingPeriod.findFirst).not.toHaveBeenCalled();
  });

  it("reactivateCompanyAction con VIEWER → bloqueado", async () => {
    const result = await reactivateCompanyAction("company-1", "user-1");

    expect(result).toEqual({ success: false, error: "No autorizado" });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });
});

describe("updateCompanySeniatDataAction — RIF con grandfathering (MP-1)", () => {
  it("cambiar el RIF a uno con formato inválido → rechaza con el mensaje del país", async () => {
    // El schema NO valida formato (hay RIFs legacy en BD que deben poder editar
    // dirección/teléfono); la validación estricta se aplica solo si el RIF CAMBIA.
    vi.mocked(prisma.company.findUnique).mockImplementation((async (args: {
      where?: Record<string, unknown>;
    }) => (args?.where && "rif" in args.where ? null : { rif: "J-12345678-9" })) as never);

    const result = await updateCompanySeniatDataAction({ ...SENIAT_INPUT, rif: "J-1234" });

    if ("clerk_error" in result) throw new Error("step-up inesperado");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/RIF/);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it("campos opcionales vacíos → llegan al servicio como null, no como cadena vacía", async () => {
    vi.mocked(prisma.company.findUnique).mockImplementation((async (args: {
      where?: Record<string, unknown>;
    }) => (args?.where && "rif" in args.where ? null : { rif: "J-12345678-9" })) as never);

    await updateCompanySeniatDataAction({
      companyId: "company-1",
      name: "Empresa Test C.A.",
      rif: "",
      address: "",
      telefono: "",
      email: "",
      ciiu: "",
      actividad: "",
      isSpecialContributor: false,
    });

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rif: null,
          address: null,
          telefono: null,
          email: null,
          ciiu: null,
          actividad: null,
        }),
      }),
    );
  });
});
