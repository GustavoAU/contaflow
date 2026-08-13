// src/__tests__/architecture/company-page-scope.test.ts
//
// MEDIUM-2 (auditoría MP-4) — ninguna PÁGINA lee `Company` con el companyId
// crudo de la URL.
//
// El bug se corrigió primero en `today-server.ts` y se cerró solo esa instancia;
// la clase seguía viva en cinco páginas. Este guard existe para que el barrido no
// dependa de que alguien se acuerde: `prisma.company.find*` dentro de
// `src/app/**` es la firma exacta del patrón, y la alternativa correcta —
// `requireCompanyPage(companyId, select)` — lee a través de la membresía.
//
// Por qué el redirect del layout no basta como defensa: vive en OTRO archivo y
// es un punto único de fallo. Mover la ruta fuera del grupo de layout, envolverla
// en Suspense o habilitar PPR convierte la lectura en divulgación cross-tenant.
//
// Environment: node (default)

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(process.cwd(), "src", "app");

/** Lectura directa del modelo Company, en cualquiera de sus formas Prisma. */
const COMPANY_READ = /\bprisma\.company\.(?:findUnique|findFirst|findMany)(?:OrThrow)?\s*\(/g;

/**
 * Rutas donde el companyId NO viene de la URL sino de un token firmado, así que
 * el patrón "atarlo al usuario" no aplica: la autorización es la firma del JWT.
 * Se listan explícitamente en vez de excluir por prefijo para que una página
 * nueva bajo esas carpetas no herede la exención sin que nadie lo mire.
 */
const TOKEN_AUTHENTICATED = new Set([
  "src/app/client-portal/[token]/page.tsx",
  "src/app/employee/[token]/page.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("Arquitectura: aislamiento multi-tenant en páginas", () => {
  it("ninguna página lee Company con el companyId crudo de la URL", () => {
    const offenders: string[] = [];

    for (const file of walk(APP)) {
      const rel = relative(process.cwd(), file).split("\\").join("/");
      if (TOKEN_AUTHENTICATED.has(rel)) continue;

      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(COMPANY_READ)) {
        const line = content.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line} → ${match[0]}`);
      }
    }

    expect(
      offenders,
      "Leer Company por id suelto carga la fila de otro tenant antes de que nadie " +
        "autorice. Usa requireCompanyPage(companyId, select) de " +
        "@/lib/company-page-guard: el where lleva companyId Y userId.\n" +
        offenders.join("\n"),
    ).toHaveLength(0);
  });

  it("las excepciones por token siguen existiendo y siguen siendo por token", () => {
    for (const rel of TOKEN_AUTHENTICATED) {
      const content = readFileSync(join(process.cwd(), rel), "utf8");
      // Si una de estas páginas dejara de resolver su companyId desde un token
      // verificado, la exención dejaría de estar justificada.
      expect(content, `${rel} ya no parece autenticarse por token`).toMatch(/verify|token/i);
    }
  });
});
