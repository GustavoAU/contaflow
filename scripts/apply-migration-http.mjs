// Aplica una migración Prisma por HTTP 443 (driver serverless de Neon), sorteando
// el bloqueo del TCP 5432 que impone la VPN (prisma db execute/migrate resolve
// fallan con P1001 bajo VPN). Hace el bookkeeping en _prisma_migrations, así que
// reemplaza a `prisma db execute` + `prisma migrate resolve --applied`.
//
// Uso:  node scripts/apply-migration-http.mjs <nombre_carpeta_migracion>
// Luego: npx prisma generate   (no toca la DB, funciona con VPN)
//
// Requisitos: las sentencias de migration.sql deben ser idempotentes
// (IF NOT EXISTS / DROP ... IF EXISTS antes de CREATE) por si se reintenta.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const MIGRATION = process.argv[2];
if (!MIGRATION) {
  console.error("Uso: node scripts/apply-migration-http.mjs <nombre_carpeta_migracion>");
  process.exit(1);
}

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const found = env.match(/^DATABASE_URL=(.*)$/m);
if (!found) {
  console.error("✗ DATABASE_URL no encontrada en .env.local");
  process.exit(1);
}
const DATABASE_URL = found[1].trim().replace(/^["']|["']$/g, "");
const sql = neon(DATABASE_URL);

const FILE = new URL(`../prisma/migrations/${MIGRATION}/migration.sql`, import.meta.url);
const raw = readFileSync(FILE, "utf8");
const checksum = createHash("sha256").update(readFileSync(FILE)).digest("hex");

/**
 * Parte el SQL en sentencias respetando los `;` EMBEBIDOS.
 *
 * La versión anterior hacía `split(";")` a secas y sólo servía para DDL simple —
 * lo decía su propio comentario. Se rompió con la primera migración que trajo un
 * bloque `DO $$ … $$` (20260816), con el error "unterminated dollar-quoted string".
 * Y volvería a romperse con ADR-044 D-4, que necesita una función plpgsql.
 *
 * Reconoce: cadenas entrecomilladas ('...' con '' escapado), identificadores
 * ("..."), comentarios de línea (--) y de bloque, y dollar-quoting con etiqueta
 * ($$ … $$ y $tag$ … $tag$, que pueden anidarse con etiquetas distintas).
 */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    // Comentario de línea. Se repone el "\n": en SQL un comentario equivale a
    // ESPACIO EN BLANCO, no a nada. Sin esto los tokens se pegan y se genera SQL
    // inválido — `... "y" text-- nota\nDEFAULT 'z'` salía como `textDEFAULT`.
    if (rest.startsWith("--")) {
      const nl = sql.indexOf("\n", i);
      buf += "\n";
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    // Comentario de bloque. Postgres SÍ permite anidarlos, así que se lleva
    // profundidad en vez de buscar el primer "*/" (`/* a /* b */ c */` dejaba
    // colgando `c */`). Se repone un espacio por el mismo motivo de arriba.
    if (rest.startsWith("/*")) {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.startsWith("/*", j)) { depth += 1; j += 2; continue; }
        if (sql.startsWith("*/", j)) { depth -= 1; j += 2; continue; }
        j += 1;
      }
      buf += " ";
      i = j;
      continue;
    }
    // Dollar-quoting: $$ … $$  ó  $etiqueta$ … $etiqueta$
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Literal de cadena o identificador entrecomillado.
    // En una cadena `E'…'` la barra invertida SÍ escapa (`E'a\'b'`); en las
    // normales, con standard_conforming_strings=on, no.
    if (rest[0] === "'" || rest[0] === '"') {
      const q = rest[0];
      const isEscapeString = q === "'" && /[Ee]$/.test(buf);
      let j = i + 1;
      while (j < sql.length) {
        if (isEscapeString && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === q) {
          if (sql[j + 1] === q) { j += 2; continue; } // '' escapado
          j += 1;
          break;
        }
        j += 1;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Fin de sentencia
    if (rest[0] === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    buf += sql[i];
    i += 1;
  }

  if (buf.trim()) out.push(buf.trim());
  return out;
}

const statements = splitStatements(raw);

try {
  const already = await sql.query(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1`, [MIGRATION]);
  if (already.length > 0) {
    console.log(`• ${MIGRATION} ya estaba aplicada (nada que hacer)`);
    process.exit(0);
  }

  for (const [i, stmt] of statements.entries()) {
    await sql.query(stmt);
    console.log(`✓ [${i + 1}/${statements.length}] ${stmt.slice(0, 72).replace(/\s+/g, " ")}…`);
  }

  await sql.query(
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
     VALUES ($1, $2, $3, now(), now(), $4)`,
    [randomUUID(), checksum, MIGRATION, statements.length],
  );
  console.log(`✓ Registrada en _prisma_migrations (${statements.length} pasos)`);
  console.log(`\n✅ ${MIGRATION} aplicada por HTTP (443). Ahora corre: npx prisma generate`);
} catch (e) {
  console.error("✗ Error:", e?.message ?? e);
  process.exit(1);
}
