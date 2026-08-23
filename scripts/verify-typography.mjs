#!/usr/bin/env node
// scripts/verify-typography.mjs
//
// Punto 9 del handoff de UI: dos escalas tipográficas solapadas.
//
// `--text-9` … `--text-15` están declaradas en el @theme de globals.css y son
// legítimas POR DEBAJO de 12px, que es donde la escala estándar de Tailwind no
// llega (text-xs = 12px). El problema son `text-13` (13px) y `text-15` (15px):
// caen en medio del rango que ya cubren text-xs (12) y text-sm (14), así que
// dos componentes hermanos acaban con tamaños que difieren en un píxel sin que
// nadie lo haya decidido.
//
// REGLA: la escala numérica solo por debajo de 12px. De 12 en adelante, la
// estándar.
//
// Esto es un TRINQUETE, no un check en verde: los usos que ya existen están
// contados abajo y no se tocan — migrar el sidebar de 13px a 14px es una
// decisión de diseño, no una limpieza mecánica. Lo que este script impide es
// que aparezcan MÁS. Cuando se migren, baja el número.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Usos existentes al establecer la regla (2026-08-23). Solo puede BAJAR.
const RATCHET = { "text-13": 9, "text-15": 7 };

const ROOT = "src";
const EXT = /\.(tsx|ts)$/;
const PATTERN = /\btext-(13|15)\b/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXT.test(entry)) out.push(p);
  }
  return out;
}

const found = { "text-13": [], "text-15": [] };

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PATTERN)) {
      found[m[0]].push(`${file}:${i + 1}`);
    }
  });
}

let failed = false;
for (const [cls, limit] of Object.entries(RATCHET)) {
  const hits = found[cls];
  const n = hits.length;
  if (n > limit) {
    failed = true;
    console.error(`\n✗ ${cls}: ${n} usos, el trinquete está en ${limit}.`);
    console.error(`  De 12px en adelante usa la escala estándar (text-xs 12 / text-sm 14 / text-base 16).`);
    console.error(`  Nuevos:`);
    hits.slice(limit).forEach((h) => console.error(`    ${h}`));
  } else if (n < limit) {
    console.log(`✓ ${cls}: ${n} usos (el trinquete decía ${limit} — bájalo a ${n} en scripts/verify-typography.mjs)`);
  } else {
    console.log(`✓ ${cls}: ${n} usos, sin crecer`);
  }
}

if (failed) {
  console.error("\nLa escala numérica es solo para tamaños por debajo de 12px.\n");
  process.exit(1);
}

console.log("\nTipografía: sin escalas solapadas nuevas.");
