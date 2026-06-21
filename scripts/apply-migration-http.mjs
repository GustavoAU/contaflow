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

// Quita comentarios de línea (--) y parte por ';'. Sirve para DDL simple
// (sin cuerpos de función ni ';' embebidos), que es el caso de estas migraciones.
const statements = raw
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

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
