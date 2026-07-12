// src/lib/__tests__/zod-helpers.business-date.test.ts
// Regresión auditoría Compras/Ventas 2026-07 (H-1/H-2): un año con typo ("12026")
// pasaba Date.parse / z.coerce.date(), se persistía, y al releerse desde Neon
// producía Invalid Date → RangeError en .toISOString() → listado completo caído.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zBusinessDate, zBusinessDateString } from "@/lib/zod-helpers";

describe("zBusinessDate (coerce → Date acotado)", () => {
  it("acepta fechas normales de negocio", () => {
    expect(zBusinessDate().safeParse("2026-03-12").success).toBe(true);
    expect(zBusinessDate().safeParse(new Date("2026-03-12")).success).toBe(true);
    expect(zBusinessDate().safeParse("1950-01-01").success).toBe(true);
    expect(zBusinessDate().safeParse("2099-12-31").success).toBe(true);
  });

  it("H-1: rechaza el typo de año 12026 (el caso real de la auditoría)", () => {
    const r = zBusinessDate().safeParse("12026-03-12");
    expect(r.success).toBe(false);
  });

  it("rechaza años fuera del rango [1900, 2100]", () => {
    expect(zBusinessDate().safeParse("1899-12-31").success).toBe(false);
    expect(zBusinessDate().safeParse("2101-01-01").success).toBe(false);
    expect(zBusinessDate().safeParse("0999-05-05").success).toBe(false);
  });

  it("rechaza basura no-fecha", () => {
    expect(zBusinessDate().safeParse("no-es-fecha").success).toBe(false);
    expect(zBusinessDate().safeParse("").success).toBe(false);
  });

  it("respeta el mensaje de error custom del call site", () => {
    const r = zBusinessDate({ error: "Fecha de adquisición requerida" }).safeParse(undefined);
    expect(r.success).toBe(false);
  });

  it("output es Date (drop-in de z.coerce.date)", () => {
    const r = zBusinessDate().safeParse("2026-03-12");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBeInstanceOf(Date);
  });
});

describe("zBusinessDateString (string validado, sin transformar)", () => {
  it("acepta fechas normales y preserva el string", () => {
    const r = zBusinessDateString.safeParse("2026-03-12");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("2026-03-12");
  });

  it("H-1: rechaza el typo de año 12026", () => {
    expect(zBusinessDateString.safeParse("12026-03-12").success).toBe(false);
  });

  it("rechaza años fuera de rango y strings vacíos", () => {
    expect(zBusinessDateString.safeParse("2101-01-01").success).toBe(false);
    expect(zBusinessDateString.safeParse("1899-01-01").success).toBe(false);
    expect(zBusinessDateString.safeParse("").success).toBe(false);
    expect(zBusinessDateString.safeParse("garbage").success).toBe(false);
  });

  it("permite '' solo cuando el call site lo compone explícitamente (patrón opcional)", () => {
    const optional = zBusinessDateString.or(z.literal("")).optional();
    expect(optional.safeParse("").success).toBe(true);
    expect(optional.safeParse(undefined).success).toBe(true);
    expect(optional.safeParse("2026-05-01").success).toBe(true);
    expect(optional.safeParse("12026-05-01").success).toBe(false);
  });
});
