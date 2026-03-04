import 'dotenv/config';
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function test() {
  console.log("🚀 Probando conexión estándar...")
  try {
    const res = await prisma.$queryRaw`SELECT 1 as connected`
    console.log("✅ CONECTADO:", res)
  } catch (e) {
    console.error("❌ ERROR:", e)
  } finally {
    await prisma.$disconnect()
  }
}

test()