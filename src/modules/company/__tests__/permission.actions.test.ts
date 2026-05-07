import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasBaseAccess, canAccessModule, toGrantSet } from "@/lib/app-modules";

// ─── Pruebas de lógica pura (sin BD, sin mocks complejos) ────────────────────

describe("hasBaseAccess", () => {
  it("OWNER tiene acceso base a todos los módulos", () => {
    expect(hasBaseAccess("OWNER", "accounting")).toBe(true);
    expect(hasBaseAccess("OWNER", "payroll")).toBe(true);
    expect(hasBaseAccess("OWNER", "reports")).toBe(true);
  });

  it("ACCOUNTANT tiene acceso base a accounting, invoicing, payroll, reports", () => {
    expect(hasBaseAccess("ACCOUNTANT", "accounting")).toBe(true);
    expect(hasBaseAccess("ACCOUNTANT", "invoicing")).toBe(true);
    expect(hasBaseAccess("ACCOUNTANT", "payroll")).toBe(true);
    expect(hasBaseAccess("ACCOUNTANT", "reports")).toBe(true);
  });

  it("ADMINISTRATIVE no tiene acceso base a accounting ni reports", () => {
    expect(hasBaseAccess("ADMINISTRATIVE", "accounting")).toBe(false);
    expect(hasBaseAccess("ADMINISTRATIVE", "reports")).toBe(false);
  });

  it("ADMINISTRATIVE tiene acceso base a invoicing, banking, inventory, orders", () => {
    expect(hasBaseAccess("ADMINISTRATIVE", "invoicing")).toBe(true);
    expect(hasBaseAccess("ADMINISTRATIVE", "banking")).toBe(true);
    expect(hasBaseAccess("ADMINISTRATIVE", "inventory")).toBe(true);
    expect(hasBaseAccess("ADMINISTRATIVE", "orders")).toBe(true);
  });

  it("VIEWER tiene acceso base solo a banking", () => {
    expect(hasBaseAccess("VIEWER", "banking")).toBe(true);
    expect(hasBaseAccess("VIEWER", "accounting")).toBe(false);
    expect(hasBaseAccess("VIEWER", "payroll")).toBe(false);
  });

  it("SENIAT tiene acceso base solo a reports", () => {
    expect(hasBaseAccess("SENIAT", "reports")).toBe(true);
    expect(hasBaseAccess("SENIAT", "accounting")).toBe(false);
  });
});

describe("canAccessModule", () => {
  it("devuelve true si el rol tiene acceso base", () => {
    const grants = new Set<string>();
    expect(canAccessModule("ACCOUNTANT", "accounting", grants)).toBe(true);
  });

  it("devuelve false si no tiene base ni grant", () => {
    const grants = new Set<string>();
    expect(canAccessModule("ADMINISTRATIVE", "accounting", grants)).toBe(false);
  });

  it("devuelve true si no tiene base pero sí grant", () => {
    const grants = new Set(["ADMINISTRATIVE:accounting"]);
    expect(canAccessModule("ADMINISTRATIVE", "accounting", grants)).toBe(true);
  });

  it("OWNER siempre tiene acceso independientemente de grants", () => {
    const grants = new Set<string>();
    expect(canAccessModule("OWNER", "reports", grants)).toBe(true);
  });

  it("ADMIN siempre tiene acceso independientemente de grants", () => {
    const grants = new Set<string>();
    expect(canAccessModule("ADMIN", "payroll", grants)).toBe(true);
  });
});

describe("toGrantSet", () => {
  it("convierte array de permisos a Set ROLE:module", () => {
    const rows = [
      { role: "ADMINISTRATIVE", module: "accounting" },
      { role: "VIEWER", module: "orders" },
    ];
    const set = toGrantSet(rows);
    expect(set.has("ADMINISTRATIVE:accounting")).toBe(true);
    expect(set.has("VIEWER:orders")).toBe(true);
    expect(set.has("ACCOUNTANT:payroll")).toBe(false);
  });

  it("devuelve Set vacío si no hay permisos", () => {
    const set = toGrantSet([]);
    expect(set.size).toBe(0);
  });
});
