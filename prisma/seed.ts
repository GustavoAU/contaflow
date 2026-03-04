// prisma/seed.ts
import { PrismaClient, AccountType, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🚀 Seeding database...");

  // ─── 1. Usuario admin (tu cuenta de Clerk) ────────────────────────────────
  const user = await prisma.user.upsert({
    where: { id: "user_3ASUXQGjepsTxT5W6AcIyytnqdf" },
    update: {},
    create: {
      id: "user_3ASUXQGjepsTxT5W6AcIyytnqdf",
      email: "admin@contaflow.com", // cambia por tu email real
      name: "Admin ContaFlow",
      role: UserRole.ADMIN,
    },
  });
  console.log(`✅ Usuario: ${user.name}`);

  // ─── 2. Empresa demo ──────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { rif: "J-12345678-9" },
    update: {},
    create: {
      name: "Empresa Demo C.A.",
      rif: "J-12345678-9",
      address: "Caracas, Venezuela",
    },
  });
  console.log(`✅ Empresa: ${company.name}`);

  // ─── 3. Asignar usuario como ADMIN de la empresa ──────────────────────────
  await prisma.companyMember.upsert({
    where: {
      userId_companyId: {
        userId: user.id,
        companyId: company.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      companyId: company.id,
      role: UserRole.ADMIN,
    },
  });
  console.log(`✅ Miembro: ${user.name} → ${company.name} (ADMIN)`);

  // ─── 4. Cuentas contables de la empresa demo ──────────────────────────────
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
      where: {
        companyId_code: {
          companyId: company.id,
          code: account.code,
        },
      },
      update: {},
      create: {
        name: account.name,
        code: account.code,
        type: account.type,
        companyId: company.id,
      },
    });
    console.log(`  ✅ ${account.code} - ${account.name}`);
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
