// src/lib/__tests__/prisma-errors.unbalanced.test.ts
//
// SPEC-001 (CA-6): el trigger de cuadre de la BD rechaza, al COMMIT, un asiento cuya suma no es 0
// con SQLSTATE 'CF001'. El error NO llega con una forma estable (Prisma no conoce ese código; con el
// adaptador de Neon viene anidado en `meta.driverAdapterError.cause`, con adapter-pg en `cause`):
// se detecta por el marcador `CF001`, que es lo único fiable (mismo criterio que
// `isExclusionViolation`, LL-014). Un test que fije UNA forma de error sería frágil: aquí se prueban
// todas las que pueden llegar.
//
// Environment: node

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { isUnbalancedEntryError, mapPrismaError } from "@/lib/prisma-errors";
import { toActionError } from "@/lib/action-errors";

const MARKER_MESSAGE =
  "CF001: asiento descuadrado (transactionId=cmtx123, suma=-0.0001). Débitos y créditos deben ser iguales.";

const BUSINESS_MESSAGE =
  "El asiento no cuadra: débitos y créditos deben ser iguales. No se guardó ningún cambio.";

function knownRequest(code: string, meta: Record<string, unknown>, message = "raw query failed") {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "7.8.0",
    meta,
  });
}

describe("isUnbalancedEntryError", () => {
  it("detecta un Error plano con el marcador CF001 en el mensaje", () => {
    expect(isUnbalancedEntryError(new Error(MARKER_MESSAGE))).toBe(true);
  });

  // Forma MEDIDA contra Postgres real (Prisma 7.8 + adapter-pg, $transaction explícito y sentencia suelta):
  // un DriverAdapterError sin meta, con la información del motor en `cause`. Es la forma que entrega el
  // COMMIT diferido del trigger; si Prisma la cambia, este test debe romperse antes que producción.
  it("detecta la forma real medida con Prisma 7.8: DriverAdapterError con cause { code, originalCode, kind }", () => {
    class DriverAdapterError extends Error {
      cause: unknown;
      constructor(message: string, cause: unknown) {
        super(message);
        this.name = "DriverAdapterError";
        this.cause = cause;
      }
    }
    const err = new DriverAdapterError(MARKER_MESSAGE, {
      originalCode: "CF001",
      originalMessage: MARKER_MESSAGE,
      kind: "postgres",
      code: "CF001",
      severity: "ERROR",
      message: MARKER_MESSAGE,
      detail: undefined,
      column: undefined,
      hint: undefined,
    });
    expect(isUnbalancedEntryError(err)).toBe(true);
    expect(mapPrismaError(err)).toBe(BUSINESS_MESSAGE);
  });

  // Límite conocido (no es un bug del detector): una escritura anidada SUELTA, fuera de un $transaction,
  // usa una transacción implícita cuyo COMMIT falla y Prisma lo oculta tras un P2028 genérico; el error
  // del trigger ya no viaja en el objeto. Debe seguir cayendo al mensaje genérico (fail-closed), no al de
  // asiento descuadrado, porque un P2028 puede tener otras causas.
  it("un P2028 de Prisma (commit ya cerrado) NO se confunde con un asiento descuadrado", () => {
    const p2028 = knownRequest(
      "P2028",
      { modelName: "Transaction" },
      "Transaction API error: Transaction already closed: A rollback cannot be executed on a committed transaction."
    );
    expect(isUnbalancedEntryError(p2028)).toBe(false);
  });

  it("detecta PrismaClientKnownRequestError P2010 con el texto de Postgres en meta.message", () => {
    expect(isUnbalancedEntryError(knownRequest("P2010", { message: MARKER_MESSAGE }))).toBe(true);
  });

  it("detecta la forma de Prisma 7.8 + adaptador de Neon: meta.driverAdapterError.cause", () => {
    const err = knownRequest("P2010", {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "postgres", code: "CF001", originalMessage: MARKER_MESSAGE },
      },
    });
    expect(isUnbalancedEntryError(err)).toBe(true);
  });

  it("detecta el SQLSTATE CF001 en `code` de un error del driver (adapter-pg) anidado en `cause`", () => {
    const pgError = Object.assign(new Error("trigger"), { code: "CF001" });
    const wrapped = new Error("Transaction failed", { cause: pgError });
    expect(isUnbalancedEntryError(wrapped)).toBe(true);
  });

  it("detecta la forma desconocida con el marcador más profundo (hasta 5 niveles)", () => {
    const deep = { a: { b: { c: { d: { message: MARKER_MESSAGE } } } } };
    expect(isUnbalancedEntryError(Object.assign(new Error("x"), { meta: deep }))).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["un string", "algo"],
    ["un Error cualquiera", new Error("Stock insuficiente")],
    ["un P2002", knownRequest("P2002", { target: ["companyId", "number"] })],
    [
      "otro SQLSTATE parecido",
      Object.assign(new Error("exclusion"), { code: "23P01", message: "PayrollRun_no_overlap" }),
    ],
    [
      "un objeto con ciclo sin marcador",
      (() => {
        const o: Record<string, unknown> = { message: "x" };
        o.self = o;
        return o;
      })(),
    ],
  ])("NO confunde %s con un asiento descuadrado", (_n, err) => {
    expect(isUnbalancedEntryError(err)).toBe(false);
  });

  it("no se cuelga con referencias circulares aunque haya marcador", () => {
    const o: Record<string, unknown> = { message: MARKER_MESSAGE };
    o.self = o;
    expect(isUnbalancedEntryError(o)).toBe(true);
  });
});

describe("mapPrismaError / toActionError — mensaje de negocio para el asiento descuadrado (CA-6)", () => {
  it("mapPrismaError devuelve el mensaje de negocio, nunca el texto crudo de Postgres", () => {
    const msg = mapPrismaError(knownRequest("P2010", { message: MARKER_MESSAGE }));
    expect(msg).toBe(BUSINESS_MESSAGE);
    expect(msg).not.toContain("CF001");
    expect(msg).not.toContain("transactionId");
  });

  it("también cuando llega como Error plano o con la forma del adaptador de Neon", () => {
    expect(mapPrismaError(new Error(MARKER_MESSAGE))).toBe(BUSINESS_MESSAGE);
    expect(
      mapPrismaError(
        knownRequest("P2010", {
          driverAdapterError: { cause: { code: "CF001", originalMessage: MARKER_MESSAGE } },
        })
      )
    ).toBe(BUSINESS_MESSAGE);
  });

  it("toActionError lo entrega como { success: false, error } con el mensaje de negocio", () => {
    expect(toActionError(new Error(MARKER_MESSAGE))).toEqual({
      success: false,
      error: BUSINESS_MESSAGE,
    });
  });

  it("no altera el mapeo de los demás errores (regresión)", () => {
    expect(mapPrismaError(knownRequest("P2002", {}))).toBe("Ya existe un registro con esos datos");
    expect(mapPrismaError(new Error("Stock insuficiente: disponible 3, solicitado 5"))).toBe(
      "Stock insuficiente: disponible 3, solicitado 5"
    );
  });
});
