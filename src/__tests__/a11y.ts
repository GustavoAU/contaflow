// src/__tests__/a11y.ts
// Helper de accesibilidad automática (SPEC-002 RN-6) sobre axe-core directo.
// Los tests que lo usen deben llevar `// @vitest-environment jsdom` en la PRIMERA línea.
import axe from "axe-core";

export type SeriousA11yViolation = axe.Result;

const SERIOUS_IMPACTS = new Set(["serious", "critical"]);

/**
 * Corre axe sobre `container` y devuelve SOLO las violaciones de impacto
 * `serious` o `critical` (RN-6). `minor`/`moderate` se ignoran a propósito.
 *
 * Regla `color-contrast` desactivada: jsdom no calcula estilos reales (no hay
 * layout ni hojas de estilo de Tailwind aplicadas), así que axe daría falsos
 * positivos/negativos. El contraste se revisa aparte (navegador / Lighthouse).
 *
 * Los portales de Radix/base-ui renderizan en document.body: para un diálogo
 * abierto pasa `document.body` como contenedor.
 */
export async function getSeriousA11yViolations(
  container: Element,
): Promise<SeriousA11yViolation[]> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.filter((v) => v.impact != null && SERIOUS_IMPACTS.has(v.impact));
}

export function formatA11yViolations(violations: SeriousA11yViolation[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `    - ${n.target.join(" ")}\n      ${n.html.slice(0, 200)}`)
        .join("\n");
      return `[${v.impact}] ${v.id}: ${v.help}\n  ${v.helpUrl}\n  Nodos (${v.nodes.length}):\n${nodes}`;
    })
    .join("\n\n");
}

/**
 * DEUDA CONOCIDA (SPEC-002 R-2): fija las reglas exactas que HOY violan. No es un
 * `it.fails`: ese pasaría también ante un error de render. Aquí falla si
 *  - aparece una regla nueva (regresión: se rompió algo más), o
 *  - desaparece una regla fijada (se corrigió: quitar la marca y usar
 *    `expectNoSeriousA11yViolations`).
 */
export async function expectKnownA11yDebt(
  container: Element,
  knownRuleIds: string[],
): Promise<void> {
  const violations = await getSeriousA11yViolations(container);
  const actual = [...new Set(violations.map((v) => v.id))].sort();
  const known = [...knownRuleIds].sort();
  if (actual.join(",") !== known.join(",")) {
    throw new Error(
      `Deuda de a11y distinta a la registrada. Esperada: [${known.join(", ")}]; actual: [${actual.join(", ")}]. ` +
        (actual.length === 0
          ? "Se corrigió todo: reemplaza expectKnownA11yDebt por expectNoSeriousA11yViolations."
          : `Detalle:\n${formatA11yViolations(violations)}`),
    );
  }
}

/** Falla con un mensaje legible si hay violaciones serious/critical. */
export async function expectNoSeriousA11yViolations(container: Element): Promise<void> {
  const violations = await getSeriousA11yViolations(container);
  if (violations.length > 0) {
    // Error propio (no expect().toEqual): evita el diff gigante de objetos axe.
    throw new Error(
      `Violaciones de accesibilidad serious/critical (${violations.length}):
${formatA11yViolations(violations)}`,
    );
  }
}
