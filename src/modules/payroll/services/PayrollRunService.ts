// src/modules/payroll/services/PayrollRunService.ts
// Fase NOM-C: CRUD de procesos de nómina + aprobación + cancelación
//
// Seguridad (ADR-013):
//   NOM-C-01: findFirst siempre incluye companyId en where (IDOR guard)
//   NOM-C-02: create() captura P2002 del @@unique como doble-proceso — no Serializable
//   NOM-C-03: approve() usa updateMany mutex (status:'DRAFT') — no Serializable
//   NOM-C-04: cancel() solo desde DRAFT; APPROVED lanza error explícito
//   NOM-C-11: AuditLog en $transaction de create/approve/cancel
//   NOM-C-13: guard de período contable cerrado en create/approve
//   NOM-C-14: totales calculados aquí, nunca del input del cliente

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import * as Sentry from "@sentry/nextjs";
import { sendEmail } from "@/lib/email";
import { signEmployeeToken } from "@/lib/employee-portal-jwt";
import { planLoanInstallments, type SalaryCurrency } from "./EmployeeLoanService";
import type {
  PayrollRunStatus,
  ConceptType,
} from "@prisma/client";
import {
  PayrollCalculatorService,
  type EmployeeCalculationInput,
  type ManualConceptCalculationInput,
  type PayrollCalculatorConfig,
  HE_DAY_MULTIPLIER,
  HE_NIGHT_MULTIPLIER,
  HE_DAY_MULTIPLIER_UNAUTHORIZED,
  HE_NIGHT_MULTIPLIER_UNAUTHORIZED,
} from "./PayrollCalculatorService";
import { PayrollConceptService } from "./PayrollConceptService";
import { LegalThresholdService } from "./LegalThresholdService";
import type { CreatePayrollRunInput } from "../schemas/payroll-run.schema";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface PayrollRunLineRow {
  id: string;
  employeeId: string;
  employeeName: string;
  conceptCode: string;
  conceptType: ConceptType;
  amount: string;
  hours: string | null;
  // U-02: base imponible y tasa para mostrar "4% sobre 130,00 = 5,20"
  basis: string | null;
  rate: string | null;
  salarySnapshotAmount: string | null;
}

export interface PayrollRunRow {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatus;
  totalEarnings: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerCosts: string; // F-03: aportes patronales
  employeeCount: number;
  bcvRateAtRun: string | null; // C-05: tasa BCV activa del período
  transactionId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  // LOTTT Art. 178: excesos de horas extra detectados al calcular. Sólo lo llena
  // create(); las lecturas posteriores no recalculan, van al AuditLog del run.
  overtimeWarnings?: string[];
}

export interface PayrollRunDetailRow extends PayrollRunRow {
  lines: PayrollRunLineRow[];
}

// ─── Serialización ────────────────────────────────────────────────────────────

