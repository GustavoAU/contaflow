import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockListCajasCajas = vi.hoisted(() => vi.fn());
const mockCreateCajaCaja = vi.hoisted(() => vi.fn());
const mockAssignCustodian = vi.hoisted(() => vi.fn());
const mockGetCajaCajaById = vi.hoisted(() => vi.fn());
const mockCreateMovement = vi.hoisted(() => vi.fn());
const mockApproveMovement = vi.hoisted(() => vi.fn());
const mockListMovements = vi.hoisted(() => vi.fn());
// HC-08 (ADR-037 D-2): registro best-effort de rechazos. Lo mockeamos para verificar
// que la action lo invoca cuando el service lanza un rechazo de regla de negocio,
// sin acoplarnos a la implementación interna de prisma.auditLog.create.
const mockLogRejection = vi.hoisted(() => vi.fn());
const mockShouldLogRejection = vi.hoisted(() => vi.fn(() => true));
// Fase 4 UX: export (arqueo). Mockeamos el service de export para evitar render PDF real.
const mockGenerateCSV = vi.hoisted(() => vi.fn());
const mockGeneratePDF = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
  },
}));
const mockCloseCajaCaja = vi.hoisted(() => vi.fn());
const mockListDeposits = vi.hoisted(() => vi.fn());
const mockListReimbursements = vi.hoisted(() => vi.fn());

vi.mock("../utils/log-rejection", () => ({
  logRejection: mockLogRejection,
  shouldLogRejection: mockShouldLogRejection,
}));

vi.mock("../services/CajaCajaService", () => ({
  createCajaCaja: mockCreateCajaCaja,
  listCajasCajas: mockListCajasCajas,
  getCajaCajaById: mockGetCajaCajaById,
  closeCajaCaja: mockCloseCajaCaja,
  assignCustodian: mockAssignCustodian,
}));
vi.mock("../services/CajaCajaMovementService", () => ({
  createMovement: mockCreateMovement,
  approveMovement: mockApproveMovement,
  voidMovement: vi.fn(),
  listMovements: mockListMovements,
}));
vi.mock("../services/CajaCajaDepositService", () => ({
  createDeposit: vi.fn(),
  voidDeposit: vi.fn(),
  listDeposits: mockListDeposits,
}));
vi.mock("../services/CajaCajaReimbursementService", () => ({
  createReimbursement: vi.fn(),
  postReimbursement: vi.fn(),
  voidReimbursement: vi.fn(),
  listReimbursements: mockListReimbursements,
}));
vi.mock("../services/CajaCajaExportService", () => ({
  generateCajaCajaCSV: mockGenerateCSV,
  generateCajaCajaPDF: mockGeneratePDF,
}));

import prisma from "@/lib/prisma";
import {
  listCajasCajasAction,
  createCajaCajaAction,
  assignCustodianAction,
  closeCajaCajaAction,
  createMovementAction,
  approveMovementAction,
  listMovementsAction,
  listDepositsAction,
  listReimbursementsAction,
  exportCajaCajaCSVAction,
  exportCajaCajaPDFAction,
} from "../actions/cajachica.actions";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";

function setupAdmin() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ADMIN",
  } as never);
}

function setupWriter() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ADMINISTRATIVE",
  } as never);
}

function setupRole(role: string) {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role } as never);
}

const mockCaja = {
  id: "caja-1",
  name: "Caja Operativa",
  accountId: "acc-1",
  accountCode: "1010",
  accountName: "Caja VES",
  custodianId: "emp-1",
  custodianName: "Ana Pérez",
  currency: "VES",
  maxBalance: "1000000.00",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  closedAt: null,
  totalDeposited: "0.00",
  totalPendingMovements: "0.00",
  totalApprovedMovements: "0.00",
  availableBalance: "0.00",
  percentUsed: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  // shouldLogRejection vuelve a su default (true) tras clearAllMocks.
  mockShouldLogRejection.mockReturnValue(true);
});

// ─── Auth guards ──────────────────────────────────────────────────────────────

describe("auth guards", () => {
  it("listCajasCajasAction → 401 sin sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/autenticado/i);
  });

  it("listCajasCajasAction → 403 rate limit", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/límite/i);
  });

  it("listCajasCajasAction → 403 sin membresía", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/miembro/i);
  });

  it("createCajaCajaAction → 403 para ACCOUNTANT (requiere ADMIN)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
    } as never);
    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      custodianId: "emp-1",
      maxBalance: "100000",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
  });
});

// ─── createCajaCajaAction ─────────────────────────────────────────────────────

