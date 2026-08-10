// src/lib/__tests__/csp.test.ts
//
// Una CSP mal armada falla en silencio: la página carga y algo deja de funcionar,
// o peor, se relaja sin que nadie lo note. Estos tests fijan las propiedades que
// costaron auditorías: nonce sin unsafe-inline en scripts (MEDIUM-1) y la
// separación elem/attr de estilos (I-1).

import { describe, it, expect } from "vitest";
import { buildCsp, STYLE_SRC_ENFORCED, styleSrcObserved } from "../csp";

const NONCE = "dGVzdC1ub25jZS0xMjM0";
const enforced = () => buildCsp(NONCE, STYLE_SRC_ENFORCED);
const observed = () => buildCsp(NONCE, styleSrcObserved(NONCE));

/** Extrae una directiva concreta de la cadena de CSP. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe("buildCsp — invariantes de scripts (MEDIUM-1)", () => {
  it("script-src usa nonce y NUNCA unsafe-inline", () => {
    const scriptSrc = directive(enforced(), "script-src") ?? "";
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("no habilita unsafe-eval en producción", () => {
    expect(enforced()).not.toContain("'unsafe-eval'");
  });

  it("habilita unsafe-eval solo en desarrollo", () => {
    expect(buildCsp(NONCE, STYLE_SRC_ENFORCED, true)).toContain("'unsafe-eval'");
  });

  it("mantiene cerrados los vectores clásicos", () => {
    const csp = enforced();
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });
});

describe("buildCsp — estilos (I-1)", () => {
  it("la política APLICADA sigue permitiendo estilos inline (49 atributos en la landing)", () => {
    // Documenta el estado actual a propósito: si alguien lo endurece aquí sin
    // migrar los atributos style=, el hero se rompe y este test lo avisa.
    expect(directive(enforced(), "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("la política de OBSERVACIÓN separa elem/attr y solo el elem lleva nonce", () => {
    const csp = observed();
    expect(directive(csp, "style-src-elem")).toBe(`style-src-elem 'self' 'nonce-${NONCE}'`);
    expect(directive(csp, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
  });

  it("la de observación NO permite <style> inline sin nonce — es el punto de I-1", () => {
    const elem = directive(observed(), "style-src-elem") ?? "";
    expect(elem).not.toContain("'unsafe-inline'");
  });

  it("ambas políticas comparten el resto de directivas", () => {
    const soloEstilos = (csp: string) =>
      csp
        .split(";")
        .map((d) => d.trim())
        .filter((d) => !d.startsWith("style-src"));
    expect(soloEstilos(observed())).toEqual(soloEstilos(enforced()));
  });

  it("el nonce de estilos es el mismo del request, no uno fijo", () => {
    const otro = "b3Ryby1ub25jZQ==";
    expect(buildCsp(otro, styleSrcObserved(otro))).toContain(`style-src-elem 'self' 'nonce-${otro}'`);
  });
});
