// scripts/verify-rls-runtime.mjs — Verificación de COMPORTAMIENTO de la RLS (ADR-007)
//
// Complementa a `verify-rls.mjs`, que es ESTRUCTURAL: comprueba que las policies
// existen. Existir no es aplicarse. Este script comprueba que se APLICAN, contra
// la base de datos real, ejecutando la misma secuencia que `withCompanyContext`:
//
//     SET LOCAL ROLE authenticated
//     SELECT set_config('app.current_company_id', $1, true)
//
// Motivación (2026-08-15): durante meses ADR-007 afirmó que omitir
// `withCompanyContext` era *fail-closed* ("la policy usa NULL y devuelve 0 filas").
// La medición demostró lo contrario: sin el wrapper nunca se sale de `neondb_owner`,
// que tiene BYPASSRLS, así que la policy ni se evalúa y la query ve TODAS las
// empresas. El mecanismo era correcto; el valor por defecto no. Nada verificaba esa
// diferencia porque toda la verificación era estructural. Este script cierra ese hueco.
//
//   node scripts/verify-rls-runtime.mjs
//
// Exit 0 = la RLS aísla de verdad; exit 1 = alguna garantía no se cumple.
// Solo hace LECTURAS: no muta ninguna fila.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL no encontrada en .env.local");
let url = line.slice("DATABASE_URL=".length).trim();
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
const sql = neon(url);

/** companyId que no pertenece a nadie — sirve de tenant ajeno sin tocar datos reales. */
const FOREIGN_ID = "rls-probe-tenant-inexistente";

const failures = [];
function check(ok, label, detail) {
  console.log(`  ${ok ? "OK  " : "FALLA"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// ─── 0. Identidad de la conexión ──────────────────────────────────────────────
const [who] = await sql.query(
  `SELECT current_user AS usr,
          (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`,
);
console.log(`Conexión: ${who.usr} · BYPASSRLS=${who.bypassrls}`);
if (who.bypassrls) {
  console.log(
    "  NOTA: el rol por defecto ignora la RLS. Por eso toda query que NO pase por\n" +
      "  withCompanyContext corre SIN aislamiento a nivel de base de datos (ADR-007).",
  );
}

// ─── 1. Buscar una tabla tenant con filas de 2+ empresas ──────────────────────
// Se descubre dinámicamente: así el script no envejece cuando cambian los modelos.
const tenantTables = await sql.query(`
  SELECT c.relname AS t
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'companyId' AND a.attnum > 0
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  ORDER BY c.relname
`);

let probe = null;
for (const { t } of tenantTables) {
  const rows = await sql.query(
    `SELECT "companyId" AS cid, count(*)::int AS n
     FROM "${t}" WHERE "companyId" IS NOT NULL
     GROUP BY "companyId" ORDER BY n DESC`,
  );
  if (rows.length >= 2) {
    probe = { table: t, target: rows[0], total: rows.reduce((a, r) => a + r.n, 0) };
    break;
  }
}

if (!probe) {
  console.log(
    "\nSin datos suficientes (hacen falta filas de 2+ empresas en alguna tabla tenant).\n" +
      "La verificación estructural sigue siendo válida: node scripts/verify-rls.mjs",
  );
  process.exit(0);
}

const { table, target, total } = probe;
console.log(
  `\nTabla de prueba: ${table} · ${total} filas totales · empresa objetivo ${target.cid} (${target.n} filas)\n`,
);

// ─── 2. Las tres garantías que la RLS debe cumplir ────────────────────────────
console.log("Garantías de aislamiento (bajo rol `authenticated`, como withCompanyContext):");

// 2a. Con el contexto propio se ven exactamente las filas propias.
{
  const res = await sql.transaction([
    sql`SET LOCAL ROLE authenticated`,
    sql.query(`SELECT set_config('app.current_company_id', $1, true)`, [target.cid]),
    sql.query(`SELECT count(*)::int AS n FROM "${table}"`),
  ]);
  const n = res[2][0].n;
  check(n === target.n, "contexto propio ve sus filas", `${n} visibles, ${target.n} esperadas`);
}

// 2b. Con contexto ajeno no se ve nada — el aislamiento cross-tenant real.
{
  const res = await sql.transaction([
    sql`SET LOCAL ROLE authenticated`,
    sql.query(`SELECT set_config('app.current_company_id', $1, true)`, [FOREIGN_ID]),
    sql.query(`SELECT count(*)::int AS n FROM "${table}"`),
  ]);
  const n = res[2][0].n;
  check(n === 0, "contexto ajeno no ve nada", `${n} filas visibles de ${total}`);
}

// 2c. Sin contexto no se ve nada — fail-closed, el olvido no filtra.
{
  const res = await sql.transaction([
    sql`SET LOCAL ROLE authenticated`,
    sql.query(`SELECT count(*)::int AS n FROM "${table}"`),
  ]);
  const n = res[1][0].n;
  check(n === 0, "sin contexto no ve nada (fail-closed)", `${n} filas visibles de ${total}`);
}

// ─── 3. Alcance real de la protección ─────────────────────────────────────────
// No es un fallo: es el hecho que ADR-007 documenta y que conviene reimprimir en
// cada corrida, para que nadie vuelva a suponer que la RLS cubre toda la app.
{
  const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM "${table}"`);
  console.log(
    `\nAlcance: una query SIN withCompanyContext ve ${n} de ${total} filas ` +
      `(todas las empresas).\nEl aislamiento de esas rutas lo sostiene el guard aplicativo ` +
      `(ADR-004 / ADR-041), no la base de datos.`,
  );
}

if (failures.length > 0) {
  console.error(`\nRLS NO aísla como se espera: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nLa RLS aísla correctamente cuando se invoca.");