describe("createCajaCajaAction", () => {
  it("crea caja correctamente", async () => {
    setupAdmin();
    mockCreateCajaCaja.mockResolvedValue(mockCaja);

    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      name: "Caja Operativa",
      accountId: "acc-1",
      custodianId: "emp-1",
      maxBalance: "1000000",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Caja Operativa");
  });

  it("propaga error del servicio", async () => {
    setupAdmin();
    mockCreateCajaCaja.mockRejectedValue(new Error("Cuenta no encontrada"));

    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      custodianId: "emp-1",
      maxBalance: "100000",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("Cuenta no encontrada");
  });

  it("falla con Zod si falta nombre", async () => {
    setupAdmin();
    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      accountId: "acc-1",
      maxBalance: "100000",
    });
    expect(result.success).toBe(false);
  });
});

// ─── assignCustodianAction ────────────────────────────────────────────────────

describe("assignCustodianAction", () => {
  const validAssign = {
    cajaCajaId: "caja-1",
    companyId: COMPANY_ID,
    custodianId: "emp-2",
  };

  it("asigna custodio correctamente (requiere ADMIN)", async () => {
    setupAdmin();
    mockAssignCustodian.mockResolvedValue({ ...mockCaja, custodianId: "emp-2", custodianName: "Luis Gómez" });

    const result = await assignCustodianAction(validAssign);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.custodianId).toBe("emp-2");
      expect(result.data.custodianName).toBe("Luis Gómez");
    }
    // delega al service con el input parseado + userId del guard
    expect(mockAssignCustodian).toHaveBeenCalledWith(
      expect.objectContaining(validAssign),
      USER_ID,
      undefined,
      undefined
    );
  });

  it("rechaza para ACCOUNTANT (requiere ADMIN) → no llama al service", async () => {
    setupRole("ACCOUNTANT");
    const result = await assignCustodianAction(validAssign);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
    expect(mockAssignCustodian).not.toHaveBeenCalled();
  });

  it("rechaza para VIEWER (requiere ADMIN) → no llama al service", async () => {
    setupRole("VIEWER");
    const result = await assignCustodianAction(validAssign);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
    expect(mockAssignCustodian).not.toHaveBeenCalled();
  });

  it("falla con Zod si falta custodianId → no llama al service", async () => {
    setupAdmin();
    const result = await assignCustodianAction({
      cajaCajaId: "caja-1",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(false);
    expect(mockAssignCustodian).not.toHaveBeenCalled();
  });

  it("propaga error de negocio del servicio (caja cerrada)", async () => {
    setupAdmin();
    mockAssignCustodian.mockRejectedValue(
      new Error("No se puede cambiar el custodio de una caja cerrada")
    );
    const result = await assignCustodianAction(validAssign);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/cerrada/i);
  });
});

// ─── listCajasCajasAction ─────────────────────────────────────────────────────

describe("listCajasCajasAction", () => {
  it("devuelve lista correctamente para ADMINISTRATIVE", async () => {
    setupWriter();
    mockListCajasCajas.mockResolvedValue([mockCaja]);

    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
  });
});

// ─── createMovementAction ─────────────────────────────────────────────────────

