import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { mapPrismaError, isPrismaError, p2002TargetIncludes } from "@/lib/prisma-errors";

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

  it("oculta el error de cuota de cómputo de Neon (infra) — no lo filtra crudo ni en inglés", () => {
    const msg = mapPrismaError(
      new Error(
        "Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.",
      ),
    );
    expect(msg).toBe(GENERIC_DB_ERROR);
    expect(msg).not.toContain("quota");
    expect(msg).not.toContain("Upgrade your plan");
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

// ─── p2002TargetIncludes ──────────────────────────────────────────────────────
//
// Decide QUÉ constraint chocó cuando un modelo tiene varios `@@unique`. De esta
// función cuelgan dos contratos de usuario:
//   1. La recuperación TOCTOU de idempotencia (ExpenseService / InventoryOperations):
//      si devuelve `false` de más, el perdedor de la carrera recibe un error en vez
//      de su fila; si devuelve `true` de más, se le devuelve la fila EQUIVOCADA.
//   2. El mensaje de `createPayrollRunAction`, que hoy tiene tres ramas.
//
// `meta.target` NO tiene forma estable: el adaptador de Neon lo parsea del DETAIL
// de Postgres, así que con `@@unique` compuesto llega como ARRAY y en otros drivers
// podría llegar como string. Ambas formas se prueban aquí.

function p2002(target: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: target === undefined ? {} : { target },
  });
}

describe("p2002TargetIncludes", () => {
  // ── target ARRAY (la forma real con el adaptador de Neon) ───────────────────

  it("array que contiene la columna → true", () => {
    expect(p2002TargetIncludes(p2002(["companyId", "idempotencyKey"]), "idempotencyKey")).toBe(true);
    // La otra columna del mismo compuesto también matchea — es un OR de columnas
    expect(p2002TargetIncludes(p2002(["companyId", "idempotencyKey"]), "companyId")).toBe(true);
  });

  it("array que NO contiene la columna → false", () => {
    // El caso que motivó el helper: PayrollRun tiene DOS @@unique compuestos.
    const delPeriodo = p2002(["companyId", "periodStart", "periodEnd"]);
    expect(p2002TargetIncludes(delPeriodo, "idempotencyKey")).toBe(false);
    expect(p2002TargetIncludes(delPeriodo, "periodStart")).toBe(true);
  });

  it("array vacío → false", () => {
    expect(p2002TargetIncludes(p2002([]), "idempotencyKey")).toBe(false);
  });

  it("compara la columna COMPLETA, no por prefijo/substring", () => {
    // Si alguien cambia el `===` por un `.includes()` de string, esto pasa a true
    // y el catch de idempotencia se dispararía con el constraint equivocado.
    expect(p2002TargetIncludes(p2002(["idempotencyKeyHash"]), "idempotencyKey")).toBe(false);
    expect(p2002TargetIncludes(p2002(["idempotency"]), "idempotencyKey")).toBe(false);
  });

  it("normaliza entradas no-string del array (String(c)) sin reventar", () => {
    expect(p2002TargetIncludes(p2002([null, 42]), "idempotencyKey")).toBe(false);
    expect(p2002TargetIncludes(p2002([42]), "42")).toBe(true);
  });

  // ── target STRING (forma defensiva para otros drivers) ─────────────────────

  it("string de una sola columna → true", () => {
    expect(p2002TargetIncludes(p2002("idempotencyKey"), "idempotencyKey")).toBe(true);
  });

  it("string separado por comas SIN espacio → true", () => {
    expect(p2002TargetIncludes(p2002("companyId,idempotencyKey"), "idempotencyKey")).toBe(true);
  });

  it("string que NO contiene la columna → false", () => {
    expect(p2002TargetIncludes(p2002("companyId,periodStart,periodEnd"), "idempotencyKey")).toBe(false);
  });

  // REGRESIÓN BUG-1 (CERRADO): el split usaba `/[,s]+/` en vez de `/[,s]+/`.
  // el split usa `/[,s]+/`, no `/[,\s]+/`. Se perdió la barra invertida, así que
  // la clase de caracteres es «coma o la letra s» en vez de «coma o espacio».
  // Consecuencias medidas con node:
  //   "companyId, idempotencyKey".split(/[,s]+/) → ["companyId"," idempotencyKey"] → false
  //   "sku".split(/[,s]+/)                       → ["","ku"]                       → false
  // El primero es EXACTAMENTE el formato del DETAIL de Postgres
  // (`Key (companyId, idempotencyKey)=(...)`) — el único motivo por el que la
  // rama string existe. Hoy la rama string es letra muerta salvo sin espacios.
  // Riesgo real bajo (con el adaptador de Neon el target llega como array), pero
  // el día que se cambie de driver la idempotencia deja de recuperar en silencio.
  // Arreglado quitando el regex de en medio: ahora parte por coma y recorta.
  // Un escape que se pierde no lo ve ni el tipo ni el compilador — el reemplazo
  // `"\s"` -> `"s"` en una cadena JS es literalmente `"s"`, asi que el primer
  // intento de arreglo fue un NO-OP que informo OK. Estos dos quedan de guardia.
  it("REGRESIÓN BUG-1: string 'companyId, idempotencyKey' (formato DETAIL de Postgres) debería dar true", () => {
    expect(p2002TargetIncludes(p2002("companyId, idempotencyKey"), "idempotencyKey")).toBe(true);
  });

  it("REGRESIÓN BUG-1: string con la letra 's' se parte por la mitad — 'sku' debería dar true", () => {
    expect(p2002TargetIncludes(p2002("sku"), "sku")).toBe(true);
  });

  // ── Fail-closed: sin target no se puede afirmar nada ────────────────────────

  it("P2002 sin `target` en meta → false (fail-closed)", () => {
    expect(p2002TargetIncludes(p2002(undefined), "idempotencyKey")).toBe(false);
  });

  it("P2002 sin `meta` → false (fail-closed)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
    });
    expect(p2002TargetIncludes(err, "idempotencyKey")).toBe(false);
  });

  it("target de tipo inesperado (objeto/número) → false", () => {
    expect(p2002TargetIncludes(p2002({ column: "idempotencyKey" }), "idempotencyKey")).toBe(false);
    expect(p2002TargetIncludes(p2002(7), "idempotencyKey")).toBe(false);
  });

  // ── No es P2002 / no es de Prisma ──────────────────────────────────────────

  it("otro código de Prisma con el target correcto → false", () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError("FK failed", {
      code: "P2003",
      clientVersion: "7.0.0",
      meta: { target: ["companyId", "idempotencyKey"] },
    });
    expect(p2002TargetIncludes(p2003, "idempotencyKey")).toBe(false);
    const p2034 = new Prisma.PrismaClientKnownRequestError("Write conflict", {
      code: "P2034",
      clientVersion: "7.0.0",
      meta: { target: ["idempotencyKey"] },
    });
    expect(p2002TargetIncludes(p2034, "idempotencyKey")).toBe(false);
  });

  it("error que no es de Prisma → false", () => {
    // Error corriente, incluso si su mensaje menciona P2002 y la columna
    expect(p2002TargetIncludes(new Error("P2002 idempotencyKey"), "idempotencyKey")).toBe(false);
    // Objeto que finge ser un error de Prisma (duck typing no basta)
    expect(
      p2002TargetIncludes({ code: "P2002", meta: { target: ["idempotencyKey"] } }, "idempotencyKey"),
    ).toBe(false);
    expect(p2002TargetIncludes(null, "idempotencyKey")).toBe(false);
    expect(p2002TargetIncludes(undefined, "idempotencyKey")).toBe(false);
    expect(p2002TargetIncludes("P2002", "idempotencyKey")).toBe(false);
  });
});
