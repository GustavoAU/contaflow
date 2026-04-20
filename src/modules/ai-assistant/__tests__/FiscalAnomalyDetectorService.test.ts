// src/modules/ai-assistant/__tests__/FiscalAnomalyDetectorService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockFindFirstPeriod = vi.hoisted(() => vi.fn());
const mockFindManyTransaction = vi.hoisted(() => vi.fn());
const mockFindManyRetencion = vi.hoisted(() => vi.fn());
const mockFindManyInvoice = vi.hoisted(() => vi.fn());
const mockFindManyAccount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  default: {
    accountingPeriod: { findFirst: mockFindFirstPeriod },
    transaction: { findMany: mockFindManyTransaction },
    retencion: { findMany: mockFindManyRetencion },
    invoice: { findMany: mockFindManyInvoice },
    account: { findMany: mockFindManyAccount },
  },
}));

import { FiscalAnomalyDetectorService } from "../services/FiscalAnomalyDetectorService";

const COMPANY_ID = "company-test";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makePeriod() {
  return { id: "period-1", year: 2026, month: 4 };
}

/** Transacción cuadrada: DEBE = HABER, suma = 0 */
function makeBalancedTx(id = "tx-1") {
  return {
    id,
    number: `DIARIO-${id}`,
    description: "Asiento cuadrado",
    entries: [
      { amount: new Decimal("1000.00") },
      { amount: new Decimal("-1000.00") },
    ],
  };
}

/** Transacción descuadrada: suma ≠ 0 */
function makeImbalancedTx(id = "tx-bad") {
  return {
    id,
    number: `DIARIO-${id}`,
    description: "Asiento descuadrado",
    entries: [
      { amount: new Decimal("1000.00") },
      { amount: new Decimal("-500.00") }, // falta 500 en HABER
    ],
  };
}

