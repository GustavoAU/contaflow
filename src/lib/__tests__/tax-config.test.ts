// src/lib/__tests__/tax-config.test.ts
// Q3-5: Tests para tax-config.ts + fiscal-provider.ts + fiscal-validators.ts

import { describe, it, expect } from "vitest";
import {
  getFiscalConfig,
  getTaxRates,
  VEN_RIF_REGEX,
  VEN_CONTROL_NUMBER_REGEX,
  SUPPORTED_COUNTRIES,
} from "../tax-config";
import { FiscalProviderFactory, VenezuelaFiscalProvider } from "../fiscal-provider";
import { validateVenezuelanRif, MAX_INVOICE_AMOUNT, CONTROL_NUMBER_REGEX } from "../fiscal-validators";

// ── getFiscalConfig ───────────────────────────────────────────────────────────

describe("getFiscalConfig", () => {
  it("retorna config VEN para 'VEN'", () => {
    const cfg = getFiscalConfig("VEN");
    expect(cfg.countryCode).toBe("VEN");
    expect(cfg.currency).toBe("VES");
    expect(cfg.taxIdLabel).toBe("RIF");
  });

  it("fallback defensivo a VEN para país desconocido", () => {
    const cfg = getFiscalConfig("COL");
    expect(cfg.countryCode).toBe("VEN");
  });

  it("fallback defensivo a VEN para string vacío", () => {
    const cfg = getFiscalConfig("");
    expect(cfg.countryCode).toBe("VEN");
  });
});

// ── getTaxRates ───────────────────────────────────────────────────────────────

describe("getTaxRates", () => {
  it("retorna alícuotas VEN correctas", () => {
    const rates = getTaxRates("VEN");
    expect(rates.ivaGeneral).toBe("0.16");
    expect(rates.ivaReduced).toBe("0.08");
    expect(rates.ivaLuxury).toBe("0.15");
    expect(rates.ivaCombined).toBe("0.31");
    expect(rates.igtf).toBe("0.03");
  });

  it("alícuotas son strings (R-5: no float)", () => {
    const rates = getTaxRates("VEN");
    for (const val of Object.values(rates)) {
      expect(typeof val).toBe("string");
    }
  });
});

// ── VEN_RIF_REGEX ─────────────────────────────────────────────────────────────

describe("VEN_RIF_REGEX", () => {
  it("acepta RIF válido con guión verificador", () => {
    expect(VEN_RIF_REGEX.test("J-12345678-9")).toBe(true);
  });

  it("acepta RIF válido sin guión verificador", () => {
    expect(VEN_RIF_REGEX.test("V-123456789")).toBe(true);
  });

  it("acepta prefijos G, E, C, P", () => {
    expect(VEN_RIF_REGEX.test("G-12345678-1")).toBe(true);
    expect(VEN_RIF_REGEX.test("E-12345678-2")).toBe(true);
    expect(VEN_RIF_REGEX.test("C-12345678-3")).toBe(true);
    expect(VEN_RIF_REGEX.test("P-12345678-4")).toBe(true);
  });

  it("acepta prefijos en minúscula (case-insensitive)", () => {
    expect(VEN_RIF_REGEX.test("j-12345678-9")).toBe(true);
  });

  it("rechaza RIF sin prefijo", () => {
    expect(VEN_RIF_REGEX.test("12345678-9")).toBe(false);
  });

  it("rechaza prefijo inválido", () => {
    expect(VEN_RIF_REGEX.test("X-12345678-9")).toBe(false);
  });

  it("rechaza RIF con menos de 8 dígitos", () => {
    expect(VEN_RIF_REGEX.test("J-1234567-9")).toBe(false);
  });
});

// ── VEN_CONTROL_NUMBER_REGEX ──────────────────────────────────────────────────

describe("VEN_CONTROL_NUMBER_REGEX", () => {
  it("acepta formato XX-XXXXXXXX", () => {
    expect(VEN_CONTROL_NUMBER_REGEX.test("00-00000001")).toBe(true);
    expect(VEN_CONTROL_NUMBER_REGEX.test("99-12345678")).toBe(true);
  });

  it("rechaza formato incorrecto", () => {
    expect(VEN_CONTROL_NUMBER_REGEX.test("0-00000001")).toBe(false);
    expect(VEN_CONTROL_NUMBER_REGEX.test("00-0000001")).toBe(false);
    expect(VEN_CONTROL_NUMBER_REGEX.test("AB-00000001")).toBe(false);
  });
});

// ── VenezuelaFiscalProvider ───────────────────────────────────────────────────

describe("VenezuelaFiscalProvider", () => {
  const provider = new VenezuelaFiscalProvider();

  it("validate RIF válido", () => {
    expect(provider.validateTaxId("J-12345678-9")).toBe(true);
  });

  it("rechaza RIF inválido", () => {
    expect(provider.validateTaxId("invalid")).toBe(false);
  });

  it("formatTaxId normaliza a mayúsculas", () => {
    expect(provider.formatTaxId("j-12345678-9")).toBe("J-12345678-9");
  });

  it("validateControlNumber acepta formato correcto", () => {
    expect(provider.validateControlNumber?.("00-00000001")).toBe(true);
  });

  it("getTaxRates retorna alícuotas VEN", () => {
    const rates = provider.getTaxRates();
    expect(rates.ivaGeneral).toBe("0.16");
  });
});

// ── FiscalProviderFactory ─────────────────────────────────────────────────────

describe("FiscalProviderFactory", () => {
  it("forCountry('VEN') retorna VenezuelaFiscalProvider", () => {
    const provider = FiscalProviderFactory.forCountry("VEN");
    expect(provider.countryCode).toBe("VEN");
  });

  it("forCountry fallback a VEN para país desconocido", () => {
    const provider = FiscalProviderFactory.forCountry("COL");
    expect(provider.countryCode).toBe("VEN");
  });

  it("ven() retorna provider VEN directamente", () => {
    const provider = FiscalProviderFactory.ven();
    expect(provider.taxIdLabel).toBe("RIF");
  });
});

// ── fiscal-validators.ts — compatibilidad backward ───────────────────────────

describe("fiscal-validators backward compat", () => {
  it("validateVenezuelanRif usa VEN_RIF_REGEX", () => {
    expect(validateVenezuelanRif("J-12345678-9")).toBe(true);
    expect(validateVenezuelanRif("invalid")).toBe(false);
  });

  it("CONTROL_NUMBER_REGEX re-exportado correctamente", () => {
    expect(CONTROL_NUMBER_REGEX.test("00-00000001")).toBe(true);
  });

  it("MAX_INVOICE_AMOUNT es string (R-5)", () => {
    expect(typeof MAX_INVOICE_AMOUNT).toBe("string");
    expect(MAX_INVOICE_AMOUNT).toBe("9999999999.9999");
  });
});

// ── SUPPORTED_COUNTRIES ───────────────────────────────────────────────────────

describe("SUPPORTED_COUNTRIES", () => {
  it("contiene VEN", () => {
    expect(SUPPORTED_COUNTRIES.some((c) => c.code === "VEN")).toBe(true);
  });

  it("VEN tiene nombre 'Venezuela'", () => {
    const ven = SUPPORTED_COUNTRIES.find((c) => c.code === "VEN");
    expect(ven?.name).toBe("Venezuela");
  });
});
