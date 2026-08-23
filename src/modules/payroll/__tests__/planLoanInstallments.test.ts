// src/modules/payroll/__tests__/planLoanInstallments.test.ts
//
// Fase 1 del rediseño de préstamos en nómina. Estos tests son la red que faltaba
// cuando la lógica estaba escrita tres veces (inyección de la cuota, aprobación,
// y un applyInstallments muerto) y las tres habían divergido.
//
// Reglas de negocio que fijan (Gustavo, 2026-08-23):
//   - La cuota se cobra SIEMPRE en la moneda del préstamo.
//   - Un préstamo en USD sólo puede descontarse si el recibo puede expresar
//     dólares; si no, se omite. Omitir es correcto, cobrar mal no.
//   - Un préstamo del que no se cobró nada NUNCA queda marcado como pagado.

import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { planLoanInstallments, type LoanForPlanning } from "../services/EmployeeLoanService";

/** Préstamo en USD tal como lo escribe EmployeeLoanService.create. */
function usdLoan(over: Partial<LoanForPlanning> = {}): LoanForPlanning {
  return {
    id: "loan-usd",
    currency: "USD",
    installmentAmount: "0",
    remainingBalance: "0",
    installmentAmountUsd: "250.00",
    remainingBalanceUsd: "2500.00",
    paidInstallments: 2,
    ...over,
  };
}

function vesLoan(over: Partial<LoanForPlanning> = {}): LoanForPlanning {
  return {
    id: "loan-ves",
    currency: "VES",
    installmentAmount: "750.00",
    remainingBalance: "4500.00",
    installmentAmountUsd: null,
    remainingBalanceUsd: null,
    paidInstallments: 0,
    ...over,
  };
}

describe("préstamo en USD — el bug que no cobraba nada", () => {
  it("se descuenta de las columnas USD cuando el sueldo es en USD", () => {
    const [plan] = planLoanInstallments([usdLoan()], "USD");
    expect(plan.currency).toBe("USD");
    expect(plan.lineAmount.toFixed(2)).toBe("250.00");
    expect(plan.newBalanceUsd?.toFixed(2)).toBe("2250.00");
    expect(plan.isPaid).toBe(false);
  });

  it("NO queda marcado como pagado sin haberse cobrado", () => {
    // Antes: balance VES = 0 -> isPaid = 0.isZero() && !undefined = true.
    // El préstamo pasaba a PAID con una cuota más contada y saldo USD intacto.
    const plans = planLoanInstallments([usdLoan()], "VES");
    expect(plans).toHaveLength(0); // ni siquiera entra al plan
  });

  it("se omite si el recibo va en bolívares — no se cobra en la moneda equivocada", () => {
    expect(planLoanInstallments([usdLoan()], "VES")).toHaveLength(0);
  });

  it("la última cuota no puede cobrar más que el saldo", () => {
    const [plan] = planLoanInstallments(
      [usdLoan({ remainingBalanceUsd: "100.00" })],
      "USD",
    );
    expect(plan.lineAmount.toFixed(2)).toBe("100.00");
    expect(plan.newBalanceUsd?.isZero()).toBe(true);
    expect(plan.isPaid).toBe(true);
  });
});

describe("préstamo en bolívares", () => {
  it("se descuenta de las columnas VES", () => {
    const [plan] = planLoanInstallments([vesLoan()], "VES");
    expect(plan.currency).toBe("VES");
    expect(plan.lineAmount.toFixed(2)).toBe("750.00");
    expect(plan.newBalanceVes.toFixed(2)).toBe("3750.00");
  });

  it("se omite si el recibo va en dólares", () => {
    expect(planLoanInstallments([vesLoan()], "USD")).toHaveLength(0);
  });

  it("queda pagado cuando el saldo llega a cero", () => {
    const [plan] = planLoanInstallments([vesLoan({ remainingBalance: "750.00" })], "VES");
    expect(plan.isPaid).toBe(true);
  });
});

describe("saldo agotado", () => {
  it("un préstamo sin saldo no entra al plan, en ninguna moneda", () => {
    expect(planLoanInstallments([usdLoan({ remainingBalanceUsd: "0" })], "USD")).toHaveLength(0);
    expect(planLoanInstallments([vesLoan({ remainingBalance: "0" })], "VES")).toHaveLength(0);
  });

  it("un préstamo con cuota cero tampoco", () => {
    expect(planLoanInstallments([usdLoan({ installmentAmountUsd: "0" })], "USD")).toHaveLength(0);
  });

  it("los campos USD nulos no rompen el cálculo", () => {
    expect(planLoanInstallments(
      [usdLoan({ installmentAmountUsd: null, remainingBalanceUsd: null })],
      "USD",
    )).toHaveLength(0);
  });
});

describe("sueldo híbrido", () => {
  it("admite las dos monedas, cada préstamo en la suya", () => {
    const plans = planLoanInstallments([vesLoan(), usdLoan()], "MIXED");
    expect(plans).toHaveLength(2);
    expect(plans.find((p) => p.loanId === "loan-ves")!.currency).toBe("VES");
    expect(plans.find((p) => p.loanId === "loan-usd")!.currency).toBe("USD");
  });
});

describe("préstamo MIXTO — legado", () => {
  // Ya no se puede crear, pero las filas existentes deben seguir comportándose
  // igual que antes de este cambio.
  const mixed: LoanForPlanning = {
    id: "loan-mixed",
    currency: "MIXED",
    installmentAmount: "500.00",
    remainingBalance: "5000.00",
    installmentAmountUsd: "50.00",
    remainingBalanceUsd: "500.00",
    paidInstallments: 0,
  };

  it("cobra la cuota en bolívares y baja también el lado USD", () => {
    const [plan] = planLoanInstallments([mixed], "VES");
    expect(plan.lineAmount.toFixed(2)).toBe("500.00");
    expect(plan.newBalanceVes.toFixed(2)).toBe("4500.00");
    expect(plan.newBalanceUsd?.toFixed(2)).toBe("450.00");
    expect(plan.isPaid).toBe(false);
  });

  it("sólo se da por pagado cuando los DOS lados llegan a cero", () => {
    const [plan] = planLoanInstallments(
      [{ ...mixed, remainingBalance: "500.00", remainingBalanceUsd: "500.00" }],
      "VES",
    );
    expect(plan.newBalanceVes.isZero()).toBe(true);
    expect(plan.newBalanceUsd?.isZero()).toBe(false); // queda deuda en USD
    expect(plan.isPaid).toBe(false);
  });
});

describe("varios préstamos del mismo empleado", () => {
  it("cada uno aporta su cuota — el total es la suma", () => {
    const plans = planLoanInstallments(
      [vesLoan({ id: "a" }), vesLoan({ id: "b", installmentAmount: "250.00" })],
      "VES",
    );
    const total = plans.reduce((s, p) => s.plus(p.lineAmount), new Decimal(0));
    expect(total.toFixed(2)).toBe("1000.00");
  });

  it("el que no se puede cobrar no arrastra al que sí", () => {
    const plans = planLoanInstallments([usdLoan(), vesLoan()], "VES");
    expect(plans).toHaveLength(1);
    expect(plans[0].loanId).toBe("loan-ves");
  });
});
