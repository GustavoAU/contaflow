// src/modules/payroll/__tests__/PayrollRunService.test.ts
// Fase NOM-C: Tests del PayrollRunService (CRUD + estados + IDOR guard)

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("../services/PayrollConceptService", () => ({
  PayrollConceptService: {
    seedDefaults: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payrollRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payrollRunLine: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    payrollConcept: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    payrollConfig: {
      findUnique: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    overtimeEntry: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    legalThreshold: {
      findFirst: vi.fn(),
    },
    bcvBenefitRate: {
      findFirst: vi.fn(),
    },
    employeeLoan: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    employeeRecurringConcept: {
      findMany: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { PayrollRunService } from "../services/PayrollRunService";
import { PayrollConceptService } from "../services/PayrollConceptService";
import Decimal from "decimal.js";
import { MISSING_USD_RATE_MESSAGE } from "../services/PayrollCalculatorService";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const RUN_ID = "run-1";

function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma)) as never);
}

const BASE_RUN = {
  id: RUN_ID,
  companyId: COMPANY_ID,
  periodStart: new Date("2026-04-01"),
  periodEnd: new Date("2026-04-15"),
  status: "DRAFT" as const,
  currencySegment: "VES" as const,
  totalEarnings: new Decimal("30000"),
  totalDeductions: new Decimal("2100"),
  totalNet: new Decimal("27900"),
  totalEmployerCosts: new Decimal("0"),
  employeeCount: 1,
  bcvRateAtRun: null,
  transactionId: null,
  createdByUserId: USER_ID,
  approvedByUserId: null,
  cancelledByUserId: null,
  approvedAt: null,
  cancelledAt: null,
  idempotencyKey: "key-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("PayrollRunService.list", () => {
  it("returns serialized runs for company", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([BASE_RUN] as never);
    const result = await PayrollRunService.list(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(RUN_ID);
    expect(result[0].totalNet).toBe("27900");
    // Sin esto, dos procesos del mismo periodo eran indistinguibles en pantalla.
    expect(result[0].currencySegment).toBe("VES");
    expect(vi.mocked(prisma.payrollRun.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } })
    );
  });
});

// ─── getById — IDOR guard ─────────────────────────────────────────────────────

describe("PayrollRunService.getById", () => {
  it("returns null when run belongs to different company (IDOR guard)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    const result = await PayrollRunService.getById("other-company", RUN_ID);
    expect(result).toBeNull();
    expect(vi.mocked(prisma.payrollRun.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "other-company" }),
      })
    );
  });

  it("returns null when run does not exist", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    const result = await PayrollRunService.getById(COMPANY_ID, "nonexistent");
    expect(result).toBeNull();
  });
});

// ─── create — doble proceso (NOM-C-02) ───────────────────────────────────────

