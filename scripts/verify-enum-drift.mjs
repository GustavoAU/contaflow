// scripts/verify-enum-drift.mjs — columnas que schema.prisma declara como ENUM
// y la base de datos guarda con otro tipo.
//
// Complementa a verify-schema-drift.mjs (índices únicos), verify-rls.mjs
// (policies) y verify-rls-runtime.mjs (comportamiento). Esto vigila una cuarta
// cosa: que el TIPO real de cada columna enum sea el que el schema dice.
//
// MOTIVACIÓN (2026-08-30): `PayrollConfig.workSchedule` estaba declarado como
// `WorkSchedule` (enum) pero en la BD era TEXT, y el tipo enum ni siquiera
// existía. Prisma genera un cast a `"public"."WorkSchedule"` al escribir, así que
// GUARDAR LA CONFIGURACIÓN DE NÓMINA fallaba con:
//
//   prisma:error type "public.WorkSchedule" does not exist
//
// Llevaba roto desde mayo. Nadie lo vio porque LEER funciona —leer un TEXT no
// necesita el tipo— y sólo revienta al escribir; ni tsc, ni los tests con Prisma
// mockeado, ni el build lo alcanzan. Es exactamente el mismo patrón del índice
// único fantasma que tumbó las retenciones dos meses: deriva invisible que sólo
// aparece como error en producción.
//
//   node scripts/verify-enum-drift.mjs
//
// Exit 0 = sin deriva; exit 1 = hay columnas con el tipo equivocado.
// Solo LECTURAS sobre catálogos de Postgres.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
if (!line) throw new Error("DATABASE_URL no encontrada en .env.local");
let url = line.slice("DATABASE_URL=".length).trim();
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1);
const sql = neon(url);

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");

const enums = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]));

// Columnas que el schema declara con un tipo enum. Se ignoran las listas (`[]`):
// en Postgres son arrays y su udt_name lleva guion bajo delante.
const esperado = [];
for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, model, body] = m;
  const mapped = /@@map\(\s*"([^"]+)"\s*\)/.exec(body);
  const tabla = mapped ? mapped[1] : model;
  for (const f of body.matchAll(/^\s{2}(\w+)\s+(\w+)(\??)(\[\])?/gm)) {
    const [, campo, tipo, , esArray] = f;
    if (esArray || !enums.has(tipo)) continue;
    // Nombre real de la columna si lleva @map
    const linea = f[0];
    const conMap = new RegExp(`^\s{2}${campo}\s+[^\n]*@map\(\s*"([^"]+)"\s*\)`, "m").exec(body);
    esperado.push({ tabla, campo: conMap ? conMap[1] : campo, tipo, linea: linea.trim() });
  }
}

const cols = await sql`
  SELECT table_name AS t, column_name AS c, udt_name AS u
    FROM information_schema.columns
   WHERE table_schema = 'public'`;
const real = new Map(cols.map((r) => [`${r.t}.${r.c}`, r.u]));

const tiposEnBD = new Set(
  (await sql`SELECT typname FROM pg_type WHERE typtype = 'e'`).map((r) => r.typname),
);

const problemas = [];
for (const { tabla, campo, tipo } of esperado) {
  const udt = real.get(`${tabla}.${campo}`);
  // Columna ausente: es deriva de otra clase (falta la migración entera) y la
  // delata el propio Prisma al arrancar. Aquí sólo se miran las que existen.
  if (udt === undefined) continue;
  if (!tiposEnBD.has(tipo)) {
    problemas.push(`${tabla}.${campo}: el tipo "${tipo}" NO EXISTE en la base de datos`);
  } else if (udt !== tipo) {
    problemas.push(`${tabla}.${campo}: schema dice "${tipo}", la BD tiene "${udt}"`);
  }
}

console.log(`Columnas enum declaradas en schema.prisma: ${esperado.length}`);

if (problemas.length > 0) {
  console.error(`\n✗ ${problemas.length} columna(s) con deriva de tipo:\n`);
  for (const p of problemas) console.error("  - " + p);
  console.error(
    "\nEscribir en esas columnas falla en runtime con " +
    '`type "public.X" does not exist` o un error de cast. Las lecturas siguen ' +
    "funcionando, así que no se nota hasta que alguien guarda.",
  );
  process.exit(1);
}

console.log("Sin deriva: cada columna enum tiene en la BD el tipo que el schema declara.");