describe("createMovementAction", () => {
  // HC-01 (ADR-037): supportingDocumentId SIEMPRE obligatorio.
  const validMovement = {
    companyId: COMPANY_ID,
    cajaCajaId: "caja-1",
    date: "2026-05-12",
    concept: "Café",
    expenseAccountId: "acc-exp",
    amount: "150000",
    currency: "VES",
    supportingDocumentId: "FAC-001",
  };

  const mockMovement = {
    id: "mov-1",
    cajaCajaId: "caja-1",
    date: "2026-05-12",
    voucherNumber: "CCC-2026-00001",
    concept: "Café",
    description: null,
    expenseAccountId: "acc-exp",
    expenseAccountCode: "6010",
    expenseAccountName: "Gastos Operativos",
    amount: "150000.00",
    currency: "VES",
    status: "PENDING",
    providerRif: null,
    approvedAt: null,
    approvedBy: null,
    reimbursementId: null,
    createdAt: new Date().toISOString(),
    voidedAt: null,
  };

  it("crea movimiento para ADMINISTRATIVE", async () => {
    setupWriter();
    mockCreateMovement.mockResolvedValue(mockMovement);

    const result = await createMovementAction(validMovement);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.voucherNumber).toBe("CCC-2026-00001");
  });

  // HC-01 (ADR-037): el umbral 500k fue eliminado; supportingDocumentId es obligatorio
  // SIEMPRE. Sin él, el Zod rechaza antes de llamar al service.
  it("rechaza (Zod) si falta supportingDocumentId → no llama al service", async () => {
    setupWriter();
    const { supportingDocumentId: _omit, ...sinSoporte } = validMovement;
    void _omit;
    const result = await createMovementAction(sinSoporte);
    expect(result.success).toBe(false);
    // clave ausente -> Zod falla por type check (no por el .min(1)); basta con que rechace.
    expect(mockCreateMovement).not.toHaveBeenCalled();
  });

  it("rechaza (Zod) si supportingDocumentId está vacío → no llama al service", async () => {
    setupWriter();
    const result = await createMovementAction({ ...validMovement, supportingDocumentId: "" });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/soporte/i);
    expect(mockCreateMovement).not.toHaveBeenCalled();
  });

  // HC-10 (ADR-037): RIF inválido lo rechaza el Zod (no llega al service).
  it("rechaza (Zod) si providerRif tiene formato inválido → no llama al service", async () => {
    setupWriter();
    const result = await createMovementAction({ ...validMovement, providerRif: "123" });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/RIF/i);
    expect(mockCreateMovement).not.toHaveBeenCalled();
  });

  // HC-08 (ADR-037 D-2): cuando el service lanza un rechazo de regla de negocio,
  // la action devuelve { success: false } Y registra el rechazo (logRejection).
  it("registra el rechazo (HC-08) cuando el service lanza error de negocio", async () => {
    setupWriter();
    mockCreateMovement.mockRejectedValue(new Error("Saldo insuficiente"));

    const result = await createMovementAction(validMovement);

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/saldo insuficiente/i);
    expect(mockLogRejection).toHaveBeenCalledTimes(1);
    expect(mockLogRejection).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        userId: USER_ID,
        action: "CREATE_MOVEMENT",
        entityName: "CajaCajaMovement",
        reason: expect.stringMatching(/saldo insuficiente/i),
      })
    );
  });

  // HC-08: si shouldLogRejection devuelve false (p.ej. error de infra), NO se loguea
  // pero igual se devuelve el error al usuario.
  it("NO registra el rechazo si shouldLogRejection es false (infra/transitorio)", async () => {
    setupWriter();
    mockShouldLogRejection.mockReturnValue(false);
    mockCreateMovement.mockRejectedValue(new Error("connection terminated"));

    const result = await createMovementAction(validMovement);

    expect(result.success).toBe(false);
    expect(mockLogRejection).not.toHaveBeenCalled();
  });
});

// ─── closeCajaCajaAction ──────────────────────────────────────────────────────

