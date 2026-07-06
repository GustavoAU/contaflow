// scripts/verify-rls.mjs — Verificación estructural de RLS (ADR-007 / fase A1-bis)
//
// Comprueba que TODA tabla de negocio del schema tiene ENABLE + FORCE ROW LEVEL
// SECURITY y al menos una policy. Correr tras cada migración que cree tablas y
// al desplegar a staging/prod (usa DATABASE_URL de .env.local — HTTP 443, funciona
// bajo VPN; ver memoria "migraciones-neon-vpn-http").
//
//   node scripts/verify-rls.mjs
//
// Exit 0 = cobertura completa; exit 1 = hay tablas sin RLS (las lista).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

// Tablas SIN tenant, exentas por diseño (documentadas en ADR-007-addendum):
//  - User: identidad global (Clerk), consultada por clerkId como owner.
//  - _prisma_migrations: bookkeeping de Prisma.
const EXEMPT = new Set(["User", "_prisma_migrations"]);

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL no encontrada en .env.local");
let url = line.slice("DATABASE_URL=".length).trim();
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
const sql = neon(url);

const rows = await sql.query(`
  SELECT c.relname AS table,
         c.relrowsecurity AS rls,
         c.relforcerowsecurity AS forced,
         (SELECT count(*)::int FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = c.relname) AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname
`);

const bad = rows.filter((r) => !EXEMPT.has(r.table) && (!r.rls || !r.forced || r.policies < 1));
const covered = rows.length - EXEMPT.size - bad.length;

console.log(`Tablas: ${rows.length} · exentas: ${EXEMPT.size} · con RLS completo: ${covered} · SIN cobertura: ${bad.length}`);
if (bad.length > 0) {
  console.table(bad);
  console.error("\n❌ Tablas de negocio sin RLS — agregar ENABLE+FORCE+policy (ADR-007 A1-bis)");
  process.exit(1);
}
console.log("✅ Cobertura RLS completa");
