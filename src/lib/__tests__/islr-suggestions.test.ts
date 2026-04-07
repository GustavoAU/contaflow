// src/lib/__tests__/islr-suggestions.test.ts

import { describe, it, expect } from "vitest";
import { suggestIslrCode } from "../islr-suggestions";

describe("suggestIslrCode", () => {
  // ─── null / vacío ──────────────────────────────────────────────────────────
  it("concepto vacío → null", () => {
    expect(suggestIslrCode("")).toBeNull();
    expect(suggestIslrCode("   ")).toBeNull();
  });

  it("concepto sin palabras clave reconocibles → null", () => {
    expect(suggestIslrCode("factura número 001")).toBeNull();
    expect(suggestIslrCode("compra de materiales de oficina")).toBeNull();
  });

  // ─── Honorarios ────────────────────────────────────────────────────────────
  it("'honorarios' → HONORARIOS_PN 5%", () => {
    const s = suggestIslrCode("honorarios profesionales");
    expect(s?.code).toBe("HONORARIOS_PN");
    expect(s?.rate).toBe(5);
  });

  it("'abogado' → HONORARIOS_PN", () => {
    expect(suggestIslrCode("Servicios de abogado externo")?.code).toBe("HONORARIOS_PN");
  });

  it("'auditoria' → HONORARIOS_PN (auditoría profesional)", () => {
    expect(suggestIslrCode("Auditoría de estados financieros")?.code).toBe("HONORARIOS_PN");
  });

  // ─── Arrendamiento ─────────────────────────────────────────────────────────
  it("'alquiler' → ARRENDAMIENTO_PJ 5%", () => {
    const s = suggestIslrCode("Alquiler de local comercial");
    expect(s?.code).toBe("ARRENDAMIENTO_PJ");
    expect(s?.rate).toBe(5);
  });

  it("'canon' → ARRENDAMIENTO_PJ", () => {
    expect(suggestIslrCode("Canon de arrendamiento mensual")?.code).toBe("ARRENDAMIENTO_PJ");
  });

  it("'oficina' → ARRENDAMIENTO_PJ", () => {
    expect(suggestIslrCode("Renta de oficina piso 3")?.code).toBe("ARRENDAMIENTO_PJ");
  });

  // ─── Fletes ────────────────────────────────────────────────────────────────
  it("'flete' → FLETES_PJ 1%", () => {
    const s = suggestIslrCode("Flete de mercancía Valencia-Caracas");
    expect(s?.code).toBe("FLETES_PJ");
    expect(s?.rate).toBe(1);
  });

  it("'transporte' → FLETES_PJ", () => {
    expect(suggestIslrCode("Servicio de transporte terrestre")?.code).toBe("FLETES_PJ");
  });

  it("'courier' → FLETES_PJ", () => {
    expect(suggestIslrCode("Courier internacional DHL")?.code).toBe("FLETES_PJ");
  });

  // ─── Publicidad ────────────────────────────────────────────────────────────
  it("'publicidad' → PUBLICIDAD_PJ 3%", () => {
    const s = suggestIslrCode("Publicidad en redes sociales");
    expect(s?.code).toBe("PUBLICIDAD_PJ");
    expect(s?.rate).toBe(3);
  });

  it("'marketing' → PUBLICIDAD_PJ", () => {
    expect(suggestIslrCode("Campaña de marketing digital")?.code).toBe("PUBLICIDAD_PJ");
  });

  // ─── Construcción ──────────────────────────────────────────────────────────
  it("'construccion' → CONSTRUCCION_PJ 2%", () => {
    const s = suggestIslrCode("Construcción de galpón industrial");
    expect(s?.code).toBe("CONSTRUCCION_PJ");
    expect(s?.rate).toBe(2);
  });

  it("'remodelacion' → CONSTRUCCION_PJ", () => {
    expect(suggestIslrCode("Remodelación de oficinas")?.code).toBe("CONSTRUCCION_PJ");
  });

  it("'instalacion' → CONSTRUCCION_PJ", () => {
    expect(suggestIslrCode("Instalación de sistema eléctrico")?.code).toBe("CONSTRUCCION_PJ");
  });

  // ─── Servicios (default PJ) ────────────────────────────────────────────────
  it("'consultoria' → SERVICIOS_PJ 2%", () => {
    const s = suggestIslrCode("Consultoría fiscal y tributaria");
    expect(s?.code).toBe("SERVICIOS_PJ");
    expect(s?.rate).toBe(2);
  });

  it("'software' → SERVICIOS_PJ", () => {
    expect(suggestIslrCode("Desarrollo de software a medida")?.code).toBe("SERVICIOS_PJ");
  });

  it("'asesoria' → SERVICIOS_PJ", () => {
    expect(suggestIslrCode("Asesoría contable mensual")?.code).toBe("SERVICIOS_PJ");
  });

  it("'limpieza' → SERVICIOS_PJ", () => {
    expect(suggestIslrCode("Servicio de limpieza de oficinas")?.code).toBe("SERVICIOS_PJ");
  });

  // ─── Normalización (tildes/mayúsculas) ─────────────────────────────────────
  it("texto con tildes es normalizado correctamente", () => {
    expect(suggestIslrCode("Honorários profesionales")?.code).toBe("HONORARIOS_PN");
    expect(suggestIslrCode("Asesoría legal")?.code).toBe("SERVICIOS_PJ");
    expect(suggestIslrCode("Construcción de almacén")?.code).toBe("CONSTRUCCION_PJ");
  });

  it("texto en mayúsculas es normalizado", () => {
    expect(suggestIslrCode("HONORARIOS PROFESIONALES")?.code).toBe("HONORARIOS_PN");
    expect(suggestIslrCode("FLETE DE MERCANCIA")?.code).toBe("FLETES_PJ");
  });

  // ─── legalRef está presente ────────────────────────────────────────────────
  it("la sugerencia incluye legalRef no vacío", () => {
    const s = suggestIslrCode("honorarios");
    expect(s?.legalRef).toBeTruthy();
    expect(s?.legalRef).toContain("Decreto 1808");
  });
});
