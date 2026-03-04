// prisma/seed.ts
import { PrismaClient, AccountType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import "dotenv/config";

// 1. Setup the connection for Prisma 7
const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

// 2. Pass the adapter to the constructor
const prisma = new PrismaClient({ adapter });

async function main() {
  const accounts: { name: string; code: string; type: AccountType }[] = [
    { name: "Caja General", code: "1105", type: AccountType.ASSET },
    { name: "Bancos", code: "1110", type: AccountType.ASSET },
    { name: "Cuentas por Cobrar", code: "1305", type: AccountType.ASSET },
    { name: "Proveedores", code: "2205", type: AccountType.LIABILITY },
    { name: "Ventas", code: "4135", type: AccountType.REVENUE },
    { name: "Gastos de Personal", code: "5105", type: AccountType.EXPENSE },
  ];

  console.log("🚀 Seeding accounts...");

  for (const account of accounts) {
    await prisma.account.upsert({
      where: { code: account.code },
      update: {}, 
      create: {
        name: account.name,
        code: account.code,
        type: account.type,
      },
    });
  }

  console.log("✅ Seeding finished!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });