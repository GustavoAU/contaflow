// src/__tests__/architecture/csp-style-nonce-watch.test.ts
//
// VIGÍA de I-1 (auditoría STRIDE 2026-07) — no prueba código nuestro.
//
// I-1 quiere quitar `'unsafe-inline'` de `style-src`. Está publicado en
// Content-Security-Policy-Report-Only y NO se puede aplicar todavía, pero no por
// culpa nuestra: dos dependencias de terceros inyectan `<style>` sin nonce y
// quedarían bloqueadas. Verificado en producción el 2026-08-09 con un colector de
// `securitypolicyviolation` (ver src/lib/csp.ts):
//
//   - Clerk UI  → 2 elementos `<style data-emotion="cl-internal">`
//   - sonner    → 1 elemento `<style>` con `[data-sonner-toaster]{…}`
//
// El problema de un pendiente así es que se olvida: nadie relee changelogs de
// dependencias buscando "ahora soportamos nonce". Este test lo detecta solo.
// Fija el estado ACTUAL (bloqueado) y FALLA cuando deje de serlo — y como
// dependabot sube estas librerías con regularidad, la falla llega sola en el PR
// del bump, no meses después.
//
// Si este test falla: no lo "arregles" ajustando la expectativa. Significa que
// I-1 se puede avanzar — ve a src/lib/csp.ts y pasa styleSrcObserved a aplicada.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Raíz de un paquete instalado. No se puede usar `require.resolve(pkg +
 * "/package.json")`: el campo `exports` de ambas librerías lo bloquea. Se resuelve
 * la entrada principal y se sube hasta el package.json cuyo `name` coincide.
 */
function packageRoot(pkg: string): string {
  let dir = dirname(require.resolve(pkg));
  for (let i = 0; i < 12; i++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      const { name } = JSON.parse(readFileSync(pj, "utf8")) as { name?: string };
      if (name === pkg) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`No se pudo ubicar la raíz del paquete "${pkg}".`);
}

/** Lee un archivo dentro de un paquete instalado, probando varias rutas. */
function readFromPackage(pkg: string, candidates: string[]): { path: string; content: string } {
  const root = packageRoot(pkg);
  for (const rel of candidates) {
    const full = join(root, rel);
    if (existsSync(full)) return { path: rel, content: readFileSync(full, "utf8") };
  }
  throw new Error(
    `No se encontró ninguno de [${candidates.join(", ")}] en "${pkg}".\n` +
      "La librería reestructuró su build: revisa a mano si ya soporta nonce en estilos y " +
      "actualiza este vigía (ver I-1 en src/lib/csp.ts).",
  );
}

describe("I-1 — vigía: ¿ya se puede aplicar style-src estricto?", () => {
  it("Clerk sigue exigiendo 'unsafe-inline' en style-src", () => {
    // Clerk publica sus directivas recomendadas en DEFAULT_DIRECTIVES. Es la
    // fuente autoritativa: mientras ELLOS pidan unsafe-inline para estilos,
    // nosotros no podemos quitarlo sin romper su widget de login.
    const { content } = readFromPackage("@clerk/nextjs", [
      "dist/esm/server/content-security-policy.js",
      "dist/cjs/server/content-security-policy.js",
    ]);

    const styleSrc = content.match(/"style-src":\s*\[([^\]]*)\]/)?.[1];
    expect(
      styleSrc,
      "No se pudo leer el style-src por defecto de Clerk — cambió el formato del bundle.",
    ).toBeDefined();

    expect(
      styleSrc,
      "Clerk YA NO exige 'unsafe-inline' para estilos → uno de los dos bloqueantes de I-1 cayó. " +
        "Revisa si sus <style data-emotion> ahora llevan nonce y avanza I-1 en src/lib/csp.ts.",
    ).toContain("unsafe-inline");
  });

  it("sonner sigue sin aceptar un nonce para su <style>", () => {
    const { content } = readFromPackage("sonner", ["dist/index.d.ts", "dist/index.d.mts"]);

    // Si algún día ToasterProps acepta `nonce`, se lo pasamos desde el layout
    // (el nonce ya viaja en la cabecera x-nonce que pone el middleware).
    expect(
      /\bnonce\??\s*:/.test(content),
      "sonner YA acepta un nonce → pásaselo al <Toaster> y quita este bloqueante de I-1 " +
        "(src/lib/csp.ts). El nonce está disponible en la cabecera x-nonce.",
    ).toBe(false);
  });
});
