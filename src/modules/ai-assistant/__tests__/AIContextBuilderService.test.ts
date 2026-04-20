// src/modules/ai-assistant/__tests__/AIContextBuilderService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockPendingTasksService = vi.hoisted(() => ({
  getPendingTasks: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    company: { findUnique: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    payrollRun: { findFirst: vi.fn() },
    fixedAsset: { findMany: vi.fn() },
    inventoryItem: { findMany: vi.fn() },
    retencion: { count: vi.fn() },
    exchangeRate: { findFirst: vi.fn() },
    inflationAdjustment: { findFirst: vi.fn() },
    account: { findMany: vi.fn() },
  },
}));

vi.mock("@/modules/dashboard/services/PendingTasksService", () => ({
  PendingTasksService: mockPendingTasksService,
}));

import prisma from "@/lib/prisma";
import { AIContextBuilderService } from "../services/AIContextBuilderService";

const COMPANY_ID = "company-test";

function setupDefaults() {
  vi.mocked(prisma.company.findUnique).mockResolvedValue({
    name: "Empresa Test C.A.",
    rif: "J-12345678-9",
    isSpecialContributor: false,
  } as never);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
    year: 2026,
    month: 4,
    status: "OPEN",
  } as never);
  vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([]);
  // invoice.findMany se llama 3 veces: IVA, CxC, CxP — default: []
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
  vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.fixedAsset.findMany).mockResolvedValue([]);
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([]);
  vi.mocked(prisma.retencion.count).mockResolvedValue(0);
  vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.inflationAdjustment.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.account.findMany).mockResolvedValue([]);
  mockPendingTasksService.getPendingTasks.mockResolvedValue({ tasks: [], totalCount: 0 });
}

describe("AIContextBuilderService.buildContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("devuelve companyName y rif correctamente", async () => {
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.companyName).toBe("Empresa Test C.A.");
    expect(ctx.rif).toBe("J-12345678-9");
    expect(ctx.isSpecialContributor).toBe(false);
  });

  it("devuelve activePeriod cuando hay un período OPEN", async () => {
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.activePeriod).toEqual({ year: 2026, month: 4, status: "OPEN" });
  });

  it("devuelve activePeriod null cuando no hay período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.activePeriod).toBeNull();
  });

  it("calcula ivaDebito e ivaCredito desde facturas del mes", async () => {
    // 1=IVA (con datos), 2=CxC, 3=CxP
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([
        { type: "SALE", taxLines: [{ amount: "1600.00", taxType: "IVA_GENERAL" }] },
        { type: "PURCHASE", taxLines: [{ amount: "800.00", taxType: "IVA_GENERAL" }] },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.ivaDebito).toBe("1600.00");
    expect(ctx.ivaCredito).toBe("800.00");
    expect(ctx.ivaSaldoAPagar).toBe("800.00");
  });

  it("excluye IVA EXENTO del cálculo de IVA", async () => {
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([
        { type: "SALE", taxLines: [{ amount: "0.00", taxType: "EXENTO" }] },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.ivaDebito).toBe("0.00");
  });

  it("incluye saldos bancarios correctamente", async () => {
    vi.mocked(prisma.bankAccount.findMany).mockResolvedValue([
      { name: "Banco Principal", currency: "VES", closingBalance: "500000.00" },
    ] as never);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.bankBalances).toHaveLength(1);
    expect(ctx.bankBalances[0].balance).toBe("500000.00");
  });

  it("mapea CxC vencidas correctamente con días vencidos", async () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 días atrás
    // invoice.findMany se llama 3 veces: 1=IVA, 2=CxC, 3=CxP
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([] as never) // IVA
      .mockResolvedValueOnce([
        { controlNumber: "0001", counterpartName: "Cliente ABC", pendingAmount: "5000.00", dueDate: pastDate },
      ] as never) // CxC
      .mockResolvedValueOnce([] as never); // CxP
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.cxcVencidas).toHaveLength(1);
    expect(ctx.cxcVencidas[0].counterparty).toBe("Cliente ABC");
    expect(ctx.cxcVencidas[0].daysOverdue).toBeGreaterThanOrEqual(9);
  });

  it("devuelve retencionesPendientes del count de Prisma", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(5);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.retencionesPendientes).toBe(5);
  });

  it("incluye tareas pendientes de PendingTasksService", async () => {
    mockPendingTasksService.getPendingTasks.mockResolvedValue({
      tasks: [{ type: "INVOICES_SIN_CAUSAR", severity: "error", count: 3, title: "", description: "", href: "" }],
      totalCount: 3,
    });
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.pendingTasks).toHaveLength(1);
    expect(ctx.pendingTasks[0].type).toBe("INVOICES_SIN_CAUSAR");
  });

  it("devuelve inpcPendiente true cuando no hay ajuste del período", async () => {
    vi.mocked(prisma.inflationAdjustment.findFirst).mockResolvedValue(null as never);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.inpcPendiente).toBe(true);
  });

  it("devuelve inpcPendiente false cuando el ajuste existe", async () => {
    vi.mocked(prisma.inflationAdjustment.findFirst).mockResolvedValue({ id: "adj-1" } as never);
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    expect(ctx.inpcPendiente).toBe(false);
  });
});

describe("AIContextBuilderService.buildSystemPrompt", () => {
  it("incluye datos de empresa y conocimiento contable VEN-NIF", async () => {
    setupDefaults();
    const ctx = await AIContextBuilderService.buildContext(COMPANY_ID);
    const prompt = AIContextBuilderService.buildSystemPrompt(ctx);
    expect(prompt).toContain("Empresa Test C.A.");
    expect(prompt).toContain("IGTF");
    expect(prompt).toContain("Decreto 1808");
    expect(prompt).toContain("NIF 3");
    expect(prompt).toContain("DEBE/HABER");
  });
});
