// src/modules/payroll/__tests__/PayrollAutoDraftService.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import {
  PayrollAutoDraftService,
  periodoCerradoEn,
  autoDraftKey,
  AUTO_DRAFT_ACTOR,
  AUTO_DRAFT_USER_AGENT,
} from "../services/PayrollAutoDraftService";
import { PayrollRunService } from "../services/PayrollRunService";
import { MIXED_SALARY_MESSAGE } from "../services/payroll-currency";
import { READ_ONLY_MESSAGE } from "@/lib/prisma-billing-gate";

vi.mock("@/lib/prisma", () => ({
  default: { payrollConfig: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock("../services/PayrollRunService", () => ({
  PayrollRunService: { create: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.payrollConfig.count).mockResolvedValue(0 as never);
  vi.mocked(PayrollRunService.create).mockResolvedValue({ id: "run-nuevo" } as never);
});

describe("periodoCerradoEn — el periodo que TERMINA, no el que empieza", () => {
  // approve() fecha el asiento en periodEnd y las horas extra se registran
  // DESPUES de trabajarse. Dibujar el periodo entrante seria pagar trabajo no
  // realizado y, por definicion, con cero horas extra.

  it("quincenal, dia 16 → la primera quincena que acaba de cerrar", () => {
    expect(periodoCerradoEn("2026-08-16", "BIWEEKLY")).toEqual({ start: "2026-08-01", end: "2026-08-15" });
  });

  it("quincenal, dia 1 → la segunda quincena del mes ANTERIOR", () => {
    expect(periodoCerradoEn("2026-09-01", "BIWEEKLY")).toEqual({ start: "2026-08-16", end: "2026-08-31" });
  });

  it("mensual, dia 1 → el mes anterior completo", () => {
    expect(periodoCerradoEn("2026-09-01", "MONTHLY")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("mensual: el dia 16 NO cierra periodo", () => {
    expect(periodoCerradoEn("2026-08-16", "MONTHLY")).toBeNull();
  });

  it("el 1 de enero retrocede el AÑO, no solo el mes", () => {
    expect(periodoCerradoEn("2027-01-01", "MONTHLY")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(periodoCerradoEn("2027-01-01", "BIWEEKLY")).toEqual({ start: "2026-12-16", end: "2026-12-31" });
  });

  it("respeta los meses de 30 dias y febrero bisiesto", () => {
    expect(periodoCerradoEn("2026-05-01", "MONTHLY")!.end).toBe("2026-04-30");
    expect(periodoCerradoEn("2028-03-01", "MONTHLY")!.end).toBe("2028-02-29");
  });

  it("cualquier otro dia no cierra nada", () => {
    expect(periodoCerradoEn("2026-08-20", "BIWEEKLY")).toBeNull();
    expect(periodoCerradoEn("2026-08-15", "BIWEEKLY")).toBeNull();
  });

  it("SEMANAL siempre null: el ciclo no tiene ancla en la configuracion", () => {
    // Adivinar los limites de la semana produce procesos solapados que
    // envenenan la ranura del periodo, y de ahi solo se sale cancelando.
    expect(periodoCerradoEn("2026-08-16", "SEMANAL")).toBeNull();
    expect(periodoCerradoEn("2026-08-01", "SEMANAL")).toBeNull();
  });
});

describe("autoDraftKey", () => {
  it("es determinista: el mismo periodo da la misma clave", () => {
    expect(autoDraftKey("2026-08-01", "2026-08-15")).toBe(autoDraftKey("2026-08-01", "2026-08-15"));
  });

  it("lleva prefijo propio: no colisiona con las claves aleatorias de la UI", () => {
    expect(autoDraftKey("2026-08-01", "2026-08-15")).toMatch(/^auto:v1:/);
  });
});

describe("runAutoDrafts", () => {
  function config(over: Record<string, unknown> = {}) {
    return {
      companyId: "co-1", frequency: "BIWEEKLY",
      company: { name: "Empresa Uno", country: "VEN", scopeProfile: "EMPRESA" }, ...over,
    };
  }

  it("solo mira las empresas que ACTIVARON el borrador automatico", async () => {
    await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    const where = vi.mocked(prisma.payrollConfig.findMany).mock.calls[0][0]?.where;
    expect(where?.autoDraftEnabled).toBe(true);
  });

  it("crea el borrador con la clave determinista y el actor centinela", async () => {
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");

    expect(res[0].status).toBe("CREADA");
    const [companyId, userId, input, ip, ua] = vi.mocked(PayrollRunService.create).mock.calls[0];
    expect(companyId).toBe("co-1");
    // Nunca el userId de una persona: poner su nombre en un documento que no
    // creo es lo que un rastro de auditoria existe para impedir.
    expect(userId).toBe(AUTO_DRAFT_ACTOR);
    expect(input.idempotencyKey).toBe("auto:v1:2026-08-01:2026-08-15");
    // Sin IP inventada: la de la infraestructura no es la de un actor.
    expect(ip).toBeNull();
    expect(ua).toBe(AUTO_DRAFT_USER_AGENT);
  });

  it("NUNCA aprueba: el servicio no expone ni importa approve", () => {
    expect((PayrollAutoDraftService as Record<string, unknown>).approve).toBeUndefined();
  });

  it("una empresa que falla NO tumba el lote", async () => {
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([
      config({ companyId: "co-1" }),
      config({ companyId: "co-2", company: { name: "Empresa Dos", country: "VEN", scopeProfile: "EMPRESA" } }),
    ] as never);
    vi.mocked(PayrollRunService.create)
      .mockRejectedValueOnce(new Error("Nómina con monedas mixtas (USD y VES)."))
      .mockResolvedValueOnce({ id: "run-2" } as never);

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");

    expect(res).toHaveLength(2);
    expect(res[0].status).toBe("OMITIDA");
    expect(res[0].motivo).toContain("dos monedas");
    expect(res[1].status).toBe("CREADA");
  });

  it("un reintento del cron cuenta como OMITIDA, no como error", async () => {
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(
      new Error("Esta solicitud ya se envió. Revisa si el proceso de nómina se creó antes de reintentar."),
    );

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("OMITIDA");
  });

  it("respeta el proceso que ya creo un humano", async () => {
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(
      new Error("Ya existe un proceso de nómina en borrador en VES que cubre del 2026-08-01 al 2026-08-15."),
    );

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("OMITIDA");
    expect(res[0].motivo).toContain("se respeta el del usuario");
  });

  it("un error inesperado SI se marca FALLIDA, y NO filtra el mensaje crudo", async () => {
    // Los errores del calculador y del guard de solape llevan el NOMBRE del
    // trabajador. `motivo` acaba en el cuerpo de la respuesta del cron y en los
    // logs de invocacion de Vercel: audiencia mucho mas amplia que la BD.
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(
      new Error("El neto a pagar de Pérez, Juan es negativo"),
    );

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("FALLIDA");
    expect(res[0].motivo).not.toContain("Pérez");
    expect(res[0].motivo).toContain("Sentry");
  });

  it("el choque por TRABAJADOR es omision, y su nombre no sale", async () => {
    // Son dos guards distintos: "ya EXISTE un proceso" (ranura ocupada) y
    // "ya ESTA en un proceso" (trabajador en un periodo solapado). Cubrir solo
    // el primero mandaba el segundo a FALLIDA con el nombre dentro.
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(
      new Error("Flores, Ramón ya está en un proceso de nómina en borrador del 2026-08-01 al 2026-08-15."),
    );

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("OMITIDA");
    expect(res[0].motivo).not.toContain("Flores");
  });

  it("suscripcion vencida es OMISION, no fallo del sistema", async () => {
    // Se compara contra la CONSTANTE real, no un literal copiado: un literal
    // deja de casar en cuanto alguien reescribe el mensaje, y eso no lo ve ni
    // tsc ni ningun test.
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(new Error(READ_ONLY_MESSAGE));

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("OMITIDA");
    expect(res[0].motivo).toContain("solo lectura");
  });

  it("sueldo en modalidad MIXTA es omision (constante real, no literal)", async () => {
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(new Error(MIXED_SALARY_MESSAGE));

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("OMITIDA");
  });

  it("OMITE las empresas cuyo perfil no incluye Nomina (SOLO)", async () => {
    // El perfil SOLO no ve el modulo. Hoy eso solo lo bloquea la navegacion, asi
    // que sin este filtro el cron le seguiria creando procesos a una empresa que
    // ni siquiera tiene pantalla desde donde apagarlo.
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([
      config({ company: { name: "Solo", country: "VEN", scopeProfile: "SOLO" } }),
    ] as never);

    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(res[0].status).toBe("OMITIDA");
    expect(res[0].motivo).toContain("perfil");
    expect(vi.mocked(PayrollRunService.create)).not.toHaveBeenCalled();
  });

  it("marca el lote como truncado en vez de cortar en silencio", async () => {
    // El orden es estable, asi que las empresas que caen fuera del tope no
    // rotan: no se procesan NUNCA. Que no sea invisible.
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    vi.mocked(prisma.payrollConfig.count).mockResolvedValue(40 as never);

    const r = await PayrollAutoDraftService.runAutoDrafts("2026-08-16");
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(40);
  });

  it("no llama a create si hoy no cierra periodo", async () => {
    vi.mocked(prisma.payrollConfig.findMany).mockResolvedValue([config()] as never);
    const { results: res } = await PayrollAutoDraftService.runAutoDrafts("2026-08-20");
    expect(res[0].status).toBe("OMITIDA");
    expect(vi.mocked(PayrollRunService.create)).not.toHaveBeenCalled();
  });
});
