// src/modules/ai-assistant/services/AIContextBuilderService.ts
//
// Ensambla el contexto financiero de la empresa para el Asistente Contable IA.
// Solo lectura — sin mutaciones. El contexto se pasa a Gemini como texto estructurado.
//
// Limitación de cuentas: solo incluye cuentas con movimiento en los últimos 90 días
// (transacciones no VOIDED). Evita saturar el contexto con cuentas inactivas.

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { PendingTasksService } from "@/modules/dashboard/services/PendingTasksService";

// ─── Tipos exportados ──────────────────────────────────────────────────────────

export type AccountBalanceLine = {
  code: string;
  name: string;
  type: string;
  balance: string;
};

export type OverdueInvoiceLine = {
  number: string;
  counterparty: string;
  amount: string;
  daysOverdue: number;
};

export type AICompanyContext = {
  companyName: string;
  rif: string | null;
  isSpecialContributor: boolean;
  activePeriod: { year: number; month: number; status: string } | null;
  totalActivo: string;
  totalPasivo: string;
  totalPatrimonio: string;
  totalIngresos: string;
  totalGastos: string;
  utilidadNeta: string;
  bankBalances: { name: string; currency: string; balance: string }[];
  ivaDebito: string;
  ivaCredito: string;
  ivaSaldoAPagar: string;
  cxcVencidas: OverdueInvoiceLine[];
  cxpVencidas: OverdueInvoiceLine[];
  payrollMonth: { totalDevengado: string; empleados: number } | null;
  fixedAssets: { count: number; totalNetValue: string };
  inventoryValue: string;
  retencionesPendientes: number;
  bcvRate: string | null;
  inpcPendiente: boolean;
  pendingTasks: { type: string; severity: string; count: number }[];
  activeAccounts: AccountBalanceLine[];
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value: Decimal | string | number | null | undefined): string {
  return new Decimal(value ?? 0).toDecimalPlaces(2).toFixed(2);
}

function daysAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const AIContextBuilderService = {
  async buildContext(companyId: string): Promise<AICompanyContext> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
    const startOfNextMonth = new Date(currentYear, currentMonth, 1);

    const [
      company,
      activePeriod,
      bankAccounts,
      currentMonthInvoices,
      overdueReceivables,
      overduePayables,
      latestPayroll,
      fixedAssetRows,
      inventoryAgg,
      pendingRetenciones,
      latestExchangeRate,
      latestInpc,
      pendingTasksData,
      activeAccountRows,
    ] = await Promise.all([
      // 1. Empresa
      prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, rif: true, isSpecialContributor: true },
      }),

      // 2. Período activo
      prisma.accountingPeriod.findFirst({
        where: { companyId, status: "OPEN" },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { year: true, month: true, status: true },
      }),

      // 3. Saldos bancarios
      prisma.bankAccount.findMany({
        where: { companyId, isActive: true, deletedAt: null },
        select: { name: true, currency: true, closingBalance: true },
      }),

      // 4. Facturas del mes para IVA
      prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          date: { gte: startOfMonth, lt: startOfNextMonth },
        },
        select: {
          type: true,
          taxLines: { select: { amount: true, taxType: true } },
        },
      }),

      // 5. CxC vencidas (SALE, UNPAID/PARTIAL, dueDate pasado)
      prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          type: "SALE",
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
          dueDate: { lt: now },
        },
        orderBy: { pendingAmount: "desc" },
        take: 5,
        select: {
          controlNumber: true,
          counterpartName: true,
          pendingAmount: true,
          dueDate: true,
        },
      }),

      // 6. CxP vencidas (PURCHASE, UNPAID/PARTIAL, dueDate pasado)
      prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          type: "PURCHASE",
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
          dueDate: { lt: now },
        },
        orderBy: { pendingAmount: "desc" },
        take: 5,
        select: {
          controlNumber: true,
          counterpartName: true,
          pendingAmount: true,
          dueDate: true,
        },
      }),

      // 7. Nómina del mes actual (más reciente APPROVED)
      prisma.payrollRun.findFirst({
        where: {
          companyId,
          status: "APPROVED",
          periodStart: { gte: startOfMonth },
        },
        orderBy: { periodStart: "desc" },
        select: { totalEarnings: true, employeeCount: true },
      }),

      // 8. Activos fijos ACTIVE
      prisma.fixedAsset.findMany({
        where: { companyId, status: "ACTIVE", deletedAt: null },
        select: {
          acquisitionCost: true,
          entries: {
            orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
            take: 1,
            select: { bookValue: true },
          },
        },
      }),

      // 9. Inventario — valor CPP total (aproximado)
      prisma.inventoryItem.findMany({
        where: { companyId, deletedAt: null },
        select: { averageCost: true, stockQuantity: true },
      }),

      // 10. Retenciones pendientes
      prisma.retencion.count({
        where: { companyId, status: "PENDING", deletedAt: null },
      }),

      // 11. Tipo de cambio BCV más reciente (USD)
      prisma.exchangeRate.findFirst({
        where: { companyId, currency: "USD" },
        orderBy: { date: "desc" },
        select: { rate: true },
      }),

      // 12. INPC pendiente (ajuste del mes actual)
      prisma.inflationAdjustment.findFirst({
        where: { companyId, periodYear: currentYear, periodMonth: currentMonth },
        select: { id: true },
      }),

      // 13. Tareas pendientes
      PendingTasksService.getPendingTasks(companyId),

      // 14. Cuentas con actividad reciente — incluye journalEntries para calcular saldo
      prisma.account.findMany({
        where: {
          companyId,
          deletedAt: null,
          journalEntries: {
            some: {
              transaction: {
                companyId,
                createdAt: { gte: ninetyDaysAgo },
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
            where: {
              transaction: { status: { not: "VOIDED" } },
            },
            select: { amount: true },
          },
        },
        orderBy: { code: "asc" },
        take: 30,
      }),
    ]);

    // ── Cuentas activas con saldo ──────────────────────────────────────────────

    const activeAccounts: AccountBalanceLine[] = activeAccountRows.map((acc) => {
      const balance = (acc.journalEntries as { amount: Decimal }[]).reduce(
        (sum, e) => sum.plus(e.amount),
        new Decimal(0),
      );
      return { code: acc.code, name: acc.name, type: acc.type, balance: fmt(balance.abs()) };
    });

    // ── Balance sheet por tipo ─────────────────────────────────────────────────

    const totales = {
      ASSET: new Decimal(0),
      LIABILITY: new Decimal(0),
      EQUITY: new Decimal(0),
      REVENUE: new Decimal(0),
      EXPENSE: new Decimal(0),
    };

    for (const acc of activeAccountRows) {
      const bal = (acc.journalEntries as { amount: Decimal }[]).reduce(
        (s, e) => s.plus(e.amount),
        new Decimal(0),
      );
      const key = acc.type as keyof typeof totales;
      if (key in totales) totales[key] = totales[key].plus(bal.abs());
    }

    // ── IVA del mes ────────────────────────────────────────────────────────────

    let ivaDebito = new Decimal(0);
    let ivaCredito = new Decimal(0);
    for (const inv of currentMonthInvoices) {
      for (const tl of inv.taxLines) {
        if (tl.taxType !== "EXENTO") {
          if (inv.type === "SALE") ivaDebito = ivaDebito.plus(tl.amount);
          else ivaCredito = ivaCredito.plus(tl.amount);
        }
      }
    }
    const ivaSaldo = ivaDebito.minus(ivaCredito);

    // ── CxC / CxP vencidas ────────────────────────────────────────────────────

    function mapOverdue(
      rows: { controlNumber: string | null; counterpartName: string; pendingAmount: Decimal | null; dueDate: Date | null }[],
    ): OverdueInvoiceLine[] {
      return rows.map((r) => ({
        number: r.controlNumber ?? "S/N",
        counterparty: r.counterpartName,
        amount: fmt(r.pendingAmount),
        daysOverdue: r.dueDate ? daysAgo(r.dueDate) : 0,
      }));
    }

    // ── Activos Fijos ─────────────────────────────────────────────────────────

    const fixedAssetNetValue = fixedAssetRows.reduce((sum, fa) => {
      const bv = fa.entries[0]?.bookValue ?? fa.acquisitionCost;
      return sum.plus(bv);
    }, new Decimal(0));

    // ── Inventario (valor CPP = Σ averageCost × stockQuantity) ───────────────

    const invValue = inventoryAgg.reduce(
      (sum, item) => sum.plus(new Decimal(item.averageCost).times(item.stockQuantity)),
      new Decimal(0),
    );

    // ── Bancos ────────────────────────────────────────────────────────────────

    const bankBalances = bankAccounts.map((b) => ({
      name: b.name,
      currency: b.currency,
      balance: fmt(b.closingBalance),
    }));

    return {
      companyName: company?.name ?? "—",
      rif: company?.rif ?? null,
      isSpecialContributor: company?.isSpecialContributor ?? false,
      activePeriod: activePeriod ?? null,
      totalActivo: fmt(totales.ASSET),
      totalPasivo: fmt(totales.LIABILITY),
      totalPatrimonio: fmt(totales.EQUITY),
      totalIngresos: fmt(totales.REVENUE),
      totalGastos: fmt(totales.EXPENSE),
      utilidadNeta: fmt(totales.REVENUE.minus(totales.EXPENSE)),
      bankBalances,
      ivaDebito: fmt(ivaDebito),
      ivaCredito: fmt(ivaCredito),
      ivaSaldoAPagar: fmt(ivaSaldo.gt(0) ? ivaSaldo : new Decimal(0)),
      cxcVencidas: mapOverdue(overdueReceivables),
      cxpVencidas: mapOverdue(overduePayables),
      payrollMonth: latestPayroll
        ? { totalDevengado: fmt(latestPayroll.totalEarnings), empleados: latestPayroll.employeeCount }
        : null,
      fixedAssets: { count: fixedAssetRows.length, totalNetValue: fmt(fixedAssetNetValue) },
      inventoryValue: fmt(invValue),
      retencionesPendientes: pendingRetenciones,
      bcvRate: latestExchangeRate ? fmt(latestExchangeRate.rate) : null,
      inpcPendiente: latestInpc === null,
      pendingTasks: pendingTasksData.tasks.map((t) => ({
        type: t.type,
        severity: t.severity,
        count: t.count,
      })),
      activeAccounts,
    };
  },

  // ── System prompt ensamblado ───────────────────────────────────────────────

  buildSystemPrompt(ctx: AICompanyContext): string {
    const period = ctx.activePeriod
      ? `${ctx.activePeriod.month}/${ctx.activePeriod.year} (${ctx.activePeriod.status === "OPEN" ? "ABIERTO" : "CERRADO"})`
      : "Sin período activo";

    const bankLines = ctx.bankBalances.length
      ? ctx.bankBalances.map((b) => `  ${b.name} [${b.currency}]: Bs. ${b.balance}`).join("\n")
      : "  Sin cuentas bancarias registradas";

    const cxcLines = ctx.cxcVencidas.length
      ? ctx.cxcVencidas.map((c) => `  ${c.counterparty} — Bs. ${c.amount} (${c.daysOverdue}d vencida)`).join("\n")
      : "  Ninguna";

    const cxpLines = ctx.cxpVencidas.length
      ? ctx.cxpVencidas.map((c) => `  ${c.counterparty} — Bs. ${c.amount} (${c.daysOverdue}d vencida)`).join("\n")
      : "  Ninguna";

    const taskLines = ctx.pendingTasks.length
      ? ctx.pendingTasks.map((t) => `  [${t.severity.toUpperCase()}] ${t.type}: ${t.count}`).join("\n")
      : "  Sin tareas pendientes";

    const accountLines = ctx.activeAccounts.length
      ? ctx.activeAccounts.map((a) => `  ${a.code} ${a.name} [${a.type}]: Bs. ${a.balance}`).join("\n")
      : "  Sin cuentas con movimiento reciente";

    return `Eres ContaFlow IA, un contador venezolano experto integrado en el sistema contable ContaFlow.
Respondes en español venezolano, con precisión técnica y lenguaje directo y profesional.
Nunca inventas datos — solo usas los que se te proporcionan a continuación.
Si no tienes el dato solicitado, lo dices claramente.

═══════════════════════════════════════════════
CONOCIMIENTO CONTABLE VEN-NIF (ESTÁTICO)
═══════════════════════════════════════════════

PLAN DE CUENTAS SENIAT:
  1.x = Activo (saldo normal DEBE)
  2.x = Pasivo (saldo normal HABER)
  3.x = Patrimonio (saldo normal HABER)
  4.x = Ingresos (saldo normal HABER)
  5.x = Gastos y Costos (saldo normal DEBE)

REGLA T — DEBE/HABER:
  Saldo deudor (DEBE): Activos, Gastos, Costos
  Saldo acreedor (HABER): Pasivos, Patrimonio, Ingresos
  Todo asiento debe cuadrar: Σ DEBE = Σ HABER

IVA VENEZUELA:
  Alícuota general: 16% | Reducida: 8% | Lujo: 31% (16%+15%) | Exento: 0%
  Declaración: día 15 del mes siguiente al período
  Saldo a pagar = Débito Fiscal (ventas) − Crédito Fiscal (compras)
  Retención IVA: 75% o 100% — SOLO si isSpecialContributor = true

IGTF (3%):
  Aplica en: Zelle, Cashea, criptomonedas, divisas en efectivo
  También aplica si isSpecialContributor = true Y paga en VES por medios electrónicos
  NO aplica: transferencias VES entre no-contribuyentes especiales

RETENCIONES ISLR (Decreto 1808):
  Honorarios profesionales: 3% | Servicios: 1-3% | Arrendamiento inmueble: 3%
  Publicidad: 3% | Comisiones: 3% | Transporte: 1%
  Base: monto bruto del pago. Se retiene al momento del pago.

DIFERENCIAL CAMBIARIO:
  Ganancia cambiaria → Ingreso (4.x)
  Pérdida cambiaria → Gasto (5.x)
  Registro: diferencia entre tipo al momento de la operación vs tipo de liquidación.

LOTTT (NÓMINA):
  Prestaciones: 15 días de salario/trimestre + intereses BCV
  Vacaciones: 15 días base + 1 día adicional/año trabajado
  Utilidades: mínimo 15 días, máximo según utilidades de la empresa
  IVSS: obrero 4%, patronal 9-11% | INCES: obrero 0.5%, patronal 2% | Banavih: 1% c/u

VEN-NIF:
  NIF 1: Presentación de estados financieros
  NIF 3: Ajuste por inflación (INPC — obligatorio para empresas en Venezuela)
  NIF 16: Activos fijos — depreciación obligatoria mensual

═══════════════════════════════════════════════
DATOS ACTUALES DE LA EMPRESA
═══════════════════════════════════════════════

EMPRESA: ${ctx.companyName}
RIF: ${ctx.rif ?? "No registrado"}
Contribuyente especial: ${ctx.isSpecialContributor ? "SÍ" : "NO"}
Período contable activo: ${period}
Tipo de cambio BCV (USD): ${ctx.bcvRate ? `Bs. ${ctx.bcvRate}` : "No registrado"}

BALANCE (cuentas con actividad últimos 90 días):
  Activo Total:    Bs. ${ctx.totalActivo}
  Pasivo Total:    Bs. ${ctx.totalPasivo}
  Patrimonio:      Bs. ${ctx.totalPatrimonio}

ESTADO DE RESULTADOS (período activo):
  Ingresos:        Bs. ${ctx.totalIngresos}
  Gastos:          Bs. ${ctx.totalGastos}
  Utilidad neta:   Bs. ${ctx.utilidadNeta}

CAJA Y BANCOS:
${bankLines}

IVA DEL MES:
  Débito Fiscal (ventas):   Bs. ${ctx.ivaDebito}
  Crédito Fiscal (compras): Bs. ${ctx.ivaCredito}
  Saldo a pagar:            Bs. ${ctx.ivaSaldoAPagar}

CxC VENCIDAS (top 5 por monto):
${cxcLines}

CxP VENCIDAS (top 5 por monto):
${cxpLines}

NÓMINA (mes actual):
${ctx.payrollMonth ? `  Devengado: Bs. ${ctx.payrollMonth.totalDevengado} | Empleados: ${ctx.payrollMonth.empleados}` : "  Sin nómina aprobada este mes"}

ACTIVOS FIJOS:
  Activos ACTIVE: ${ctx.fixedAssets.count} | Valor neto en libros: Bs. ${ctx.fixedAssets.totalNetValue}

INVENTARIO:
  Valor estimado CPP: Bs. ${ctx.inventoryValue}

RETENCIONES PENDIENTES: ${ctx.retencionesPendientes}
AJUSTE INPC PENDIENTE: ${ctx.inpcPendiente ? "SÍ — no registrado para el período actual" : "NO — ajuste del período registrado"}

TAREAS PENDIENTES:
${taskLines}

PLAN DE CUENTAS (cuentas con movimiento reciente):
${accountLines}`;
  },
};