function serializeRun(r: {
  id: string;
  companyId: string;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollRunStatus;
  totalEarnings: Decimal;
  totalDeductions: Decimal;
  totalNet: Decimal;
  totalEmployerCosts: Decimal;
  employeeCount: number;
  bcvRateAtRun: Decimal | null;
  transactionId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}): PayrollRunRow {
  return {
    id: r.id,
    companyId: r.companyId,
    periodStart: r.periodStart.toISOString().split("T")[0],
    periodEnd: r.periodEnd.toISOString().split("T")[0],
    status: r.status,
    totalEarnings: r.totalEarnings.toString(),
    totalDeductions: r.totalDeductions.toString(),
    totalNet: r.totalNet.toString(),
    totalEmployerCosts: r.totalEmployerCosts.toString(),
    employeeCount: r.employeeCount,
    bcvRateAtRun: r.bcvRateAtRun?.toString() ?? null,
    transactionId: r.transactionId,
    createdByUserId: r.createdByUserId,
    approvedByUserId: r.approvedByUserId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ─── PayrollRunService ────────────────────────────────────────────────────────

export const PayrollRunService = {
  // ── list — todos los runs de la empresa (sin líneas — NOM-C-17) ───────────
  async list(companyId: string): Promise<PayrollRunRow[]> {
    const runs = await prisma.payrollRun.findMany({
      where: { companyId },
      orderBy: { periodStart: "desc" },
    });
    return runs.map(serializeRun);
  },

  // ── getById — run con líneas detalladas ───────────────────────────────────
  // NOM-C-01: findFirst con companyId (IDOR guard)
  async getById(companyId: string, runId: string): Promise<PayrollRunDetailRow | null> {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: {
        lines: {
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
          orderBy: [{ employeeId: "asc" }, { conceptCode: "asc" }],
        },
      },
    });
    if (!run) return null;

    return {
      ...serializeRun(run),
      lines: run.lines.map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        conceptCode: l.conceptCode,
        conceptType: l.conceptType,
        amount: l.amount.toString(),
        hours: l.hours?.toString() ?? null,
        basis: l.basis?.toString() ?? null,
        rate: l.rate?.toString() ?? null,
        salarySnapshotAmount: l.salarySnapshotAmount?.toString() ?? null,
      })),
    };
  },

  // ── create — calcula y persiste un run en DRAFT ───────────────────────────
  // NOM-C-02: P2002 del @@unique manejado por la action (no Serializable)
  // NOM-C-13: guard de período contable cerrado
  // NOM-C-14: totales calculados aquí — nunca del input
  async create(
    companyId: string,
    userId: string,
    input: CreatePayrollRunInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<PayrollRunRow> {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    // ── Guard período contable (NOM-C-13) ─────────────────────────────────
    // Usar métodos UTC para evitar desfase de zona horaria (VEN = UTC-4)
    const openPeriod = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: periodStart.getUTCFullYear(),
        month: periodStart.getUTCMonth() + 1,
        status: "OPEN",
      },
    });
    if (!openPeriod) {
      throw new Error(
        "No existe un período contable abierto que cubra las fechas de nómina"
      );
    }

    // ── Guard de períodos SOLAPADOS ───────────────────────────────────────
    // El @@unique([companyId, periodStart, periodEnd]) bloquea el período
    // IDÉNTICO, no el solapado: 01–15 de agosto y 01–31 de agosto son dos pares
    // de fechas distintos y ambos pasaban. Con horas extra de por medio eso es
    // doble pago —las mismas horas entran en las líneas de los dos runs— y con
    // el salario base, dos nóminas por el mismo tiempo trabajado.
    const overlapping = await prisma.payrollRun.findFirst({
      where: {
        companyId,
        status: { in: ["DRAFT", "APPROVED"] },
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
      select: { periodStart: true, periodEnd: true, status: true },
    });
    if (overlapping) {
      const desde = overlapping.periodStart.toISOString().split("T")[0];
      const hasta = overlapping.periodEnd.toISOString().split("T")[0];
      throw new Error(
        `Ya existe un proceso de nómina ${overlapping.status === "DRAFT" ? "en borrador" : "aprobado"} ` +
        `que cubre del ${desde} al ${hasta}, y se solapa con el período que intentas procesar. ` +
        "Cancélalo o ajusta las fechas."
      );
    }

    // ── Obtener config (con flags de organismos) ───────────────────────────
    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
    });
    if (!config) throw new Error("Configure la nómina antes de procesar");

    // ── Obtener empleados activos (o seleccionados) ────────────────────────
    const employeeFilter =
      input.employeeIds && input.employeeIds.length > 0
        ? { id: { in: input.employeeIds }, companyId, status: "ACTIVE" as const }
        : { companyId, status: "ACTIVE" as const };

    const employees = await prisma.employee.findMany({
      where: employeeFilter,
      include: {
        salaryHistory: {
          where: { effectiveFrom: { lte: periodStart } },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
    });

    if (employees.length === 0) {
      throw new Error("No hay empleados activos para procesar");
    }

    // ── Garantizar que los conceptos del sistema existen (idempotente) ───────
    // Necesario para empresas que nunca visitaron la página de conceptos
    // y para sincronizar nuevos conceptos del sistema (ej: RPE_OBR — ítem 54)
    await PayrollConceptService.seedDefaults(companyId, userId, ipAddress, userAgent);

    // ── Obtener conceptos del sistema de la empresa ────────────────────────
    // NOM-C-07: siempre de la DB con companyId — nunca del input del cliente
    const systemConcepts = await prisma.payrollConcept.findMany({
      where: { companyId, isSystem: true, isActive: true },
      select: { id: true, code: true, salaryNature: true },
    });

    // Topes y alícuotas legales: LegalThreshold vigente al inicio del período.
    // Las alícuotas tienen fallback a los defaults del calculador si no hay registro.
    const periodDate = new Date(input.periodStart);
    const [
      thresholdSalMin,
      ivssObrPct, ivssPatPct,
      incesObrPct, incesPatPct,
      faovObrPct, faovPatPct,
      rpeObrPct, rpePatPct,
      usdFxRow,
    ] = await Promise.all([
      LegalThresholdService.getActive(companyId, "SALARY_MIN_VES",  periodDate),
      LegalThresholdService.getActive(companyId, "IVSS_OBR_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "IVSS_PAT_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "INCES_OBR_RATE", periodDate),
      LegalThresholdService.getActive(companyId, "INCES_PAT_RATE", periodDate),
      LegalThresholdService.getActive(companyId, "FAOV_OBR_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "FAOV_PAT_RATE",  periodDate),
      LegalThresholdService.getActive(companyId, "RPE_OBR_RATE",   periodDate),
      LegalThresholdService.getActive(companyId, "RPE_PAT_RATE",   periodDate),
      // H-4: tasa Bs./USD para llevar los topes legales a la moneda del sueldo.
      // Misma ventana que usa approve() para el asiento (lte periodEnd, la más
      // reciente), para que el tope y el asiento no salgan de tasas distintas.
      prisma.exchangeRate.findFirst({
        where: { companyId, currency: "USD", date: { lte: periodEnd } },
        orderBy: { date: "desc" },
        select: { rate: true },
      }),
    ]);

    const salaryMinimumVes =
      thresholdSalMin ??
      (config.salaryMinimumVes ? new Decimal(config.salaryMinimumVes.toString()) : new Decimal(0));

    // LegalThreshold almacena alícuotas como porcentaje (ej: 4.00 = 4%) → dividir /100
    const toRate = (pct: Decimal | null) => pct ? pct.dividedBy(100) : undefined;

    const activeEmployeeCount = await prisma.employee.count({
      where: { companyId, status: "ACTIVE" },
    });

    const calcConfig: PayrollCalculatorConfig = {
      frequency: config.frequency,
      ivssEnabled: config.ivssEnabled,
      incesEnabled: config.incesEnabled,
      banavihEnabled: config.banavihEnabled,
      rpeEnabled: config.rpeEnabled,
      salaryMinimumVes,
      ivssRiskClass: config.ivssRiskClass,
      // El IVSS se cotiza por semana (Reglamento LSS Art. 99): el período define
      // cuántas cotizaciones se causaron.
      periodStart,
      periodEnd,
      // Ley INCES Art. 49: el aporte patronal sólo lo deben las entidades con
      // cinco o más trabajadores. Se cuentan los ACTIVOS de la empresa, no los
      // de este proceso, que puede correrse sobre un subconjunto.
      activeEmployeeCount,
      // Alícuotas del salario integral — base del FAOV (LRPVH Art. 33.1).
      profitDays: config.profitDays,
      vacationBonusDays: config.vacationBonusDays,
      usdToVesRate: usdFxRow ? new Decimal(usdFxRow.rate.toString()) : null,
      systemConcepts: systemConcepts.map((c) => ({
        code: c.code, conceptId: c.id, salaryNature: c.salaryNature,
      })),
      ivssObrRate:  toRate(ivssObrPct),
      ivssPatRate:  toRate(ivssPatPct),
      incesObrRate: toRate(incesObrPct),
      incesPatRate: toRate(incesPatPct),
      faovObrRate:  toRate(faovObrPct),
      faovPatRate:  toRate(faovPatPct),
      rpeObrRate:   toRate(rpeObrPct),
      rpePatRate:   toRate(rpePatPct),
    };

    // ── Salario normal del MES ANTERIOR (ADR-045 D-5) ──────────────────────
    // LOTTT Art. 107: toda contribución se calcula "considerando el salario
    // normal correspondiente al mes inmediatamente anterior a aquél en que se
    // causó". LRPE Art. 46 lo repite para el RPE.
    //
    // Se suman TODOS los runs aprobados de ese mes: en nómina quincenal son dos,
    // y lo que pide el artículo es el salario del mes, no el de una quincena.
    const prevMonthStart = new Date(Date.UTC(
      periodStart.getUTCFullYear(), periodStart.getUTCMonth() - 1, 1,
    ));
    const prevMonthEnd = new Date(Date.UTC(
      periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 0,
    ));

    const previousNormalWageByEmp = new Map<string, Decimal>();
    const prevRuns = await prisma.payrollRun.findMany({
      where: {
        companyId,
        status: "APPROVED",
        periodStart: { gte: prevMonthStart },
        periodEnd: { lte: prevMonthEnd },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    });

    // ¿Cubren TODO el mes anterior? En nómina quincenal son dos runs; si la
    // segunda sigue en DRAFT, sumar sólo la primera da media base legal — y un
    // Decimal a la mitad es un valor válido, así que pasaba sin error ni aviso.
    // Se distingue "no hay mes anterior" de "lo hay incompleto": en el segundo
    // caso también se cae al mes en curso, pero dejando constancia del motivo.
    const DAY_MS = 1000 * 60 * 60 * 24;
    const prevMonthDays = Math.round((prevMonthEnd.getTime() - prevMonthStart.getTime()) / DAY_MS) + 1;
    const coveredDays = prevRuns.reduce(
      (n, r) => n + Math.round((r.periodEnd.getTime() - r.periodStart.getTime()) / DAY_MS) + 1,
      0,
    );
    const prevMonthComplete = prevRuns.length > 0 && coveredDays >= prevMonthDays;
    const prevMonthPartial = prevRuns.length > 0 && !prevMonthComplete;

    const prevRunIds = prevMonthComplete ? prevRuns.map((r) => r.id) : [];

    // ── Horas extra acumuladas en el año (LOTTT Art. 178) ──────────────────
    // El tope anual son cien horas; sin el acumulado sólo se puede comprobar el
    // semanal. Se cuentan los runs APPROVED del año calendario en curso.
    const yearStart = new Date(Date.UTC(periodStart.getUTCFullYear(), 0, 1));
    const overtimeYtdByEmp = new Map<string, Decimal>();
    const yearRunIds = (await prisma.payrollRun.findMany({
      where: {
        companyId,
        status: "APPROVED",
        periodStart: { gte: yearStart },
        periodEnd: { lt: periodStart },
      },
      select: { id: true },
    })).map((r) => r.id);

    if (yearRunIds.length > 0) {
      const heLines = await prisma.payrollRunLine.findMany({
        where: {
          // companyId explícito aunque runIds ya venga acotado: PayrollRunLine
          // tiene columna propia y la aserción de tenant (ADR-044 D-3) no acepta
          // el acotamiento indirecto. Ademas habilita el indice compuesto.
          companyId,
          payrollRunId: { in: yearRunIds },
          conceptCode: { in: ["HE_DIURNA", "HE_NOCTURNA"] },
        },
        select: { employeeId: true, hours: true },
      });
      for (const l of heLines) {
        if (!l.hours) continue;
        overtimeYtdByEmp.set(
          l.employeeId,
          (overtimeYtdByEmp.get(l.employeeId) ?? new Decimal(0)).plus(l.hours.toString()),
        );
      }
    }

    if (prevRunIds.length > 0) {
      // La naturaleza salarial vive en PayrollConcept, no en la línea: se
      // resuelve por código sobre todos los conceptos de la empresa, no sólo los
      // del sistema, porque un bono propio con incidencia también forma base.
      const allConcepts = await prisma.payrollConcept.findMany({
        where: { companyId },
        select: { code: true, salaryNature: true },
      });
      const natureByCode = new Map(allConcepts.map((c) => [c.code, c.salaryNature]));

      const prevLines = await prisma.payrollRunLine.findMany({
        where: { companyId, payrollRunId: { in: prevRunIds }, conceptType: "EARNING" },
        select: {
          employeeId: true, conceptCode: true, amount: true,
          // Naturaleza CONGELADA al calcular aquel mes. Resolverla contra el
          // catálogo vivo hacía que reclasificar un concepto reescribiera la
          // base de un mes ya aprobado, contabilizado y declarado.
          salaryNature: true,
          // La moneda del mes anterior NO tiene por qué ser la de hoy. Sumar
          // `amount` a secas mezclaba unidades: un empleado que pasó de USD 300
          // a Bs. 30.000 cotizaba sobre "300 bolívares". Es el mismo mecanismo
          // de H-4, por la puerta del histórico.
          salarySnapshotCurrency: true,
        },
      });

      // Moneda del sueldo VIGENTE de cada empleado: es la unidad en la que el
      // calculador compara la base contra el tope, así que es a la que hay que
      // llevar el mes anterior.
      const currentCurrencyByEmp = new Map(
        employees
          .filter((e) => e.salaryHistory.length > 0)
          .map((e) => [e.id, e.salaryHistory[0].currency]),
      );
      const usdRate = usdFxRow ? new Decimal(usdFxRow.rate.toString()) : null;

      for (const l of prevLines) {
        // El catálogo sólo se consulta cuando la línea es anterior a la
        // migración del snapshot: ahí no hay nada congelado que respetar.
        const nature = l.salaryNature ?? natureByCode.get(l.conceptCode);
        if (nature !== "SALARIO_NORMAL") continue;
        const to = currentCurrencyByEmp.get(l.employeeId);
        const from = l.salarySnapshotCurrency;
        if (!to) continue;

        let amount = new Decimal(l.amount.toString());
        if (from && from !== to) {
          // Bloquea en vez de inventar, igual que hace el calculador con los
          // topes: una base en la moneda equivocada se desvía por el factor
          // exacto de la tasa y no se nota en ninguna cifra del recibo.
          if (from === "MIXED" || to === "MIXED") {
            throw new Error(
              "El empleado tiene sueldo en modalidad MIXTA en alguno de los dos " +
              "meses: no se puede saber qué parte va en cada moneda para calcular " +
              "la base del mes anterior. Divide el sueldo en dos registros."
            );
          }
          if (!usdRate || usdRate.lte(0)) {
            throw new Error(
              "El empleado cambió de moneda de sueldo respecto al mes anterior y " +
              "no hay tasa BCV registrada para el período. Regístrala en " +
              "Contabilidad → Tasas de Cambio: sin ella, la base de cotización " +
              "del mes anterior quedaría en una moneda distinta a la del tope."
            );
          }
          amount = from === "USD" ? amount.mul(usdRate) : amount.div(usdRate);
        }

        previousNormalWageByEmp.set(
          l.employeeId,
          (previousNormalWageByEmp.get(l.employeeId) ?? new Decimal(0)).plus(amount),
        );
      }
    }

    // ── Horas extra del período (LOTTT Art. 183) ───────────────────────────
    // Vienen del registro, que es donde la Ley manda anotarlas. Hasta 2026-08-29
    // esto era `new Decimal(0)` en duro: las líneas HE_DIURNA/HE_NOCTURNA no se
    // generaban nunca y los recargos de los Arts. 117/118 y los topes del 178
    // eran código inalcanzable.
    //
    // Sólo las que aún no se han pagado (`payrollRunId: null`): si un período se
    // reprocesa, las horas ya liquidadas en otra nómina no se vuelven a pagar.
    //
    // Y sólo las de quien este proceso REALMENTE liquida. Sin el filtro por
    // empleado se reservaban todas las horas libres de la empresa, incluidas las
    // de trabajadores fuera del run —`create` acepta `employeeIds`, y una empresa
    // con sueldos en dos monedas está OBLIGADA a procesar por separado— y las de
    // quien no tiene sueldo vigente, que no produce líneas. Esas horas quedaban
    // con `payrollRunId` de un run que no las paga, sin `paidAmount`, invisibles
    // para todo run futuro (el filtro es `payrollRunId: null`) y sin salida por
    // UI: trabajadas, marcadas como tomadas y nunca cobradas. Es el mismo defecto
    // que ya se corrigió en `approve` (ver allí), un paso antes.
    const payableEmployeeIds = employees
      .filter((e) => e.salaryHistory.length > 0)
      .map((e) => e.id);

    const overtimeEntries = await prisma.overtimeEntry.findMany({
      where: {
        companyId,
        payrollRunId: null,
        employeeId: { in: payableEmployeeIds },
        // `lte: periodEnd` y no un rango: las horas de un período cuya nómina ya
        // se aprobó quedaban sin recoger POR NADIE — el run siguiente sólo
        // miraba su propia ventana y el de su período ya no se puede rehacer
        // (@@unique). Se veían para siempre como "por pagar".
        //
        // Arrastrarlas es lo que hace cualquier nómina real: se pagan tarde,
        // pero se pagan. Siguen sin cobrarse hasta que alguien las liquide, así
        // que barrer lo pendiente es lo correcto, no una licencia.
        workedOn: { lte: periodEnd },
      },
      select: { id: true, employeeId: true, hours: true, kind: true, authorized: true },
    });
    // Ids de los registros que ESTE run va a liquidar. Se reservan al crear el
    // borrador (mas abajo, dentro del $transaction) y no al aprobar: mientras
    // estuvieran libres, un segundo run con periodo SOLAPADO —que el
    // @@unique([companyId, periodStart, periodEnd]) no impide, porque el par de
    // fechas es distinto— se llevaba las mismas horas y el trabajador cobraba dos
    // veces. Reservarlas aqui hace que el filtro `payrollRunId: null` de arriba
    // sea el guard: el segundo run simplemente no las ve.
    const claimedOvertimeIds = overtimeEntries.map((e) => e.id);

    type OvertimeBuckets = {
      dayAuth: Decimal; nightAuth: Decimal;
      dayUnauth: Decimal; nightUnauth: Decimal;
    };
    const overtimeByEmp = new Map<string, OvertimeBuckets>();
    for (const e of overtimeEntries) {
      if (!overtimeByEmp.has(e.employeeId)) {
        overtimeByEmp.set(e.employeeId, {
          dayAuth: new Decimal(0), nightAuth: new Decimal(0),
          dayUnauth: new Decimal(0), nightUnauth: new Decimal(0),
        });
      }
      const b = overtimeByEmp.get(e.employeeId)!;
      const h = new Decimal(e.hours.toString());
      // Art. 182: el permiso de la Inspectoría cambia la TARIFA, no la
      // naturaleza de la hora. Por eso se separan en cuatro cubos y no en dos.
      if (e.kind === "DIURNA") {
        if (e.authorized) b.dayAuth = b.dayAuth.plus(h);
        else b.dayUnauth = b.dayUnauth.plus(h);
      } else {
        if (e.authorized) b.nightAuth = b.nightAuth.plus(h);
        else b.nightUnauth = b.nightUnauth.plus(h);
      }
    }

    // ── Construir inputs del calculador ────────────────────────────────────
    const empInputs: EmployeeCalculationInput[] = employees
      .filter((e) => e.salaryHistory.length > 0)
      .map((e) => ({
        employeeId: e.id,
        salaryHistoryId: e.salaryHistory[0].id,
        salaryAmount: e.salaryHistory[0].amount,
        salaryCurrency: e.salaryHistory[0].currency,
        // LOTTT Art. 173: la jornada decide el divisor del salario hora.
        workShift: e.workSchedule,
        overtimeHoursDay: overtimeByEmp.get(e.id)?.dayAuth ?? new Decimal(0),
        overtimeHoursNight: overtimeByEmp.get(e.id)?.nightAuth ?? new Decimal(0),
        overtimeHoursDayUnauthorized: overtimeByEmp.get(e.id)?.dayUnauth,
        overtimeHoursNightUnauthorized: overtimeByEmp.get(e.id)?.nightUnauth,
        absenceDays: new Decimal(0),
        // undefined para quien no tenga mes anterior: el calculador cotiza
        // entonces sobre el mes en curso (ver D-5).
        previousMonthNormalWage: previousNormalWageByEmp.get(e.id),
        overtimeHoursYearToDate: overtimeYtdByEmp.get(e.id) ?? new Decimal(0),
      }));

    // Quien no tenga sueldo con vigencia al inicio del período queda fuera del
    // filtro de arriba. Si eso deja la lista vacía, `calculate` no se queja —no
    // hay monedas que mezclar ni importes negativos— y el proceso nacía en
    // DRAFT sin una sola línea: una nómina que parecía creada y no pagaba a
    // nadie. El chequeo de `employees.length` de más arriba no lo ve, porque
    // esos trabajadores SÍ existen y están activos.
    if (empInputs.length === 0) {
      throw new Error(
        "Ninguno de los trabajadores seleccionados tiene un sueldo con vigencia " +
        "al inicio del período. Registra el sueldo con una fecha de vigencia " +
        "igual o anterior al inicio, o ajusta las fechas del proceso."
      );
    }

    // ── Conceptos manuales (NOM-C-07: validar ownership) ──────────────────
    const manualInputs: ManualConceptCalculationInput[] = [];
    if (input.manualConcepts && input.manualConcepts.length > 0) {
      const manualConceptIds = [...new Set(input.manualConcepts.map((m) => m.conceptId))];
      const validConcepts = await prisma.payrollConcept.findMany({
        where: { id: { in: manualConceptIds }, companyId },
        select: { id: true, code: true, type: true, salaryNature: true },
      });
      if (validConcepts.length !== manualConceptIds.length) {
        throw new Error("Uno o más conceptos manuales no pertenecen a esta empresa");
      }
      const conceptMap = new Map(validConcepts.map((c) => [c.id, c]));
      for (const m of input.manualConcepts) {
        const concept = conceptMap.get(m.conceptId)!;
        manualInputs.push({
          conceptId: m.conceptId,
          conceptCode: concept.code,
          conceptType: concept.type,
          employeeId: m.employeeId,
          amount: new Decimal(m.amount),
          // ADR-045 D-4: si el concepto tiene incidencia salarial, este monto
          // entra en la base de cotizaciones.
          salaryNature: concept.salaryNature,
        });
      }
    }

    // ── Cuotas de préstamos activos (PRESTAMO_EMP) ────────────────────────
    // Inyectadas como deducciones automáticas antes del cálculo.
    // La cuota = min(installmentAmount, remainingBalance) por préstamo.
    const employeeIds = empInputs.map((e) => e.employeeId);
    const activeLoans = await prisma.employeeLoan.findMany({
      where: { companyId, status: "ACTIVE", employeeId: { in: employeeIds } },
      orderBy: { createdAt: "asc" }, // más antiguo primero
    });
    if (activeLoans.length > 0) {
      const loanConcept = systemConcepts.find((c) => c.code === "PRESTAMO_EMP");
      if (loanConcept) {
        // La cuota sale de planLoanInstallments, no de leer las columnas a mano:
        // la moneda del préstamo decide de qué par de columnas se cobra, y el
        // mismo planificador corre otra vez al aprobar para bajar los saldos.
        const salaryByEmployee = new Map(empInputs.map((e) => [e.employeeId, e.salaryCurrency]));
        const loansByEmployee = new Map<string, typeof activeLoans>();
        for (const loan of activeLoans) {
          const list = loansByEmployee.get(loan.employeeId) ?? [];
          list.push(loan);
          loansByEmployee.set(loan.employeeId, list);
        }

        for (const [empId, empLoans] of loansByEmployee.entries()) {
          const salaryCurrency = salaryByEmployee.get(empId) ?? "VES";
          const plans = planLoanInstallments(empLoans, salaryCurrency);
          const total = plans.reduce((sum, p) => sum.plus(p.lineAmount), new Decimal(0));
          if (total.greaterThan(0)) {
            manualInputs.push({
              conceptId: loanConcept.id,
              conceptCode: "PRESTAMO_EMP",
              conceptType: "DEDUCTION",
              employeeId: empId,
              amount: total,
              salaryNature: loanConcept.salaryNature,
            });
          }
        }
      }
    }

    // ── Calcular (servicio puro — lanza si netPayable < 0) ────────────────
    const result = PayrollCalculatorService.calculate(empInputs, manualInputs, calcConfig);

    // C-05: lookup tasa BCV activa del período para snapshot de auditoría
    const bcvRate = await prisma.bcvBenefitRate.findFirst({
      where: {
        companyId,
        year: periodStart.getUTCFullYear(),
        month: periodStart.getUTCMonth() + 1,
      },
      orderBy: { createdAt: "desc" },
      select: { annualRate: true },
    });

    // ── Persistir en $transaction ──────────────────────────────────────────
    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          companyId,
          periodStart,
          periodEnd,
          status: "DRAFT",
          totalEarnings: result.totalEarnings,
          totalDeductions: result.totalDeductions,
          totalNet: result.totalNet,
          totalEmployerCosts: result.totalEmployerCosts,
          employeeCount: empInputs.length,
          bcvRateAtRun: bcvRate ? new Decimal(bcvRate.annualRate.toString()) : null,
          createdByUserId: userId,
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (result.lines.length > 0) {
        await tx.payrollRunLine.createMany({
          data: result.lines.map((l) => ({
            companyId,
            payrollRunId: run.id,
            employeeId: l.employeeId,
            conceptId: l.conceptId,
            conceptCode: l.conceptCode,
            conceptType: l.conceptType,
            amount: l.amount,
            basis: l.basis ?? null,
            hours: l.hours ?? null,
            rate: l.rate ?? null,
            salaryHistoryId: l.salaryHistoryId,
            salarySnapshotAmount: l.salarySnapshotAmount,
            salarySnapshotCurrency: l.salarySnapshotCurrency,
            // Snapshot igual que conceptCode/conceptType: la base del mes
            // anterior se lee de estas líneas, y el catálogo puede cambiar.
            salaryNature: l.salaryNature,
          })),
        });
      }

      if (claimedOvertimeIds.length > 0) {
        // `payrollRunId: null` en el where: si otro run se los llevo entre la
        // lectura y aqui, esta actualizacion no los toca y el conteo lo delata.
        const claimed = await tx.overtimeEntry.updateMany({
          where: { id: { in: claimedOvertimeIds }, companyId, payrollRunId: null },
          data: { payrollRunId: run.id },
        });
        if (claimed.count !== claimedOvertimeIds.length) {
          throw new Error(
            "Otro proceso de nómina tomó estas horas extraordinarias mientras se " +
            "calculaba este. Vuelve a intentarlo."
          );
        }
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollRun",
          entityId: run.id,
          action: "CREATE_PAYROLL_RUN",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            employeeCount: empInputs.length,
            totalEarnings: result.totalEarnings.toString(),
            totalDeductions: result.totalDeductions.toString(),
            totalNet: result.totalNet.toString(),
            // VI: conceptos manuales para trazabilidad de fiscalización
            manualConcepts: (input.manualConcepts ?? []).map((m) => ({
              conceptId: m.conceptId,
              employeeId: m.employeeId,
              amount: m.amount,
            })),
            // ADR-045 D-5: de dónde salió la base de las cotizaciones. Sin esto
            // no hay forma de saber, mirando el run, si se cotizó sobre el mes
            // anterior o sobre el mes en curso, ni por qué.
            contributionBasis: prevMonthComplete
              ? "MES_ANTERIOR"
              : prevMonthPartial
                ? "MES_EN_CURSO_POR_MES_ANTERIOR_INCOMPLETO"
                : "MES_EN_CURSO_SIN_MES_ANTERIOR",
            // LOTTT Art. 178: excesos sobre los topes de horas extraordinarias.
            // Quedan en el AuditLog aunque la nómina se procese igual, para que
            // exista rastro de cuándo se superó y de quién autorizó el proceso.
            // No es el registro formal del Art. 183 — ese sigue pendiente.
            overtimeWarnings: result.overtimeWarnings.map((w) => ({
              employeeId: w.employeeId,
              kind: w.kind,
              hours: w.hours.toString(),
              limit: w.limit.toString(),
            })),
          },
        },
      });

      return {
        ...serializeRun(run),
        overtimeWarnings: result.overtimeWarnings.map((w) => w.message),
      };
    });
  },

  // ── approve — DRAFT → APPROVED + asiento de causación ────────────────────
  // NOM-C-03: updateMany mutex (status:'DRAFT') previene aprobación doble
  // NOM-C-11: AuditLog dentro del $transaction
  // ADR-013 Decisión 5: Read Committed suficiente (single-row state transition)
  // ADR-013 Decisión 4: asiento consolidado por run (no por empleado)
  async approve(
    companyId: string,
    userId: string,
    runId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<PayrollRunRow> {
    // ── Guard período contable (NOM-C-13) ─────────────────────────────────
    // Se verifica antes del $transaction para mensajes de error claros
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
    });
    if (!run) throw new Error("Proceso de nómina no encontrado");
    if (run.status !== "DRAFT") {
      throw new Error(
        run.status === "APPROVED"
          ? "Este proceso ya fue aprobado"
          : "No se puede aprobar un proceso cancelado"
      );
    }

    const openPeriod = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: run.periodStart.getUTCFullYear(),
        month: run.periodStart.getUTCMonth() + 1,
        status: "OPEN",
      },
    });
    if (!openPeriod) {
      throw new Error("El período contable correspondiente está cerrado");
    }

    // ── Verificar cuentas contables configuradas ───────────────────────────
    const config = await prisma.payrollConfig.findUnique({
      where: { companyId },
      select: {
        expenseAccountId: true,
        payableAccountId: true,
        ivssPayableAccountId: true,
        faovPayableAccountId: true,
        incesPayableAccountId: true,
        rpePayableAccountId: true,
        loanReceivableAccountId: true,
        // F-02/F-03: cuentas aportes patronales
        ivssPatronalAccountId: true,
        incesPatronalAccountId: true,
        faovPatronalAccountId: true,
        rpePatronalAccountId: true,
        ivssEnabled: true,
        incesEnabled: true,
        banavihEnabled: true,
        rpeEnabled: true,
      },
    });
    if (!config) throw new Error("Configure la nómina antes de aprobar");
    if (!config.expenseAccountId || !config.payableAccountId) {
      throw new Error(
        "Configure las cuentas contables de nómina antes de aprobar (Gastos de Personal y Sueldos por Pagar)"
      );
    }

    const result = await Sentry.startSpan(
      {
        name: "payroll_run.approve",
        op: "db.transaction",
        attributes: {
          "contaflow.company_id": companyId,
          "contaflow.payroll_run_id": runId,
        },
      },
      () => prisma.$transaction(async (tx) => {
      // ── Mutex atómico: solo actualiza si status === 'DRAFT' (NOM-C-03) ──
      const updated = await tx.payrollRun.updateMany({
        where: { id: runId, companyId, status: "DRAFT" },
        data: {
          status: "APPROVED",
          approvedByUserId: userId,
          approvedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new Error("Este proceso ya fue aprobado o cancelado por otro usuario");
      }

      // ── Calcular montos por concepto para el asiento ───────────────────
      const lines = await tx.payrollRunLine.findMany({
        where: { payrollRunId: runId, companyId },
      });

      const ivssTotal = config.ivssEnabled
        ? lines
            .filter((l) => l.conceptCode === "IVSS_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      const incesTotal = config.incesEnabled
        ? lines
            .filter((l) => l.conceptCode === "INCES_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      const faovTotal = config.banavihEnabled
        ? lines
            .filter((l) => l.conceptCode === "FAOV_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      const rpeTotal = config.rpeEnabled
        ? lines
            .filter((l) => l.conceptCode === "RPE_OBR" && l.conceptType === "DEDUCTION")
            .reduce((s, l) => s.plus(l.amount), new Decimal(0))
        : new Decimal(0);

      // F-03: Aportes patronales (EMPLOYER_COST — no afectan neto del empleado)
      const ivssPatTotal = config.ivssEnabled
        ? lines
            .filter((l) => l.conceptCode === "IVSS_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const incesPatTotal = config.incesEnabled
        ? lines
            .filter((l) => l.conceptCode === "INCES_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const faovPatTotal = config.banavihEnabled
        ? lines
            .filter((l) => l.conceptCode === "FAOV_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const rpePatTotal = config.rpeEnabled
        ? lines
            .filter((l) => l.conceptCode === "RPE_PAT" && l.conceptType === "EMPLOYER_COST")
            .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0))
        : new Decimal(0);
      const totalPatronal = ivssPatTotal.plus(incesPatTotal).plus(faovPatTotal).plus(rpePatTotal);

      // V-1: debit patronal = SOLO los organismos con cuenta GL configurada — garantiza cuadre del asiento.
      // Si ivssPatronalAccountId=null pero incesPatronalAccountId≠null, el debit debe ser solo INCES.
      const configuredPatronal = [
        config.ivssPatronalAccountId ? ivssPatTotal : new Decimal(0),
        config.incesPatronalAccountId ? incesPatTotal : new Decimal(0),
        config.faovPatronalAccountId ? faovPatTotal : new Decimal(0),
        config.rpePatronalAccountId ? rpePatTotal : new Decimal(0),
      ].reduce((s, v) => s.plus(v), new Decimal(0));

      // ── Asiento de causación (ADR-013 Decisión 4) ─────────────────────
      // Convención JournalEntry: amount positivo = Débito, negativo = Crédito
      // DÉBITO: Gastos de Personal (totalEarnings — solo componentes salariales, sin cuotas de préstamo)
      // CRÉDITO: Sueldos por Pagar (neto sin préstamos) + retenciones separadas + recuperación préstamos
      //
      // Invariante de cuadre: Σ entries = 0 independientemente de cuántas cuentas estén configuradas.
      // Las cuotas de préstamo (PRESTAMO_EMP) NO son un gasto de nómina — son recuperación de un activo
      // (Préstamos a Empleados). Por eso se excluyen de totalEarnings y se creditean contra la cuenta
      // del activo si está configurada, o se incluyen en "Sueldos por Pagar" si no lo está.
      const expenseAccountId = config.expenseAccountId!;
      const payableAccountId = config.payableAccountId!;
      const nomPeriod = `${run.periodStart.toISOString().split("T")[0]}/${run.periodEnd.toISOString().split("T")[0]}`;

      // Total de cuotas de préstamo descontadas en esta nómina
      const loanTotal = lines
        .filter((l) => l.conceptCode === "PRESTAMO_EMP" && l.conceptType === "DEDUCTION")
        .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0));

      // Gasto salarial real = bruto total − cuotas de préstamo (estas no son gasto, son recuperación de activo)
      const salaryExpense = new Decimal(run.totalEarnings.toString()).minus(loanTotal);

      // Deducciones que SÍ tienen cuenta separada configurada (retenciones)
      const configuredDeductions = [
        config.ivssPayableAccountId ? ivssTotal : new Decimal(0),
        config.faovPayableAccountId ? faovTotal : new Decimal(0),
        config.incesPayableAccountId ? incesTotal : new Decimal(0),
        config.rpePayableAccountId ? rpeTotal : new Decimal(0),
        // Loan recovery: solo si está configurada la cuenta del activo
        config.loanReceivableAccountId ? loanTotal : new Decimal(0),
      ].reduce((s, v) => s.plus(v), new Decimal(0));

      // Crédito consolidado a "Sueldos por Pagar" = gasto salarial − retenciones con cuenta propia
      const payableCredit = salaryExpense.minus(configuredDeductions).negated();

      // V-2: si la nómina fue procesada en USD, convertir a VES antes de generar el asiento
      const firstLine = lines[0];
      const payCurrency = firstLine?.salarySnapshotCurrency ?? "VES";
      let glMultiplier = new Decimal(1);
      let fxNote = "";

      if (payCurrency === "USD") {
        const fxRow = await tx.exchangeRate.findFirst({
          where: { companyId, currency: "USD", date: { lte: run.periodEnd } },
          orderBy: { date: "desc" },
          select: { rate: true },
        });
        if (!fxRow) {
          throw new Error(
            "Nómina en USD: registra la tasa BCV USD/VES en Contabilidad → Tasas de Cambio antes de aprobar esta nómina."
          );
        }
        glMultiplier = new Decimal(fxRow.rate.toString());
        fxNote = ` (USD → Bs. ${glMultiplier.toFixed(2)}/USD)`;
      }

      // Montos GL en VES (glMultiplier=1 para nóminas VES — no cambia valores)
      const glSalaryExpense     = salaryExpense.mul(glMultiplier);
      const glPayableCredit     = payableCredit.mul(glMultiplier);
      const glIvssTotal         = ivssTotal.mul(glMultiplier);
      const glFaovTotal         = faovTotal.mul(glMultiplier);
      const glIncesTotal        = incesTotal.mul(glMultiplier);
      const glRpeTotal          = rpeTotal.mul(glMultiplier);
      const glLoanTotal         = loanTotal.mul(glMultiplier);
      const glConfiguredPatronal = configuredPatronal.mul(glMultiplier);
      const glIvssPatTotal      = ivssPatTotal.mul(glMultiplier);
      const glIncesPatTotal     = incesPatTotal.mul(glMultiplier);
      const glFaovPatTotal      = faovPatTotal.mul(glMultiplier);
      const glRpePatTotal       = rpePatTotal.mul(glMultiplier);

      const nominaEntries = [
        // DÉBITO — Gastos de Personal (solo componente salarial, sin cuotas de préstamo)
        { accountId: expenseAccountId, amount: glSalaryExpense, description: `Nómina ${nomPeriod} — salario bruto — ${run.employeeCount} empleados${fxNote}` },
        // CRÉDITO — Sueldos por Pagar (neto después de deducir lo que tiene cuenta propia)
        { accountId: payableAccountId, amount: glPayableCredit, description: `Nómina ${nomPeriod} — neto + retenciones sin cuenta separada${fxNote}` },
        // CRÉDITO — IVSS Obrero por Pagar (si aplica)
        ...(config.ivssPayableAccountId && glIvssTotal.greaterThan(0)
          ? [{ accountId: config.ivssPayableAccountId, amount: glIvssTotal.negated(), description: `Nómina ${nomPeriod} — retención IVSS obrero${fxNote}` }]
          : []),
        // CRÉDITO — FAOV / BANAVIH por Pagar (si aplica)
        ...(config.faovPayableAccountId && glFaovTotal.greaterThan(0)
          ? [{ accountId: config.faovPayableAccountId, amount: glFaovTotal.negated(), description: `Nómina ${nomPeriod} — retención FAOV obrero${fxNote}` }]
          : []),
        // CRÉDITO — INCES por Pagar (si aplica)
        ...(config.incesPayableAccountId && glIncesTotal.greaterThan(0)
          ? [{ accountId: config.incesPayableAccountId, amount: glIncesTotal.negated(), description: `Nómina ${nomPeriod} — retención INCES obrero${fxNote}` }]
          : []),
        // CRÉDITO — Paro Forzoso RPE por Pagar (si aplica)
        ...(config.rpePayableAccountId && glRpeTotal.greaterThan(0)
          ? [{ accountId: config.rpePayableAccountId, amount: glRpeTotal.negated(), description: `Nómina ${nomPeriod} — retención paro forzoso obrero${fxNote}` }]
          : []),
        // CRÉDITO — Préstamos a Empleados (recuperación del activo: cuota cobrada vía nómina)
        ...(config.loanReceivableAccountId && glLoanTotal.greaterThan(0)
          ? [{ accountId: config.loanReceivableAccountId, amount: glLoanTotal.negated(), description: `Nómina ${nomPeriod} — recuperación cuotas préstamos empleados${fxNote}` }]
          : []),
        // V-1 + F-03: Aportes patronales — Dr Gastos de Personal / Cr CxP organismos
        // Debit = SOLO organismos con cuenta configurada (configuredPatronal) — garantiza cuadre.
        ...(glConfiguredPatronal.greaterThan(0)
          ? [{ accountId: expenseAccountId, amount: glConfiguredPatronal, description: `Nómina ${nomPeriod} — aportes patronales IVSS/INCES/FAOV/RPE${fxNote}` }]
          : []),
        ...(config.ivssPatronalAccountId && glIvssPatTotal.greaterThan(0)
          ? [{ accountId: config.ivssPatronalAccountId, amount: glIvssPatTotal.negated(), description: `Nómina ${nomPeriod} — IVSS patronal 9%${fxNote}` }]
          : []),
        ...(config.incesPatronalAccountId && glIncesPatTotal.greaterThan(0)
          ? [{ accountId: config.incesPatronalAccountId, amount: glIncesPatTotal.negated(), description: `Nómina ${nomPeriod} — INCES patronal 2%${fxNote}` }]
          : []),
        ...(config.faovPatronalAccountId && glFaovPatTotal.greaterThan(0)
          ? [{ accountId: config.faovPatronalAccountId, amount: glFaovPatTotal.negated(), description: `Nómina ${nomPeriod} — FAOV patronal 2%${fxNote}` }]
          : []),
        ...(config.rpePatronalAccountId && glRpePatTotal.greaterThan(0)
          ? [{ accountId: config.rpePatronalAccountId, amount: glRpePatTotal.negated(), description: `Nómina ${nomPeriod} — RPE patronal 2%${fxNote}` }]
          : []),
      ];
      assertBalancedGLEntries(nominaEntries); // N4: invariante partida doble
      const asiento = await tx.transaction.create({
        data: {
          companyId,
          number: `NOM-${run.periodStart.toISOString().split("T")[0]}-${runId.slice(-6)}`,
          // Hallazgo #11: fecha del asiento = fin del período de nómina, no la fecha de aprobación.
          // Si se usara new Date(), el asiento aparece en el Ledger del mes de aprobación
          // en lugar del mes del período, rompiendo la coincidencia InvoiceBook ↔ Ledger.
          date: run.periodEnd,
          description: `Causación nómina ${run.periodStart.toISOString().split("T")[0]} — ${run.periodEnd.toISOString().split("T")[0]} (${run.employeeCount} empleados)`,
          reference: runId,
          userId,
          periodId: openPeriod.id,
          type: "DIARIO",
          entries: {
            create: nominaEntries,
          },
        },
      });

      // ── Vincular asiento al run ────────────────────────────────────────
      const approvedRun = await tx.payrollRun.update({
        where: { id: runId },
        data: { transactionId: asiento.id },
      });

      // ── Actualizar saldos de préstamos (PRESTAMO_EMP) ─────────────────
      // Se recalcula el MISMO plan que produjo la línea del recibo, en vez de
      // repartir el total a ojo entre los préstamos del empleado. Antes esta
      // copia leía solo las columnas VES y sólo tocaba el lado USD si el
      // préstamo era MIXED: con uno en USD daba isPaid=true y lo marcaba
      // pagado sin haber cobrado nada.
      const loanLines = lines.filter((l) => l.conceptCode === "PRESTAMO_EMP" && l.conceptType === "DEDUCTION");
      if (loanLines.length > 0) {
        const currencyByEmployee = new Map<string, SalaryCurrency>();
        const deductedByEmployee = new Map<string, Decimal>();
        for (const l of loanLines) {
          const prev = deductedByEmployee.get(l.employeeId) ?? new Decimal(0);
          deductedByEmployee.set(l.employeeId, prev.plus(new Decimal(l.amount.toString())));
          currencyByEmployee.set(l.employeeId, (l.salarySnapshotCurrency ?? "VES") as SalaryCurrency);
        }

        for (const [empId, deducted] of deductedByEmployee.entries()) {
          const empLoans = await tx.employeeLoan.findMany({
            where: { companyId, employeeId: empId, status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
          });

          const plans = planLoanInstallments(empLoans, currencyByEmployee.get(empId) ?? "VES");
          const planned = plans.reduce((sum, p) => sum.plus(p.lineAmount), new Decimal(0));

          // Si los préstamos cambiaron entre el cálculo y la aprobación, el
          // recibo y el plan discrepan. Se aplica el plan (es el que cuadra con
          // los saldos reales) y queda constancia en el log.
          if (!planned.equals(deducted)) {
            console.warn(
              `[PayrollRunService] Préstamos de ${empId}: el recibo dice ${deducted.toFixed(2)} y el plan ${planned.toFixed(2)}. Se aplica el plan.`,
            );
          }

          for (const plan of plans) {
            await tx.employeeLoan.update({
              where: { id: plan.loanId },
              data: {
                remainingBalance: plan.newBalanceVes.toFixed(2),
                ...(plan.newBalanceUsd !== null && { remainingBalanceUsd: plan.newBalanceUsd.toFixed(2) }),
                paidInstallments: { increment: 1 },
                status: plan.isPaid ? "PAID" : "ACTIVE",
              },
            });
          }
        }
      }

      // ── Cerrar el registro del Art. 183 ────────────────────────────────
      // "la REMUNERACION ESPECIAL que haya pagado a cada trabajador". Los
      // registros ya estan RESERVADOS por este run desde que se creo el
      // borrador, asi que aqui solo se les pone el importe: no hay que adivinar
      // cuales por ventana de fechas.
      //
      // Adivinarlo era un error con dinero detrás: marcaba como pagadas las
      // horas de empleados fuera del run (create acepta `employeeIds`), las de
      // quien no tiene salario registrado, y las cargadas entre create y
      // approve — que quedaban con `paidAmount` y sin haberse pagado nunca, sin
      // salida por UI y sin que ningun run futuro las recogiera.
      const claimed = await tx.overtimeEntry.findMany({
        where: { companyId, payrollRunId: runId },
        select: { id: true, employeeId: true, kind: true, hours: true, authorized: true },
      });

      if (claimed.length > 0) {
        const heLines = await tx.payrollRunLine.findMany({
          where: {
            companyId,
            payrollRunId: runId,
            conceptCode: { in: ["HE_DIURNA", "HE_NOCTURNA"] },
          },
          select: { employeeId: true, conceptCode: true, amount: true, hours: true, rate: true },
        });

        // La clave incluye la TARIFA: el calculador emite dos lineas del mismo
        // conceptCode por empleado —autorizadas y sin permiso, a distinto
        // recargo (Art. 182)— y una clave `empleado:tipo` hacia que la segunda
        // pisara a la primera, con lo que el importe anotado en el registro
        // legal no era ninguno de los dos.
        const paidPerHour = new Map<string, Decimal>();
        for (const l of heLines) {
          const h = l.hours ? new Decimal(l.hours.toString()) : null;
          if (!h || h.lte(0) || !l.rate) continue;
          const kind = l.conceptCode === "HE_DIURNA" ? "DIURNA" : "NOCTURNA";
          paidPerHour.set(
            `${l.employeeId}:${kind}:${new Decimal(l.rate.toString()).toFixed(2)}`,
            new Decimal(l.amount.toString()).div(h),
          );
        }

        for (const e of claimed) {
          const rate = e.kind === "DIURNA"
            ? (e.authorized ? HE_DAY_MULTIPLIER : HE_DAY_MULTIPLIER_UNAUTHORIZED)
            : (e.authorized ? HE_NIGHT_MULTIPLIER : HE_NIGHT_MULTIPLIER_UNAUTHORIZED);
          const perHour = paidPerHour.get(`${e.employeeId}:${e.kind}:${rate.toFixed(2)}`);
          // Sin linea que le corresponda no se inventa un importe: se deja en
          // null y el registro sigue mostrandose como pendiente de pago.
          if (!perHour) continue;
          await tx.overtimeEntry.update({
            where: { id: e.id },
            data: { paidAmount: perHour.mul(e.hours.toString()).toDecimalPlaces(4).toFixed(4) },
          });
        }
      }

      // ── AuditLog (NOM-C-11) ────────────────────────────────────────────
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollRun",
          entityId: runId,
          action: "APPROVE_PAYROLL_RUN",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: "DRAFT" },
          newValue: {
            status: "APPROVED",
            transactionId: asiento.id,
            approvedAt: new Date().toISOString(),
            approvedByUserId: userId,
            employeeCount: approvedRun.employeeCount,
            totalEarnings: approvedRun.totalEarnings.toString(),
            totalDeductions: approvedRun.totalDeductions.toString(),
            totalNet: approvedRun.totalNet.toString(),
            bcvRateAtRun: approvedRun.bcvRateAtRun?.toString() ?? null,
            // V-2: tasa de cambio usada para GL si la nómina fue en USD
            ...(payCurrency !== "VES" && { fxRateAtApproval: glMultiplier.toString(), payCurrency }),
          },
        },
      });

      return serializeRun(approvedRun);
    }));

    // Feature 7: enviar recibos por email a empleados (fire-and-forget post-commit)
    // Degradación graceful: si email no configurado o empleado sin email, no lanza error.
    void this._sendPayslipEmails(companyId, runId).catch((err) => {
      console.warn("[PayrollRunService] Error al enviar recibos por email:", err);
    });

    return result;
  },

  async _sendPayslipEmails(companyId: string, runId: string): Promise<void> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    if (!appUrl) return; // no configurado — silencioso

    const employees = await prisma.payrollRunLine.findMany({
      where: { payrollRunId: runId, companyId },
      select: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      distinct: ["employeeId"],
    });

    const periodLabel = runId; // usamos el runId como ref en el subject; overwritten below
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      select: { periodStart: true, periodEnd: true },
    });
    const period = run
      ? `${run.periodStart.toISOString().slice(0, 10)} — ${run.periodEnd.toISOString().slice(0, 10)}`
      : periodLabel;

    const seen = new Set<string>();
    for (const line of employees) {
      const emp = line.employee;
      if (!emp?.email || seen.has(emp.id)) continue;
      seen.add(emp.id);

      const token = signEmployeeToken(emp.id, companyId);
      const portalUrl = `${appUrl}/employee/${token}`;

      await sendEmail({
        to: emp.email,
        subject: `Tu recibo de nómina — ${period}`,
        html: `
          <p>Hola ${emp.firstName},</p>
          <p>Tu proceso de nómina del período <strong>${period}</strong> ha sido aprobado.</p>
          <p>Puedes consultar tu recibo de pago en el siguiente enlace (válido 30 días):</p>
          <p><a href="${portalUrl}" style="color:#2563eb">Ver mi recibo</a></p>
          <p style="color:#6b7280;font-size:12px">ContaFlow — Sistema de Gestión Contable</p>
        `.trim(),
      });
    }
  },

  // ── cancel — DRAFT → CANCELLED ────────────────────────────────────────────
  // NOM-C-04: solo DRAFT es cancelable directamente
  async cancel(
    companyId: string,
    userId: string,
    runId: string,
    reason: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<PayrollRunRow> {
    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: runId, companyId },
      });
      if (!run) throw new Error("Proceso de nómina no encontrado");

      if (run.status === "APPROVED") {
        throw new Error(
          "No se puede cancelar un proceso aprobado. Un proceso aprobado genera asiento contable — contacte al administrador para reversarlo."
        );
      }
      if (run.status === "CANCELLED") {
        throw new Error("Este proceso ya está cancelado");
      }

      // Liberar las horas extra reservadas: si el borrador se cancela, esas
      // horas vuelven a estar disponibles para la nomina que si se emita. Sin
      // esto quedarian atadas a un run muerto y no las cobraria nadie.
      await tx.overtimeEntry.updateMany({
        where: { companyId, payrollRunId: runId },
        data: { payrollRunId: null },
      });

      const cancelled = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: "CANCELLED",
          cancelledByUserId: userId,
          cancelledAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollRun",
          entityId: runId,
          action: "CANCEL_PAYROLL_RUN",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: "DRAFT" },
          newValue: { status: "CANCELLED", reason, cancelledAt: new Date().toISOString() },
        },
      });

      return serializeRun(cancelled);
    });
  },
};
