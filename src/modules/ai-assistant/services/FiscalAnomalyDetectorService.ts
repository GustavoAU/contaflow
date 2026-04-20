// src/modules/ai-assistant/services/FiscalAnomalyDetectorService.ts
//
// Detector RETROSPECTIVO de errores ya cometidos en la contabilidad.
// Responde a: "¿qué está mal en mis registros?" (no: "¿qué me falta hacer?")
//
// Distinción conceptual:
//   PendingTasksService   → prospectivo: tareas pendientes de compliance
//   FiscalAnomalyDetectorService → retrospectivo: errores ya registrados
//
// Solo lectura — sin mutaciones. Se integra en sendMessageAction (modo auditoría).

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type AnomalyLevel = "CRITICAL" | "HIGH" | "MEDIUM";

export type FiscalAnomaly = {
  type: string;
  level: AnomalyLevel;
  description: string;
  count: number;
  details: string[];
};

export type FiscalAnomalyReport = {
  companyId: string;
  detectedAt: Date;
  anomalies: FiscalAnomaly[];
  totalCritical: number;
  totalHigh: number;
  totalMedium: number;
  clean: boolean;
};

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Epsilon para descuadre: diferencia absoluta mayor que esto = anomalía */
const IMBALANCE_THRESHOLD = new Decimal("0.01");

