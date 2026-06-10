// prisma.config.ts  ← en la raíz del proyecto
//
// Next.js carga automáticamente .env → .env.local (con override), pero el CLI
// de Prisma invoca este archivo directamente y solo ve dotenv/config que carga .env.
// Leemos .env.local manualmente con fs (sin dependencia extra) para que
// DATABASE_URL_DIRECT esté disponible en `prisma db execute` y `prisma migrate`.
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const eq = clean.indexOf("=");
    if (eq < 1) continue;
    const key = clean.slice(0, eq).trim();
    const val = clean.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    process.env[key] = val; // .env.local sobreescribe .env (mismo orden que Next.js)
  }
}

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
