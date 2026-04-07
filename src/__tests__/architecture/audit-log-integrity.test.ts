// src/__tests__/architecture/audit-log-integrity.test.ts
// Architectural guard: ensures that AuditLog is append-only in production code.
//
// Rationale (ADR-006 D-4):
//   The AuditLog is legally append-only under VEN-NIF (Código de Comercio Art. 32-33).
//   Any `auditLog.update()` or `auditLog.delete()` call in production code would allow
//   tampering with the audit trail — a CRITICAL compliance violation.
//
// Strategy:
//   Scan all .ts production files under src/ (excluding test files and the
//   architecture test directory itself) for the forbidden patterns:
//     - prisma.auditLog.update
//     - prisma.auditLog.updateMany
//     - prisma.auditLog.delete
//     - prisma.auditLog.deleteMany
//     - auditLog.update  (when called via a tx client)
//     - auditLog.delete  (when called via a tx client)
//
// Environment: node (default)

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// ─── Forbidden patterns ────────────────────────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  /auditLog\.update\s*\(/,
  /auditLog\.updateMany\s*\(/,
  /auditLog\.delete\s*\(/,
  /auditLog\.deleteMany\s*\(/,
];

// ─── Helper: recursively collect all .ts files under a directory ──────────────
function collectTsFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(fullPath, files);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── Helper: relative path for display ───────────────────────────────────────
const ROOT = path.resolve(process.cwd());
function rel(abs: string): string {
  return abs.replace(ROOT + path.sep, "").replace(/\\/g, "/");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Architecture: AuditLog append-only integrity (ADR-006 D-4)", () => {
  it("no production file calls auditLog.update or auditLog.delete", () => {
    const srcDir = path.join(ROOT, "src");
    const testsDir = path.join(ROOT, "src", "__tests__");

    const allFiles = collectTsFiles(srcDir);

    // Exclude the __tests__ directory (test files are allowed to reference these
    // patterns in test descriptions or this guard itself)
    const productionFiles = allFiles.filter(
      (f) => !f.startsWith(testsDir + path.sep),
    );

    const violations: string[] = [];

    for (const absPath of productionFiles) {
      const content = fs.readFileSync(absPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip comments
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(
              `[${rel(absPath)}:${i + 1}]: "${trimmed.slice(0, 100)}"`,
            );
            break;
          }
        }
      }
    }

    expect(
      violations,
      `CRITICAL — AuditLog tamper found in production code (ADR-006 D-4):\n` +
        `The following files call auditLog.update or auditLog.delete, which is ` +
        `forbidden under VEN-NIF (Código de Comercio Art. 32-33):\n\n` +
        violations.map((v) => `  ✗ ${v}`).join("\n"),
    ).toHaveLength(0);
  });

  it("production files under src/ are accessible for scanning", () => {
    const srcDir = path.join(ROOT, "src");
    const files = collectTsFiles(srcDir);
    // Sanity check: there must be production TS files to scan
    expect(files.length).toBeGreaterThan(10);
  });
});
