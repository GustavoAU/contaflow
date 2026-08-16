// scripts/verify-schema-drift.mjs — Índices ÚNICOS que la BD tiene y el schema NO declara
//
// Complementa a verify-rls.mjs (policies) y verify-rls-runtime.mjs (comportamiento).
// Esto vigila una tercera cosa: que la unicidad real de la BD sea la que
// `schema.prisma` dice. Un único que sobra es invisible para Prisma —no aparece en
// los tipos, no rompe el build, no falla ningún test— y sólo se manifiesta como un
// P2002 en producción, con un mensaje genérico y sin pista del motivo.
//
// MOTIVACIÓN (2026-08-16): `RetentionSequence` tenía un `CREATE UNIQUE INDEX ... ON
// ("companyId")` de marzo que la migración de junio intentó quitar con
// `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`. Sobre un ÍNDICE suelto eso es un
// NO-OP SILENCIOSO. El índice sobrevivió y dejó la tabla en una fila por empresa,
// mientras el código hacía upsert por (companyId, year, month): la primera retención
// de cada mes nuevo fallaba. Llevaba roto desde julio y nadie se enteró, porque
// ninguna capa de verificación miraba esto.
//
//   node scripts/verify-schema-drift.mjs
//
// Exit 0 = sin drift; exit 1 = hay unicidad no declarada (la lista).
// Solo LECTURAS sobre catálogos de Postgres.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL no encontrada en .env.local");
let url = line.slice("DATABASE_URL=".length).trim();
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
const sql = neon(url);

// ─── 1. Unicidad DECLARADA en schema.prisma ───────────────────────────────────
// Se compara por CONJUNTO DE COLUMNAS, nunca por nombre: Postgres trunca los
// identificadores a 63 bytes, así que los nombres largos generan falsos positivos.
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** Nombre de tabla real: `@@map("x")` si existe, si no el del modelo. */
function tableOf(modelName, body) {
  const mapped = /@@map\(\s*"([^"]+)"\s*\)/.exec(body);
  return mapped ? mapped[1] : modelName;
}

/** Columna real de un campo: `@map("x")` si existe. */
function columnOf(body, fieldName) {
  const re = new RegExp(`^\\s+${fieldName}\\s+\\S+.*$`, "m");
  const m = re.exec(body);
  if (m) {
    const mapped = /@map\(\s*"([^"]+)"\s*\)/.exec(m[0]);
    if (mapped) return mapped[1];
  }
  return fieldName;
}

const declared = new Set(); // "tabla::col1,col2"
const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
let m;
while ((m = modelRe.exec(schema)) !== null) {
  const [, modelName, body] = m;
  const table = tableOf(modelName, body);

  // `@unique` de columna
  for (const fm of body.matchAll(/^\s+(\w+)\s+\S+[^\n]*@unique[^\n]*$/gm)) {
    declared.add(`${table}::${columnOf(body, fm[1])}`);
  }
  // `@@unique([a, b])`
  for (const bm of body.matchAll(/@@unique\(\s*\[([^\]]+)\]/g)) {
    const cols = bm[1].split(",").map((c) => columnOf(body, c.trim()));
    declared.add(`${table}::${cols.join(",")}`);
  }
  // `@@id([a, b])` — clave primaria compuesta, también unicidad legítima
  for (const im of body.matchAll(/@@id\(\s*\[([^\]]+)\]/g)) {
    const cols = im[1].split(",").map((c) => columnOf(body, c.trim()));
    declared.add(`${table}::${cols.join(",")}`);
  }
}

// ─── 2. Unicidad REAL en la base de datos ─────────────────────────────────────
// Se excluyen: PK (Prisma la declara con @id), índices PARCIALES (Prisma no soporta
// WHERE en @@unique — son deliberadamente "no declarables", ver Fix A3 y ADR-035) y
// los de expresión.
const rows = await sql.query(`
  SELECT rel.relname AS tabla,
         i.relname   AS indice,
         ARRAY(
           SELECT a.attname
             FROM unnest(x.indkey[0:x.indnkeyatts-1]) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
            ORDER BY k.ord
         ) AS cols
    FROM pg_index x
    JOIN pg_class     i   ON i.oid   = x.indexrelid
    JOIN pg_class     rel ON rel.oid = x.indrelid
    JOIN pg_namespace n   ON n.oid   = rel.relnamespace
   WHERE n.nspname = 'public'
     AND x.indisunique
     AND NOT x.indisprimary
     AND x.indpred  IS NULL
     AND x.indexprs IS NULL
   ORDER BY 1, 2
`);

// El driver HTTP puede devolver los arrays de Postgres ya parseados o como
// literal `{a,b}`. Se normaliza a array de strings.
function toCols(value) {
  if (Array.isArray(value)) return value;
  return String(value).replace(/^\{|\}$/g, "").split(",").filter(Boolean).map((c) => c.replace(/^"|"$/g, ""));
}
for (const r of rows) r.cols = toCols(r.cols);

const orphans = rows.filter((r) => !declared.has(`${r.tabla}::${r.cols.join(",")}`));

console.log(
  `Índices únicos en la BD (sin PK ni parciales): ${rows.length} · declarados en schema.prisma: ${rows.length - orphans.length}`,
);

if (orphans.length > 0) {
  console.table(orphans.map((o) => ({ tabla: o.tabla, indice: o.indice, columnas: o.cols.join(", ") })));
  console.error(
    "\nDRIFT: la BD impone unicidad que el schema NO declara.\n" +
      "Prisma no la ve, así que no hay tipo, ni build, ni test que la detecte —\n" +
      "sólo un P2002 en producción con mensaje genérico. Revisa si sobra (migración\n" +
      "de DROP) o si falta declararla en schema.prisma.\n" +
      "Causa habitual: un `DROP CONSTRAINT IF EXISTS` sobre algo que en realidad era\n" +
      "un `CREATE UNIQUE INDEX` — falla en silencio.",
  );
  process.exit(1);
}
console.log("Sin drift: la unicidad de la BD coincide con la declarada.");
