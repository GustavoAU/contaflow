import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { mapPrismaError, isPrismaError } from "@/lib/prisma-errors";

const GENERIC_DB_ERROR =
  "No se pudo completar la operación por un problema de base de datos. Intenta de nuevo; si el problema persiste, contacta al administrador.";

describe("mapPrismaError", () => {
  // ─── Fuga de errores técnicos de Postgres (HA-01b / R-4) ──────────────────────

  it("NO filtra 'permission denied for schema public' crudo — devuelve mensaje genérico en español", () => {
    const err = new Error("permission denied for schema public");
    const msg = mapPrismaError(err);
    expect(msg).toBe(GENERIC_DB_ERROR);
    expect(msg).not.toContain("permission denied");
    expect(msg).not.toContain("schema public");
  });

  it("oculta errores de SET LOCAL ROLE / set_config (RLS)", () => {
    expect(mapPrismaError(new Error('db error running "SET LOCAL ROLE authenticated"'))).toBe(
      GENERIC_DB_ERROR,
    );
    expect(mapPrismaError(new Error("error en set_config app.current_company_id"))).toBe(
      GENERIC_DB_ERROR,
    );
  });

  it("oculta errores de sintaxis SQL", () => {
    expect(mapPrismaError(new Error('syntax error at or near "SELECT"'))).toBe(GENERIC_DB_ERROR);
  });

  it("mapea P2010 (raw query failed) a mensaje genérico en español sin exponer el mensaje crudo", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Raw query failed. Code: 42501. Message: permission denied for schema public",
      { code: "P2010", clientVersion: "7.0.0" },
    );
    const msg = mapPrismaError(err);
    expect(msg).toBe(GENERIC_DB_ERROR);
    expect(msg).not.toContain("permission denied");
    expect(msg).not.toContain("42501");
  });

  // ─── Errores de negocio (español) deben pasar sin alterarse ───────────────────

  it("deja pasar el mensaje de un error de negocio en español", () => {
    const msg = "El monto del pago excede el saldo pendiente de la factura";
    expect(mapPrismaError(new Error(msg))).toBe(msg);
  });

  it("deja pasar 'La factura está anulada' sin ocultarlo", () => {
    expect(mapPrismaError(new Error("La factura está anulada"))).toBe("La factura está anulada");
  });

  it("NO oculta un mensaje de negocio español que mencione 'permisos' (el keyword es el inglés 'permission denied')", () => {
    const msg = "Transacción bancaria no encontrada o sin permisos";
    expect(mapPrismaError(new Error(msg))).toBe(msg);
  });

  // ─── Códigos Prisma conocidos ─────────────────────────────────────────────────

  it("mapea P2002 (único) a mensaje en español", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
    });
    expect(mapPrismaError(err)).toBe("Ya existe un registro con esos datos");
  });

  it("mapea P2003 (FK) a mensaje en español", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "7.0.0",
    });
    expect(mapPrismaError(err)).toBe("Datos de referencia inválidos");
  });

  // ─── Conexión / timeout ───────────────────────────────────────────────────────

  it("mapea errores de conexión/timeout a mensaje de reintento", () => {
    expect(mapPrismaError(new Error("connection timeout"))).toContain("tardó en responder");
  });

  // ─── No-Error ─────────────────────────────────────────────────────────────────

  it("devuelve mensaje genérico para valores no-Error", () => {
    expect(mapPrismaError("string suelto")).toBe("Error inesperado");
    expect(mapPrismaError(null)).toBe("Error inesperado");
  });
});

describe("isPrismaError", () => {
  it("identifica el código exacto", () => {
    const err = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "7.0.0" });
    expect(isPrismaError(err, "P2002")).toBe(true);
    expect(isPrismaError(err, "P2003")).toBe(false);
    expect(isPrismaError(new Error("x"), "P2002")).toBe(false);
  });
});