/** Días de vencimiento considerados críticos en CxC */
const OVERDUE_CRITICAL_DAYS = 90;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/** Saldo normal esperado por tipo de cuenta (convención: positivo = DEBE) */
function expectedSign(
  accountType: string,
): "positive" | "negative" | "unknown" {
  switch (accountType) {
    case "ASSET":
    case "EXPENSE":
      return "positive"; // saldo normal DEBE
    case "LIABILITY":
    case "EQUITY":
    case "REVENUE":
      return "negative"; // saldo normal HABER
    default:
      return "unknown";
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const FiscalAnomalyDetectorService = {
  async detect(companyId: string): Promise<FiscalAnomalyReport> {
    const now = new Date();

    // Período activo (para limitar el escaneo de asientos al período corriente)
    const activePeriod = await prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true, year: true, month: true },
    });

    const [
      postedTransactions,
      retencionesSinFactura,
      overdueReceivables90,
      accountsWithEntries,
    ] = await Promise.all([
      // ── 1. Transacciones POSTED del período activo (descuadre) ──────────────
      activePeriod
        ? prisma.transaction.findMany({
            where: {
              companyId,
              status: "POSTED",
              periodId: activePeriod.id,
            },
            select: {
              id: true,
              number: true,
              description: true,
              entries: { select: { amount: true } },
            },
          })
        : Promise.resolve([]),

      // ── 2. Retenciones sin factura vinculada ────────────────────────────────
      prisma.retencion.findMany({
        where: {
          companyId,
          invoiceId: null,
          deletedAt: null,
        },
        select: {
          id: true,
          providerName: true,
          providerRif: true,
          invoiceNumber: true,
          totalRetention: true,
          status: true,
        },
        take: 10,
      }),

      // ── 3. CxC vencida +90 días ─────────────────────────────────────────────
      prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          type: "SALE",
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
          dueDate: {
            lt: new Date(now.getTime() - OVERDUE_CRITICAL_DAYS * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          controlNumber: true,
          counterpartName: true,
          pendingAmount: true,
          dueDate: true,
        },
        orderBy: { pendingAmount: "desc" },
        take: 10,
      }),

      // ── 4. Cuentas con saldo anormal (signo invertido vs tipo) ──────────────
      prisma.account.findMany({
        where: {
          companyId,
          deletedAt: null,
          journalEntries: {
            some: {
              transaction: {
                companyId,
                status: { not: "VOIDED" },
              },
            },
          },
        },
        select: {
          code: true,
          name: true,
          type: true,
          journalEntries: {
            where: { transaction: { status: { not: "VOIDED" } } },
            select: { amount: true },
          },
        },
      }),
    ]);

    const anomalies: FiscalAnomaly[] = [];

    // ── CRÍTICO: Asientos descuadrados ─────────────────────────────────────────
    const descuadradas = postedTransactions.filter((tx) => {
      const sum = (tx.entries as { amount: Decimal }[]).reduce(
        (acc, e) => acc.plus(e.amount),
        new Decimal(0),
      );
      return sum.abs().gt(IMBALANCE_THRESHOLD);
    });

    if (descuadradas.length > 0) {
      anomalies.push({
        type: "ASIENTO_DESCUADRADO",
        level: "CRITICAL",
        description: "Transacciones cuya suma DEBE ≠ HABER (partida doble violada)",
        count: descuadradas.length,
        details: descuadradas.slice(0, 5).map(
          (tx) => `Comprobante ${tx.number}: ${tx.description.slice(0, 60)}`,
        ),
      });
    }

    // ── ALTO: Retenciones sin factura ─────────────────────────────────────────
    if (retencionesSinFactura.length > 0) {
      anomalies.push({
        type: "RETENCION_SIN_FACTURA",
        level: "HIGH",
        description: "Retenciones registradas sin factura de origen vinculada",
        count: retencionesSinFactura.length,
        details: retencionesSinFactura.slice(0, 5).map(
          (r) => `${r.providerName} (${r.providerRif}) — Fact. ${r.invoiceNumber}`,
        ),
      });
    }

    // ── ALTO: CxC vencida +90 días ────────────────────────────────────────────
    if (overdueReceivables90.length > 0) {
      anomalies.push({
        type: "CXC_VENCIDA_90_DIAS",
        level: "HIGH",
        description: `Cuentas por cobrar vencidas hace más de ${OVERDUE_CRITICAL_DAYS} días`,
        count: overdueReceivables90.length,
        details: overdueReceivables90.slice(0, 5).map((inv) => {
          const days = inv.dueDate ? daysBetween(inv.dueDate) : 0;
          return `${inv.counterpartName} — Bs. ${new Decimal(inv.pendingAmount ?? 0).toFixed(2)} (${days}d)`;
        }),
      });
    }

    // ── MEDIO: Cuentas con saldo anormal ──────────────────────────────────────
    const cuentasAnormales = accountsWithEntries.filter((acc) => {
      const sign = expectedSign(acc.type);
      if (sign === "unknown") return false;
      const balance = (acc.journalEntries as { amount: Decimal }[]).reduce(
        (s, e) => s.plus(e.amount),
        new Decimal(0),
      );
      if (sign === "positive" && balance.lt(IMBALANCE_THRESHOLD.negated())) return true;
      if (sign === "negative" && balance.gt(IMBALANCE_THRESHOLD)) return true;
      return false;
    });

    if (cuentasAnormales.length > 0) {
      anomalies.push({
        type: "SALDO_ANORMAL",
        level: "MEDIUM",
        description: "Cuentas cuyo saldo tiene signo contrario al esperado por su tipo",
        count: cuentasAnormales.length,
        details: cuentasAnormales.slice(0, 5).map(
          (a) => `${a.code} ${a.name} [${a.type}]`,
        ),
      });
    }

    const totalCritical = anomalies.filter((a) => a.level === "CRITICAL").length;
    const totalHigh = anomalies.filter((a) => a.level === "HIGH").length;
    const totalMedium = anomalies.filter((a) => a.level === "MEDIUM").length;

    return {
      companyId,
      detectedAt: now,
      anomalies,
      totalCritical,
      totalHigh,
      totalMedium,
      clean: anomalies.length === 0,
    };
  },

  /** Convierte el reporte a texto para inyectar en el prompt de Gemini */
  formatForPrompt(report: FiscalAnomalyReport): string {
    if (report.clean) {
      return "AUDITORÍA CONTABLE: No se detectaron anomalías en los registros del período activo.";
    }

    const lines: string[] = [
      `AUDITORÍA CONTABLE — ${report.detectedAt.toLocaleDateString("es-VE")}`,
      `Resumen: ${report.totalCritical} CRÍTICO(S) | ${report.totalHigh} ALTO(S) | ${report.totalMedium} MEDIO(S)`,
      "",
    ];

    for (const anomaly of report.anomalies) {
      lines.push(`[${anomaly.level}] ${anomaly.type} (${anomaly.count} caso${anomaly.count > 1 ? "s" : ""})`);
      lines.push(`  ${anomaly.description}`);
      for (const detail of anomaly.details) {
        lines.push(`  • ${detail}`);
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  },
};