function setupDefaultMocks() {
  mockFindFirstPeriod.mockResolvedValue(makePeriod());
  mockFindManyTransaction.mockResolvedValue([]);
  mockFindManyRetencion.mockResolvedValue([]);
  mockFindManyInvoice.mockResolvedValue([]);
  mockFindManyAccount.mockResolvedValue([]);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("FiscalAnomalyDetectorService.detect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── Reporte limpio ──────────────────────────────────────────────────────────

  it("devuelve clean=true cuando no hay anomalías", async () => {
    mockFindManyTransaction.mockResolvedValue([makeBalancedTx()]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.clean).toBe(true);
    expect(report.anomalies).toHaveLength(0);
    expect(report.totalCritical).toBe(0);
    expect(report.totalHigh).toBe(0);
    expect(report.totalMedium).toBe(0);
  });

  it("incluye companyId y detectedAt en el reporte", async () => {
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.companyId).toBe(COMPANY_ID);
    expect(report.detectedAt).toBeInstanceOf(Date);
  });

  // ── CRITICAL: Asientos descuadrados ────────────────────────────────────────

  it("detecta asiento descuadrado como CRITICAL", async () => {
    mockFindManyTransaction.mockResolvedValue([makeImbalancedTx()]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.totalCritical).toBe(1);
    const anomaly = report.anomalies.find((a) => a.type === "ASIENTO_DESCUADRADO");
    expect(anomaly).toBeDefined();
    expect(anomaly!.level).toBe("CRITICAL");
    expect(anomaly!.count).toBe(1);
    expect(anomaly!.details[0]).toContain("DIARIO-tx-bad");
  });

  it("no reporta descuadre para transacción cuadrada", async () => {
    mockFindManyTransaction.mockResolvedValue([makeBalancedTx()]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.anomalies.find((a) => a.type === "ASIENTO_DESCUADRADO")).toBeUndefined();
  });

  it("cuenta múltiples asientos descuadrados", async () => {
    mockFindManyTransaction.mockResolvedValue([
      makeImbalancedTx("bad-1"),
      makeBalancedTx("ok-1"),
      makeImbalancedTx("bad-2"),
    ]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    const anomaly = report.anomalies.find((a) => a.type === "ASIENTO_DESCUADRADO");
    expect(anomaly!.count).toBe(2);
  });

  it("no escanea transacciones si no hay período activo", async () => {
    mockFindFirstPeriod.mockResolvedValue(null);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    // Sin período activo, el array de transacciones es vacío por diseño
    expect(report.anomalies.find((a) => a.type === "ASIENTO_DESCUADRADO")).toBeUndefined();
    expect(mockFindManyTransaction).not.toHaveBeenCalled();
  });

  // ── HIGH: Retenciones sin factura ──────────────────────────────────────────

  it("detecta retención sin factura como HIGH", async () => {
    mockFindManyRetencion.mockResolvedValue([
      {
        id: "ret-1",
        providerName: "Proveedor ABC",
        providerRif: "J-12345678-9",
        invoiceNumber: "0001",
        totalRetention: new Decimal("500.00"),
        status: "PENDING",
      },
    ]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    const anomaly = report.anomalies.find((a) => a.type === "RETENCION_SIN_FACTURA");
    expect(anomaly).toBeDefined();
    expect(anomaly!.level).toBe("HIGH");
    expect(anomaly!.count).toBe(1);
    expect(anomaly!.details[0]).toContain("Proveedor ABC");
    expect(anomaly!.details[0]).toContain("J-12345678-9");
  });

  it("no reporta retenciones cuando todas tienen factura (invoiceId no null)", async () => {
    // El mock devuelve vacío porque la query filtra invoiceId: null
    mockFindManyRetencion.mockResolvedValue([]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.anomalies.find((a) => a.type === "RETENCION_SIN_FACTURA")).toBeUndefined();
  });

  // ── HIGH: CxC vencida +90 días ────────────────────────────────────────────

  it("detecta CxC vencida +90 días como HIGH", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 100); // 100 días atrás
    mockFindManyInvoice.mockResolvedValue([
      {
        controlNumber: "FACT-001",
        counterpartName: "Cliente X",
        pendingAmount: new Decimal("15000.00"),
        dueDate: pastDate,
      },
    ]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    const anomaly = report.anomalies.find((a) => a.type === "CXC_VENCIDA_90_DIAS");
    expect(anomaly).toBeDefined();
    expect(anomaly!.level).toBe("HIGH");
    expect(anomaly!.count).toBe(1);
    expect(anomaly!.details[0]).toContain("Cliente X");
    expect(anomaly!.details[0]).toContain("15000.00");
  });

  // ── MEDIUM: Cuentas con saldo anormal ─────────────────────────────────────

  it("detecta activo con saldo acreedor como MEDIUM", async () => {
    // ASSET con balance negativo = saldo acreedor = anomalía
    mockFindManyAccount.mockResolvedValue([
      {
        code: "1.1.01",
        name: "Caja",
        type: "ASSET",
        journalEntries: [
          { amount: new Decimal("1000.00") },
          { amount: new Decimal("-3000.00") }, // balance = -2000 (anormal)
        ],
      },
    ]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    const anomaly = report.anomalies.find((a) => a.type === "SALDO_ANORMAL");
    expect(anomaly).toBeDefined();
    expect(anomaly!.level).toBe("MEDIUM");
    expect(anomaly!.details[0]).toContain("1.1.01");
    expect(anomaly!.details[0]).toContain("Caja");
  });

  it("no reporta saldo anormal para activo con saldo deudor (normal)", async () => {
    mockFindManyAccount.mockResolvedValue([
      {
        code: "1.1.01",
        name: "Caja",
        type: "ASSET",
        journalEntries: [{ amount: new Decimal("5000.00") }],
      },
    ]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.anomalies.find((a) => a.type === "SALDO_ANORMAL")).toBeUndefined();
  });

  it("detecta pasivo con saldo deudor como MEDIUM", async () => {
    // LIABILITY con balance positivo = saldo deudor = anomalía
    mockFindManyAccount.mockResolvedValue([
      {
        code: "2.1.01",
        name: "Cuentas por Pagar",
        type: "LIABILITY",
        journalEntries: [
          { amount: new Decimal("2000.00") }, // balance positivo = saldo deudor = anormal
        ],
      },
    ]);
    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    const anomaly = report.anomalies.find((a) => a.type === "SALDO_ANORMAL");
    expect(anomaly).toBeDefined();
    expect(anomaly!.details[0]).toContain("2.1.01");
  });

  // ── Conteo de niveles ──────────────────────────────────────────────────────

  it("totalCritical/High/Medium reflejan correctamente los niveles detectados", async () => {
    const pastDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    mockFindManyTransaction.mockResolvedValue([makeImbalancedTx()]); // CRITICAL
    mockFindManyRetencion.mockResolvedValue([
      { id: "r1", providerName: "X", providerRif: "J-1", invoiceNumber: "1", totalRetention: new Decimal("100"), status: "PENDING" },
    ]); // HIGH
    mockFindManyInvoice.mockResolvedValue([
      { controlNumber: "F1", counterpartName: "Y", pendingAmount: new Decimal("100"), dueDate: pastDate },
    ]); // HIGH
    mockFindManyAccount.mockResolvedValue([
      {
        code: "2.1.01",
        name: "CxP",
        type: "LIABILITY",
        journalEntries: [{ amount: new Decimal("500") }],
      },
    ]); // MEDIUM

    const report = await FiscalAnomalyDetectorService.detect(COMPANY_ID);
    expect(report.totalCritical).toBe(1);
    expect(report.totalHigh).toBe(2);
    expect(report.totalMedium).toBe(1);
    expect(report.clean).toBe(false);
  });
});

// ─── formatForPrompt ───────────────────────────────────────────────────────────

describe("FiscalAnomalyDetectorService.formatForPrompt", () => {
  it("devuelve mensaje limpio cuando no hay anomalías", () => {
    const report = {
      companyId: COMPANY_ID,
      detectedAt: new Date(),
      anomalies: [],
      totalCritical: 0,
      totalHigh: 0,
      totalMedium: 0,
      clean: true,
    };
    const text = FiscalAnomalyDetectorService.formatForPrompt(report);
    expect(text).toContain("No se detectaron anomalías");
  });

  it("incluye anomalías con nivel y detalles en el texto", () => {
    const report = {
      companyId: COMPANY_ID,
      detectedAt: new Date(),
      anomalies: [
        {
          type: "ASIENTO_DESCUADRADO",
          level: "CRITICAL" as const,
          description: "Transacciones descuadradas",
          count: 1,
          details: ["Comprobante DIARIO-001: Prueba"],
        },
      ],
      totalCritical: 1,
      totalHigh: 0,
      totalMedium: 0,
      clean: false,
    };
    const text = FiscalAnomalyDetectorService.formatForPrompt(report);
    expect(text).toContain("[CRITICAL]");
    expect(text).toContain("ASIENTO_DESCUADRADO");
    expect(text).toContain("DIARIO-001");
    expect(text).toContain("1 CRÍTICO");
  });
});
