// src/__tests__/architecture/utc-date-getters.test.ts
//
// Guard del anti-patrón "construir en UTC y leer en local".
//
// Las fechas de NEGOCIO se persisten a medianoche UTC. Construir una fecha con
// `Date.UTC(...)` y leerla con un getter LOCAL devuelve el día anterior en zonas
// horarias negativas — Venezuela es UTC−4 — y el error es invisible en producción
// porque Vercel corre en UTC. Se detectó dos veces en retention.actions.ts:
//
//   new Date(Date.UTC(year, month, 0)).getDate()   // 30 en vez de 31
//
// Ese `lastDay` recortaba el período contable y hacía rechazar retenciones de
// facturas del último día del mes. Correcto: `.getUTCDate()`.
//
// Este test NO cubre la clase completa (leer con getters locales una fecha que
// viene de la BD); esa parte se corrigió con un barrido manual y no es detectable
// por texto. Ver la memoria "fechas-getters-locales-barrido-pendiente" para el
// criterio de clasificación.
//
// Environment: node (default)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";

const SRC = join(process.cwd(), "src");

/** Construcción con Date.UTC seguida de un getter LOCAL en la misma expresión. */
const ANTI_PATTERN = /new Date\(\s*Date\.UTC\([^;]*?\)\s*\)\s*\.get(?:Date|Month|FullYear|Hours)\(\)/g;

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

describe("Arquitectura: fechas UTC", () => {
  it("nadie construye con Date.UTC y lee con un getter local", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(ANTI_PATTERN)) {
        const line = content.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(process.cwd(), file)}:${line} → ${match[0].slice(0, 80)}`);
      }
    }
    expect(
      offenders,
      "Construir con Date.UTC y leer en local devuelve el día ANTERIOR en zonas " +
        "negativas (Venezuela, UTC−4). Usa getUTCDate/getUTCMonth/getUTCFullYear.\n" +
        offenders.join("\n"),
    ).toHaveLength(0);
  });
});
