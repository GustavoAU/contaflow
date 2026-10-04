import { describe, expect, it } from "vitest";

import { createLoanSchema } from "../schemas/employee-loan.schema";

// totalAmount se validaba con parseFloat: "12abc" pasaba (parseFloat → 12) y recién
// fallaba más adentro, en new Decimal(). Ahora la validación es estricta (R-5).
const base = {
  employeeId: "emp_1",
  currency: "VES" as const,
  installments: 12,
};

const msgOf = (totalAmount: string) => {
  const r = createLoanSchema.safeParse({ ...base, totalAmount });
  return r.success ? null : r.error.issues.map((i) => i.message);
};

describe("createLoanSchema.totalAmount", () => {
  it.each(["1000", "1000.50", "0.01"])("acepta %j", (v) => {
    expect(msgOf(v)).toBeNull();
  });

  it.each(["0", "0.00", "-5", "abc", "12abc", "0x64", "1e3", "100,50"])("rechaza %j", (v) => {
    expect(msgOf(v)).toContain("El monto debe ser mayor que cero.");
  });

  it("vacío conserva su mensaje propio", () => {
    expect(msgOf("")).toContain("Ingrese el monto total.");
  });
});