describe("PayrollRunService.create", () => {
  const INPUT = {
    periodStart: "2026-04-01",
    periodEnd: "2026-04-15",
    idempotencyKey: "key-test",
  };

  function setupCreateMocks() {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null); // sin threshold → fallback a config
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      frequency: "MONTHLY",
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-1",
        workSchedule: "DIURNA",
        salaryHistory: [
          {
            id: "sal-1",
            amount: new Decimal("30000"),
            currency: "VES",
            effectiveFrom: new Date("2026-01-01"),
          },
        ],
      },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-inces", code: "INCES_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue(null); // sin tasa BCV configurada
    // Ley INCES Art. 49: por encima del umbral de cinco trabajadores.
    vi.mocked(prisma.employee.count).mockResolvedValue(10 as never);
    // LOTTT Art. 183: sin registro de horas extra en el periodo.
    vi.mocked(prisma.overtimeEntry.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.overtimeEntry.update).mockResolvedValue({} as never);
    // Sin run solapado ni choque de trabajador. Linea base propia:
    // clearAllMocks() no borra las implementaciones, asi que sin esto un mock de
    // otro test se filtra aqui.
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.payrollRunLine.findFirst).mockResolvedValue(null as never);
    // D-5: sin runs aprobados el mes anterior → el calculador cotiza sobre el
    // mes en curso. Los tests que fijan D-5 sobrescriben estos dos.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 4 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never); // sin préstamos activos
    // Sin asignaciones fijas. Linea base propia: clearAllMocks() no borra las
    // implementaciones, asi que sin esto un mock de otro test se filtra aqui.
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([] as never);
  }

  it("creates run with AuditLog in $transaction", async () => {
    setupCreateMocks();
    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    expect(result.id).toBe(RUN_ID);
    expect(vi.mocked(prisma.payrollRun.create)).toHaveBeenCalled();
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE_PAYROLL_RUN" }),
      })
    );
  });

  it("throws when no open accounting period (NOM-C-13)", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      frequency: "MONTHLY",
    } as never);
    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "No existe un período contable abierto"
    );
  });

  it("throws when no payroll config", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "p1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null as never);
    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "Configure la nómina"
    );
  });

  it("throws when no active employees", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "p1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      frequency: "MONTHLY",
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "No hay empleados activos"
    );
  });

  it("throws si nadie tiene sueldo con vigencia al inicio del período", async () => {
    // `salaryHistory` viene ya filtrado por Prisma (effectiveFrom <= periodStart):
    // vacío significa que el sueldo se registró con vigencia POSTERIOR. Antes
    // pasaba el chequeo de empleados activos, `calculate` no encontraba nada que
    // objetar y el proceso nacía en DRAFT sin una sola línea.
    setupCreateMocks();
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-1", workSchedule: "DIURNA", salaryHistory: [] },
    ] as never);
    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "vigencia al inicio del período"
    );
    expect(vi.mocked(prisma.payrollRunLine.createMany)).not.toHaveBeenCalled();
  });

  it("aplica tope salario mínimo en IVSS cuando salaryMinimumVes > 0 — regresión ítem 55", async () => {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
      frequency: "MONTHLY",
      salaryMinimumVes: new Decimal("130"),
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-1",
        workSchedule: "DIURNA",
        salaryHistory: [
          {
            id: "sal-1",
            amount: new Decimal("1000"),
            currency: "VES",
            effectiveFrom: new Date("2026-01-01"),
          },
        ],
      },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR");
    expect(ivssLine).toBeDefined();
    // Tope MENSUAL 5×130 = 650 (Reglamento Art. 98), llevado a las semanas que
    // cotiza esta quincena: el 1–15 de abril de 2026 tiene dos lunes (6 y 13).
    // 650 × 12/52 × 2 = 300 → 4% = 12. Antes cobraba el mes entero en cada
    // quincena, o sea dos veces la cotización del mes.
    expect(new Decimal(ivssLine!.amount.toString()).toFixed(2)).toBe("12.00");
  });

  // ── Horas extra: reserva y periodos solapados ──────────────────────────────

  it("RESERVA las horas extra del periodo al crear el borrador", async () => {
    setupCreateMocks();
    vi.mocked(prisma.overtimeEntry.findMany).mockResolvedValue([
      {
        id: "ot-1",
        employeeId: "emp-1",
        hours: new Decimal("4"),
        kind: "DIURNA",
        authorized: true,
      },
    ] as never);
    vi.mocked(prisma.overtimeEntry.updateMany).mockResolvedValue({ count: 1 } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    // Reservarlas al CREAR —y no al aprobar— es lo que impide que un segundo
    // run se lleve las mismas horas: el filtro `payrollRunId: null` las excluye.
    expect(vi.mocked(prisma.overtimeEntry.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID, payrollRunId: null }),
        data: { payrollRunId: RUN_ID },
      })
    );
  });

  it("si otro run se llevo las horas entre la lectura y la reserva, aborta", async () => {
    setupCreateMocks();
    vi.mocked(prisma.overtimeEntry.findMany).mockResolvedValue([
      {
        id: "ot-1",
        employeeId: "emp-1",
        hours: new Decimal("4"),
        kind: "DIURNA",
        authorized: true,
      },
    ] as never);
    vi.mocked(prisma.overtimeEntry.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "tomó estas horas extraordinarias"
    );
  });

  it("RECHAZA un periodo solapado CUANDO comparte trabajador", async () => {
    // El unico bloquea el periodo identico, no el solapado: 01-15 y 01-31 de
    // abril son pares distintos y ambos pasaban, cobrando dos veces lo mismo.
    setupCreateMocks();
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      // Otra MONEDA: el choque tiene que salir por trabajador compartido, no por
      // la ranura, que es lo que este test fija.
      {
        id: "run-viejo",
        periodStart: new Date("2026-04-01"),
        periodEnd: new Date("2026-04-30"),
        status: "APPROVED",
        currencySegment: "USD",
      },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findFirst).mockResolvedValue({
      employeeId: "emp-1",
      payrollRunId: "run-viejo",
    } as never);

    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "Cobraría dos veces"
    );
  });

  it("PERMITE el mismo periodo en otra moneda: no comparten trabajador", async () => {
    // El caso que el selector de empleados vino a resolver y que el guard viejo
    // —que solo miraba fechas— dejaba imposible: una empresa con sueldos en dos
    // monedas DEBE procesar por separado, y esos dos procesos comparten periodo.
    // Se podia pagar a UN grupo y el otro se quedaba sin cobrar ese periodo.
    setupCreateMocks();
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      {
        id: "run-usd",
        periodStart: new Date("2026-04-01"),
        periodEnd: new Date("2026-04-30"),
        status: "DRAFT",
        currencySegment: "USD",
      },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findFirst).mockResolvedValue(null as never);

    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    expect(result.id).toBe(RUN_ID);
  });

  it("dos runs del MISMO rango no cuentan el mes anterior dos veces (Art. 107)", async () => {
    // Consecuencia directa de permitir dos procesos por periodo: sumar las
    // duraciones daba 15+15=30 en un mes de 30 dias con MEDIO mes cubierto.
    // La base de cotizacion salia a la mitad, sin error, y el AuditLog
    // certificaba MES_ANTERIOR. Se cuentan dias UNICOS.
    setupCreateMocks();
    // MAYO a proposito: el mes anterior es ABRIL, de 30 dias. Con marzo (31) la
    // suma vieja daba 15+15=30 < 31 y el test pasaria tambien con el codigo
    // roto: no probaria nada. Es en los meses de 30 dias —y en febrero— donde
    // la duplicacion cruza el umbral.
    const INPUT_MAYO = {
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      idempotencyKey: "key-mayo",
    };
    vi.mocked(prisma.payrollRun.findMany).mockImplementation((async (args: {
      where?: { status?: unknown; periodStart?: unknown };
    }) => {
      // La consulta de solape pide status DRAFT|APPROVED con rango de fechas.
      const w = args?.where as Record<string, unknown> | undefined;
      const st = w?.status as { in?: string[] } | undefined;
      if (st?.in?.includes("DRAFT")) return [];
      // La del mes anterior: dos runs del MISMO rango (USD y VES).
      return [
        { id: "prev-usd", periodStart: new Date("2026-04-01"), periodEnd: new Date("2026-04-15") },
        { id: "prev-ves", periodStart: new Date("2026-04-01"), periodEnd: new Date("2026-04-15") },
      ];
    }) as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT_MAYO);

    // Con 15 dias unicos sobre 30, el mes anterior esta INCOMPLETO: no se usa
    // como base y no se leen sus lineas de EARNING.
    //
    // Se filtra por `conceptType: "EARNING"` a proposito: los mismos runs los
    // consulta tambien el acumulado anual de horas extra, y sin acotar la
    // asercion pasaba por esa otra llamada en vez de por la del Art. 107.
    const leyoBaseMesAnterior = vi.mocked(prisma.payrollRunLine.findMany).mock.calls.some((c) => {
      const w = c[0]?.where as Record<string, unknown> | undefined;
      if (w?.conceptType !== "EARNING") return false;
      const ids = (w?.payrollRunId as { in?: string[] } | undefined)?.in;
      return Array.isArray(ids) && ids.includes("prev-usd");
    });
    expect(leyoBaseMesAnterior).toBe(false);
  });

  it("RECHAZA con mensaje honesto si la ranura periodo+moneda ya esta ocupada", async () => {
    // El caso "misma moneda, otro grupo de gente": el guard por trabajador lo
    // dejaba pasar y reventaba despues contra la BD, con un mensaje que culpaba
    // a la moneda —que es justo lo que NO sobra—. Ahora se dice la verdad y se
    // apunta a la salida real: el retroactivo del proceso siguiente.
    setupCreateMocks(); // empleados en VES
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      {
        id: "run-ves",
        periodStart: new Date("2026-04-01"),
        periodEnd: new Date("2026-04-15"),
        status: "APPROVED",
        currencySegment: "VES",
      },
    ] as never);
    // Ningun trabajador compartido: sin este chequeo, pasaria el guard.
    vi.mocked(prisma.payrollRunLine.findFirst).mockResolvedValue(null as never);

    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "RETROACTIVO"
    );
  });

  it("graba el segmento de moneda del proceso", async () => {
    setupCreateMocks();
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    const data = vi.mocked(prisma.payrollRun.create).mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.currencySegment).toBe("VES");
  });

  it("registra el segmento de moneda en el AuditLog — sin esto dos procesos del mismo periodo son indistinguibles en el rastro", async () => {
    setupCreateMocks();
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as {
      newValue: Record<string, unknown>;
    };
    expect(audit.newValue.currencySegment).toBe("VES");
  });

  it("NO reserva horas extra de trabajadores fuera del run", async () => {
    // Una empresa con sueldos en dos monedas DEBE procesar por separado, así que
    // correr sobre un subconjunto es lo normal, no un caso raro. Sin filtrar por
    // empleado, el run en USD se llevaba también las horas del que cobra en VES:
    // quedaban con payrollRunId de un run que no las paga y ningún run futuro
    // volvía a verlas (el filtro es `payrollRunId: null`).
    setupCreateMocks();
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-usd",
        workSchedule: "DIURNA",
        salaryHistory: [
          {
            id: "sal-1",
            amount: new Decimal("2500"),
            currency: "USD",
            effectiveFrom: new Date("2026-01-01"),
          },
        ],
      },
      // Sin sueldo vigente al inicio: tampoco produce líneas, así que sus horas
      // tampoco pueden reservarse.
      { id: "emp-sin-sueldo", workSchedule: "DIURNA", salaryHistory: [] },
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const where = vi.mocked(prisma.overtimeEntry.findMany).mock.calls[0][0]?.where;
    expect(where?.employeeId).toEqual({ in: ["emp-usd"] });
  });

  // ── Asignaciones fijas (EmployeeRecurringConcept) ─────────────────────────
  // El caso real: salario en bolivares (base de cotizaciones) + bono en dolares
  // NO salarial, que es como paga la mayoria de las empresas venezolanas.

  function recurringBono(over: Record<string, unknown> = {}) {
    return {
      employeeId: "emp-1",
      amount: new Decimal("200"),
      currency: "USD",
      concept: {
        id: "c-bono",
        code: "BONO_DIVISAS",
        type: "EARNING",
        salaryNature: "NO_SALARIAL",
        isActive: true,
      },
      ...over,
    };
  }

  it("un bono en USD sobre nomina en VES se convierte a la tasa del periodo", async () => {
    setupCreateMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("100"),
    } as never);
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([
      recurringBono(),
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const lines = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0][0]!.data as Array<
      Record<string, unknown>
    >;
    const bono = lines.find((l) => l.conceptCode === "BONO_DIVISAS");
    expect(bono).toBeDefined();
    // USD 200 x 100 Bs/USD
    expect(new Decimal(bono!.amount as never).toString()).toBe("20000");
    // ADR-045 D-3: la conversion queda reconstruible
    expect(new Decimal(bono!.originalAmount as never).toString()).toBe("200");
    expect(bono!.originalCurrency).toBe("USD");
    expect(new Decimal(bono!.exchangeRateApplied as never).toString()).toBe("100");
  });

  it("un bono NO_SALARIAL no engorda la base de cotizaciones", async () => {
    // Lo que hace que todo esto sirva: si el bono entrara en la base, pagar en
    // divisas dispararia IVSS/FAOV/INCES y el modelo no representaria nada.
    //
    // Se corre dos veces y se comparan las bases. Comprobar la base contra una
    // cifra fija no probaria nada: ya vale 30.000 solo por el salario, asi que
    // pasaria igual aunque el bono se estuviera sumando.
    setupCreateMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("100"),
    } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([
      recurringBono(),
    ] as never);
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const calls = vi.mocked(prisma.payrollRunLine.createMany).mock.calls;
    const sinBono = calls[0][0]!.data as Array<Record<string, unknown>>;
    const conBono = calls[1][0]!.data as Array<Record<string, unknown>>;

    // El bono entro de verdad en la segunda: si no, la comparacion seria vacia.
    expect(conBono.find((l) => l.conceptCode === "BONO_DIVISAS")).toBeDefined();

    for (const code of ["FAOV_OBR", "IVSS_OBR", "INCES_PAT"]) {
      const a = sinBono.find((l) => l.conceptCode === code);
      const b = conBono.find((l) => l.conceptCode === code);
      if (!a || !b) continue;
      expect(`${code}:${new Decimal(b.basis as never).toString()}`).toBe(
        `${code}:${new Decimal(a.basis as never).toString()}`
      );
    }
  });

  it("sin tasa BCV, un bono en otra moneda BLOQUEA en vez de colar un numero", async () => {
    setupCreateMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([
      recurringBono(),
    ] as never);

    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "BONO_DIVISAS"
    );
  });

  it("un concepto desactivado no se aplica, pero la asignacion sobrevive", async () => {
    setupCreateMocks();
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([
      recurringBono({
        concept: {
          id: "c-bono",
          code: "BONO_DIVISAS",
          type: "EARNING",
          salaryNature: "NO_SALARIAL",
          isActive: false,
        },
      }),
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const lines = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0][0]!.data as Array<
      Record<string, unknown>
    >;
    expect(lines.find((l) => l.conceptCode === "BONO_DIVISAS")).toBeUndefined();
  });

  it("solo toma las asignaciones vigentes al INICIO del periodo", async () => {
    // Misma regla que el sueldo: un bono que arranca a mitad de quincena no se
    // cobra en esa quincena. Se comprueba el WHERE, que es donde vive la regla.
    setupCreateMocks();

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const where = vi.mocked(prisma.employeeRecurringConcept.findMany).mock.calls[0][0]?.where;
    expect(where?.effectiveFrom).toEqual({ lte: new Date(INPUT.periodStart) });
    expect(where?.OR).toEqual([
      { effectiveTo: null },
      { effectiveTo: { gte: new Date(INPUT.periodStart) } },
    ]);
  });

  // ── addManualLine — el concepto puntual (ISLR, bono de una vez) ───────────
  // Lo que desbloquea: `manualConcepts` solo se podia fijar AL CREAR y ninguna
  // pantalla lo enviaba, asi que la retencion de ISLR no tenia via de entrada.

  function setupManualLineMocks(over: Record<string, unknown> = {}) {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      id: RUN_ID,
      status: "DRAFT",
      periodStart: new Date("2026-04-01"),
      ...over,
    } as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "p1" } as never);
    // El trabajador YA tiene lineas en el run; y no hay duplicado del concepto.
    vi.mocked(prisma.payrollRunLine.findFirst)
      .mockResolvedValueOnce({ id: "line-existente" } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue({
      id: "c-islr",
      code: "ISLR_RET",
      name: "Retención ISLR",
      type: "DEDUCTION",
      salaryNature: "NO_SALARIAL",
      isActive: true,
    } as never);
    vi.mocked(prisma.payrollRunLine.create).mockResolvedValue({ id: "line-nueva" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  }

  const MANUAL_INPUT = {
    runId: RUN_ID,
    employeeId: "emp-1",
    conceptId: "c-islr",
    amount: "150.00",
  };

  it("agrega un concepto puntual y mueve los totales por el delta", async () => {
    setupManualLineMocks();

    await PayrollRunService.addManualLine(COMPANY_ID, USER_ID, MANUAL_INPUT, "1.2.3.4", "ua");

    // Una DEDUCTION sube deducciones y BAJA el neto.
    const update = vi.mocked(prisma.payrollRun.update).mock.calls[0][0];
    expect(update.data).toHaveProperty("totalDeductions");
    expect(update.data).toHaveProperty("totalNet");
    // R-6: IP y user-agent en el AuditLog, en el mismo $transaction.
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(audit.ipAddress).toBe("1.2.3.4");
    expect(audit.action).toBe("ADD_MANUAL_PAYROLL_LINE");
  });

  it("RECHAZA sobre un run aprobado", async () => {
    setupManualLineMocks({ status: "APPROVED" });
    await expect(
      PayrollRunService.addManualLine(COMPANY_ID, USER_ID, MANUAL_INPUT, null, null)
    ).rejects.toThrow("asiento contable");
    expect(vi.mocked(prisma.payrollRunLine.create)).not.toHaveBeenCalled();
  });

  it("RECHAZA si el periodo contable esta cerrado (R-3)", async () => {
    setupManualLineMocks();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollRunService.addManualLine(COMPANY_ID, USER_ID, MANUAL_INPUT, null, null)
    ).rejects.toThrow("cerrado");
  });

  it("RECHAZA si el trabajador no esta en el run", async () => {
    setupManualLineMocks();
    // La PRIMERA consulta de lineas es la que comprueba pertenencia al run.
    vi.mocked(prisma.payrollRunLine.findFirst).mockReset();
    vi.mocked(prisma.payrollRunLine.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollRunService.addManualLine(COMPANY_ID, USER_ID, MANUAL_INPUT, null, null)
    ).rejects.toThrow("no forma parte");
  });

  it("RECHAZA el mismo concepto dos veces para el mismo trabajador", async () => {
    setupManualLineMocks();
    vi.mocked(prisma.payrollRunLine.findFirst).mockReset();
    vi.mocked(prisma.payrollRunLine.findFirst).mockResolvedValue({ id: "x" } as never);
    await expect(
      PayrollRunService.addManualLine(COMPANY_ID, USER_ID, MANUAL_INPUT, null, null)
    ).rejects.toThrow("ya tiene una línea");
  });

  it("PERMITE recrear el periodo de un run CANCELADO", async () => {
    // Lo que hace "Recalcular": cancelar el borrador y rehacerlo con las MISMAS
    // fechas. El guard de solape sólo mira DRAFT/APPROVED, y desde la migración
    // 20260830 el único de la BD es parcial (WHERE status <> 'CANCELLED'). Con
    // el único incondicional que había antes, cancelar inutilizaba ese período
    // para siempre y el botón no podía funcionar nunca.
    setupCreateMocks();
    // La consulta de solape filtra por estados vigentes: no ve el cancelado.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);

    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(result.id).toBe(RUN_ID);
    const solape = vi
      .mocked(prisma.payrollRun.findMany)
      .mock.calls.find(
        (c) => (c[0]?.where as Record<string, unknown> | undefined)?.periodStart !== undefined
      );
    expect((solape?.[0]?.where as Record<string, unknown>)?.status).toEqual({
      in: ["DRAFT", "APPROVED"],
    });
  });

  it("ARRASTRA horas viejas sin pagar de periodos anteriores", async () => {
    // Antes el filtro era la ventana del periodo, asi que unas horas registradas
    // despues de aprobar la nomina de su mes no las recogia NADIE: el run
    // siguiente no las veia y el de su periodo no se puede rehacer (@@unique).
    setupCreateMocks();
    vi.mocked(prisma.overtimeEntry.findMany).mockResolvedValue([] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const where = vi.mocked(prisma.overtimeEntry.findMany).mock.calls[0]![0]!.where as {
      workedOn?: { lte?: Date; gte?: Date };
    };
    // Todo lo pendiente hasta el fin del periodo, sin cota inferior.
    expect(where.workedOn?.lte).toBeInstanceOf(Date);
    expect(where.workedOn?.gte).toBeUndefined();
  });

  // ── D-5: la base sale del mes anterior (LOTTT Art. 107) ────────────────────

  it("D-5: cotiza sobre el salario normal del mes anterior, no el del período", async () => {
    setupCreateMocks();
    // Marzo cerrado con 10.000 de salario normal; en abril gana 30.000.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { id: "run-mar", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: "emp-1", conceptCode: "SAL_BASE", amount: new Decimal("10000") },
      // Una HE del mes pasado NO forma parte del salario normal (Art. 104).
      { employeeId: "emp-1", conceptCode: "HE_DIURNA", amount: new Decimal("5000") },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-he", code: "HE_DIURNA", salaryNature: "SALARIAL_ACCIDENTAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-rpe", code: "RPE_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; basis: Decimal | null }>;
    // Se paga el sueldo de abril…
    const sal = lines.find((l) => l.conceptCode === "SAL_BASE")!;
    expect(new Decimal((sal as unknown as { amount: Decimal }).amount.toString()).toFixed(2)).toBe(
      "30000.00"
    );
    // …pero se cotiza sobre los 10.000 de marzo, sin la hora extra.
    // El FAOV va sobre el integral de esa base: 10.000 x 1,125 = 11.250.
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;
    expect(new Decimal(faov.basis!.toString()).toFixed(2)).toBe("11250.00");
  });

  it("PENSIONES_PAT suma del mes anterior TODO lo que salarioNormal excluye (verificado con contador)", async () => {
    setupCreateMocks();
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      frequency: "MONTHLY",
      pensionesEnabled: true,
    } as never);
    // Piso bajo a propósito: este test verifica la SUMA, no el piso del Art. 7
    // (ya cubierto en PayrollCalculatorService.test.ts).
    vi.mocked(prisma.legalThreshold.findFirst).mockImplementation((async (args: {
      where?: { type?: string };
    }) =>
      args?.where?.type === "INGRESO_MINIMO_INTEGRAL_USD"
        ? { value: new Decimal("1.00") }
        : null) as never);
    // Sueldo en VES: el piso (en USD) necesita esta tasa para convertirse.
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("50.00"),
    } as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-he", code: "HE_DIURNA", salaryNature: "SALARIAL_ACCIDENTAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-pensiones", code: "PENSIONES_PAT", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { id: "run-mar", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: "emp-1", conceptCode: "SAL_BASE", amount: new Decimal("10000") },
      // La HE_DIURNA NO es SALARIO_NORMAL (Art. 104) — salarioNormal la excluye,
      // pero PENSIONES_PAT (verificado con contador) SÍ la suma.
      { employeeId: "emp-1", conceptCode: "HE_DIURNA", amount: new Decimal("5000") },
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; basis: Decimal | null }>;
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;
    const pensiones = lines.find((l) => l.conceptCode === "PENSIONES_PAT")!;
    // FAOV sin cambios: sigue siendo 10.000 x 1,125 (solo SALARIO_NORMAL).
    expect(new Decimal(faov.basis!.toString()).toFixed(2)).toBe("11250.00");
    // PENSIONES_PAT: 10.000 + 5.000 = 15.000 (salario Y bono, mes anterior).
    expect(new Decimal(pensiones.basis!.toString()).toFixed(2)).toBe("15000.00");
  });

  it("D-5: sin nómina aprobada el mes anterior usa el mes en curso", async () => {
    setupCreateMocks(); // payrollRun.findMany → []
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; basis: Decimal | null }>;
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;
    expect(new Decimal(faov.basis!.toString()).toFixed(2)).toBe("33750.00"); // 30.000 x 1,125
  });

  // ── D-5 + moneda: el mes anterior puede estar en otra moneda ───────────────
  // Hallazgo HIGH de la auditoria pre-merge: `prevLines` sumaba `amount` sin
  // mirar `salarySnapshotCurrency`, asi que un empleado que cambio de moneda
  // cotizaba sobre un numero en la unidad equivocada. Mismo mecanismo que H-4,
  // por la puerta del historico.

  function prevMonthLines(currency: "VES" | "USD", amount: string) {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { id: "run-mar", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        conceptCode: "SAL_BASE",
        amount: new Decimal(amount),
        salarySnapshotCurrency: currency,
      },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
  }

  function faovBasis() {
    const arg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = arg.data as Array<{ conceptCode: string; basis: Decimal | null }>;
    return new Decimal(lines.find((l) => l.conceptCode === "FAOV_OBR")!.basis!.toString());
  }

  it("convierte el mes anterior a la moneda del sueldo actual", async () => {
    setupCreateMocks();
    // Mes pasado en USD 100; este mes cobra en bolivares. Tasa 65.
    prevMonthLines("USD", "100");
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("65"),
    } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    // 100 USD x 65 = 6.500 Bs. -> integral 6.500 x 1,125 = 7.312,50
    // Antes se cotizaba sobre "100 bolivares": 65 veces menos.
    expect(faovBasis().toFixed(2)).toBe("7312.50");
  });

  it("misma moneda en los dos meses: no convierte nada", async () => {
    setupCreateMocks();
    prevMonthLines("VES", "10000");
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    // 10.000 Bs. x 1,125 = 11.250. Si se hubiera convertido, no daria esto.
    expect(faovBasis().toFixed(2)).toBe("11250.00");
  });

  it("cambio de moneda sin tasa registrada BLOQUEA, no mezcla unidades", async () => {
    setupCreateMocks();
    prevMonthLines("USD", "100");
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      "cambió de moneda"
    );
  });

  // ── M1: la naturaleza salarial va CONGELADA en la linea ────────────────────

  it("usa el snapshot de la linea, no el catalogo vivo", async () => {
    setupCreateMocks();
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { id: "run-mar", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") },
    ] as never);
    // La linea de marzo se calculo como SALARIO_NORMAL...
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        conceptCode: "BONO_PROD",
        amount: new Decimal("10000"),
        salarySnapshotCurrency: "VES",
        salaryNature: "SALARIO_NORMAL",
      },
    ] as never);
    // ...y despues alguien reclasifico el concepto a NO_SALARIAL.
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-bono", code: "BONO_PROD", salaryNature: "NO_SALARIAL" },
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    // Marzo ya estaba aprobado y declarado: su base no se reescribe.
    expect(faovBasis().toFixed(2)).toBe("11250.00"); // 10.000 x 1,125
  });

  it("cae al catalogo solo si la linea es anterior al snapshot (NULL)", async () => {
    setupCreateMocks();
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { id: "run-mar", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        conceptCode: "SAL_BASE",
        amount: new Decimal("10000"),
        salarySnapshotCurrency: "VES",
        salaryNature: null,
      },
    ] as never);
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    expect(faovBasis().toFixed(2)).toBe("11250.00");
  });

  // ── M2: mes anterior INCOMPLETO no da media base ───────────────────────────

  it("mes anterior a medias: cae al mes en curso y lo deja en el AuditLog", async () => {
    setupCreateMocks();
    // Solo la primera quincena de marzo aprobada: 15 dias de 31.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { id: "run-mar-q1", periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-15") },
    ] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        employeeId: "emp-1",
        conceptCode: "SAL_BASE",
        amount: new Decimal("5000"),
        salarySnapshotCurrency: "VES",
        salaryNature: "SALARIO_NORMAL",
      },
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    // Ni 5.000 (media base, el bug) ni nada raro: el mes en curso, 30.000.
    expect(faovBasis().toFixed(2)).toBe("33750.00");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({
            contributionBasis: "MES_EN_CURSO_POR_MES_ANTERIOR_INCOMPLETO",
          }),
        }),
      })
    );
  });

  it("mes anterior completo lo dice en el AuditLog", async () => {
    setupCreateMocks();
    prevMonthLines("VES", "10000");
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ contributionBasis: "MES_ANTERIOR" }),
        }),
      })
    );
  });

  // ── H-4: el tope está en bolívares; el sueldo puede no estarlo ──────────────

  function setupUsdCapMocks() {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
      frequency: "MONTHLY",
      salaryMinimumVes: new Decimal("130"), // tope IVSS = Bs. 650
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-1",
        workSchedule: "DIURNA",
        salaryHistory: [
          {
            id: "sal-1",
            amount: new Decimal("2500"),
            currency: "USD",
            effectiveFrom: new Date("2026-01-01"),
          },
        ],
      },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.employee.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.overtimeEntry.findMany).mockResolvedValue([] as never);
    // Linea base propia del mes anterior: `vi.clearAllMocks()` borra las llamadas
    // pero NO las implementaciones, asi que sin esto un mockResolvedValue de otro
    // test se filtra aqui y cambia la base de cotizacion sin que se note.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);
  }

  it("H-4: convierte el tope legal a dólares con la tasa de ExchangeRate", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("65"),
    } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Tope Bs. 650 / 65 = USD 10, por las dos semanas de la quincena:
    // 10 × 12/52 × 2 = 4,62 → 4% = USD 0,18.
    // Antes del fix de H-4 salía 26,00: los bolívares del tope cobrados como
    // dólares. Lo que se comprueba aquí sigue siendo la conversión del tope.
    expect(new Decimal(ivssLine.amount.toString()).toFixed(2)).toBe("0.18");
  });

  it("H-4: busca la tasa USD de la empresa hasta el fin del período", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("65"),
    } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    // Misma ventana que usa approve() para el asiento — si divergen, el tope y el
    // asiento saldrían de tasas distintas.
    expect(vi.mocked(prisma.exchangeRate.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          currency: "USD",
          date: { lte: new Date(INPUT.periodEnd) },
        }),
      })
    );
  });

  it("H-4: sin tasa registrada no crea la nómina — bloquea en vez de inventar el tope", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await expect(PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)).rejects.toThrow(
      MISSING_USD_RATE_MESSAGE
    );

    expect(vi.mocked(prisma.payrollRun.create)).not.toHaveBeenCalled();
  });

  it("H-4: un sueldo en USD sin topes configurados no exige tasa", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
      frequency: "MONTHLY",
      salaryMinimumVes: null, // sin tope
    } as never);
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Sin tope, el sueldo entero por las dos semanas: 2500 × 12/52 × 2 = 1.153,85
    expect(new Decimal(ivssLine.amount.toString()).toFixed(2)).toBe("46.15");
  });

  it("C-05: almacena tasa BCV cuando existe BcvBenefitRate para el período", async () => {
    setupCreateMocks();
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue({
      annualRate: new Decimal("17.50"),
    } as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue({
      ...BASE_RUN,
      bcvRateAtRun: new Decimal("17.50"),
    } as never);

    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(vi.mocked(prisma.payrollRun.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bcvRateAtRun: expect.any(Decimal),
        }),
      })
    );
    expect(result.bcvRateAtRun).toBe("17.5");
  });

  it("F-03: almacena totalEmployerCosts calculado por PayrollCalculatorService", async () => {
    setupCreateMocks();
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-ivss-pat", code: "IVSS_PAT", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue({
      ...BASE_RUN,
      totalEmployerCosts: new Decimal("2700"), // 30000 × 9%
    } as never);

    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(vi.mocked(prisma.payrollRun.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalEmployerCosts: expect.any(Decimal),
        }),
      })
    );
    expect(result.totalEmployerCosts).toBeDefined();
  });

  it("llama seedDefaults antes de calcular para garantizar RPE_OBR — regresión ítem 54", async () => {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: false,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: true,
      frequency: "MONTHLY",
      salaryMinimumVes: null,
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-1",
        workSchedule: "DIURNA",
        salaryHistory: [
          {
            id: "sal-1",
            amount: new Decimal("3000"),
            currency: "VES",
            effectiveFrom: new Date("2026-01-01"),
          },
        ],
      },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-rpe", code: "RPE_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(vi.mocked(PayrollConceptService.seedDefaults)).toHaveBeenCalledWith(
      COMPANY_ID,
      USER_ID,
      null,
      null
    );
    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const rpeLine = lines.find((l) => l.conceptCode === "RPE_OBR");
    expect(rpeLine).toBeDefined();
    // Sin salaryMin: 3000×0.005=15
    expect(new Decimal(rpeLine!.amount.toString()).toFixed(2)).toBe("15.00");
  });
});

