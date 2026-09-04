// src/modules/dashboard/__tests__/PendingTasksService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PendingTasksService } from "../services/PendingTasksService";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { count: vi.fn() },
    accountingPeriod: { count: vi.fn() },
    fixedAsset: { count: vi.fn() },
    retencion: { count: vi.fn() },
    bankStatement: { count: vi.fn() },
    order: { count: vi.fn() },               // GAP-02
    inventoryItem: { count: vi.fn() },       // PC-03
    company: { findFirst: vi.fn() },         // ADR-030 audit: isSpecialContributor
    companySettings: { findUnique: vi.fn() }, // Hallazgo #5: igtfPayableAccountId
    paymentBatch: { count: vi.fn() },         // Hallazgo #12: lotes A/P sin GL
    $queryRaw: vi.fn(),
    // Parte VII: nómina
    employee: { count: vi.fn(), findMany: vi.fn() },
    legalThreshold: { findFirst: vi.fn() },
    benefitAccrualLine: { count: vi.fn() },
    payrollConfig: { findUnique: vi.fn() },
    payrollRun: { findMany: vi.fn() },
    payrollRunLine: { findMany: vi.fn() },
    salaryHistory: { findMany: vi.fn() },
    employeeRecurringConcept: { findMany: vi.fn() },
    bcvBenefitRate: { findFirst: vi.fn() },
    // Fase 4 Caja Chica
    cajaCajaMovement: { count: vi.fn() },        // CAJA_CHICA_GASTOS_POR_APROBAR
    cajaCajaReimbursement: { count: vi.fn() },   // CAJA_CHICA_REEMBOLSO_BORRADOR
    cajaCaja: { count: vi.fn() },                // CAJA_CHICA_SIN_CUSTODIO
  },
}));

import prisma from "@/lib/prisma";

function mockAllZero() {
  vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.accountingPeriod.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.fixedAsset.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.bankStatement.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.order.count).mockResolvedValue(0 as never);           // GAP-02
  vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0 as never);   // PC-03
  vi.mocked(prisma.company.findFirst).mockResolvedValue(null as never);  // no CE por defecto
  vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({ igtfPayableAccountId: "acc-configured" } as never);
  vi.mocked(prisma.paymentBatch.count).mockResolvedValue(0 as never);      // Hallazgo #12
  // $queryRaw: stockBajo + igtfPagosSinRegistrar + clientesInactivos + igtfGlIncompleto + cxcGlDescuadre
  // gap_ves "0.0000" → ≤ tolerancia → sin alerta; count: BigInt(0) cubre los demás
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: BigInt(0), gap_ves: "0.0000" }] as never);
  // Parte VII: nómina — sin empleados por defecto → no dispara alertas de nómina
  vi.mocked(prisma.employee.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.benefitAccrualLine.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue(null as never);
  // Sin frecuencia ni vigencias: la alerta de vigencias a mitad de periodo no salta.
  vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
  // NOM_PERIODO_SIN_PROCESAR: sin nadie a quien pagar no hay nada que reclamar.
  vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([] as never);
  // Fase 4 Caja Chica — sin pendientes por defecto → no dispara alertas de caja chica
  vi.mocked(prisma.cajaCajaMovement.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.cajaCajaReimbursement.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.cajaCaja.count).mockResolvedValue(0 as never);
}

