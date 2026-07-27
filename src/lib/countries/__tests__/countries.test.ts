// src/lib/countries/__tests__/countries.test.ts
// ADR-042 MP-2 — Registry multi-país: contratos que debe cumplir CUALQUIER país
// que se registre, no solo Venezuela.

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  FISCAL_CONFIGS,
  FiscalProviderFactory,
  SUPPORTED_COUNTRIES,
  VEN_FISCAL_CONFIG,
  getFiscalConfig,
  getTaxLineRate,
  getTaxRates,
  hasCapability,
  isSupportedCountry,
  memoizePerCountry,
  toClientFiscalConfig,
  type CountryCode,
  type FiscalCapabilities,
} from "../index";

const ALL_COUNTRIES = Object.keys(FISCAL_CONFIGS) as CountryCode[];

// ── Contratos que aplican a todo país registrado ─────────────────────────────

describe.each(ALL_COUNTRIES)("contrato de FiscalConfig — %s", (code) => {
  const cfg = FISCAL_CONFIGS[code];

  it("countryCode coincide con su clave en el registry", () => {
    expect(cfg.countryCode).toBe(code);
  });

  it("declara moneda, locale, símbolo y autoridad fiscal", () => {
    expect(cfg.currency).toMatch(/^[A-Z]{3}$/); // ISO 4217
    expect(cfg.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    expect(cfg.currencySymbol.length).toBeGreaterThan(0);
    expect(cfg.taxAuthorityName.length).toBeGreaterThan(0);
    expect(typeof cfg.negativeParens).toBe("boolean");
  });

  it("todas las alícuotas son strings decimales válidos (R-5: nunca float)", () => {
    for (const [key, value] of Object.entries(cfg.taxRates)) {
      expect(typeof value, `taxRates.${key}`).toBe("string");
      expect(new Decimal(value).isFinite(), `taxRates.${key}`).toBe(true);
    }
  });

  it("el placeholder del ID tributario cumple su propia regex", () => {
    expect(cfg.taxIdRegex.test(cfg.taxIdPlaceholder)).toBe(true);
  });

  it("las regex no son globales (evita estado compartido de lastIndex)", () => {
    expect(cfg.taxIdRegex.global).toBe(false);
    expect(cfg.taxIdRegex.sticky).toBe(false);
    if (cfg.controlNumberRegex) {
      expect(cfg.controlNumberRegex.global).toBe(false);
      expect(cfg.controlNumberRegex.sticky).toBe(false);
    }
  });

  it("defaultTaxLineType existe en taxLineRates", () => {
    expect(Object.keys(cfg.taxLineRates)).toContain(cfg.defaultTaxLineType);
  });

  it("cada taxLineRate tiene rate y percent coherentes entre sí", () => {
    for (const [key, info] of Object.entries(cfg.taxLineRates)) {
      // percent debe ser rate × 100 — si divergen, la UI muestra una tasa y el
      // servicio calcula otra
      expect(
        new Decimal(info.rate).times(100).toNumber(),
        `taxLineRates.${key}: rate=${info.rate} percent=${info.percent}`,
      ).toBe(new Decimal(info.percent).toNumber());
      expect(info.label.length).toBeGreaterThan(0);
    }
  });

  it("declara TODAS las capabilities (ninguna undefined)", () => {
    const required: Array<keyof FiscalCapabilities> = [
      "igtf",
      "inflationAdjustment",
      "ivaRetention",
      "islrRetention",
      "ivaDeclaration",
      "taxAuthorityReporting",
      "digitalInvoice",
      "fiscalCalendar",
      "specialContributor",
      "taxIdOnlineValidation",
      "payrollEngine",
    ];
    for (const cap of required) {
      expect(cfg.capabilities[cap], `capabilities.${cap}`).toBeDefined();
    }
  });

  it("tiene provider registrado y consistente con su config", () => {
    const provider = FiscalProviderFactory.forCountry(code);
    expect(provider.countryCode).toBe(code);
    expect(provider.currency).toBe(cfg.currency);
    expect(provider.taxIdLabel).toBe(cfg.taxIdLabel);
    expect(provider.validateTaxId(cfg.taxIdPlaceholder)).toBe(true);
  });

  it("aparece en SUPPORTED_COUNTRIES", () => {
    expect(SUPPORTED_COUNTRIES.some((c) => c.code === code)).toBe(true);
  });
});

// ── Lookup estricto (ADR-042 D-8) ────────────────────────────────────────────

describe("getFiscalConfig — lookup estricto", () => {
  it("resuelve un país soportado", () => {
    expect(getFiscalConfig("VEN").countryCode).toBe("VEN");
  });

  it("lanza con mensaje accionable para país no soportado", () => {
    expect(() => getFiscalConfig("COL")).toThrow(/País no soportado: "COL"/);
    expect(() => getFiscalConfig("COL")).toThrow(/VEN/); // lista los disponibles
  });

  it("lanza para vacío, basura y claves heredadas de Object", () => {
    expect(() => getFiscalConfig("")).toThrow();
    expect(() => getFiscalConfig("../etc")).toThrow();
    // hasOwnProperty evita que "constructor"/"toString" resuelvan a algo
    expect(() => getFiscalConfig("constructor")).toThrow(/País no soportado/);
    expect(() => getFiscalConfig("toString")).toThrow(/País no soportado/);
  });
});

describe("isSupportedCountry", () => {
  it("distingue países soportados de los que no", () => {
    expect(isSupportedCountry("VEN")).toBe(true);
    expect(isSupportedCountry("COL")).toBe(false);
    expect(isSupportedCountry("")).toBe(false);
    expect(isSupportedCountry("ven")).toBe(false); // case-sensitive
  });
});

// ── Accesores ─────────────────────────────────────────────────────────────────

describe("getTaxRates", () => {
  it("devuelve las alícuotas del país", () => {
    expect(getTaxRates("VEN").ivaGeneral).toBe("0.16");
  });
});

describe("getTaxLineRate", () => {
  it("devuelve la alícuota de línea por clave del enum TaxLineType", () => {
    expect(getTaxLineRate(VEN_FISCAL_CONFIG, "IVA_GENERAL").percent).toBe("16");
  });

  it("lanza si el país no define esa alícuota", () => {
    expect(() => getTaxLineRate(VEN_FISCAL_CONFIG, "IVA_INEXISTENTE")).toThrow(
      /no definida para VEN/,
    );
  });
});

describe("hasCapability", () => {
  it("responde según las capabilities del país", () => {
    expect(hasCapability("VEN", "igtf")).toBe(true);
    expect(hasCapability("VEN", "ivaRetention")).toBe(true);
  });

  it("payrollEngine no nulo cuenta como capability activa", () => {
    expect(hasCapability("VEN", "payrollEngine")).toBe(true);
  });
});

// ── Proyección al cliente (ADR-042 D-3) ──────────────────────────────────────

describe("toClientFiscalConfig", () => {
  const client = toClientFiscalConfig(VEN_FISCAL_CONFIG);

  it("es serializable — cruza la frontera RSC sin perder datos", () => {
    const roundTrip = JSON.parse(JSON.stringify(client));
    expect(roundTrip).toEqual(client);
  });

  it("no contiene ninguna RegExp (no cruzan a componentes cliente)", () => {
    const hasRegExp = (v: unknown): boolean => {
      if (v instanceof RegExp) return true;
      if (v && typeof v === "object") return Object.values(v).some(hasRegExp);
      return false;
    };
    expect(hasRegExp(client)).toBe(false);
  });

  it("los patterns reconstruyen regex equivalentes a las del servidor", () => {
    const taxId = new RegExp(client.taxIdPattern, "i");
    expect(taxId.test("J-12345678-9")).toBe(VEN_FISCAL_CONFIG.taxIdRegex.test("J-12345678-9"));
    expect(taxId.test("J-12345678")).toBe(VEN_FISCAL_CONFIG.taxIdRegex.test("J-12345678"));

    expect(client.controlNumberPattern).toBeDefined();
    const control = new RegExp(client.controlNumberPattern!);
    expect(control.test("00-00000001")).toBe(true);
    expect(control.test("0-1")).toBe(false);
  });

  it("preserva alícuotas, capabilities y datos de presentación", () => {
    expect(client.taxRates).toEqual(VEN_FISCAL_CONFIG.taxRates);
    expect(client.capabilities).toEqual(VEN_FISCAL_CONFIG.capabilities);
    expect(client.taxLineRates).toEqual(VEN_FISCAL_CONFIG.taxLineRates);
    expect(client.currencySymbol).toBe("Bs.");
    expect(client.locale).toBe("es-VE");
    expect(client.negativeParens).toBe(true);
    expect(client.taxAuthorityName).toBe("SENIAT");
  });
});

// ── Memoización (ADR-042 D-1) ────────────────────────────────────────────────

describe("memoizePerCountry", () => {
  it("construye una sola vez por país y devuelve la misma referencia", () => {
    let builds = 0;
    const get = memoizePerCountry(() => {
      builds++;
      return { id: builds };
    });

    const first = get(VEN_FISCAL_CONFIG);
    const second = get(VEN_FISCAL_CONFIG);

    expect(builds).toBe(1);
    expect(second).toBe(first); // identidad, no solo igualdad
  });

  it("cachea por countryCode, no por identidad del objeto config", () => {
    let builds = 0;
    const get = memoizePerCountry(() => ({ n: ++builds }));

    get(VEN_FISCAL_CONFIG);
    get({ ...VEN_FISCAL_CONFIG }); // copia distinta, mismo país

    expect(builds).toBe(1);
  });

  it("pasa la config al builder", () => {
    const get = memoizePerCountry((cfg) => cfg.taxIdLabel);
    expect(get(VEN_FISCAL_CONFIG)).toBe("RIF");
  });
});

// ── Venezuela: valores concretos (no deben cambiar en el refactor) ───────────

describe("VEN — valores congelados", () => {
  it("mantiene las alícuotas exactas previas al refactor", () => {
    expect(VEN_FISCAL_CONFIG.taxRates).toEqual({
      ivaGeneral: "0.16",
      ivaReduced: "0.08",
      ivaLuxury: "0.15",
      ivaCombined: "0.31",
      igtf: "0.03",
    });
  });

  it("implementa todas las capabilities (el filtro por país es identidad)", () => {
    const caps = VEN_FISCAL_CONFIG.capabilities;
    const { payrollEngine, ...booleans } = caps;
    expect(Object.values(booleans).every((v) => v === true)).toBe(true);
    expect(payrollEngine).toBe("VEN");
  });

  it("cubre las 4 alícuotas del enum Prisma TaxLineType", () => {
    expect(Object.keys(VEN_FISCAL_CONFIG.taxLineRates).sort()).toEqual([
      "EXENTO",
      "IVA_ADICIONAL",
      "IVA_GENERAL",
      "IVA_REDUCIDO",
    ]);
  });

  it("ivaCombined es exactamente general + lujo (relación luxuryGroupId, Z-2)", () => {
    const { ivaGeneral, ivaLuxury, ivaCombined } = VEN_FISCAL_CONFIG.taxRates;
    expect(new Decimal(ivaGeneral).plus(ivaLuxury).toString()).toBe(
      new Decimal(ivaCombined).toString(),
    );
  });
});
