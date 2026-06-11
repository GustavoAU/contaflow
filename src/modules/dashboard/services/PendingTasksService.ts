// src/modules/dashboard/services/PendingTasksService.ts
//
// Motor de reglas determinístico para detectar tareas de compliance fiscal pendientes.
// Solo recibe companyId — no texto libre del usuario (security finding 26B-02: prompt injection).
// El servicio devuelve counts y metadata; el resumen en lenguaje natural lo genera la action.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";

export type PendingTaskType =
  | "INVOICES_SIN_CAUSAR"
  | "PERIODO_ABIERTO_VIEJO"
  | "ACTIVOS_SIN_DEPRECIAR"
  | "RETENCIONES_SIN_VINCULAR"
  | "EXTRACTO_SIN_CONCILIAR"
  | "STOCK_BAJO"
  | "ORDENES_VENCIDAS"             // GAP-02: órdenes con fecha comprometida vencida
  | "RETENCIONES_POR_ENTERAR"      // OM-06: retenciones emitidas no enteradas ante SENIAT
  | "INVENTARIO_SIN_CUENTAS_GL"    // PC-03: ítems físicos sin cuenta Inventario o COGS → autoPost silencioso
  | "IGTF_PAGOS_SIN_REGISTRAR"     // ADR-030 audit: CE con pagos en divisa sin IGTF registrado (Ley IGTF Art. 4)
  | "CLIENTES_INACTIVOS"           // Q3-2: clientes con historial de facturas pero sin actividad en 90+ días
  // Parte VII: automatizaciones de nómina
  | "NOM_SALARIO_MINIMO_VENCIDO"    // SALARY_MIN_VES sin actualizar > 30 días
  | "NOM_PRESTACIONES_POR_ACUMULAR" // Trimestre actual sin acumular prestaciones (Art. 142 LOTTT)
  | "NOM_INTERESES_BCV_PENDIENTES"  // Mes anterior tiene tasa BCV pero sin intereses registrados (Art. 143 LOTTT)
  | "NOM_PRUEBA_POR_VENCER"         // Empleados con período de prueba que vence en ≤30 días (Art. 45 LOTTT)
  | "IGTF_SIN_CUENTA_GL"           // Hallazgo #5: facturas con igtfAmount > 0 pero igtfPayableAccountId no configurado
  | "IGTF_GL_INCOMPLETO"           // Hallazgo #5 legacy: facturas con IGTF ya causdas pero sin línea IGTF en asiento
  | "PAGOS_SIN_ASIENTO_GL"         // Hallazgo #12: lotes A/P aplicados sin asiento GL (apAccountId no configurado)
  | "RETENCIONES_SIN_ASIENTO_GL"   // Hallazgo #1: retenciones (RIVA/RISLR) emitidas sin asiento en Libro Diario
  | "CXC_GL_DESCUADRE";            // ADR-032 F3: subledger CxC ≠ saldo GL cuenta CxC (Art. 32-35 Cód. Comercio)

export type PendingTask = {
  type: PendingTaskType;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  count: number;
  href: string; // ruta relativa (se prefija con /company/[companyId] en el componente)
};

export type PendingTasksData = {
  tasks: PendingTask[];
  totalCount: number;
};

