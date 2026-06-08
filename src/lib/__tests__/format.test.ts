import { describe, it, expect } from "vitest";
import { formatAmount, fmtDate } from "../format";
import { fmtBs, fmtVen } from "../fmt-ven";
import { zMoneyAmount, zMoneyPositive } from "../zod-helpers";
import { mapPrismaError } from "../prisma-errors";
import { Prisma } from "@prisma/client";

describe("formatAmount", () => {
  it("formatea VES con separadores venezolanos", () => {
    expect(formatAmount("1234.56")).toBe("1.234,56");
  });

  it("formatea USD con separadores americanos", () => {
    expect(formatAmount("1234.56", "USD")).toBe("1,234.56");
  });

  it("formatea sin moneda usa VES", () => {
    expect(formatAmount(1000)).toBe("1.000,00");
  });

  it("devuelve '0,00' para NaN", () => {
    expect(formatAmount("abc")).toBe("0,00");
  });

  it("acepta moneda desconocida y usa VES", () => {
    expect(formatAmount("500.00", "EUR")).toBe("500,00");
  });
});

describe("fmtDate", () => {
  it("formatea fecha UTC correctamente en formato venezolano", () => {
    const result = fmtDate(new Date("2026-01-15T00:00:00Z"));
    expect(result).toContain("15");
    expect(result).toContain("1");
    expect(result).toContain("2026");
  });

  it("acepta string de fecha", () => {
    const result = fmtDate("2026-05-20");
    expect(result).toContain("20");
    expect(result).toContain("2026");
  });
});

describe("fmtBs", () => {
  it("formatea con prefijo Bs.", () => {
    expect(fmtBs("1000.00")).toBe("Bs. 1.000,00");
  });

  it("formatea valores negativos con paréntesis", () => {
    expect(fmtBs("-500.00")).toBe("Bs. (500,00)");
  });

  it("retorna '—' para null", () => {
    expect(fmtBs(null)).toBe("—");
  });

  it("retorna '—' para string vacío", () => {
    expect(fmtBs("")).toBe("—");
  });

  it("acepta decimales configurables", () => {
    expect(fmtBs("1234.5678", 4)).toBe("Bs. 1.234,5678");
  });
});

describe("fmtVen — valores edge", () => {
  it("retorna '—' para undefined", () => {
    expect(fmtVen(undefined)).toBe("—");
  });

  it("formatea número negativo con paréntesis", () => {
    expect(fmtVen(-100)).toBe("(100,00)");
  });
});

describe("zMoneyAmount — validaciones edge", () => {
  it("rechaza Infinity", () => {
    const result = zMoneyAmount.safeParse(Infinity);
    expect(result.success).toBe(false);
  });

  it("rechaza más de 2 decimales", () => {
    const result = zMoneyAmount.safeParse("1.234");
    expect(result.success).toBe(false);
  });

  it("rechaza valor negativo en zMoneyPositive", () => {
    const result = zMoneyPositive.safeParse("0");
    expect(result.success).toBe(false);
  });

  it("acepta valor válido en zMoneyAmount", () => {
    const result = zMoneyAmount.safeParse("100.50");
    expect(result.success).toBe(true);
  });
});

describe("mapPrismaError", () => {
  it("mapea P2002 a mensaje de unicidad", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "7.0.0",
    });
    expect(mapPrismaError(err)).toBe("Ya existe un registro con esos datos");
  });

  it("mapea P2003 a mensaje de referencia", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Foreign key", {
      code: "P2003",
      clientVersion: "7.0.0",
    });
    expect(mapPrismaError(err)).toBe("Datos de referencia inválidos");
  });

  it("devuelve mensaje amigable para errores de conexión/timeout", () => {
    const friendly = "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
    expect(mapPrismaError(new Error("timeout"))).toBe(friendly);
    expect(mapPrismaError(new Error("Connection terminated"))).toBe(friendly);
    expect(mapPrismaError(new Error("ECONNRESET"))).toBe(friendly);
  });

  it("devuelve message para errores genéricos no relacionados con conexión", () => {
    expect(mapPrismaError(new Error("validation failed"))).toBe("validation failed");
  });

  it("devuelve 'Error inesperado' para tipos desconocidos", () => {
    expect(mapPrismaError("algo raro")).toBe("Error inesperado");
  });
});
