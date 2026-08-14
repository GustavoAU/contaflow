// @vitest-environment jsdom
// src/lib/countries/__tests__/client.test.tsx
// ADR-042 D-3 — FiscalUIProvider / useFiscalConfig.
//
// Lo que importa probar aquí: (1) el fallback VEN sin provider, porque los
// portales /employee y /client-portal y todos los tests jsdom existentes montan
// componentes SIN el provider; (2) que las RegExp reconstruidas equivalen a las
// del server (viajan como `.source` y el flag "i" se rearma en el hook).

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { FiscalUIProvider, useFiscalConfig, type FiscalUIConfig } from "../client";
import {
  getFiscalConfig,
  toClientFiscalConfig,
  SUPPORTED_COUNTRIES,
  VEN_FISCAL_CONFIG,
} from "../index";

/** Renderiza un componente que captura el valor del hook. */
function capture(ui: (probe: React.ReactNode) => React.ReactNode): FiscalUIConfig {
  let captured: FiscalUIConfig | null = null;
  function Probe() {
    captured = useFiscalConfig();
    return null;
  }
  renderToString(<>{ui(<Probe />)}</>);
  if (!captured) throw new Error("Probe no montó");
  return captured;
}

describe("useFiscalConfig", () => {
  it("sin provider cae a VEN (portales y tests jsdom no se tocan — D-3)", () => {
    const cfg = capture((probe) => probe);
    expect(cfg.countryCode).toBe("VEN");
    expect(cfg.taxIdLabel).toBe("RIF");
    expect(cfg.taxAuthorityName).toBe("SENIAT");
  });

  it("con provider entrega la config inyectada", () => {
    const ven = toClientFiscalConfig(getFiscalConfig("VEN"));
    const cfg = capture((probe) => (
      <FiscalUIProvider config={ven}>{probe}</FiscalUIProvider>
    ));
    expect(cfg.countryCode).toBe("VEN");
    expect(cfg.timezone).toBe("America/Caracas");
  });

  // INFO-1: el test de abajo pasaba por casualidad cuando los flags se
  // hardcodeaban ("i" para taxId, ninguno para controlNumber) porque VEN es
  // justo así. Este cierra el hueco de verdad: source Y flags deben viajar,
  // para TODO país registrado.
  it("source y flags sobreviven la serialización, en todo país registrado", () => {
    for (const { code } of SUPPORTED_COUNTRIES) {
      const server = getFiscalConfig(code);
      const client = toClientFiscalConfig(server);

      expect(client.taxIdPattern, code).toBe(server.taxIdRegex.source);
      expect(client.taxIdFlags, code).toBe(server.taxIdRegex.flags);

      const rebuilt = new RegExp(client.taxIdPattern, client.taxIdFlags);
      expect(rebuilt.source, code).toBe(server.taxIdRegex.source);
      expect(rebuilt.flags, code).toBe(server.taxIdRegex.flags);

      if (server.controlNumberRegex) {
        expect(client.controlNumberFlags, code).toBe(server.controlNumberRegex.flags);
      }
    }
  });

  it("las RegExp reconstruidas equivalen a las del server", () => {
    const cfg = capture((probe) => probe);

    // Mismo comportamiento, no solo mismo source: el flag "i" importa (RIF en minúscula)
    for (const rif of ["J-12345678-9", "j-12345678-9", "V-123456789"]) {
      expect(cfg.taxIdRegex.test(rif), rif).toBe(VEN_FISCAL_CONFIG.taxIdRegex.test(rif));
      expect(cfg.taxIdRegex.test(rif), rif).toBe(true);
    }
    expect(cfg.taxIdRegex.test("J-1234-5")).toBe(false);

    expect(cfg.controlNumberRegex).not.toBeNull();
    expect(cfg.controlNumberRegex!.test("00-12345678")).toBe(true);
    expect(cfg.controlNumberRegex!.test("0-123")).toBe(false);
  });
});