export const PendingTasksService = {
  async getPendingTasks(companyId: string): Promise<PendingTasksData> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    const currentQuarter = Math.ceil(currentMonth / 3);
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    // Empleados contratados entre (hoy - 180 días) y (hoy - 150 días) tienen prueba que vence en ≤30 días
    const probationWindowStart = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const probationWindowEnd = new Date(now.getTime() - 150 * 24 * 60 * 60 * 1000);

    const [
      invoicesSinCausarCount,
      periodosAbiertosCount,
      activosSinDepreciarCount,
      retencionesSinVincularCount,
      extractosSinConciliarCount,
      stockBajoCount,
      ordenesVencidasCount,
      retencionesPorEntregarCount,
      inventarioSinCuentasGLCount,
      companyInfo,
      igtfPagosSinRegistrarCount,
      clientesInactivosCount,
      // Parte VII: nómina
      nomActiveEmployeesCount,
      nomProbationCount,
      nomCurrentQAccruedCount,
      nomLastSalMin,
      nomBcvRatePrevMonth,
      nomBcvInterestPrevMonthCount,
      // Hallazgo #5
      igtfSinCuentaCount,
      glConfigIgtf,
      // Hallazgo #12
      pagosSinAsientoCount,
      // Hallazgo #1
      retencionesSinAsientoCount,
      // Hallazgo #5 legacy
      igtfGlIncompletoCount,
      // ADR-032 F3
      cxcGlDescuadreGap,
    ] = await Promise.all([
      // 1. Facturas sin asiento contable (transactionId null)
      prisma.invoice.count({
        where: {
          companyId,
          transactionId: null,
          deletedAt: null,
          type: { in: ["SALE", "PURCHASE"] },
        },
      }),

      // 2. Períodos contables OPEN hace más de 30 días
      prisma.accountingPeriod.count({
        where: {
          companyId,
          status: "OPEN",
          openedAt: { lt: thirtyDaysAgo },
        },
      }),

      // 3. Activos fijos ACTIVE sin entrada de depreciación del mes actual
      prisma.fixedAsset.count({
        where: {
          companyId,
          status: "ACTIVE",
          deletedAt: null,
          NOT: {
            entries: {
              some: {
                periodYear: currentYear,
                periodMonth: currentMonth,
              },
            },
          },
        },
      }),

      // 4. Retenciones PENDING sin vincular a factura
      prisma.retencion.count({
        where: {
          companyId,
          invoiceId: null,
          deletedAt: null,
          status: "PENDING",
        },
      }),

      // 5. Extractos bancarios OPEN con período terminado hace > 30 días
      prisma.bankStatement.count({
        where: {
          bankAccount: { companyId, deletedAt: null },
          status: "OPEN",
          periodEnd: { lt: thirtyDaysAgo },
          deletedAt: null,
        },
      }),

      // 6. Ítems de inventario con stock por debajo del mínimo (column comparison → raw)
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM "InventoryItem"
        WHERE "companyId" = ${companyId}
          AND "deletedAt" IS NULL
          AND "minimumStock" IS NOT NULL
          AND "stockQuantity" < "minimumStock"
      `.then(([r]) => Number(r.count)),

      // 7. GAP-02: Órdenes activas con fecha comprometida vencida
      prisma.order.count({
        where: {
          companyId,
          status: { in: ["DRAFT", "APPROVED"] },
          expectedDate: { lt: now },
        },
      }),

      // 8. OM-06: Retenciones EMITIDAS no enteradas (Art. 11 Prov. 0049 — multa 200%)
      prisma.retencion.count({
        where: {
          companyId,
          status: "ISSUED",
          deletedAt: null,
        },
      }),

      // 9. PC-03: Ítems físicos con cuentas GL faltantes — autoPostMovementInTx queda en DRAFT silencioso
      prisma.inventoryItem.count({
        where: {
          companyId,
          deletedAt: null,
          itemType: { in: ["GOODS", "RAW_MATERIAL", "FINISHED_GOOD"] },
          OR: [{ accountId: null }, { cogsAccountId: null }],
        },
      }),

      // 10. isSpecialContributor — para condicionar la alerta IGTF
      prisma.company.findFirst({
        where: { id: companyId },
        select: { isSpecialContributor: true },
      }),

      // 11. ADR-030 audit: pagos en divisa con igtfAmount = 0 en los últimos 90 días
      // (solo relevante para CE — se filtra abajo)
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM "PaymentRecord"
        WHERE "companyId" = ${companyId}
          AND "currency" != 'VES'
          AND "igtfAmount" = 0
          AND "deletedAt" IS NULL
          AND "createdAt" >= ${ninetyDaysAgo}
      `.then(([r]) => Number(r.count)),

      // 12. Q3-2: Clientes con historial de facturas pero sin actividad en 90+ días
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT c.id) AS count
        FROM "Customer" c
        WHERE c."companyId" = ${companyId}
          AND c."deletedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "Invoice" i
            WHERE i."customerId" = c.id
              AND i."companyId" = ${companyId}
              AND i."deletedAt" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM "Invoice" i2
            WHERE i2."customerId" = c.id
              AND i2."companyId" = ${companyId}
              AND i2."deletedAt" IS NULL
              AND i2."date" >= ${ninetyDaysAgo}
          )
      `.then(([r]) => Number(r.count)),

      // 13. Parte VII: Empleados activos — condiciona alertas de nómina
      prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),

      // 14. Parte VII: Empleados con período de prueba venciendo en ≤30 días (Art. 45 LOTTT — máx. 6 meses = 180 días)
      // Rango: contratados entre (hoy - 180 días) y (hoy - 150 días) → prueba termina entre hoy y +30 días
      prisma.employee.count({
        where: {
          companyId,
          status: "ACTIVE",
          hireDate: { gte: probationWindowStart, lte: probationWindowEnd },
        },
      }),

      // 15. Parte VII: Acumulación trimestral del Q actual (QUARTERLY_ACCRUAL)
      prisma.benefitAccrualLine.count({
        where: { companyId, type: "QUARTERLY_ACCRUAL", year: currentYear, quarter: currentQuarter },
      }),

      // 16. Parte VII: Última actualización del salario mínimo (SALARY_MIN_VES)
      prisma.legalThreshold.findFirst({
        where: { companyId, type: "SALARY_MIN_VES" },
        orderBy: { effectiveFrom: "desc" },
        select: { effectiveFrom: true },
      }),

      // 17. Parte VII: Tasa BCV del mes anterior (para detectar intereses no calculados)
      prisma.bcvBenefitRate.findFirst({
        where: { companyId, year: prevYear, month: prevMonth },
        select: { id: true },
      }),

      // 18. Parte VII: Líneas de intereses BCV del mes anterior (Art. 143 LOTTT)
      prisma.benefitAccrualLine.count({
        where: { companyId, type: "BCV_INTEREST", year: prevYear, month: prevMonth },
      }),

      // 19. Hallazgo #5: facturas con IGTF calculado (igtfAmount > 0) — para comparar con cuenta GL
      prisma.invoice.count({
        where: { companyId, deletedAt: null, igtfAmount: { gt: 0 } },
      }),

      // 20. Hallazgo #5: ¿está configurada la cuenta IGTF por Pagar?
      prisma.companySettings.findUnique({
        where: { companyId },
        select: { igtfPayableAccountId: true },
      }),

      // 21. Hallazgo #12: lotes A/P aplicados sin asiento GL
      // PaymentBatchService silenciosamente omite GL si apAccountId no está configurado
      prisma.paymentBatch.count({
        where: {
          companyId,
          status: "APPLIED",
          glTransactionId: null,
          bankAccountId: { not: null },
          deletedAt: null,
        },
      }),

      // 22. Hallazgo #1: retenciones (RIVA/RISLR) sin asiento de emisión en Libro Diario
      // createRetentionAction omite GL silenciosamente si las cuentas de retención no están configuradas
      prisma.retencion.count({
        where: {
          companyId,
          transactionId: null,
          status: { not: "VOIDED" },
          deletedAt: null,
        },
      }),

      // 23. Hallazgo #5 legacy: facturas con IGTF ya causadas pero sin línea IGTF en el asiento GL.
      // Ocurre cuando igtfPayableAccountId estaba null al momento del posting y se configuró después.
      // Solo cuenta cuando la cuenta está configurada ahora (si no, IGTF_SIN_CUENTA_GL lo cubre).
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count
        FROM "Invoice" i
        JOIN "CompanySettings" cs ON cs."companyId" = i."companyId"
        WHERE i."companyId" = ${companyId}
          AND cs."igtfPayableAccountId" IS NOT NULL
          AND i."deletedAt" IS NULL
          AND CAST(i."igtfAmount" AS numeric) > 0
          AND i."transactionId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "JournalEntry" je
            WHERE je."transactionId" = i."transactionId"
              AND je."accountId" = cs."igtfPayableAccountId"
          )
      `.then(([r]) => Number(r?.count ?? 0)),

      // 24. ADR-032 F3: brecha subledger CxC vs saldo GL de la cuenta arAccountId.
      // Retorna NULL si arAccountId no está configurado (sin cuenta, sin check posible).
      // Positivo = InvoicePayment legacy sin GL + posibles asientos manuales sin invoice.
      prisma.$queryRaw<[{ gap_ves: string | null }]>`
        WITH settings AS (
          SELECT "arAccountId" FROM "CompanySettings" WHERE "companyId" = ${companyId}
        ),
        subledger AS (
          SELECT COALESCE(SUM(CAST("pendingAmount" AS NUMERIC)), 0) AS total
          FROM "Invoice"
          WHERE "companyId" = ${companyId}
            AND "type" = 'SALE'
            AND "deletedAt" IS NULL
        ),
        gl_cxc AS (
          SELECT COALESCE(SUM(je.amount), 0) AS balance
          FROM "JournalEntry" je
          JOIN "Transaction" t ON t.id = je."transactionId"
          WHERE je."accountId" = (SELECT "arAccountId" FROM settings)
            AND t."companyId" = ${companyId}
            AND t."status" = 'POSTED'
            AND (SELECT "arAccountId" FROM settings) IS NOT NULL
        )
        SELECT
          CASE WHEN (SELECT "arAccountId" FROM settings) IS NULL THEN NULL
          ELSE ABS((SELECT total FROM subledger) - (SELECT balance FROM gl_cxc))::TEXT
          END AS gap_ves
      `.then(([r]) => r?.gap_ves ?? null),
    ]);

    const tasks: PendingTask[] = [];

    if (invoicesSinCausarCount > 0) {
      const pl = invoicesSinCausarCount > 1;
      tasks.push({
        type: "INVOICES_SIN_CAUSAR",
        severity: "error",
        title: "Facturas sin asiento contable",
        description: `${invoicesSinCausarCount} factura${pl ? "s" : ""} no ha${pl ? "n" : ""} sido causada${pl ? "s" : ""} en el libro mayor.`,
        count: invoicesSinCausarCount,
        href: "/invoices",
      });
    }

    if (periodosAbiertosCount > 0) {
      const pl = periodosAbiertosCount > 1;
      tasks.push({
        type: "PERIODO_ABIERTO_VIEJO",
        severity: "warning",
        title: "Período contable sin cerrar",
        description: `${periodosAbiertosCount} período${pl ? "s" : ""} lleva${pl ? "n" : ""} más de 30 días abierto${pl ? "s" : ""}.`,
        count: periodosAbiertosCount,
        href: "/settings",
      });
    }

    if (activosSinDepreciarCount > 0) {
      const pl = activosSinDepreciarCount > 1;
      tasks.push({
        type: "ACTIVOS_SIN_DEPRECIAR",
        severity: "warning",
        title: "Activos sin depreciar este mes",
        description: `${activosSinDepreciarCount} activo${pl ? "s" : ""} fijo${pl ? "s" : ""} no tiene${pl ? "n" : ""} depreciación del mes actual registrada.`,
        count: activosSinDepreciarCount,
        href: "/fixed-assets",
      });
    }

    if (retencionesSinVincularCount > 0) {
      const pl = retencionesSinVincularCount > 1;
      tasks.push({
        type: "RETENCIONES_SIN_VINCULAR",
        severity: "warning",
        title: "Retenciones sin vincular",
        description: `${retencionesSinVincularCount} retención${pl ? "es" : ""} pendiente${pl ? "s" : ""} sin factura asociada.`,
        count: retencionesSinVincularCount,
        href: "/retentions",
      });
    }

    if (stockBajoCount > 0) {
      const pl = stockBajoCount > 1;
      tasks.push({
        type: "STOCK_BAJO",
        severity: "error",
        title: "Alerta de bajo stock",
        description: `${stockBajoCount} producto${pl ? "s" : ""} ${pl ? "tienen" : "tiene"} stock por debajo del mínimo.`,
        count: stockBajoCount,
        href: "/inventory",
      });
    }

    if (extractosSinConciliarCount > 0) {
      const pl = extractosSinConciliarCount > 1;
      tasks.push({
        type: "EXTRACTO_SIN_CONCILIAR",
        severity: "info",
        title: "Extractos bancarios sin conciliar",
        description: `${extractosSinConciliarCount} extracto${pl ? "s" : ""} bancario${pl ? "s" : ""} sin conciliar hace más de 30 días.`,
        count: extractosSinConciliarCount,
        href: "/bank-reconciliation",
      });
    }

    // GAP-02: Órdenes con fecha comprometida vencida
    if (ordenesVencidasCount > 0) {
      const pl = ordenesVencidasCount > 1;
      tasks.push({
        type: "ORDENES_VENCIDAS",
        severity: "warning",
        title: "Órdenes vencidas sin convertir",
        description: `${ordenesVencidasCount} orden${pl ? "es" : ""} ${pl ? "tienen" : "tiene"} fecha comprometida vencida y aún no ${pl ? "han" : "ha"} sido convertida${pl ? "s" : ""} a factura.`,
        count: ordenesVencidasCount,
        href: "/orders",
      });
    }

    // OM-06: Retenciones emitidas sin enterar (riesgo fiscal SENIAT Art. 11 Prov. 0049)
    if (retencionesPorEntregarCount > 0) {
      const pl = retencionesPorEntregarCount > 1;
      tasks.push({
        type: "RETENCIONES_POR_ENTERAR",
        severity: "error",
        title: "Retenciones sin enterar al SENIAT",
        description: `${retencionesPorEntregarCount} retención${pl ? "es" : ""} emitida${pl ? "s" : ""} pendiente${pl ? "s" : ""} de enteramiento. Multa Art. 11 Prov. 0049: hasta 200% del monto.`,
        count: retencionesPorEntregarCount,
        href: "/retentions",
      });
    }

    // PC-03: Ítems físicos sin cuentas GL — los movimientos de inventario quedan en DRAFT sin post contable
    if (inventarioSinCuentasGLCount > 0) {
      const pl = inventarioSinCuentasGLCount > 1;
      tasks.push({
        type: "INVENTARIO_SIN_CUENTAS_GL",
        severity: "error",
        title: "Productos sin cuentas contables",
        description: `${inventarioSinCuentasGLCount} producto${pl ? "s" : ""} físico${pl ? "s" : ""} no ${pl ? "tienen" : "tiene"} cuenta de Inventario y/o COGS asignada. Las ventas/compras de ${pl ? "estos productos" : "este producto"} no generarán asiento contable automático.`,
        count: inventarioSinCuentasGLCount,
        href: "/inventory",
      });
    }

    // ADR-030 audit: CE con pagos en divisa sin IGTF — Ley IGTF Art. 4 núm. 3 + Providencia SNAT/2022/000013
    if (companyInfo?.isSpecialContributor && igtfPagosSinRegistrarCount > 0) {
      const pl = igtfPagosSinRegistrarCount > 1;
      tasks.push({
        type: "IGTF_PAGOS_SIN_REGISTRAR",
        severity: "error",
        title: "Cobros en divisas sin IGTF registrado",
        description: `${igtfPagosSinRegistrarCount} cobro${pl ? "s" : ""} en divisas de los últimos 90 días ${pl ? "no tienen" : "no tiene"} IGTF registrado. Como Contribuyente Especial, debe percibir y enterar el 3% IGTF (Ley IGTF Art. 4 — multa 100%–300% del tributo omitido).`,
        count: igtfPagosSinRegistrarCount,
        href: "/payments",
      });
    }

    // Hallazgo #5: IGTF calculado en facturas pero cuenta GL no configurada → asientos omitidos
    if (igtfSinCuentaCount > 0 && !glConfigIgtf?.igtfPayableAccountId) {
      const pl = igtfSinCuentaCount > 1;
      tasks.push({
        type: "IGTF_SIN_CUENTA_GL",
        severity: "error",
        title: "IGTF sin cuenta contable configurada",
        description: `${igtfSinCuentaCount} factura${pl ? "s tienen" : " tiene"} IGTF calculado pero ningún asiento contable fue generado porque la cuenta "IGTF por Pagar" no está configurada en Ajustes GL. Configure la cuenta para regularizar los ${pl ? "movimientos" : "el movimiento"} (Art. 4 LIGTF + PA-121).`,
        count: igtfSinCuentaCount,
        href: "/settings",
      });
    }

    // Hallazgo #5 legacy: facturas con IGTF causadas pero sin línea IGTF en asiento (igtfPayableAccountId se configuró después)
    if (igtfGlIncompletoCount > 0) {
      const pl = igtfGlIncompletoCount > 1;
      tasks.push({
        type: "IGTF_GL_INCOMPLETO",
        severity: "error",
        title: "IGTF sin registrar en asiento contable",
        description: `${igtfGlIncompletoCount} factura${pl ? "s tienen" : " tiene"} IGTF pendiente de registrar en el Libro Diario (asiento de causación original no incluyó la línea IGTF). Cree un asiento manual de corrección: Dr CxC o Banco / Cr IGTF por Enterar (Ley IGTF Art. 4).`,
        count: igtfGlIncompletoCount,
        href: "/accounting/journal",
      });
    }

    // Q3-2: Clientes inactivos — sin factura en 90+ días (con historial previo)
    if (clientesInactivosCount > 0) {
      const pl = clientesInactivosCount > 1;
      tasks.push({
        type: "CLIENTES_INACTIVOS",
        severity: "info",
        title: `Cliente${pl ? "s" : ""} sin actividad reciente`,
        description: `${clientesInactivosCount} cliente${pl ? "s" : ""} no ${pl ? "han" : "ha"} generado facturas en más de 90 días. Considera hacer seguimiento para retener la relación comercial.`,
        count: clientesInactivosCount,
        href: "/customers",
      });
    }

    // ── Parte VII: Alertas de automatización de nómina ─────────────────────────

    // NOM_SALARIO_MINIMO_VENCIDO: SALARY_MIN_VES no actualizado en > 30 días
    // Solo si la empresa tiene empleados activos (proxy de módulo nómina activo)
    if (nomActiveEmployeesCount > 0 && (
      !nomLastSalMin ||
      new Date(nomLastSalMin.effectiveFrom).getTime() < thirtyDaysAgo.getTime()
    )) {
      tasks.push({
        type: "NOM_SALARIO_MINIMO_VENCIDO",
        severity: "warning",
        title: "Salario mínimo sin actualizar",
        description: nomLastSalMin
          ? "El tope SALARY_MIN_VES lleva más de 30 días sin actualización. Verifique los decretos del INTT para mantener el cálculo correcto de IVSS/INCES."
          : "No hay tope de salario mínimo registrado. El sistema usa Bs. 0, lo que puede producir cuotas IVSS/INCES incorrectas.",
        count: 1,
        href: "/payroll/settings",
      });
    }

    // NOM_PRESTACIONES_POR_ACUMULAR: trimestre actual sin acumular (Art. 142 LOTTT)
    if (nomActiveEmployeesCount > 0 && nomCurrentQAccruedCount === 0) {
      tasks.push({
        type: "NOM_PRESTACIONES_POR_ACUMULAR",
        severity: "warning",
        title: `Prestaciones Q${currentQuarter}-${currentYear} sin acumular`,
        description: `El trimestre Q${currentQuarter}-${currentYear} no tiene prestaciones sociales acumuladas para ${nomActiveEmployeesCount} empleado${nomActiveEmployeesCount !== 1 ? "s" : ""}. Art. 142 LOTTT — 5 días de salario integral por trimestre.`,
        count: nomActiveEmployeesCount,
        href: "/payroll/benefits",
      });
    }

    // NOM_INTERESES_BCV_PENDIENTES: mes anterior tiene tasa BCV registrada pero sin intereses (Art. 143 LOTTT)
    if (nomActiveEmployeesCount > 0 && nomBcvRatePrevMonth && nomBcvInterestPrevMonthCount === 0) {
      const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
      tasks.push({
        type: "NOM_INTERESES_BCV_PENDIENTES",
        severity: "info",
        title: "Intereses BCV pendientes de registrar",
        description: `La tasa BCV de ${MONTH_NAMES[prevMonth - 1]}-${prevYear} está registrada pero no se han calculado los intereses sobre prestaciones. Art. 143 LOTTT — calcúlelos en Prestaciones Sociales.`,
        count: nomActiveEmployeesCount,
        href: "/payroll/benefits",
      });
    }

    // Hallazgo #12: lotes A/P aplicados sin GL (apAccountId faltante → GL se omite silenciosamente)
    if (pagosSinAsientoCount > 0) {
      const pl = pagosSinAsientoCount > 1;
      tasks.push({
        type: "PAGOS_SIN_ASIENTO_GL",
        severity: "error",
        title: "Pagos a proveedores sin asiento contable",
        description: `${pagosSinAsientoCount} lote${pl ? "s" : ""} de pago aplicado${pl ? "s" : ""} no ${pl ? "tienen" : "tiene"} asiento GL. Configure la cuenta CxP en Ajustes > Contabilidad para que los pagos a proveedores se registren en el Libro Diario.`,
        count: pagosSinAsientoCount,
        href: "/settings",
      });
    }

    // Hallazgo #1: retenciones (RIVA/RISLR) sin asiento de emisión en Libro Diario
    if (retencionesSinAsientoCount > 0) {
      const pl = retencionesSinAsientoCount > 1;
      tasks.push({
        type: "RETENCIONES_SIN_ASIENTO_GL",
        severity: "error",
        title: "Retenciones sin asiento contable",
        description: `${retencionesSinAsientoCount} retención${pl ? "es" : ""} sin asiento en el Libro Diario. Configure las cuentas de retención en Ajustes > Contabilidad para que los comprobantes se registren automáticamente (Prov. SNAT/2005/0056).`,
        count: retencionesSinAsientoCount,
        href: "/settings",
      });
    }

    // NOM_PRUEBA_POR_VENCER: empleados con período de prueba expirando en ≤30 días (Art. 45 LOTTT)
    if (nomProbationCount > 0) {
      const pl = nomProbationCount > 1;
      tasks.push({
        type: "NOM_PRUEBA_POR_VENCER",
        severity: "info",
        title: "Período de prueba por vencer",
        description: `${nomProbationCount} empleado${pl ? "s" : ""} ${pl ? "completan" : "completa"} el período de prueba en los próximos 30 días (Art. 45 LOTTT — máx. 6 meses). Confirme continuidad o inicie egreso.`,
        count: nomProbationCount,
        href: "/payroll/employees",
      });
    }

    // ADR-032 F3: subledger CxC vs GL — tolerancia Bs. 1 para diferencias de redondeo acumulado
    if (cxcGlDescuadreGap !== null) {
      const gap = new Decimal(cxcGlDescuadreGap);
      if (gap.gt(new Decimal("1.00"))) {
        tasks.push({
          type: "CXC_GL_DESCUADRE",
          severity: "error",
          title: "Descuadre CxC: cartera ≠ Libro Mayor",
          description: `Diferencia de Bs. ${gap.toDecimalPlaces(2).toFixed(2)} entre el saldo de facturas pendientes y la cuenta Cuentas por Cobrar del Libro Mayor. Posible causa: cobros registrados sin asiento GL (Art. 32-35 Código de Comercio).`,
          count: 1,
          href: "/accounting/journal",
        });
      }
    }

    return {
      tasks,
      totalCount: tasks.reduce((acc, t) => acc + t.count, 0),
    };
  },
};