// ─── approve — mutex updateMany (NOM-C-03) ────────────────────────────────────

describe("PayrollRunService.approve", () => {
  function setupApproveMocks() {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: "acct-ivss",
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      ivssEnabled: true,
      incesEnabled: false,
      banavihEnabled: false,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "IVSS_OBR", conceptType: "DEDUCTION", amount: new Decimal("1200") },
    ] as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...BASE_RUN,
      status: "APPROVED",
      transactionId: "tx-1",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never); // sin préstamos activos
    // Sin asignaciones fijas. Linea base propia: clearAllMocks() no borra las
    // implementaciones, asi que sin esto un mock de otro test se filtra aqui.
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([] as never);
  }

  it("approves run with updateMany mutex and creates AuditLog (NOM-C-03, NOM-C-11)", async () => {
    setupApproveMocks();
    const result = await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);
    expect(result.status).toBe("APPROVED");
    expect(vi.mocked(prisma.payrollRun.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "DRAFT" }),
      })
    );
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "APPROVE_PAYROLL_RUN" }),
      })
    );
    expect(vi.mocked(prisma.transaction.create)).toHaveBeenCalled();
  });

  it("hallazgo #11: asiento GL usa run.periodEnd como fecha (no new Date())", async () => {
    setupApproveMocks();
    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    expect(txCall?.data?.date).toEqual(BASE_RUN.periodEnd);
  });

  it("throws when run already approved (updateMany returns count 0)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      ...BASE_RUN,
      status: "APPROVED",
    } as never);
    await expect(PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)).rejects.toThrow(
      "ya fue aprobado"
    );
  });

  it("throws when run not found (IDOR guard — NOM-C-01)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    await expect(PayrollRunService.approve("other-company", USER_ID, RUN_ID)).rejects.toThrow(
      "no encontrado"
    );
  });

  it("throws when accounts not configured", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "p1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: null,
      payableAccountId: null,
      ivssPayableAccountId: null,
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
    } as never);
    await expect(PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)).rejects.toThrow(
      "Configure las cuentas contables"
    );
  });

  // V-1: descuadre GL patronal
  it("V-1: patronal debit equals sum of configured credits only (no ivssPatronalAccount)", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: null,
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      rpePayableAccountId: null,
      loanReceivableAccountId: null,
      ivssEnabled: false,
      incesEnabled: true,
      banavihEnabled: false,
      rpeEnabled: false,
      // INCES patronal configurado, IVSS NO
      ivssPatronalAccountId: null,
      incesPatronalAccountId: "acct-inces-pat",
      faovPatronalAccountId: null,
      rpePatronalAccountId: null,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        conceptCode: "SAL_BASE",
        conceptType: "EARNING",
        amount: new Decimal("1000"),
        salarySnapshotCurrency: "VES",
      },
      {
        conceptCode: "INCES_PAT",
        conceptType: "EMPLOYER_COST",
        amount: new Decimal("20"),
        salarySnapshotCurrency: "VES",
      },
    ] as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-v1" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...BASE_RUN,
      status: "APPROVED",
      transactionId: "tx-v1",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    type GL = { accountId: string; amount: Decimal; description: string };
    const entries = (txCall?.data?.entries?.create ?? []) as GL[];
    // El debit patronal tiene "aportes patronales" en la descripción — Bs. 20 (solo INCES configurado)
    const patronalDebit = entries.find((e) => e.description?.includes("aportes patronales"));
    const incesCredit = entries.find((e) => e.accountId === "acct-inces-pat");
    // Debit = 20 (solo INCES), crédito = -20 → asiento cuadrado
    expect(patronalDebit?.amount.toNumber()).toBe(20);
    expect(incesCredit?.amount.toNumber()).toBe(-20);
  });

  // V-1 + PENSIONES_PAT: mismo patrón que INCES_PAT — una sola cuenta,
  // 100% patronal, sin lado obrero.
  it("V-1: PENSIONES_PAT patronal se causa contra su propia cuenta GL", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: null,
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      rpePayableAccountId: null,
      loanReceivableAccountId: null,
      ivssEnabled: false,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
      pensionesEnabled: true,
      ivssPatronalAccountId: null,
      incesPatronalAccountId: null,
      faovPatronalAccountId: null,
      rpePatronalAccountId: null,
      pensionesPatronalAccountId: "acct-pensiones-pat",
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        conceptCode: "SAL_BASE",
        conceptType: "EARNING",
        amount: new Decimal("1000"),
        salarySnapshotCurrency: "VES",
      },
      {
        conceptCode: "PENSIONES_PAT",
        conceptType: "EMPLOYER_COST",
        amount: new Decimal("90"),
        salarySnapshotCurrency: "VES",
      },
    ] as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-pensiones" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...BASE_RUN,
      status: "APPROVED",
      transactionId: "tx-pensiones",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    type GL = { accountId: string; amount: Decimal; description: string };
    const entries = (txCall?.data?.entries?.create ?? []) as GL[];
    const patronalDebit = entries.find((e) => e.description?.includes("aportes patronales"));
    const pensionesCredit = entries.find((e) => e.accountId === "acct-pensiones-pat");
    expect(patronalDebit?.amount.toNumber()).toBe(90);
    expect(pensionesCredit?.amount.toNumber()).toBe(-90);
  });

  // V-2: conversión USD→VES en GL
  it("V-2: USD payroll amounts are converted to VES using exchange rate", async () => {
    mockTx();
    // Run con totalEarnings = $100 USD
    const USD_RUN = {
      ...BASE_RUN,
      totalEarnings: new Decimal("100"),
      totalDeductions: new Decimal("0"),
      totalNet: new Decimal("100"),
    };
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(USD_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: null,
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      rpePayableAccountId: null,
      loanReceivableAccountId: null,
      ivssEnabled: false,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
      ivssPatronalAccountId: null,
      incesPatronalAccountId: null,
      faovPatronalAccountId: null,
      rpePatronalAccountId: null,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        conceptCode: "SAL_BASE",
        conceptType: "EARNING",
        amount: new Decimal("100"),
        salarySnapshotCurrency: "USD",
      },
    ] as never);
    // Tasa BCV: 1 USD = 40 Bs.
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      rate: new Decimal("40"),
    } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-usd" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...USD_RUN,
      status: "APPROVED",
      transactionId: "tx-usd",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    type GL = { accountId: string; amount: Decimal };
    const entries = (txCall?.data?.entries?.create ?? []) as GL[];
    const debitEntry = entries.find((e) => e.accountId === "acct-exp");
    // $100 × 40 = Bs. 4000
    expect(debitEntry?.amount.toNumber()).toBe(4000);
  });

  // ADR-058 / SPEC-004 CA-1: caso real del bug. Nómina USD x tasa 779,9522 con 13 líneas de
  // asiento. En bruto Σ = 0, pero Postgres redondea cada línea a Decimal(19,4) por separado y la
  // suma guardada deja de ser 0 (aquí −0,0001, igual que NOM-2026-08-16-83jgfm).
  //
  // SPEC-013 CA-2: este caso trae una cuota de préstamo (143,71). Antes de la spec el test daba por
  // bueno el doble descuento (gasto 899,61 = 1043,32 − 143,71; Nómina por pagar −690,02). El valor
  // correcto es: gasto = bruto completo (1043,32) y Nómina por pagar = neto del recibo (833,73).
  it("ADR-058: nómina USD x 779,9522 — el asiento que va a Prisma suma 0 exacto y cada línea es múltiplo de 0,01", async () => {
    mockTx();
    const m = (s: string) => new Decimal(s);
    const RATE = m("779.9522");
    // SPEC-013: totales coherentes con las líneas (calculator: totalEarnings = solo EARNING,
    // totalDeductions = IVSS 42,54 + FAOV 12,68 + INCES 6,71 + RPE 3,95 + préstamo 143,71 = 209,59,
    // totalNet = totalEarnings − totalDeductions = 833,73). Antes el mock traía 0 y 0.
    const USD_RUN = {
      ...BASE_RUN,
      totalEarnings: m("1043.32"),
      totalDeductions: m("209.59"),
      totalNet: m("833.73"),
    };
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(USD_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: "acct-ivss",
      faovPayableAccountId: "acct-faov",
      incesPayableAccountId: "acct-inces",
      rpePayableAccountId: "acct-rpe",
      loanReceivableAccountId: "acct-loan",
      ivssPatronalAccountId: "acct-ivss-pat",
      incesPatronalAccountId: "acct-inces-pat",
      faovPatronalAccountId: "acct-faov-pat",
      rpePatronalAccountId: "acct-rpe-pat",
      pensionesPatronalAccountId: "acct-pens-pat",
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      rpeEnabled: true,
      pensionesEnabled: true,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    const line = (conceptCode: string, conceptType: string, amount: string) => ({
      conceptCode,
      conceptType,
      amount: m(amount),
      salarySnapshotCurrency: "USD",
    });
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      line("SAL_BASE", "EARNING", "1043.32"),
      line("PRESTAMO_EMP", "DEDUCTION", "143.71"),
      line("IVSS_OBR", "DEDUCTION", "42.54"),
      line("FAOV_OBR", "DEDUCTION", "12.68"),
      line("INCES_OBR", "DEDUCTION", "6.71"),
      line("RPE_OBR", "DEDUCTION", "3.95"),
      line("IVSS_PAT", "EMPLOYER_COST", "107.27"),
      line("INCES_PAT", "EMPLOYER_COST", "24.09"),
      line("FAOV_PAT", "EMPLOYER_COST", "21.46"),
      line("RPE_PAT", "EMPLOYER_COST", "21.55"),
      line("PENSIONES_PAT", "EMPLOYER_COST", "112.06"),
    ] as never);
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({ rate: RATE } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-usd" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...USD_RUN,
      status: "APPROVED",
      transactionId: "tx-usd",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    const entries = (txCall?.data?.entries?.create ?? []) as Array<{
      accountId: string;
      amount: Decimal;
    }>;
    expect(entries).toHaveLength(13);

    // Reproduce el defecto: con los mismos montos USD, redondear CADA línea a 4 decimales
    // (lo que hace Postgres con Decimal(19,4)) NO suma 0.
    const usd = [
      "1043.32", // gasto de personal = bruto completo (SPEC-013: la cuota NO se resta del gasto)
      "-833.73", // Nómina por pagar = neto del recibo (1043,32 − retenciones − cuota préstamo)
      "-42.54",
      "-12.68",
      "-6.71",
      "-3.95",
      "-143.71",
      "286.43", // débito patronal
      "-107.27",
      "-24.09",
      "-21.46",
      "-21.55",
      "-112.06",
    ].map((s) => m(s).mul(RATE));
    expect(usd.reduce((a, x) => a.plus(x), m("0")).isZero()).toBe(true);
    expect(usd.reduce((a, x) => a.plus(x.toDecimalPlaces(4)), m("0")).isZero()).toBe(false);

    const sum = entries.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);
    for (const e of entries) {
      expect(e.amount.mul(100).isInteger()).toBe(true);
      expect(Object.keys(e)).not.toContain("noAbsorb"); // Prisma rechaza campos desconocidos
    }

    // SPEC-013 CA-2 — el valor correcto, calculado con Decimal.js (no copiado del test viejo).
    // Raw (Bs.): gasto 1043,32 x tasa = 813.739,729304; Nómina por pagar 833,73 x tasa =
    // 650.269,547706. A 2 decimales (ROUND_HALF_UP): 813.739,73 y 650.269,55. La suma de las 13
    // líneas redondeadas queda en +0,01, y ese residuo lo absorbe la línea de mayor |monto| que no
    // sea noAbsorb: el gasto (813.739,73 > 650.269,55; el débito patronal es menor). Por eso el
    // gasto final es 813.739,72. Nómina por pagar NO se mueve: es el neto del recibo x tasa.
    const gastoRedondeado = m("1043.32").mul(RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(gastoRedondeado.toFixed(2)).toBe("813739.73");
    const gasto = entries.find((e) => e.accountId === "acct-exp");
    expect(gasto?.amount.toFixed(2)).toBe("813739.72");
    expect(gasto?.amount.toFixed(2)).toBe(gastoRedondeado.minus("0.01").toFixed(2));
    const porPagar = entries.find((e) => e.accountId === "acct-pay");
    expect(porPagar?.amount.toFixed(2)).toBe("-650269.55");
    expect(porPagar?.amount.toFixed(2)).toBe(
      m("-833.73").mul(RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
    );
    // La cuota se convierte con la misma tasa y su línea NO absorbe el residuo (noAbsorb):
    // queda exacta en round(143,71 x tasa, 2), sin el +/−0,01 del ajuste.
    const prestamo = entries.find((e) => e.accountId === "acct-loan");
    expect(prestamo?.amount.toFixed(2)).toBe("-112086.93");
    expect(prestamo?.amount.toFixed(2)).toBe(
      m("-143.71").mul(RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
    );

    // Obligaciones parafiscales NO absorben: IVSS obrero = round(42.54 x 779,9522, 2).
    const ivss = entries.find((e) => e.accountId === "acct-ivss");
    expect(ivss?.amount.toFixed(2)).toBe("-33179.17");
    const pens = entries.find((e) => e.accountId === "acct-pens-pat");
    expect(pens?.amount.toFixed(2)).toBe(m("-112.06").mul(RATE).toDecimalPlaces(2).toFixed(2));

    // El residuo (0,01) queda trazable en el AuditLog (R-6).
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0]?.[0];
    expect(audit?.data?.newValue).toMatchObject({
      glRounding: { residual: "0.01", scale: 2 },
    });
  });

  // V-2: USD sin tasa registrada → lanza error
  it("V-2: USD payroll throws when no exchange rate registered", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssEnabled: false,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      {
        conceptCode: "SAL_BASE",
        conceptType: "EARNING",
        amount: new Decimal("100"),
        salarySnapshotCurrency: "USD",
      },
    ] as never);
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await expect(PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)).rejects.toThrow(
      "antes de aprobar esta nómina"
    );
  });
});

