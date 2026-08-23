// @vitest-environment jsdom

// src/modules/payroll/__tests__/LoanTable.test.tsx
// Punto 10 del handoff de UI. Lo que se fija aquí es la regla de montos:
//
// Un préstamo en USD guarda 0 en las columnas VES y el valor real en las USD
// (EmployeeLoanService.create). El render anterior pintaba una rama u otra, así
// que en cuanto la que tocaba venía nula la celda quedaba EN BLANCO — que es lo
// que el handoff reporta de producción ("MONTO, CUOTA y SALDO están vacías").
// Ninguna combinación puede volver a producir una celda vacía.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { EmployeeLoanRow } from "../services/EmployeeLoanService";

vi.mock("../actions/employee-loan.actions", () => ({
  cancelLoanAction: vi.fn(),
  approveLoanAction: vi.fn(),
  rejectLoanAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../components/CreateLoanForm", () => ({ default: () => null }));

import LoanTable from "../components/LoanTable";

const BASE: EmployeeLoanRow = {
  id: "loan-1",
  companyId: "co-1",
  employeeId: "emp-1",
  employeeName: "Alejandro Blanco",
  totalAmount: "0",
  currency: "USD",
  installments: 12,
  installmentAmount: "0",
  paidInstallments: 2,
  remainingBalance: "0",
  amountUsd: "1200.00",
  installmentAmountUsd: "100.00",
  remainingBalanceUsd: "1000.00",
  interestRate: null,
  status: "ACTIVE",
  approvedByUserId: "u-1",
  approvedAt: "2026-07-15T00:00:00.000Z",
  rejectionReason: null,
  description: null,
  createdByUserId: "u-1",
  createdAt: "2026-07-15T00:00:00.000Z",
};

function renderTable(loans: EmployeeLoanRow[], props: Partial<React.ComponentProps<typeof LoanTable>> = {}) {
  return render(
    <LoanTable
      companyId="co-1"
      initialLoans={loans}
      employees={[{ id: "emp-1", name: "Alejandro Blanco" }]}
      isAdmin
      {...props}
    />
  );
}

function bodyCells() {
  const rows = screen.getAllByRole("row");
  // rows[0] es la cabecera
  return within(rows[1]).getAllByRole("cell");
}

describe("LoanTable — ninguna celda de dinero queda vacía", () => {
  it("préstamo en USD: los importes salen de las columnas USD", () => {
    renderTable([BASE]);
    const cells = bodyCells();
    expect(cells[1].textContent).toMatch(/1\.200/); // MONTO
    expect(cells[3].textContent).toMatch(/100/);    // CUOTA
    expect(cells[4].textContent).toMatch(/1\.000/); // SALDO
  });

  it("préstamo en USD con las columnas USD nulas: no deja la celda en blanco", () => {
    renderTable([{ ...BASE, amountUsd: null, installmentAmountUsd: null, remainingBalanceUsd: null }]);
    const cells = bodyCells();
    for (const i of [1, 3, 4]) {
      expect(cells[i].textContent?.trim()).not.toBe("");
    }
  });

  it("préstamo en VES: usa las columnas VES", () => {
    renderTable([{
      ...BASE, currency: "VES", totalAmount: "4500.00",
      installmentAmount: "750.00", remainingBalance: "1500.00",
      amountUsd: null, installmentAmountUsd: null, remainingBalanceUsd: null,
    }]);
    const cells = bodyCells();
    expect(cells[1].textContent).toMatch(/4\.500/);
    expect(cells[4].textContent).toMatch(/1\.500/);
  });

  it("préstamo MIXTO: muestra las dos monedas, no una sola", () => {
    renderTable([{ ...BASE, currency: "MIXED", totalAmount: "4500.00", amountUsd: "100.00" }]);
    const monto = bodyCells()[1].textContent ?? "";
    expect(monto).toMatch(/4\.500/);
    expect(monto).toMatch(/100/);
  });
});

describe("LoanTable — estructura", () => {
  it("la columna de acciones tiene su th", () => {
    renderTable([BASE]);
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeTruthy();
  });

  it("el estado pasa por StatusBadge, no por una paleta local", () => {
    renderTable([BASE]);
    expect(screen.getByText("Activo")).toBeTruthy();
  });

  it("scope employee muestra CONCEPTO en vez de EMPLEADO", () => {
    renderTable([BASE], { scope: "employee" });
    expect(screen.getByRole("columnheader", { name: /concepto/i })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /empleado/i })).toBeNull();
  });

  it("scope company mantiene la columna EMPLEADO", () => {
    renderTable([BASE]);
    expect(screen.getByRole("columnheader", { name: /empleado/i })).toBeTruthy();
  });

  it("el progreso de cuotas es accesible", () => {
    renderTable([BASE]);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("17"); // 2 de 12
  });

  it("sin préstamos muestra el estado vacío, no una tabla", () => {
    renderTable([]);
    expect(screen.getByText("Sin préstamos registrados")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