describe("closeCajaCajaAction", () => {
  it("cierra caja correctamente (requiere ADMIN)", async () => {
    setupAdmin();
    mockCloseCajaCaja.mockResolvedValue(undefined);

    const result = await closeCajaCajaAction({
      cajaCajaId: "caja-1",
      companyId: COMPANY_ID,
      returnAccountId: "acc-banco",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza cierre para ADMINISTRATIVE (requiere ADMIN)", async () => {
    setupWriter();
    const result = await closeCajaCajaAction({
      cajaCajaId: "caja-1",
      companyId: COMPANY_ID,
      returnAccountId: "acc-banco",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
  });

  it("falla con Zod si falta cajaCajaId", async () => {
    setupAdmin();
    const result = await closeCajaCajaAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(false);
  });
});

// ─── listDepositsAction ───────────────────────────────────────────────────────

describe("listDepositsAction", () => {
  it("lista depósitos para ADMINISTRATIVE", async () => {
    setupWriter();
    mockListDeposits.mockResolvedValue([]);
    const result = await listDepositsAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(Array.isArray(result.data)).toBe(true);
  });
});

// ─── listMovementsAction ──────────────────────────────────────────────────────

describe("listMovementsAction", () => {
  it("lista movimientos para ADMINISTRATIVE", async () => {
    setupWriter();
    mockListMovements.mockResolvedValue([]);
    const result = await listMovementsAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(Array.isArray(result.data)).toBe(true);
  });
});

// ─── listReimbursementsAction ─────────────────────────────────────────────────

describe("listReimbursementsAction", () => {
  it("lista reembolsos para ADMINISTRATIVE", async () => {
    setupWriter();
    mockListReimbursements.mockResolvedValue([]);
    const result = await listReimbursementsAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(Array.isArray(result.data)).toBe(true);
  });
});

// ─── approveMovementAction ────────────────────────────────────────────────────

describe("approveMovementAction", () => {
  it("aprueba movimiento (requiere ADMIN)", async () => {
    setupAdmin();
    mockApproveMovement.mockResolvedValue({ id: "mov-1", status: "APPROVED" });

    const result = await approveMovementAction({
      movementId: "mov-1",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza aprobación para ADMINISTRATIVE", async () => {
    setupWriter();
    const result = await approveMovementAction({
      movementId: "mov-1",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
  });
});

// ─── Export (arqueo: CSV / PDF) — Fase 4 UX ─────────────────────────────────────

describe("exportCajaCajaCSVAction", () => {
  // Caja resuelta por getCajaCajaById (shape CajaCajaSummary parcial usado por buildCajaExportData)
  const resolvedCaja = {
    name: "Caja Operativa",
    accountCode: "1010",
    accountName: "Caja VES",
    currency: "VES",
    status: "ACTIVE",
    custodianName: "Ana Pérez",
    totalDeposited: "1000.00",
    totalApprovedMovements: "200.00",
    totalPendingMovements: "0.00",
    availableBalance: "800.00",
  };

  function setupExportData() {
    mockGetCajaCajaById.mockResolvedValue(resolvedCaja);
    mockListMovements.mockResolvedValue([]);
    mockListDeposits.mockResolvedValue([]);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ name: "ACME C.A." } as never);
  }

  it("genera CSV (happy path) → success, csv no vacío, filename .csv", async () => {
    setupWriter();
    setupExportData();
    mockGenerateCSV.mockReturnValue("Caja Chica,Caja Operativa\r\n");

    const result = await exportCajaCajaCSVAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.csv).toBe("string");
      expect(result.data.csv.length).toBeGreaterThan(0);
      expect(result.data.filename).toMatch(/\.csv$/);
    }
    // construyó la data desde los services + nombre de empresa
    expect(mockGetCajaCajaById).toHaveBeenCalledWith("caja-1", COMPANY_ID);
    expect(mockGenerateCSV).toHaveBeenCalledTimes(1);
  });

  it("caja no encontrada → success:false con mensaje 'no encontrada'", async () => {
    setupWriter();
    mockGetCajaCajaById.mockResolvedValue(null);

    const result = await exportCajaCajaCSVAction("caja-x", COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/no encontrada/i);
    expect(mockGenerateCSV).not.toHaveBeenCalled();
  });

  it("rol insuficiente (VIEWER no es WRITER) → success:false, no construye data", async () => {
    setupRole("VIEWER");
    const result = await exportCajaCajaCSVAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(false);
    expect(mockGetCajaCajaById).not.toHaveBeenCalled();
    expect(mockGenerateCSV).not.toHaveBeenCalled();
  });

  it("sin sesión → success:false (autenticado)", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await exportCajaCajaCSVAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/autenticado/i);
  });
});

describe("exportCajaCajaPDFAction", () => {
  const resolvedCaja = {
    name: "Caja Operativa",
    accountCode: "1010",
    accountName: "Caja VES",
    currency: "VES",
    status: "ACTIVE",
    custodianName: "Ana Pérez",
    totalDeposited: "1000.00",
    totalApprovedMovements: "200.00",
    totalPendingMovements: "0.00",
    availableBalance: "800.00",
  };

  function setupExportData() {
    mockGetCajaCajaById.mockResolvedValue(resolvedCaja);
    mockListMovements.mockResolvedValue([]);
    mockListDeposits.mockResolvedValue([]);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ name: "ACME C.A." } as never);
  }

  it("genera PDF (happy path) → success, pdf base64, filename .pdf", async () => {
    setupWriter();
    setupExportData();
    // Evita render PDF real: el service mockeado retorna un Buffer fake.
    mockGeneratePDF.mockResolvedValue(Buffer.from("%PDF-fake"));

    const result = await exportCajaCajaPDFAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.pdf).toBe("string");
      // base64 de "%PDF-fake" debe poder decodificarse de vuelta
      expect(Buffer.from(result.data.pdf, "base64").toString()).toBe("%PDF-fake");
      expect(result.data.filename).toMatch(/\.pdf$/);
    }
    expect(mockGeneratePDF).toHaveBeenCalledTimes(1);
  });

  it("caja no encontrada → success:false, no genera PDF", async () => {
    setupWriter();
    mockGetCajaCajaById.mockResolvedValue(null);

    const result = await exportCajaCajaPDFAction("caja-x", COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/no encontrada/i);
    expect(mockGeneratePDF).not.toHaveBeenCalled();
  });

  it("rol insuficiente (VIEWER) → success:false, no genera PDF", async () => {
    setupRole("VIEWER");
    const result = await exportCajaCajaPDFAction("caja-1", COMPANY_ID);
    expect(result.success).toBe(false);
    expect(mockGeneratePDF).not.toHaveBeenCalled();
  });
});