describe("PendingTasksService.getPendingTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllZero();
  });

  it("retorna tareas vacías cuando todo está limpio", async () => {
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("detecta facturas sin asiento contable (INVOICES_SIN_CAUSAR) — severity error", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(3 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("INVOICES_SIN_CAUSAR");
    expect(result.tasks[0].severity).toBe("error");
    expect(result.tasks[0].count).toBe(3);
    expect(result.tasks[0].href).toBe("/invoices");
    expect(result.totalCount).toBe(3);
  });

  it("detecta período contable abierto > 30 días (PERIODO_ABIERTO_VIEJO) — severity warning", async () => {
    vi.mocked(prisma.accountingPeriod.count).mockResolvedValue(1 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("PERIODO_ABIERTO_VIEJO");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/settings");
  });

  it("detecta activos fijos sin depreciar este mes (ACTIVOS_SIN_DEPRECIAR) — severity warning", async () => {
    vi.mocked(prisma.fixedAsset.count).mockResolvedValue(2 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("ACTIVOS_SIN_DEPRECIAR");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/fixed-assets");
    expect(result.tasks[0].count).toBe(2);
  });

  it("detecta retenciones sin vincular (RETENCIONES_SIN_VINCULAR) — severity warning", async () => {
    // 1ª llamada = PENDING/sin factura (SIN_VINCULAR); 2ª = ISSUED (POR_ENTERAR) → 0
    vi.mocked(prisma.retencion.count).mockResolvedValueOnce(5 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("RETENCIONES_SIN_VINCULAR");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/retentions");
    expect(result.tasks[0].count).toBe(5);
  });

  it("detecta extractos bancarios sin conciliar > 30 días (EXTRACTO_SIN_CONCILIAR) — severity info", async () => {
    vi.mocked(prisma.bankStatement.count).mockResolvedValue(1 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("EXTRACTO_SIN_CONCILIAR");
    expect(result.tasks[0].severity).toBe("info");
    expect(result.tasks[0].href).toBe("/bank-reconciliation");
  });

  it("detecta órdenes con fecha vencida (ORDENES_VENCIDAS) — GAP-02 — severity warning", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(2 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("ORDENES_VENCIDAS");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/orders");
    expect(result.tasks[0].count).toBe(2);
  });

  it("detecta retenciones emitidas sin enterar (RETENCIONES_POR_ENTERAR) — OM-06 — severity error", async () => {
    // 1ª llamada = PENDING/sin factura → 0; 2ª llamada = ISSUED (POR_ENTERAR) → 4
    vi.mocked(prisma.retencion.count).mockResolvedValueOnce(0 as never).mockResolvedValueOnce(4 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "RETENCIONES_POR_ENTERAR");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(4);
    expect(task?.href).toBe("/retentions");
    expect(task?.description).toContain("200%");
  });

  it("RETENCIONES_POR_ENTERAR filtra status ISSUED y deletedAt null", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
    await PendingTasksService.getPendingTasks("company-1");
    const calls = vi.mocked(prisma.retencion.count).mock.calls;
    // 2ª llamada debe tener status: "ISSUED"
    expect(calls[1]?.[0]).toMatchObject({
      where: expect.objectContaining({ status: "ISSUED", deletedAt: null }),
    });
  });

  it("ORDENES_VENCIDAS filtra solo DRAFT y APPROVED con expectedDate < now", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(1 as never);
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.order.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "APPROVED"] },
          expectedDate: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });

  it("acumula múltiples tareas y suma totalCount correctamente", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(2 as never);
    // 1ª llamada = PENDING/sin factura; 2ª llamada = ISSUED → 0
    vi.mocked(prisma.retencion.count).mockResolvedValueOnce(3 as never);
    vi.mocked(prisma.bankStatement.count).mockResolvedValue(1 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(3);
    expect(result.totalCount).toBe(6); // 2 + 3 + 1
  });

  it("pasa companyId a todas las queries (ownership scoping)", async () => {
    await PendingTasksService.getPendingTasks("company-abc");
    expect(vi.mocked(prisma.invoice.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-abc" }) }),
    );
    expect(vi.mocked(prisma.retencion.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-abc" }) }),
    );
    expect(vi.mocked(prisma.fixedAsset.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-abc" }) }),
    );
  });

  it("filtra invoices con deletedAt: null y transactionId: null", async () => {
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.invoice.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transactionId: null,
          deletedAt: null,
          type: { in: ["SALE", "PURCHASE"] },
        }),
      }),
    );
  });

  it("filtra retenciones con status PENDING e invoiceId null", async () => {
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.retencion.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoiceId: null,
          deletedAt: null,
          status: "PENDING",
        }),
      }),
    );
  });

  // PC-03: productos físicos sin cuentas GL
  it("detecta ítems físicos sin cuenta GL (INVENTARIO_SIN_CUENTAS_GL) — severity error", async () => {
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(3 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "INVENTARIO_SIN_CUENTAS_GL");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(3);
    expect(task?.href).toBe("/inventory");
    expect(task?.description).toContain("COGS");
  });

  it("INVENTARIO_SIN_CUENTAS_GL filtra solo ítems físicos con OR accountId/cogsAccountId null", async () => {
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.inventoryItem.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          itemType: { in: ["GOODS", "RAW_MATERIAL", "FINISHED_GOOD"] },
          OR: expect.arrayContaining([
            { accountId: null },
            { cogsAccountId: null },
          ]),
        }),
      }),
    );
  });

  it("no emite INVENTARIO_SIN_CUENTAS_GL cuando todos los productos tienen cuentas GL", async () => {
    // mockAllZero ya pone inventoryItem.count = 0
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "INVENTARIO_SIN_CUENTAS_GL")).toBeUndefined();
  });

  // ADR-030 audit: IGTF_PAGOS_SIN_REGISTRAR — solo para Contribuyentes Especiales
  it("detecta cobros en divisa sin IGTF para CE (IGTF_PAGOS_SIN_REGISTRAR) — severity error", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: true } as never);
    // 1ª llamada $queryRaw = stockBajo (0), 2ª = igtfPagosSinRegistrar (5)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(5) }] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "IGTF_PAGOS_SIN_REGISTRAR");

    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(5);
    expect(task?.href).toBe("/payments");
    expect(task?.description).toContain("IGTF");
    expect(task?.description).toContain("3%");
  });

  it("NO emite IGTF_PAGOS_SIN_REGISTRAR para empresa no CE aunque haya pagos en divisa", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(10) }] as never); // 10 pagos sin IGTF — no CE → no alert

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "IGTF_PAGOS_SIN_REGISTRAR")).toBeUndefined();
  });

  // ── Parte VII: Alertas de nómina ─────────────────────────────────────────────

  it("pide revisar el salario mínimo si nadie lo ha confirmado en 30 días", async () => {
    // 2 empleados activos, tope registrado hace 45 dias y nunca confirmado.
    // Severidad `info`, no `warning`: el valor puede estar perfectamente vigente
    // —el minimo venezolano lleva años en Bs. 130— y lo que falta es la
    // comprobacion, no una correccion. Llamarlo "desactualizado" cuando no lo
    // esta es lo que entrenaba a ignorar la alerta.
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue({
      effectiveFrom: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      verifiedAt: null,
    } as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_SALARIO_MINIMO_VENCIDO");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("info");
    expect(task?.count).toBe(1);
    // Lleva a la pantalla donde esta el boton de confirmar, no a ajustes.
    expect(task?.href).toBe("/payroll/legal-thresholds");
    expect(task?.description).toContain("IVSS");
  });

  it("una CONFIRMACION reciente calla la alerta aunque el decreto sea viejo", async () => {
    // El defecto que corrige: medir la antiguedad de `effectiveFrom` —la fecha
    // del DECRETO—. El salario minimo venezolano lleva en Bs. 130 desde marzo de
    // 2022 porque los aumentos posteriores han sido bonos NO salariales, asi que
    // la alerta saltaba TODOS los dias por un dato correcto. Una señal siempre
    // encendida entrena a ignorarla.
    vi.mocked(prisma.employee.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue({
      effectiveFrom: new Date("2022-03-01"),          // decreto de hace años
      verifiedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // confirmado hace 5 dias
    } as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_SALARIO_MINIMO_VENCIDO")).toBeUndefined();
  });

  it("una confirmacion VIEJA vuelve a pedir revision, sin llamarlo desactualizado", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue({
      effectiveFrom: new Date("2022-03-01"),
      verifiedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    } as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_SALARIO_MINIMO_VENCIDO");
    expect(task).toBeDefined();
    // Informativa: el valor puede estar perfecto, lo que falta es comprobarlo.
    expect(task!.severity).toBe("info");
    expect(task!.title).toContain("Confirma");
  });

  it("SIN registro sigue siendo warning: se cotiza sobre Bs. 0", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_SALARIO_MINIMO_VENCIDO");
    expect(task!.severity).toBe("warning");
    expect(task!.description).toContain("Bs. 0");
  });

  it("NO emite NOM_SALARIO_MINIMO_VENCIDO cuando el tope fue actualizado recientemente", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue({
      effectiveFrom: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 días — dentro de 30
    } as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_SALARIO_MINIMO_VENCIDO")).toBeUndefined();
  });

  // ── NOM_VIGENCIA_DENTRO_DEL_PERIODO ────────────────────────────────────────
  // Nace del atasco del 2026-08-30: un aumento VES→USD con vigencia el dia 20,
  // en la quincena 16→31, rechazaba la nomina entera por "monedas mixtas" sin
  // señalar a nadie. Media hora de diagnostico que un aviso resuelve.

  /** Un dia del mes en curso que no es ni 1 ni 16 (desalineado en quincenal). */
  function diaDesalineadoDelMes(dia: number): Date {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), dia));
  }

  it("detecta un sueldo con vigencia a mitad de periodo (NOM_VIGENCIA_DENTRO_DEL_PERIODO)", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ frequency: "BIWEEKLY" } as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([
      {
        effectiveFrom: diaDesalineadoDelMes(20),
        currency: "USD",
        employee: { firstName: "José", lastName: "Rodríguez" },
      },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_VIGENCIA_DENTRO_DEL_PERIODO");
    expect(task).toBeDefined();
    expect(task!.severity).toBe("warning");
    expect(task!.count).toBe(1);
    expect(task!.description).toContain("Rodríguez");
    expect(task!.description).toContain("día 20");
  });

  it("NO marca las vigencias alineadas al corte (dia 1 y 16 en quincenal)", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ frequency: "BIWEEKLY" } as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([
      { effectiveFrom: diaDesalineadoDelMes(1), currency: "USD", employee: { firstName: "A", lastName: "Uno" } },
      { effectiveFrom: diaDesalineadoDelMes(16), currency: "VES", employee: { firstName: "B", lastName: "Dos" } },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_VIGENCIA_DENTRO_DEL_PERIODO")).toBeUndefined();
  });

  it("en nomina MENSUAL el dia 16 SI esta a mitad de periodo", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ frequency: "MONTHLY" } as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([
      { effectiveFrom: diaDesalineadoDelMes(16), currency: "USD", employee: { firstName: "C", lastName: "Tres" } },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_VIGENCIA_DENTRO_DEL_PERIODO")).toBeDefined();
  });

  it("el HISTORIAL manda sobre frequency: MONTHLY configurado pero procesa quincenas", async () => {
    // Falso positivo real: PayrollConfig.frequency es decorativo —el formulario
    // propone quincenas sin mirarlo—, asi que una empresa MONTHLY puede llevar
    // meses procesando 16→31. Fiarse del campo marcaba el dia 16 contra su
    // propia practica.
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ frequency: "MONTHLY" } as never);
    // `payrollRun.findMany` sirve DOS consultas distintas en el servicio (los
    // dias de corte historicos y los borradores del cron) — el mock debe
    // distinguirlas por `where`, igual que Postgres lo haria de verdad.
    vi.mocked(prisma.payrollRun.findMany).mockImplementation((async (args: { where?: { createdByUserId?: string } }) =>
      args?.where?.createdByUserId
        ? []
        : [
            { periodStart: new Date(Date.UTC(2026, 7, 16)) },
            { periodStart: new Date(Date.UTC(2026, 7, 1)) },
          ]) as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([
      { effectiveFrom: diaDesalineadoDelMes(16), currency: "USD", employee: { firstName: "E", lastName: "Cinco" } },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_VIGENCIA_DENTRO_DEL_PERIODO")).toBeUndefined();
  });

  it("en nomina SEMANAL no marca nada: cualquier lunes es inicio de periodo", async () => {
    // El ruido seria peor que el aviso.
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ frequency: "SEMANAL" } as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([
      { effectiveFrom: diaDesalineadoDelMes(20), currency: "USD", employee: { firstName: "D", lastName: "Cuatro" } },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_VIGENCIA_DENTRO_DEL_PERIODO")).toBeUndefined();
  });

  it("tambien mira las asignaciones fijas, no solo el sueldo", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ frequency: "BIWEEKLY" } as never);
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([
      {
        effectiveFrom: diaDesalineadoDelMes(22),
        employee: { firstName: "Ana", lastName: "Pérez" },
        concept: { name: "Bono en divisas (no salarial)" },
      },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_VIGENCIA_DENTRO_DEL_PERIODO");
    expect(task).toBeDefined();
    expect(task!.description).toContain("Bono en divisas");
  });

  it("detecta trimestre actual sin prestaciones acumuladas (NOM_PRESTACIONES_POR_ACUMULAR) — severity warning", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.benefitAccrualLine.count).mockResolvedValue(0 as never); // no accrual for Q actual

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_PRESTACIONES_POR_ACUMULAR");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("warning");
    expect(task?.count).toBe(3); // = nomActiveEmployeesCount
    expect(task?.href).toBe("/payroll/benefits");
    expect(task?.description).toContain("Art. 142");
  });

  it("detecta intereses BCV del mes anterior sin registrar (NOM_INTERESES_BCV_PENDIENTES) — severity info", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue({ id: "rate-1" } as never);
    // benefitAccrualLine.count devuelve 0 por defecto (mockAllZero)

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_INTERESES_BCV_PENDIENTES");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("info");
    expect(task?.href).toBe("/payroll/benefits");
    expect(task?.description).toContain("Art. 143");
  });

  it("NO emite NOM_INTERESES_BCV_PENDIENTES si no hay tasa BCV registrada para el mes anterior", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue(null as never); // sin tasa

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_INTERESES_BCV_PENDIENTES")).toBeUndefined();
  });

  it("detecta empleados con período de prueba por vencer (NOM_PRUEBA_POR_VENCER) — severity info", async () => {
    // employee.count devuelve 2 en la primera llamada (activos), 1 en la segunda (prueba)
    vi.mocked(prisma.employee.count)
      .mockResolvedValueOnce(5 as never)  // nomActiveEmployeesCount
      .mockResolvedValueOnce(1 as never); // nomProbationCount

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_PRUEBA_POR_VENCER");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("info");
    expect(task?.count).toBe(1);
    expect(task?.href).toBe("/payroll/employees");
    expect(task?.description).toContain("Art. 45");
  });

  // Hallazgo #5: IGTF con igtfPayableAccountId no configurado
  it("detecta IGTF sin cuenta GL configurada (IGTF_SIN_CUENTA_GL) — severity error", async () => {
    vi.mocked(prisma.invoice.count)
      .mockResolvedValueOnce(0 as never)         // invoicesSinCausarCount
      .mockResolvedValueOnce(3 as never);        // igtfSinCuentaCount — 3 facturas con IGTF
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(
      { igtfPayableAccountId: null } as never   // cuenta no configurada
    );

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "IGTF_SIN_CUENTA_GL");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(3);
    expect(task?.description).toContain("IGTF por Pagar");
    expect(task?.href).toBe("/settings");
  });

  it("NO emite IGTF_SIN_CUENTA_GL cuando la cuenta está configurada", async () => {
    vi.mocked(prisma.invoice.count)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(5 as never);       // igtfSinCuentaCount = 5
    // companySettings.findUnique ya retorna igtfPayableAccountId: "acc-configured" por mockAllZero

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "IGTF_SIN_CUENTA_GL")).toBeUndefined();
  });

  // Hallazgo #12: lotes de pago aplicados sin asiento GL
  it("detecta lotes de pago A/P aplicados sin GL (PAGOS_SIN_ASIENTO_GL) — severity error", async () => {
    vi.mocked(prisma.paymentBatch.count).mockResolvedValue(4 as never);

    const result = await PendingTasksService.getPendingTasks("company-1");

    const task = result.tasks.find((t) => t.type === "PAGOS_SIN_ASIENTO_GL");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(4);
    expect(task?.href).toBe("/settings");
    expect(task?.description).toContain("CxP");
  });

  it("NO emite PAGOS_SIN_ASIENTO_GL cuando todos los lotes tienen asiento GL", async () => {
    vi.mocked(prisma.paymentBatch.count).mockResolvedValue(0 as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "PAGOS_SIN_ASIENTO_GL")).toBeUndefined();
  });

  it("NO emite alertas de nómina cuando la empresa no tiene empleados activos", async () => {
    // mockAllZero ya pone employee.count = 0 → ninguna alerta de nómina
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue({
      effectiveFrom: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    } as never); // tope vencido pero sin empleados → no alert

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type?.startsWith("NOM_"))).toBeUndefined();
  });

  // Hallazgo #1: retenciones sin asiento GL
  it("detecta retenciones sin asiento GL (RETENCIONES_SIN_ASIENTO_GL) — severity error", async () => {
    // retencion.count se llama 3 veces en Promise.all (sinVincular, porEnterar, sinAsientoGL)
    vi.mocked(prisma.retencion.count)
      .mockResolvedValueOnce(0 as never)  // RETENCIONES_SIN_VINCULAR
      .mockResolvedValueOnce(0 as never)  // RETENCIONES_POR_ENTERAR
      .mockResolvedValueOnce(3 as never); // RETENCIONES_SIN_ASIENTO_GL

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "RETENCIONES_SIN_ASIENTO_GL");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(3);
    expect(task?.href).toBe("/settings");
    expect(task?.description).toContain("Prov. SNAT/2005/0056");
  });

  it("NO emite RETENCIONES_SIN_ASIENTO_GL cuando todas las retenciones tienen asiento GL", async () => {
    // mockAllZero ya pone retencion.count = 0 para todas las llamadas
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "RETENCIONES_SIN_ASIENTO_GL")).toBeUndefined();
  });

  // Hallazgo #5 legacy: facturas con IGTF causadas sin línea IGTF en asiento GL
  it("detecta facturas con IGTF causadas pero sin línea IGTF en asiento (IGTF_GL_INCOMPLETO) — severity error", async () => {
    // $queryRaw: stockBajo(0), igtfPagosSinRegistrar(0), clientesInactivos(0), igtfGlIncompleto(2)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never) // stockBajo
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never) // igtfPagosSinRegistrar
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never) // clientesInactivos
      .mockResolvedValueOnce([{ count: BigInt(2) }] as never); // igtfGlIncompleto

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "IGTF_GL_INCOMPLETO");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(2);
    expect(task?.href).toBe("/accounting/journal");
    expect(task?.description).toContain("IGTF");
  });

  it("NO emite IGTF_GL_INCOMPLETO cuando todas las facturas con IGTF tienen asiento completo", async () => {
    // mockAllZero already sets $queryRaw to return 0 for all calls → igtfGlIncompleto = 0
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "IGTF_GL_INCOMPLETO")).toBeUndefined();
  });

  // ── ADR-032 F3: CXC_GL_DESCUADRE ─────────────────────────────────────────────

  it("emite CXC_GL_DESCUADRE cuando la brecha subledger↔GL supera Bs. 1 (severity error)", async () => {
    // 5 $queryRaw calls in order: stockBajo, igtfPagosSin, clientesInactivos, igtfGlIncompleto, cxcGlDescuadre
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)  // stockBajo
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)  // igtfPagosSinRegistrar
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)  // clientesInactivos
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)  // igtfGlIncompleto
      .mockResolvedValueOnce([{ gap_ves: "1500.2500" }] as never); // cxcGlDescuadre

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "CXC_GL_DESCUADRE");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(1);
    expect(task?.href).toBe("/accounting/journal");
    expect(task?.description).toContain("1500.25");
  });

  it("NO emite CXC_GL_DESCUADRE cuando la brecha es null (arAccountId no configurado)", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ gap_ves: null }] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "CXC_GL_DESCUADRE")).toBeUndefined();
  });

  it("NO emite CXC_GL_DESCUADRE cuando la brecha es ≤ Bs. 1 (tolerancia redondeo)", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ gap_ves: "0.9999" }] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "CXC_GL_DESCUADRE")).toBeUndefined();
  });

  // ── Fase 4 Caja Chica (HC-12): tareas accionables del fondo fijo ────────────────

  it("detecta gastos de caja chica por aprobar (CAJA_CHICA_GASTOS_POR_APROBAR) — severity warning", async () => {
    vi.mocked(prisma.cajaCajaMovement.count).mockResolvedValue(3 as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "CAJA_CHICA_GASTOS_POR_APROBAR");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("warning");
    expect(task?.count).toBe(3);
    expect(task?.href).toBe("/cajachica");
  });

  it("CAJA_CHICA_GASTOS_POR_APROBAR filtra status PENDING en cajas ACTIVE", async () => {
    vi.mocked(prisma.cajaCajaMovement.count).mockResolvedValue(1 as never);
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.cajaCajaMovement.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-1",
          status: "PENDING",
          cajaCaja: { status: "ACTIVE" },
        }),
      }),
    );
  });

  it("detecta reembolsos de caja chica en borrador (CAJA_CHICA_REEMBOLSO_BORRADOR) — severity warning", async () => {
    vi.mocked(prisma.cajaCajaReimbursement.count).mockResolvedValue(2 as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "CAJA_CHICA_REEMBOLSO_BORRADOR");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("warning");
    expect(task?.count).toBe(2);
    expect(task?.href).toBe("/cajachica");
    expect(task?.description).toContain("Libro Mayor");
  });

  it("CAJA_CHICA_REEMBOLSO_BORRADOR filtra status DRAFT", async () => {
    vi.mocked(prisma.cajaCajaReimbursement.count).mockResolvedValue(1 as never);
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.cajaCajaReimbursement.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-1", status: "DRAFT" }),
      }),
    );
  });

  it("detecta cajas chicas activas sin custodio (CAJA_CHICA_SIN_CUSTODIO) — severity info", async () => {
    vi.mocked(prisma.cajaCaja.count).mockResolvedValue(1 as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "CAJA_CHICA_SIN_CUSTODIO");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("info");
    expect(task?.count).toBe(1);
    expect(task?.href).toBe("/cajachica");
  });

  it("CAJA_CHICA_SIN_CUSTODIO filtra cajas ACTIVE con custodianId null", async () => {
    vi.mocked(prisma.cajaCaja.count).mockResolvedValue(1 as never);
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.cajaCaja.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "company-1",
          status: "ACTIVE",
          custodianId: null,
        }),
      }),
    );
  });

  it("NO emite alertas de caja chica cuando no hay pendientes (mockAllZero)", async () => {
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "CAJA_CHICA_GASTOS_POR_APROBAR")).toBeUndefined();
    expect(result.tasks.find((t) => t.type === "CAJA_CHICA_REEMBOLSO_BORRADOR")).toBeUndefined();
    expect(result.tasks.find((t) => t.type === "CAJA_CHICA_SIN_CUSTODIO")).toBeUndefined();
  });

  // ── NOM_PERIODO_SIN_PROCESAR ───────────────────────────────────────────────
  // Reemplaza la señal que el borrador automatico destruye: mientras no habia
  // proceso, su AUSENCIA era el recordatorio. La pregunta es "quien no cobro",
  // no "hay proceso": con la ranura (periodo + moneda), una empresa que paga en
  // dos monedas necesita DOS procesos y el segundo se olvida.

  const EMPLEADOS = [
    { id: "emp-ramon", firstName: "Ramon", lastName: "Flores" },
    { id: "emp-jose", firstName: "Jose", lastName: "Rodriguez" },
  ];

  function enFecha(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("avisa de quien no cobro el periodo cerrado (NOM_PERIODO_SIN_PROCESAR)", async () => {
    enFecha("2026-09-02T12:00:00Z"); // en Caracas, 08:00 del 2 de septiembre
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLEADOS as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_PERIODO_SIN_PROCESAR");
    expect(task).toBeDefined();
    expect(task!.count).toBe(2);
    // El periodo cerrado el 2 de septiembre es la segunda quincena de AGOSTO.
    expect(task!.title).toContain("2026-08-16");
    expect(task!.title).toContain("2026-08-31");
    // Dos dias despues del cierre todavia es normal: avisa, no alarma.
    expect(task!.severity).toBe("warning");
  });

  it("escala a error cuando el periodo lleva mas de 5 dias cerrado", async () => {
    enFecha("2026-09-08T12:00:00Z");
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLEADOS as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_PERIODO_SIN_PROCESAR");
    expect(task!.severity).toBe("error");
  });

  // El caso que motiva la alerta: la nomina del periodo SI existe, pero se
  // proceso solo el segmento de una moneda y el trabajador en la otra se queda
  // sin cobrar. Contar procesos daria esto por bueno.
  it("detecta al trabajador que quedo fuera aunque el periodo tenga proceso", async () => {
    enFecha("2026-09-02T12:00:00Z");
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLEADOS as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([{ employeeId: "emp-jose" }] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_PERIODO_SIN_PROCESAR");
    expect(task).toBeDefined();
    expect(task!.count).toBe(1);
    expect(task!.title).toContain("1 trabajador");
    expect(task!.description).toContain("Flores, Ramon");
    expect(task!.description).toContain("POR MONEDA");
  });

  it("NO avisa cuando todos los trabajadores estan en un proceso del periodo", async () => {
    enFecha("2026-09-02T12:00:00Z");
    vi.mocked(prisma.employee.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue(EMPLEADOS as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: "emp-ramon" }, { employeeId: "emp-jose" },
    ] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_PERIODO_SIN_PROCESAR")).toBeUndefined();
  });

  // ── NOM_BORRADOR_AUTO_SIN_REVISAR ──────────────────────────────────────────
  // El aviso que le falta a NOM_PERIODO_SIN_PROCESAR: si el cron cubrio a todo
  // el mundo, esa alerta no dispara (nadie "falta por cobrar"), pero PAGADO no
  // es lo mismo que REVISADO. Severity "warning" desde el dia 0 a proposito:
  // es lo que hace que el digest diario lo mande por correo de inmediato.

  function borradorAuto(overrides: Partial<{
    id: string; periodStart: Date; periodEnd: Date; currencySegment: string; createdAt: Date;
  }> = {}) {
    return {
      id: "run-auto-1",
      periodStart: new Date(Date.UTC(2026, 7, 16)),
      periodEnd: new Date(Date.UTC(2026, 7, 31)),
      currencySegment: "USD",
      createdAt: new Date("2026-09-02T12:00:00Z"),
      ...overrides,
    };
  }

  function mockBorradoresAuto(rows: ReturnType<typeof borradorAuto>[]) {
    vi.mocked(prisma.payrollRun.findMany).mockImplementation((async (args: { where?: { createdByUserId?: string } }) =>
      args?.where?.createdByUserId ? rows : []) as never);
  }

  it("un borrador automatico recien creado avisa el mismo dia (severity warning)", async () => {
    enFecha("2026-09-02T12:00:00Z");
    mockBorradoresAuto([borradorAuto()]);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_BORRADOR_AUTO_SIN_REVISAR");
    expect(task).toBeDefined();
    expect(task!.severity).toBe("warning");
    expect(task!.count).toBe(1);
    expect(task!.title).toBe("Borrador automático esperando revisión");
    expect(task!.description).toContain("2026-08-16");
    expect(task!.description).toContain("2026-08-31");
  });

  it("escala a error pasados 5 dias sin que nadie lo revise", async () => {
    enFecha("2026-09-08T12:00:00Z"); // 6 dias despues de creado
    mockBorradoresAuto([borradorAuto({ createdAt: new Date("2026-09-02T12:00:00Z") })]);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_BORRADOR_AUTO_SIN_REVISAR");
    expect(task!.severity).toBe("error");
  });

  it("pluraliza cuando hay mas de un borrador automatico sin revisar", async () => {
    enFecha("2026-09-02T12:00:00Z");
    mockBorradoresAuto([
      borradorAuto({ id: "run-auto-ves", currencySegment: "VES" }),
      borradorAuto({ id: "run-auto-usd", currencySegment: "USD" }),
    ]);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "NOM_BORRADOR_AUTO_SIN_REVISAR");
    expect(task!.count).toBe(2);
    expect(task!.title).toContain("2 borradores automáticos");
  });

  it("consulta SOLO los borradores creados por el cron, no los de un humano", async () => {
    enFecha("2026-09-02T12:00:00Z");
    mockBorradoresAuto([]);

    await PendingTasksService.getPendingTasks("company-1");
    const llamadaAutoDrafts = vi.mocked(prisma.payrollRun.findMany).mock.calls.find(
      (c) => (c[0] as { where?: { createdByUserId?: string } })?.where?.createdByUserId,
    );
    expect(llamadaAutoDrafts).toBeDefined();
    const where = (llamadaAutoDrafts![0] as { where: { status: string; createdByUserId: string } }).where;
    expect(where.status).toBe("DRAFT");
    expect(where.createdByUserId).toBe("system:payroll-auto-draft");
  });

  it("NO avisa cuando no hay borradores automaticos pendientes", async () => {
    enFecha("2026-09-02T12:00:00Z");
    mockBorradoresAuto([]);

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "NOM_BORRADOR_AUTO_SIN_REVISAR")).toBeUndefined();
  });
});