// ─── approve — cuota de préstamo (SPEC-013) ───────────────────────────────────
//
// Contrato (SPEC-013, contadora 2026-10-04): la cuota de préstamo (PRESTAMO_EMP, DEDUCTION) NO está
// dentro de totalEarnings (que solo suma líneas EARNING) y NO es gasto: es la recuperación de
// "Préstamos a empleados". El asiento de causación es
//   Dr Gasto de sueldos      = totalEarnings (bruto completo)
//   Cr retenciones           = cada una con cuenta propia
//   Cr Préstamos a empleados = Σ cuotas PRESTAMO_EMP
//   Cr Nómina por pagar      = neto del recibo (totalNet) + retenciones SIN cuenta propia (RN-4)
// Bug previo: el gasto salía de totalEarnings − cuota y Nómina por pagar volvía a restarla (doble
// descuento): con bruto 1.000, IVSS 40 y cuota 100 daba 900 / 40 / 100 / 760 en vez de
// 1.000 / 40 / 100 / 860.
describe("PayrollRunService.approve — cuota de préstamo (SPEC-013)", () => {
  const m = (s: string) => new Decimal(s);
  const RATE = m("779.9522");
  const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const LOAN_ACCOUNT_REQUIRED_MESSAGE =
    "Configure la cuenta de préstamos al personal (Préstamos a Empleados) en la configuración de nómina antes de aprobar una nómina con cuotas de préstamo.";

  type Currency = "VES" | "USD";
  type LineType = "EARNING" | "DEDUCTION" | "EMPLOYER_COST";
  type Gl = { accountId: string; amount: Decimal; description: string };

  const mkLine = (
    code: string,
    type: LineType,
    amount: string,
    currency: Currency = "VES",
    employeeId = "emp-1"
  ) => ({
    conceptCode: code,
    conceptType: type,
    amount: m(amount),
    salarySnapshotCurrency: currency,
    employeeId,
  });
  type LineRow = ReturnType<typeof mkLine>;

  // Config con TODAS las cuentas de la nómina del empleado; sin cuentas patronales (estos casos no
  // traen líneas EMPLOYER_COST). Cada caso sobreescribe lo que necesita.
  function cfg(overrides: Record<string, unknown> = {}) {
    return {
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: "acct-ivss",
      faovPayableAccountId: "acct-faov",
      incesPayableAccountId: "acct-inces",
      rpePayableAccountId: "acct-rpe",
      loanReceivableAccountId: "acct-loan",
      ivssPatronalAccountId: null,
      incesPatronalAccountId: null,
      faovPatronalAccountId: null,
      rpePatronalAccountId: null,
      pensionesPatronalAccountId: null,
      ivssEnabled: true,
      incesEnabled: true,
      banavihEnabled: true,
      rpeEnabled: true,
      pensionesEnabled: false,
      ...overrides,
    };
  }

  // Totales del run COHERENTES con las líneas, igual que PayrollCalculatorService (:575):
  // totalEarnings = solo EARNING, totalDeductions = solo DEDUCTION, totalNet = la resta.
  function runFromLines(lines: LineRow[]) {
    const sumOf = (t: LineType) =>
      lines.filter((l) => l.conceptType === t).reduce((s, l) => s.plus(l.amount), m("0"));
    const totalEarnings = sumOf("EARNING");
    const totalDeductions = sumOf("DEDUCTION");
    return {
      ...BASE_RUN,
      totalEarnings,
      totalDeductions,
      totalNet: totalEarnings.minus(totalDeductions),
    };
  }

  // Préstamo ACTIVE cuya cuota coincide con la línea PRESTAMO_EMP del recibo (sin esto approve
  // loguea un warning de "recibo y plan discrepan" que no es lo que se prueba aquí).
  function loanMatchingLines(lines: LineRow[]) {
    const l = lines.find(
      (x) =>
        x.conceptCode === "PRESTAMO_EMP" && x.conceptType === "DEDUCTION" && x.amount.greaterThan(0)
    );
    if (!l) return [];
    const usd = l.salarySnapshotCurrency === "USD";
    return [
      {
        id: "loan-1",
        currency: usd ? "USD" : "VES",
        installmentAmount: usd ? m("0") : l.amount,
        remainingBalance: usd ? m("0") : l.amount.mul(5),
        installmentAmountUsd: usd ? l.amount : null,
        remainingBalanceUsd: usd ? l.amount.mul(5) : null,
        paidInstallments: 1,
      },
    ];
  }

  function setupLoanApprove(
    lines: LineRow[],
    configOverrides: Record<string, unknown> = {},
    opts: { rate?: Decimal; loans?: unknown[] } = {}
  ) {
    mockTx();
    const run = runFromLines(lines);
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(run as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(cfg(configOverrides) as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue(lines as never);
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(
      (opts.rate ? { rate: opts.rate } : null) as never
    );
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...run,
      status: "APPROVED",
      transactionId: "tx-1",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue(
      (opts.loans ?? loanMatchingLines(lines)) as never
    );
    vi.mocked(prisma.employeeRecurringConcept.findMany).mockResolvedValue([] as never);
    return run;
  }

  function glEntries(): Gl[] {
    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    return (txCall?.data?.entries?.create ?? []) as Gl[];
  }

  // Monto (string a 2 decimales) por cuenta. Estos casos no repiten cuenta: lo verifica
  // expectWellFormed, así que un Record por cuenta no esconde líneas duplicadas.
  const byAccount = (entries: Gl[]) =>
    Object.fromEntries(entries.map((e) => [e.accountId, e.amount.toFixed(2)]));

  // Residuo que ADR-058 dejó trazado en el AuditLog (0 si no hubo).
  function auditedResidual(): Decimal {
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0]?.[0];
    const nv = audit?.data?.newValue as unknown as { glRounding?: { residual: string } };
    return nv?.glRounding ? m(nv.glRounding.residual) : m("0");
  }

  // CA-5 / ADR-058: lo que llega a Prisma suma EXACTAMENTE 0, cada línea es múltiplo de 0,01, no
  // lleva el campo interno noAbsorb (Prisma rechaza campos desconocidos) y no repite cuenta.
  function expectWellFormed(entries: Gl[]) {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.reduce((acc, e) => acc.plus(e.amount), m("0")).isZero()).toBe(true);
    for (const e of entries) {
      expect(e.amount.mul(100).isInteger()).toBe(true);
      expect(Object.keys(e)).not.toContain("noAbsorb");
    }
    expect(new Set(entries.map((e) => e.accountId)).size).toBe(entries.length);
  }

  const WITHHOLDINGS = [
    {
      code: "IVSS_OBR",
      key: "ivss",
      account: "acct-ivss",
      cfgKey: "ivssPayableAccountId",
      amt: "42.54",
    },
    {
      code: "FAOV_OBR",
      key: "faov",
      account: "acct-faov",
      cfgKey: "faovPayableAccountId",
      amt: "12.68",
    },
    {
      code: "INCES_OBR",
      key: "inces",
      account: "acct-inces",
      cfgKey: "incesPayableAccountId",
      amt: "6.71",
    },
    {
      code: "RPE_OBR",
      key: "rpe",
      account: "acct-rpe",
      cfgKey: "rpePayableAccountId",
      amt: "3.95",
    },
  ] as const;
  type OwnAccounts = Record<(typeof WITHHOLDINGS)[number]["key"], boolean>;
  const LOAN_AMOUNT = "143.71";

  // ── CA-1 ─────────────────────────────────────────────────────────────────
  it("CA-1: bruto 1.000, IVSS 40 y cuota 100 → Gasto 1.000 / IVSS 40 / Préstamos 100 / Nómina por pagar 860, Σ = 0", async () => {
    setupLoanApprove([
      mkLine("SAL_BASE", "EARNING", "1000"),
      mkLine("IVSS_OBR", "DEDUCTION", "40"),
      mkLine("PRESTAMO_EMP", "DEDUCTION", "100"),
    ]);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const entries = glEntries();
    expectWellFormed(entries);
    // Exactamente 4 líneas: gasto (débito) y tres créditos. Hoy sale 900 / 40 / 100 / 760.
    expect(entries).toHaveLength(4);
    expect(byAccount(entries)).toEqual({
      "acct-exp": "1000.00",
      "acct-ivss": "-40.00",
      "acct-loan": "-100.00",
      "acct-pay": "-860.00",
    });
  });

  // ── CA-3: invariante Nómina por pagar = neto del recibo ──────────────────
  // Nota: CA-3 en la spec dice "Nómina por pagar MÁS las retenciones sin cuenta propia = totalNet",
  // pero RN-3/RN-4 (y el comportamiento actual) son al revés: lo que no tiene cuenta propia QUEDA
  // DENTRO de Nómina por pagar, o sea Nómina por pagar = totalNet + retenciones sin cuenta propia.
  const ALL_OWN: OwnAccounts = { ivss: true, faov: true, inces: true, rpe: true };
  const NONE_OWN: OwnAccounts = { ivss: false, faov: false, inces: false, rpe: false };
  const CA3_CASES: Array<{ label: string; withLoan: boolean; own: OwnAccounts }> = [
    { label: "con cuota, todas las retenciones con cuenta propia", withLoan: true, own: ALL_OWN },
    { label: "sin cuota, todas las retenciones con cuenta propia", withLoan: false, own: ALL_OWN },
    {
      label: "con cuota, IVSS sin cuenta propia",
      withLoan: true,
      own: { ...ALL_OWN, ivss: false },
    },
    {
      label: "con cuota, solo FAOV y RPE con cuenta propia",
      withLoan: true,
      own: { ivss: false, faov: true, inces: false, rpe: true },
    },
    { label: "con cuota, ninguna retención con cuenta propia", withLoan: true, own: NONE_OWN },
    { label: "sin cuota, ninguna retención con cuenta propia", withLoan: false, own: NONE_OWN },
    {
      label: "sin cuota, solo INCES con cuenta propia",
      withLoan: false,
      own: { ...NONE_OWN, inces: true },
    },
  ];
  // Filas [nombre, caso]: con %s el nombre sale completo (con $name vitest lo trunca y VES/USD se confunden).
  const CA3_MATRIX = CA3_CASES.flatMap((c) =>
    (["VES", "USD"] as const).map(
      (currency) => [`${c.label} (${currency})`, { ...c, currency }] as const
    )
  );

  it.each(CA3_MATRIX)(
    "CA-3: %s — Nómina por pagar = neto del recibo + retenciones sin cuenta propia",
    async (_name, { withLoan, own, currency }) => {
      const lines = [
        mkLine("SAL_BASE", "EARNING", "1043.32", currency),
        ...WITHHOLDINGS.map((w) => mkLine(w.code, "DEDUCTION", w.amt, currency)),
        ...(withLoan ? [mkLine("PRESTAMO_EMP", "DEDUCTION", LOAN_AMOUNT, currency)] : []),
      ];
      const ownConfig = Object.fromEntries(
        WITHHOLDINGS.map((w) => [w.cfgKey, own[w.key] ? w.account : null])
      );
      const run = setupLoanApprove(lines, ownConfig, {
        rate: currency === "USD" ? RATE : undefined,
      });
      const mult = currency === "USD" ? RATE : m("1");

      await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      const entries = glEntries();
      expectWellFormed(entries);

      // Todo se calcula aparte, a partir del recibo, no del código de producción.
      const sinCuentaPropia = WITHHOLDINGS.filter((w) => !own[w.key]).reduce(
        (s, w) => s.plus(w.amt),
        m("0")
      );
      const expected: Record<string, string> = {
        // Gasto = bruto completo x tasa (ADR-058: el residuo de redondeo cae aquí, la línea mayor).
        "acct-exp": r2(run.totalEarnings.mul(mult)).minus(auditedResidual()).toFixed(2),
        // Nómina por pagar = neto del recibo + lo que no tiene cuenta propia (RN-3 / RN-4).
        "acct-pay": r2(run.totalNet.plus(sinCuentaPropia).mul(mult)).negated().toFixed(2),
      };
      for (const w of WITHHOLDINGS) {
        if (own[w.key]) expected[w.account] = r2(m(w.amt).mul(mult)).negated().toFixed(2);
      }
      if (withLoan) expected["acct-loan"] = r2(m(LOAN_AMOUNT).mul(mult)).negated().toFixed(2);

      expect(byAccount(entries)).toEqual(expected);
    }
  );

  // ── CA-4: sin cuotas de préstamo el asiento es el de hoy ─────────────────
  it("CA-4 regresión: sin cuotas de préstamo el asiento no cambia (FAOV sin cuenta propia queda en Nómina por pagar)", async () => {
    setupLoanApprove(
      [
        mkLine("SAL_BASE", "EARNING", "1000"),
        mkLine("IVSS_OBR", "DEDUCTION", "40"),
        mkLine("FAOV_OBR", "DEDUCTION", "10"),
      ],
      { faovPayableAccountId: null }
    );

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const entries = glEntries();
    expectWellFormed(entries);
    expect(byAccount(entries)).toEqual({
      "acct-exp": "1000.00",
      "acct-ivss": "-40.00",
      "acct-pay": "-960.00", // 1000 − IVSS 40; el FAOV 10 sigue dentro de Nómina por pagar (RN-4)
    });
  });

  // ── CA-5: cuantización al céntimo con residuo; la cuota NO absorbe ───────
  // Montos buscados con Decimal.js (tasa 779,9522, sin líneas patronales) para que el redondeo a 2
  // decimales de las líneas deje un residuo ≠ 0 de cada signo. El residuo cae en el gasto (la línea
  // de mayor |monto| que no es noAbsorb) y NUNCA en Préstamos a empleados.
  it.each([
    {
      label: "residuo +0,02",
      earnings: "921.19",
      ded: { ivss: "39.86", faov: "13.34", inces: "7.26", rpe: "3.33" },
      loan: "133.64",
      residual: "0.02",
    },
    {
      label: "residuo −0,01",
      earnings: "1983.72",
      ded: { ivss: "33.96", faov: "10.95", inces: "3.85", rpe: "4.05" },
      loan: "118.58",
      residual: "-0.01",
    },
  ])(
    "CA-5: nómina USD con cuota, $label — Σ = 0 exacta, múltiplos de 0,01 y la cuota queda en round(cuota x tasa, 2)",
    async ({ earnings, ded, loan, residual }) => {
      const lines = [
        mkLine("SAL_BASE", "EARNING", earnings, "USD"),
        mkLine("IVSS_OBR", "DEDUCTION", ded.ivss, "USD"),
        mkLine("FAOV_OBR", "DEDUCTION", ded.faov, "USD"),
        mkLine("INCES_OBR", "DEDUCTION", ded.inces, "USD"),
        mkLine("RPE_OBR", "DEDUCTION", ded.rpe, "USD"),
        mkLine("PRESTAMO_EMP", "DEDUCTION", loan, "USD"),
      ];
      const run = setupLoanApprove(lines, {}, { rate: RATE });

      await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      const entries = glEntries();
      expectWellFormed(entries);
      expect(auditedResidual().toFixed(2)).toBe(m(residual).toFixed(2));

      const amounts = byAccount(entries);
      // La cuota NO absorbe: exacta, sin el ajuste del residuo.
      expect(amounts["acct-loan"]).toBe(r2(m(loan).mul(RATE)).negated().toFixed(2));
      // Las retenciones tampoco (noAbsorb).
      expect(amounts["acct-ivss"]).toBe(r2(m(ded.ivss).mul(RATE)).negated().toFixed(2));
      // Nómina por pagar = neto del recibo x tasa, sin tocar.
      expect(amounts["acct-pay"]).toBe(r2(run.totalNet.mul(RATE)).negated().toFixed(2));
      // El gasto = bruto completo x tasa − residuo (el residuo cae aquí).
      expect(amounts["acct-exp"]).toBe(r2(m(earnings).mul(RATE)).minus(m(residual)).toFixed(2));
    }
  );

  // ── CA-6 / RN-7: saldos del préstamo y línea del recibo intactos ─────────
  describe("CA-6: saldos de EmployeeLoan y línea PRESTAMO_EMP", () => {
    it("aplica la cuota al saldo del préstamo y no toca la línea del recibo ni los totales", async () => {
      const lines = [
        mkLine("SAL_BASE", "EARNING", "1000"),
        mkLine("IVSS_OBR", "DEDUCTION", "40"),
        mkLine("PRESTAMO_EMP", "DEDUCTION", "100"),
      ];
      const antes = JSON.stringify(lines.map((l) => ({ ...l, amount: l.amount.toString() })));
      setupLoanApprove(
        lines,
        {},
        {
          loans: [
            {
              id: "loan-1",
              currency: "VES",
              installmentAmount: m("100"),
              remainingBalance: m("500"),
              installmentAmountUsd: null,
              remainingBalanceUsd: null,
              paidInstallments: 2,
            },
          ],
        }
      );

      await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      expect(vi.mocked(prisma.employeeLoan.update)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(prisma.employeeLoan.update)).toHaveBeenCalledWith({
        where: { id: "loan-1" },
        data: {
          remainingBalance: "400.00",
          paidInstallments: { increment: 1 },
          status: "ACTIVE",
        },
      });
      // La línea del recibo y los totales no se reescriben: solo se vincula el asiento.
      const despues = JSON.stringify(lines.map((l) => ({ ...l, amount: l.amount.toString() })));
      expect(despues).toBe(antes);
      expect(vi.mocked(prisma.payrollRunLine.create)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.payrollRunLine.createMany)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.payrollRun.update)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(prisma.payrollRun.update)).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        data: { transactionId: "tx-1" },
      });
    });

    it("la última cuota deja el préstamo en PAID con saldo 0.00", async () => {
      setupLoanApprove(
        [mkLine("SAL_BASE", "EARNING", "1000"), mkLine("PRESTAMO_EMP", "DEDUCTION", "100")],
        {},
        {
          loans: [
            {
              id: "loan-1",
              currency: "VES",
              installmentAmount: m("100"),
              remainingBalance: m("100"),
              installmentAmountUsd: null,
              remainingBalanceUsd: null,
              paidInstallments: 5,
            },
          ],
        }
      );

      await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      expect(vi.mocked(prisma.employeeLoan.update)).toHaveBeenCalledWith({
        where: { id: "loan-1" },
        data: {
          remainingBalance: "0.00",
          paidInstallments: { increment: 1 },
          status: "PAID",
        },
      });
    });

    it("préstamo en USD en nómina USD: baja el saldo en dólares (no en bolívares) sin convertir", async () => {
      setupLoanApprove(
        [
          mkLine("SAL_BASE", "EARNING", "1043.32", "USD"),
          mkLine("PRESTAMO_EMP", "DEDUCTION", "143.71", "USD"),
        ],
        {},
        {
          rate: RATE,
          loans: [
            {
              id: "loan-usd",
              currency: "USD",
              installmentAmount: m("0"),
              remainingBalance: m("0"),
              installmentAmountUsd: m("143.71"),
              remainingBalanceUsd: m("500"),
              paidInstallments: 0,
            },
          ],
        }
      );

      await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      expect(vi.mocked(prisma.employeeLoan.update)).toHaveBeenCalledWith({
        where: { id: "loan-usd" },
        data: {
          remainingBalance: "0.00",
          remainingBalanceUsd: "356.29",
          paidInstallments: { increment: 1 },
          status: "ACTIVE",
        },
      });
    });
  });

  // ── CA-7 / RN-8: sin cuenta de préstamos, con cuotas → se rechaza ────────
  describe("CA-7: cuota de préstamo sin loanReceivableAccountId", () => {
    function expectNothingWritten() {
      expect(vi.mocked(prisma.transaction.create)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.employeeLoan.update)).not.toHaveBeenCalled();
      // `payrollRun.update` es el que vincula el asiento (transactionId): no se marca aprobada con asiento.
      expect(vi.mocked(prisma.payrollRun.update)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.auditLog.create)).not.toHaveBeenCalled();
    }

    it("VES: rechaza con el mensaje de RN-8 y no crea asiento, no toca saldos ni vincula el asiento", async () => {
      setupLoanApprove(
        [
          mkLine("SAL_BASE", "EARNING", "1000"),
          mkLine("IVSS_OBR", "DEDUCTION", "40"),
          mkLine("PRESTAMO_EMP", "DEDUCTION", "100"),
        ],
        { loanReceivableAccountId: null }
      );

      await expect(PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)).rejects.toMatchObject({
        message: LOAN_ACCOUNT_REQUIRED_MESSAGE,
      });
      expectNothingWritten();
    });

    it("USD (con tasa registrada): también rechaza con el mensaje de RN-8 y no escribe nada", async () => {
      setupLoanApprove(
        [
          mkLine("SAL_BASE", "EARNING", "1043.32", "USD"),
          mkLine("PRESTAMO_EMP", "DEDUCTION", "143.71", "USD"),
        ],
        { loanReceivableAccountId: null },
        { rate: RATE }
      );

      await expect(PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)).rejects.toMatchObject({
        message: LOAN_ACCOUNT_REQUIRED_MESSAGE,
      });
      expectNothingWritten();
    });

    it("sin cuotas de préstamo, la falta de la cuenta NO bloquea la aprobación", async () => {
      setupLoanApprove(
        [mkLine("SAL_BASE", "EARNING", "1000"), mkLine("IVSS_OBR", "DEDUCTION", "40")],
        { loanReceivableAccountId: null }
      );

      const result = await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      expect(result.status).toBe("APPROVED");
      const entries = glEntries();
      expectWellFormed(entries);
      expect(byAccount(entries)).toEqual({
        "acct-exp": "1000.00",
        "acct-ivss": "-40.00",
        "acct-pay": "-960.00",
      });
    });

    it("una línea PRESTAMO_EMP en 0 no es una cuota: no bloquea sin la cuenta", async () => {
      setupLoanApprove(
        [mkLine("SAL_BASE", "EARNING", "1000"), mkLine("PRESTAMO_EMP", "DEDUCTION", "0")],
        { loanReceivableAccountId: null }
      );

      const result = await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

      expect(result.status).toBe("APPROVED");
      expect(vi.mocked(prisma.transaction.create)).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── cancel — solo DRAFT (NOM-C-04) ──────────────────────────────────────────

describe("PayrollRunService.cancel", () => {
  it("cancels DRAFT run with AuditLog", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({
      ...BASE_RUN,
      status: "CANCELLED",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollRunService.cancel(COMPANY_ID, USER_ID, RUN_ID, "Error en datos");
    expect(result.status).toBe("CANCELLED");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CANCEL_PAYROLL_RUN" }),
      })
    );
  });

  it("throws when trying to cancel APPROVED run (NOM-C-04)", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      ...BASE_RUN,
      status: "APPROVED",
    } as never);
    await expect(PayrollRunService.cancel(COMPANY_ID, USER_ID, RUN_ID, "razón")).rejects.toThrow(
      "No se puede cancelar un proceso aprobado"
    );
  });

  it("throws when trying to cancel CANCELLED run", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      ...BASE_RUN,
      status: "CANCELLED",
    } as never);
    await expect(PayrollRunService.cancel(COMPANY_ID, USER_ID, RUN_ID, "razón")).rejects.toThrow(
      "ya está cancelado"
    );
  });

  it("throws when run not found (IDOR guard)", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollRunService.cancel("other-company", USER_ID, RUN_ID, "razón")
    ).rejects.toThrow("no encontrado");
  });
});
