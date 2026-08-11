"use client";
// src/lib/countries/client.tsx
// ADR-042 D-3 — Config fiscal en componentes cliente.
//
// El server resuelve el país de la empresa UNA vez (company layout) y baja
// `ClientFiscalConfig` serializado por Context. Los componentes cliente leen
// `useFiscalConfig()` en lugar de importar constantes VEN_* — esa es la costura
// que las fases MP-5/MP-7 usan para despegar la UI de Venezuela.
//
// Sin provider (portales /employee y /client-portal, tests jsdom existentes) el
// hook cae a VEN: esos árboles son hoy VEN-only y no se tocan (decisión D-3).

import { createContext, useContext, useMemo } from "react";
import type { ClientFiscalConfig } from "./types";
import { VEN_FISCAL_CONFIG, toClientFiscalConfig } from "./index";

/**
 * `ClientFiscalConfig` + las RegExp reconstruidas. Las regex viajan como string
 * (`.source`) porque una RegExp no cruza la frontera RSC; el hook las rearma.
 */
export type FiscalUIConfig = ClientFiscalConfig & {
  /** Reconstruida de `taxIdPattern` con flag "i" (el RIF acepta minúsculas) */
  taxIdRegex: RegExp;
  /** Reconstruida de `controlNumberPattern`; null si el país no exige Nº control */
  controlNumberRegex: RegExp | null;
};

const FiscalConfigContext = createContext<ClientFiscalConfig | null>(null);

export function FiscalUIProvider({
  config,
  children,
}: {
  config: ClientFiscalConfig;
  children: React.ReactNode;
}) {
  return (
    <FiscalConfigContext.Provider value={config}>{children}</FiscalConfigContext.Provider>
  );
}

export function useFiscalConfig(): FiscalUIConfig {
  const fromProvider = useContext(FiscalConfigContext);
  return useMemo(() => {
    const cfg = fromProvider ?? toClientFiscalConfig(VEN_FISCAL_CONFIG);
    return {
      ...cfg,
      taxIdRegex: new RegExp(cfg.taxIdPattern, "i"),
      controlNumberRegex: cfg.controlNumberPattern
        ? new RegExp(cfg.controlNumberPattern)
        : null,
    };
  }, [fromProvider]);
}
