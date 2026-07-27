// src/__tests__/architecture/rif-regex-single-source.test.ts
// MP-1: guard de fuente única para la validación de RIF.
//
// Contexto: la auditoría multi-país (ADR-042) encontró una variante LAXA de la regex
// del RIF duplicada inline — `/^[JVEGCP]-\d{8}-?\d?$/i` — con el dígito verificador
// OPCIONAL (`\d?` final). Vivía justo en el alta de empresa (company.actions.ts y
// NewCompanyForm.tsx), aceptando RIFs sin dígito verificador que el resto de la app
// (facturas, retenciones, proveedores) rechaza. Resultado: empresas creadas con un RIF
// que después falla en todo documento fiscal.
//
// La fuente única es `taxIdRegex` en src/lib/countries/ven/config.ts, expuesta
// como VEN_RIF_REGEX desde src/lib/tax-config.ts (dígito verificador
// obligatorio). Este test impide que la variante laxa reaparezca por copy-paste.
//
// Environment: node (default)

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { VEN_RIF_REGEX } from "@/lib/tax-config";

// Cualquier regex de RIF escrita inline (con o sin el `\d?` laxo).
// La fuente única debe importarse, nunca reescribirse.
const INLINE_RIF_REGEX = /\[JVEGCP\]/;

const ROOT = path.resolve(process.cwd());

/** Archivos de producción: .ts/.tsx bajo src/, sin tests ni declaraciones */
function collectSourceFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function rel(abs: string): string {
  return abs.replace(ROOT + path.sep, "").replace(/\\/g, "/");
}

/**
 * Única ubicación autorizada para definir la regex del RIF: el perfil fiscal de
 * Venezuela (ADR-042 MP-2 la movió aquí desde src/lib/tax-config.ts, que ahora
 * es un re-export fino).
 */
const ALLOWED = new Set(["src/lib/countries/ven/config.ts"]);

describe("Arquitectura: VEN_RIF_REGEX es fuente única (MP-1 / ADR-042)", () => {
  it("ningún archivo de producción reescribe la regex del RIF inline", () => {
    const files = collectSourceFiles(path.join(ROOT, "src")).filter(
      (f) => !f.startsWith(path.join(ROOT, "src", "__tests__")),
    );

    const violations: string[] = [];
    for (const file of files) {
      const relPath = rel(file);
      if (ALLOWED.has(relPath)) continue;
      const content = fs.readFileSync(file, "utf-8");
      content.split("\n").forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (INLINE_RIF_REGEX.test(line)) {
          violations.push(`${relPath}:${i + 1} → ${trimmed}`);
        }
      });
    }

    expect(
      violations,
      `Regex de RIF escrita inline. Importa VEN_RIF_REGEX de "@/lib/tax-config":\n` +
        violations.join("\n"),
    ).toHaveLength(0);
  });

  it("la regex canónica EXIGE dígito verificador (la variante laxa lo hacía opcional)", () => {
    // Válidos — con guión o pegado
    expect(VEN_RIF_REGEX.test("J-12345678-9")).toBe(true);
    expect(VEN_RIF_REGEX.test("J-123456789")).toBe(true);
    expect(VEN_RIF_REGEX.test("v-12345678-1")).toBe(true);

    // Inválido — sin dígito verificador. La variante laxa lo ACEPTABA.
    expect(VEN_RIF_REGEX.test("J-12345678")).toBe(false);
    expect(VEN_RIF_REGEX.test("J-12345678-")).toBe(false);

    // Otros inválidos
    expect(VEN_RIF_REGEX.test("X-12345678-9")).toBe(false); // letra no válida
    expect(VEN_RIF_REGEX.test("J-1234567-9")).toBe(false);  // 7 dígitos
    expect(VEN_RIF_REGEX.test("12345678-9")).toBe(false);   // sin letra
  });
});
