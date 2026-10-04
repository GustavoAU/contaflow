// src/modules/inflation/services/__tests__/INPCService.runAdjustment.test.ts
//
// INPCService.runAdjustment no tenía test directo (la suite de actions mockea
// el servicio entero). Se agrega uno enfocado: el guard de cuentas ajenas
// (hallazgo MEDIUM del security-agent, 2026-09-05) corre ANTES de cualquier
// otra consulta, así que un tx mínimo basta para probar el rechazo.

import { describe, it, expect, vi } from "vitest";
import { Decimal } from "decimal.js";
import { INPCService } from "../INPCService";

describe("INPCService.runAdjustment — guard de cuenta ajena", () => {
  it("RECHAZA si adjustmentAccountId o repomoAccountId no pertenecen a esta empresa", async () => {
    const tx = { account: { findMany: vi.fn().mockResolvedValue([]) } };

    await expect(
      INPCService.runAdjustment(
        {
          companyId: "company-1",
          periodYear: 2026,
          periodMonth: 8,
          adjustmentAccountId: "acc-ajena",
        } as never,
        "user-1",
        tx as never
      )
    ).rejects.toThrow(/no pertenece/);
  });
});

describe("INPCService.runAdjustment — ADR-058 asiento al céntimo", () => {
  it("ajustes con 4 decimales: líneas múltiplos de 0,01, Σ = 0, residuo en la línea mayor + glRounding en el AuditLog, sin noAbsorb", async () => {
    const spy = vi.spyOn(INPCService, "previewAdjustment").mockResolvedValue({
      rows: [
        {
          accountId: "acc-1",
          accountCode: "1.2.1",
          accountName: "Activo 1",
          accountType: "ASSET",
          originalBalance: new Decimal("1000"),
          cumulativeIndex: new Decimal("1.01"),
          adjustmentAmount: new Decimal("10.004"),
          periodInpc: new Decimal("101"),
          baseInpc: new Decimal("100"),
        },
        {
          accountId: "acc-2",
          accountCode: "1.2.2",
          accountName: "Activo 2",
          accountType: "ASSET",
          originalBalance: new Decimal("1000"),
          cumulativeIndex: new Decimal("1.01"),
          adjustmentAmount: new Decimal("10.004"),
          periodInpc: new Decimal("101"),
          baseInpc: new Decimal("100"),
        },
      ],
      repomo: null,
    } as never);
    const txCreate = vi.fn().mockResolvedValue({ id: "gl-1" });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      account: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id }))
        ),
      },
      inflationAdjustment: {
        count: vi.fn().mockResolvedValue(0),
        createMany: vi.fn().mockResolvedValue({}),
      },
      company: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ inflationBaseYear: 2025, inflationBaseMonth: 1 }),
      },
      transaction: { count: vi.fn().mockResolvedValue(0), create: txCreate },
      auditLog: { create: auditCreate },
    };

    await INPCService.runAdjustment(
      {
        companyId: "company-1",
        periodYear: 2026,
        periodMonth: 8,
        adjustmentAccountId: "acc-adj",
      } as never,
      "user-1",
      tx as never
    );
    spy.mockRestore();

    const lines = txCreate.mock.calls[0]![0].data.entries.create as {
      accountId: string;
      amount: Decimal;
    }[];
    expect(lines).toHaveLength(3);
    expect(lines.reduce((a, l) => a.plus(l.amount), new Decimal(0)).isZero()).toBe(true);
    for (const l of lines) {
      expect(l.amount.equals(l.amount.toDecimalPlaces(2))).toBe(true);
      expect("noAbsorb" in l).toBe(false);
    }
    // 10.004 → 10.00 (×2); la contrapartida −20.008 → −20.01 absorbe el residuo de −0,01
    expect(lines.find((l) => l.accountId === "acc-adj")!.amount.toFixed(2)).toBe("-20.00");

    const audit = auditCreate.mock.calls[0]![0].data.newValue;
    expect(audit.glRounding).toMatchObject({ residual: "-0.01", absorbedIndex: 2, scale: 2 });
  });
});
