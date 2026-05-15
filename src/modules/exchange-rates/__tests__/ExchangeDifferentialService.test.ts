// src/modules/exchange-rates/__tests__/ExchangeDifferentialService.test.ts
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  ExchangeDifferentialService,
  type FxDiffLine,
} from "../services/ExchangeDifferentialService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLine(
  invoiceType: "SALE" | "PURCHASE",
  outstandingForeign: number,
  originalRate: number,
  revalRate: number
): FxDiffLine {
  const outstanding = new Decimal(outstandingForeign);
  const orig = new Decimal(originalRate);
  const reval = new Decimal(revalRate);
  const vesAtOriginal = outstanding.times(orig).toDecimalPlaces(4);
  const vesAtReval = outstanding.times(reval).toDecimalPlaces(4);
  return {
    invoiceId: "inv-1",
    invoiceNumber: "F-001",
    invoiceType,
    currency: "USD",
    outstandingForeign: outstanding,
    originalRate: orig,
    revalRate: reval,
    vesAtOriginal,
    vesAtReval,
    differential: vesAtReval.minus(vesAtOriginal).toDecimalPlaces(4),
  };
}

// ─── aggregate() ─────────────────────────────────────────────────────────────

describe("ExchangeDifferentialService.aggregate", () => {
  it("SALE: rate increase → gain on CxC", () => {
    // Invoice 100 USD @ 40, revalued @ 45 → gain 500
    const line = makeLine("SALE", 100, 40, 45);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxGain.toFixed(2)).toBe("500.00");
    expect(summary.totalFxLoss.toFixed(2)).toBe("0.00");
    expect(summary.netCxCMovement.toFixed(2)).toBe("500.00");   // CxC Dr+500
    expect(summary.netCxPMovement.toFixed(2)).toBe("0.00");
  });

  it("SALE: rate decrease → loss on CxC", () => {
    // Invoice 100 USD @ 45, revalued @ 40 → loss 500
    const line = makeLine("SALE", 100, 45, 40);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxLoss.toFixed(2)).toBe("500.00");
    expect(summary.totalFxGain.toFixed(2)).toBe("0.00");
    expect(summary.netCxCMovement.toFixed(2)).toBe("-500.00"); // CxC Cr 500
  });

  it("PURCHASE: rate increase → loss on CxP (owe more VES)", () => {
    const line = makeLine("PURCHASE", 100, 40, 45);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxLoss.toFixed(2)).toBe("500.00");
    expect(summary.totalFxGain.toFixed(2)).toBe("0.00");
    expect(summary.netCxPMovement.toFixed(2)).toBe("500.00"); // CxP Cr 500 (liability ↑)
  });

  it("PURCHASE: rate decrease → gain on CxP (owe less VES)", () => {
    const line = makeLine("PURCHASE", 100, 45, 40);
    const summary = ExchangeDifferentialService.aggregate([line]);

    expect(summary.totalFxGain.toFixed(2)).toBe("500.00");
    expect(summary.totalFxLoss.toFixed(2)).toBe("0.00");
    expect(summary.netCxPMovement.toFixed(2)).toBe("-500.00"); // CxP Dr 500 (liability ↓)
  });

  it("GL invariant: netCxC + (-netCxP) + (-totalFxGain) + totalFxLoss = 0", () => {
    const lines = [
      makeLine("SALE", 100, 40, 45),    // gain 500 on CxC
      makeLine("PURCHASE", 50, 38, 45), // loss 350 on CxP
    ];
    const s = ExchangeDifferentialService.aggregate(lines);

    // CxC +500, CxP Cr(-350), FxGain Cr(-500), FxLoss Dr +350
    const gl = s.netCxCMovement
      .plus(s.netCxPMovement.negated())   // CxP entry is negated (liability Cr)
      .plus(s.totalFxGain.negated())
      .plus(s.totalFxLoss);

    expect(gl.toFixed(4)).toBe("0.0000");
  });

  it("mixed SALE gain + SALE loss nets correctly", () => {
    const lines = [
      makeLine("SALE", 100, 40, 45), // diff +500 (gain)
      makeLine("SALE", 80, 50, 45),  // diff -400 (loss)
    ];
    const s = ExchangeDifferentialService.aggregate(lines);

    expect(s.totalFxGain.toFixed(2)).toBe("500.00");
    expect(s.totalFxLoss.toFixed(2)).toBe("400.00");
    expect(s.netCxCMovement.toFixed(2)).toBe("100.00"); // 500 - 400
  });

  it("returns all zeros when lines is empty", () => {
    const s = ExchangeDifferentialService.aggregate([]);
    expect(s.totalFxGain.toFixed(2)).toBe("0.00");
    expect(s.totalFxLoss.toFixed(2)).toBe("0.00");
    expect(s.netCxCMovement.toFixed(2)).toBe("0.00");
    expect(s.netCxPMovement.toFixed(2)).toBe("0.00");
  });

  it("invoice with identical rates produces zero differential", () => {
    const line = makeLine("SALE", 100, 40, 40);
    expect(line.differential.toFixed(4)).toBe("0.0000");
    const s = ExchangeDifferentialService.aggregate([line]);
    expect(s.totalFxGain.toFixed(2)).toBe("0.00");
    expect(s.totalFxLoss.toFixed(2)).toBe("0.00");
  });
});
