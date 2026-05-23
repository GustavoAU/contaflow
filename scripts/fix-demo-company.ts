#!/usr/bin/env node
/**
 * scripts/fix-demo-company.ts
 *
 * Aplica las correcciones GL a la empresa demo:
 *
 *   PC-03 — Asigna cuentas GL en CompanySettings (inventario 1115, retención IVA 2110)
 *   PC-01 — Crea asientos AJUSTE Dr 1115 / Cr 5110 para facturas de compra mal contabilizadas
 *   GAP-06 — Rellena datos del CPC en CompanySettings
 *   PC-05 — Cierra el período activo (opcional, con --close-period)
 *
 * USO (--env-file carga .env.local automáticamente en Node 20+):
 *
 *   # Vista previa (sin cambios):
 *   npx tsx --env-file=.env.local scripts/fix-demo-company.ts --company "Nombre Empresa"
 *
 *   # Aplicar correcciones (sin cerrar período):
 *   npx tsx --env-file=.env.local scripts/fix-demo-company.ts --company "Nombre Empresa" --execute
 *
 *   # Aplicar correcciones + cerrar período:
 *   npx tsx --env-file=.env.local scripts/fix-demo-company.ts --company "Nombre Empresa" --execute --close-period
 *
 *   # Ejemplo completo con datos de CPC:
 *   npx tsx --env-file=.env.local scripts/fix-demo-company.ts \
 *     --company "Demo VEN" \
 *     --cpc-name "Pedro Pérez" \
 *     --cpc-number "CPC-12345" \
 *     --execute --close-period
 *
 * VARIABLES DE ENTORNO (opcionales para GAP-06, alternativa a --cpc-name):
 *   CPC_NAME="Pedro Pérez"
 *   CPC_TITLE="Contador Público Colegiado"
 *   CPC_NUMBER="CPC-12345"
 *
 * NOTA: Requiere DATABASE_URL_DIRECT (o DATABASE_URL) en el entorno.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";

// ─── Argumentos de línea de comandos ─────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const COMPANY_NAME = getArg("--company") ?? "";
const EXECUTE = args.includes("--execute");
const CLOSE_PERIOD = args.includes("--close-period");
const FIX_ACCOUNTS = args.includes("--fix-accounts");     // corrige isCurrent en plan de cuentas
const VOID_DUPLICATES = args.includes("--void-duplicates"); // anula asientos AJUSTE duplicados

// Datos CPC — de args o env
const CPC_NAME = getArg("--cpc-name") ?? process.env.CPC_NAME ?? "";
const CPC_TITLE = getArg("--cpc-title") ?? process.env.CPC_TITLE ?? "Contador Público Colegiado";
const CPC_NUMBER = getArg("--cpc-number") ?? process.env.CPC_NUMBER ?? "";

if (!COMPANY_NAME) {
  console.error("❌ Error: --company <nombre> es requerido");
  console.error("   Ej: npx tsx scripts/fix-demo-company.ts --company \"Demo VEN\"");
  process.exit(1);
}

// ─── Cliente Prisma con adapter-pg (requerido por Prisma 7.x) ────────────────
// Preferimos DATABASE_URL_DIRECT (bypass pool) para scripts; caemos a DATABASE_URL
const DB_URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌ DATABASE_URL (o DATABASE_URL_DIRECT) no está configurado");
  console.error("   Ejecuta con: npx tsx --env-file=.env scripts/fix-demo-company.ts ...");
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString: DB_URL,
  connectionTimeoutMillis: 15_000,
  max: 2, // scripts no necesitan más de 2 conexiones
});

const prisma = new PrismaClient({ adapter });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SEP = "─".repeat(70);

function log(msg: string) { console.log(msg); }
function ok(msg: string)  { console.log(`  ✅ ${msg}`); }
function warn(msg: string){ console.log(`  ⚠️  ${msg}`); }
function info(msg: string){ console.log(`  ℹ️  ${msg}`); }
function skip(msg: string){ console.log(`  ⏭️  ${msg}`); }
function dry(msg: string) { console.log(`  🔵 [DRY] ${msg}`); }

/** Genera el número correlativo para un asiento, igual que TransactionService */
async function generateTransactionNumber(companyId: string, date: Date): Promise<string> {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `${year}-${month}-`;

  const last = await prisma.transaction.findFirst({
    where: { companyId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  let sequence = 1;
  if (last) {
    const lastSeq = parseInt(last.number.replace(prefix, ""), 10);
    sequence = lastSeq + 1;
  }
  return `${prefix}${String(sequence).padStart(6, "0")}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log("");
  log(SEP);
  log(` ContaFlow — Script de Corrección GL`);
  log(` Empresa: "${COMPANY_NAME}"`);
  log(` Modo: ${EXECUTE ? "EJECUTAR (cambios reales)" : "DRY-RUN (solo vista previa)"}`);
  log(SEP);
  log("");

  // ── 1. Encontrar la empresa ──────────────────────────────────────────────────
  log("🔍 Buscando empresa...");

  const company = await prisma.company.findFirst({
    where: { name: { contains: COMPANY_NAME, mode: "insensitive" } },
    select: { id: true, name: true, rif: true },
  });

  if (!company) {
    console.error(`❌ No se encontró ninguna empresa con nombre que contenga "${COMPANY_NAME}"`);
    // Listar empresas disponibles
    const all = await prisma.company.findMany({ select: { name: true, id: true }, take: 10 });
    log("\nEmpresas disponibles:");
    all.forEach(c => log(`  • ${c.name} (${c.id})`));
    process.exit(1);
  }

  ok(`Empresa encontrada: "${company.name}" (id: ${company.id})`);
  const companyId = company.id;

  // ── 2. Encontrar el usuario OWNER ────────────────────────────────────────────
  const ownerMember = await prisma.companyMember.findFirst({
    where: { companyId, role: "OWNER" },
    select: { userId: true },
  });
  const userId = ownerMember?.userId ?? "script-fix";
  info(`UserId para asientos: ${userId}`);
  log("");

  // ── 3. Discovery: cuentas contables ─────────────────────────────────────────
  log("🔍 Buscando cuentas contables...");

  const accounts = await prisma.account.findMany({
    where: {
      companyId,
      deletedAt: null,
      code: { in: ["1115", "5110", "2110", "2105", "1305", "4110"] },
    },
    select: { id: true, code: true, name: true },
  });

  const byCode = Object.fromEntries(accounts.map(a => [a.code, a]));

  const acc1115 = byCode["1115"]; // Inventario de Mercancías
  const acc5110 = byCode["5110"]; // Costo de Ventas
  const acc2110 = byCode["2110"]; // Retenciones IVA por Pagar
  const acc2105 = byCode["2105"]; // IVA Débito Fiscal
  const acc1305 = byCode["1305"]; // Cuentas por Cobrar
  const acc4110 = byCode["4110"]; // Ventas

  log(`  Cuentas encontradas:`);
  [acc1115, acc5110, acc2110, acc2105, acc1305, acc4110].forEach(a => {
    if (a) ok(`${a.code} — ${a.name}`);
  });

  if (!acc1115) warn("No se encontró cuenta 1115 (Inventario). PC-03 y PC-01 serán omitidos.");
  if (!acc5110) warn("No se encontró cuenta 5110 (Costo de Ventas). PC-01 será omitido.");
  if (!acc2110) warn("No se encontró cuenta 2110 (Retenciones IVA). PC-03 parcial.");
  log("");

  // ── 4. Discovery: CompanySettings ────────────────────────────────────────────
  log("🔍 Estado actual de CompanySettings...");

  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: {
      id: true,
      inventoryAccountId: true,
      ivaRetentionPayableAccountId: true,
      accountantName: true,
      accountantTitle: true,
      accountantCpcNumber: true,
      stockControlLevel: true,
    },
  });

  if (!settings) {
    warn("CompanySettings no existe para esta empresa — se creará.");
  } else {
    info(`inventoryAccountId: ${settings.inventoryAccountId ?? "(sin configurar)"}`);
    info(`ivaRetentionPayableAccountId: ${settings.ivaRetentionPayableAccountId ?? "(sin configurar)"}`);
    info(`accountantName: ${settings.accountantName ?? "(sin configurar)"}`);
    info(`stockControlLevel: ${settings.stockControlLevel ?? "(sin configurar)"}`);
  }
  log("");

  // ── 5. Discovery: período activo ─────────────────────────────────────────────
  log("🔍 Período contable activo...");

  const activePeriod = await prisma.accountingPeriod.findFirst({
    where: { companyId, status: "OPEN" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  if (!activePeriod) {
    warn("No hay período OPEN — los asientos de corrección (PC-01) no se podrán crear.");
    warn("Abre un período en Configuración antes de ejecutar el script.");
  } else {
    ok(`Período activo: ${activePeriod.month}/${activePeriod.year} (id: ${activePeriod.id})`);
  }
  log("");

  // ── 6. Discovery: JournalEntries mal contabilizadas (PC-01) ──────────────────
  log("🔍 Buscando asientos de compra con Dr 5110 incorrecto (PC-01)...");

  let wrongEntries: Array<{
    id: string;
    amount: Decimal;
    transactionId: string;
    transactionNumber: string;
    transactionDate: Date;
    transactionDescription: string;
  }> = [];

  if (acc5110) {
    const raw = await prisma.journalEntry.findMany({
      where: {
        accountId: acc5110.id,
        amount: { gt: 0 }, // solo débitos
        transaction: {
          companyId,
          status: "POSTED",
          type: "DIARIO", // facturas de compra auto-contabilizadas
        },
      },
      include: {
        transaction: {
          select: {
            id: true,
            number: true,
            date: true,
            description: true,
            invoices: {
              select: { id: true, type: true, invoiceNumber: true },
              take: 1,
            },
          },
        },
      },
    });

    // Filtrar solo los que vengan de facturas de COMPRA
    wrongEntries = raw
      .filter(e => {
        const inv = (e.transaction as { invoices?: { type: string }[] }).invoices?.[0];
        return inv?.type === "PURCHASE";
      })
      .map(e => ({
        id: e.id,
        amount: new Decimal(e.amount.toString()),
        transactionId: e.transaction.id,
        transactionNumber: e.transaction.number,
        transactionDate: e.transaction.date,
        transactionDescription: e.transaction.description,
      }));
  }

  // ── Deduplicación: excluir facturas que ya tienen asiento AJUSTE ────────────
  if (wrongEntries.length > 0) {
    const correctionRefs = wrongEntries.map(e => `AJUSTE-${e.transactionNumber}`);
    const alreadyFixed = await prisma.transaction.findMany({
      where: {
        companyId,
        type: "AJUSTE",
        status: { in: ["POSTED", "VOIDED"] }, // ignorar si ya existe (incluso anulado)
        reference: { in: correctionRefs },
      },
      select: { reference: true },
    });
    const doneRefs = new Set(alreadyFixed.map(t => t.reference).filter(Boolean) as string[]);
    const filtered = wrongEntries.filter(e => !doneRefs.has(`AJUSTE-${e.transactionNumber}`));
    if (filtered.length < wrongEntries.length) {
      info(`${wrongEntries.length - filtered.length} asiento(s) ya tienen corrección AJUSTE — omitidos (deduplicación).`);
    }
    wrongEntries = filtered;
  }

  if (wrongEntries.length === 0) {
    if (acc5110) {
      ok("No se encontraron débitos a 5110 en facturas de compra — PC-01 no es necesario.");
    }
  } else {
    warn(`Encontrados ${wrongEntries.length} asiento(s) con Dr 5110 en facturas de compra:`);
    wrongEntries.forEach(e => {
      log(`    • Asiento ${e.transactionNumber} | ${e.transactionDate.toISOString().slice(0,10)} | ${e.amount.toFixed(2)} Bs.`);
      log(`      Descripción: ${e.transactionDescription}`);
    });
    const total = wrongEntries.reduce((s, e) => s.plus(e.amount), new Decimal(0));
    info(`  Total a reclasificar: ${total.toFixed(2)} Bs.`);
  }
  log("");

  // ── 7. Discovery: Retenciones PENDING (RF-02) ────────────────────────────────
  log("🔍 Retenciones PENDING (RF-02 — solo informativo)...");

  const pendingRetentions = await prisma.retencion.findMany({
    where: { companyId, status: "PENDING", deletedAt: null },
    select: {
      id: true,
      type: true,
      providerName: true,
      providerRif: true,
      totalRetention: true,
      createdAt: true,
      voucherNumber: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (pendingRetentions.length === 0) {
    ok("No hay retenciones PENDING.");
  } else {
    warn(`${pendingRetentions.length} retención(es) PENDING — deben enterarse en la UI:`);
    pendingRetentions.forEach(r => {
      log(`    • ${r.voucherNumber ?? "(sin comprobante)"} | ${r.type} | ${r.providerName} | ${r.totalRetention.toFixed(2)} Bs.`);
    });
    info("  Para enterar: Módulo Retenciones → selecciona cada retención → 'Enterar'");
    info("  Necesitas: cuenta Retenciones por Pagar + cuenta Banco");
  }
  log("");

  // ─────────────────────────────────────────────────────────────────────────────
  log(SEP);
  log(" RESUMEN DE CAMBIOS A APLICAR");
  log(SEP);

  const changes: string[] = [];

  // PC-03
  if (acc1115 && (!settings?.inventoryAccountId || settings.inventoryAccountId !== acc1115.id)) {
    changes.push(`PC-03a: CompanySettings.inventoryAccountId → ${acc1115.code} (${acc1115.name})`);
  } else {
    skip("PC-03a: inventoryAccountId ya está configurado correctamente");
  }

  if (acc2110 && (!settings?.ivaRetentionPayableAccountId || settings.ivaRetentionPayableAccountId !== acc2110.id)) {
    changes.push(`PC-03b: CompanySettings.ivaRetentionPayableAccountId → ${acc2110.code} (${acc2110.name})`);
  } else {
    skip("PC-03b: ivaRetentionPayableAccountId ya está configurado correctamente");
  }

  // GAP-06
  if (CPC_NAME && CPC_NAME !== settings?.accountantName) {
    changes.push(`GAP-06: CompanySettings.accountantName → "${CPC_NAME}"`);
    changes.push(`GAP-06: CompanySettings.accountantTitle → "${CPC_TITLE}"`);
    if (CPC_NUMBER) changes.push(`GAP-06: CompanySettings.accountantCpcNumber → "${CPC_NUMBER}"`);
  } else if (!CPC_NAME) {
    skip("GAP-06: CPC_NAME no provisto (usa --cpc-name o env CPC_NAME)");
  } else {
    skip("GAP-06: datos CPC ya están configurados");
  }

  // PC-01
  if (wrongEntries.length > 0 && acc1115 && acc5110 && activePeriod) {
    changes.push(`PC-01: Crear ${wrongEntries.length} asiento(s) AJUSTE Dr 1115 / Cr 5110`);
  } else if (wrongEntries.length > 0 && !activePeriod) {
    warn("PC-01: hay entradas a corregir pero no hay período OPEN — omitido");
  } else if (wrongEntries.length > 0 && (!acc1115 || !acc5110)) {
    warn("PC-01: hay entradas a corregir pero faltan las cuentas 1115 o 5110");
  }

  // PC-05
  if (CLOSE_PERIOD && activePeriod) {
    changes.push(`PC-05: Cerrar período ${activePeriod.month}/${activePeriod.year}`);
  } else if (CLOSE_PERIOD && !activePeriod) {
    warn("PC-05: --close-period solicitado pero no hay período OPEN");
  } else if (!CLOSE_PERIOD && activePeriod) {
    skip("PC-05: período no se cerrará (agrega --close-period para cerrarlo)");
  }

  // isCurrent
  if (FIX_ACCOUNTS) {
    changes.push(`isCurrent: clasificar cuentas corrientes en Balance General`);
  } else {
    skip("isCurrent: agrega --fix-accounts para corregir clasificación en Balance General");
  }

  // VOID-DUPES
  if (VOID_DUPLICATES) {
    changes.push(`VOID-DUPES: Buscar y anular asientos AJUSTE duplicados`);
  } else {
    skip("VOID-DUPES: agrega --void-duplicates para anular asientos duplicados");
  }

  log("");
  if (changes.length === 0) {
    log("  ✅ No hay cambios necesarios — todo está en orden.");
  } else {
    changes.forEach(c => log(`  📌 ${c}`));
  }

  log("");

  if (!EXECUTE) {
    log("──────────────────────────────────────────────────────────────────────");
    log("  ℹ️  Modo DRY-RUN — no se realizaron cambios.");
    log("  ℹ️  Agrega --execute para aplicar los cambios.");
    if (CLOSE_PERIOD) {
      log("  ℹ️  --close-period está activado — se cerrará el período al ejecutar.");
    } else {
      log("  ℹ️  Agrega también --close-period para cerrar el período activo.");
    }
    log("──────────────────────────────────────────────────────────────────────");
    await prisma.$disconnect();
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EJECUCIÓN REAL
  // ═══════════════════════════════════════════════════════════════════════════
  log(SEP);
  log(" EJECUTANDO CAMBIOS...");
  log(SEP);
  log("");

  // ── Paso 1: PC-03 + GAP-06 — Actualizar CompanySettings ─────────────────────
  log("▶ Paso 1: Actualizando CompanySettings (PC-03 + GAP-06)...");

  const settingsData: Prisma.CompanySettingsUpdateInput = {};
  let settingsChanged = false;

  if (acc1115 && (!settings?.inventoryAccountId || settings.inventoryAccountId !== acc1115.id)) {
    settingsData.inventoryAccount = { connect: { id: acc1115.id } };
    settingsChanged = true;
    ok(`inventoryAccountId → ${acc1115.code} (${acc1115.name})`);
  }

  if (acc2110 && (!settings?.ivaRetentionPayableAccountId || settings.ivaRetentionPayableAccountId !== acc2110.id)) {
    settingsData.ivaRetentionPayableAccount = { connect: { id: acc2110.id } };
    settingsChanged = true;
    ok(`ivaRetentionPayableAccountId → ${acc2110.code} (${acc2110.name})`);
  }

  if (CPC_NAME && CPC_NAME !== settings?.accountantName) {
    settingsData.accountantName = CPC_NAME;
    settingsData.accountantTitle = CPC_TITLE;
    if (CPC_NUMBER) settingsData.accountantCpcNumber = CPC_NUMBER;
    settingsChanged = true;
    ok(`accountantName → "${CPC_NAME}"`);
    ok(`accountantTitle → "${CPC_TITLE}"`);
    if (CPC_NUMBER) ok(`accountantCpcNumber → "${CPC_NUMBER}"`);
  }

  if (settingsChanged) {
    if (settings) {
      await prisma.companySettings.update({
        where: { companyId },
        data: settingsData,
      });
    } else {
      await prisma.companySettings.create({
        data: {
          companyId,
          ...(acc1115 ? { inventoryAccountId: acc1115.id } : {}),
          ...(acc2110 ? { ivaRetentionPayableAccountId: acc2110.id } : {}),
          ...(CPC_NAME ? { accountantName: CPC_NAME, accountantTitle: CPC_TITLE } : {}),
          ...(CPC_NUMBER ? { accountantCpcNumber: CPC_NUMBER } : {}),
        },
      });
    }

    // AuditLog
    await prisma.auditLog.create({
      data: {
        companyId,
        entityId: companyId,
        entityName: "Company",
        action: "UPDATE",
        userId,
        ipAddress: null,
        userAgent: "fix-demo-company-script",
        newValue: { pc03: "GL accounts configured", gap06: CPC_NAME ? "CPC data set" : "skipped" },
      },
    });

    ok("CompanySettings actualizado y auditado.");
  } else {
    skip("CompanySettings no requería cambios.");
  }
  log("");

  // ── Paso 2: PC-01 — Asientos de corrección Dr 1115 / Cr 5110 ─────────────────
  if (wrongEntries.length > 0 && acc1115 && acc5110 && activePeriod) {
    log(`▶ Paso 2: Creando ${wrongEntries.length} asiento(s) AJUSTE (PC-01)...`);

    for (const entry of wrongEntries) {
      const date = new Date(); // hoy — dentro del período abierto
      const number = await generateTransactionNumber(companyId, date);
      const description = `Corrección GL — Reclasificación COGS→Inventario para asiento ${entry.transactionNumber} (PC-01)`;

      await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
          data: {
            number,
            companyId,
            userId,
            description,
            reference: `AJUSTE-${entry.transactionNumber}`,
            date,
            type: "AJUSTE",
            periodId: activePeriod.id,
            entries: {
              create: [
                {
                  // Dr 1115 Inventario de Mercancías
                  accountId: acc1115.id,
                  description: `Reclasificación inventario (original: ${entry.transactionNumber})`,
                  amount: entry.amount, // positivo = débito
                },
                {
                  // Cr 5110 Costo de Ventas
                  accountId: acc5110.id,
                  description: `Reverso COGS incorrecto (original: ${entry.transactionNumber})`,
                  amount: entry.amount.negated(), // negativo = crédito
                },
              ],
            },
          },
          select: { id: true, number: true },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityId: created.id,
            entityName: "Transaction",
            action: "CREATE",
            userId,
            ipAddress: null,
            userAgent: "fix-demo-company-script",
            newValue: {
              type: "AJUSTE",
              description,
              amount: entry.amount.toFixed(2),
              dr: acc1115.code,
              cr: acc5110.code,
            },
          },
        });

        ok(`Asiento ${created.number} — Dr ${acc1115.code} / Cr ${acc5110.code} por ${entry.amount.toFixed(2)} Bs.`);
      });
    }

    log("");
  } else if (wrongEntries.length > 0) {
    skip("PC-01: condiciones no cumplidas (ver advertencias arriba)");
    log("");
  } else {
    skip("PC-01: no hay asientos a corregir");
    log("");
  }

  // ── Paso 3: PC-05 — Cerrar período ───────────────────────────────────────────
  if (CLOSE_PERIOD && activePeriod) {
    log(`▶ Paso 3: Cerrando período ${activePeriod.month}/${activePeriod.year} (PC-05)...`);
    warn("  El cierre genera snapshots de saldo para todas las cuentas con movimientos.");
    warn("  Después del cierre, deberás abrir el período de Mayo en Configuración.");

    // Importar PeriodSnapshotService inline para generar snapshots (necesario para cierre correcto)
    // Como no podemos importar servicios de Next.js aquí directamente, hacemos el cierre básico:
    const closed = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountingPeriod.update({
        where: { id: activePeriod.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: updated.id,
          entityName: "AccountingPeriod",
          action: "CLOSE",
          userId,
          ipAddress: null,
          userAgent: "fix-demo-company-script",
          newValue: updated as object,
        },
      });

      return updated;
    });

    ok(`Período ${closed.month}/${closed.year} cerrado en ${closed.closedAt?.toISOString()}`);
    warn("  NOTA: Los snapshots de saldo NO se generaron en este script.");
    warn("  Para snapshot completo, usa la función 'Cerrar período' en la UI en su lugar.");
    log("");
  } else if (!CLOSE_PERIOD) {
    skip("PC-05: período NO cerrado (agrega --close-period para cerrarlo)");
    log("");
  }

  // ── Paso 4: isCurrent — clasificación corriente/no corriente ─────────────────
  if (FIX_ACCOUNTS) {
    log("▶ Paso 4: Corrigiendo isCurrent en plan de cuentas (Balance General)...");

    // VEN-NIF BA-10 / IAS 1: clasificación por código de cuenta
    // Current ASSETS: 11xx (caja/bancos), 12xx (inversiones corto plazo),
    //                 13xx (CxC, anticipos), 14xx (inventarios, prepagados)
    // Current LIABILITIES: 21xx (AP corto plazo), 22xx (Proveedores), 23xx (impuestos)
    const CURRENT_ASSET_PREFIXES = ["11", "12", "13", "14"];
    const CURRENT_LIABILITY_PREFIXES = ["21", "22", "23", "24"];

    // Cuentas que deben ser corrientes
    const toMarkCurrent = await prisma.account.findMany({
      where: {
        companyId,
        isCurrent: false,
        OR: [
          ...CURRENT_ASSET_PREFIXES.map(p => ({ code: { startsWith: p } })),
          ...CURRENT_LIABILITY_PREFIXES.map(p => ({ code: { startsWith: p } })),
        ],
      },
      select: { id: true, code: true, name: true },
    });

    if (toMarkCurrent.length === 0) {
      ok("isCurrent ya está configurado correctamente en todas las cuentas.");
    } else {
      if (!EXECUTE) {
        dry(`Marcaría ${toMarkCurrent.length} cuenta(s) como isCurrent = true:`);
        toMarkCurrent.forEach(a => dry(`  ${a.code} — ${a.name}`));
      } else {
        const updated = await prisma.account.updateMany({
          where: { id: { in: toMarkCurrent.map(a => a.id) } },
          data: { isCurrent: true },
        });
        ok(`${updated.count} cuenta(s) actualizadas a isCurrent = true:`);
        toMarkCurrent.forEach(a => ok(`  ${a.code} — ${a.name}`));
      }
    }
    log("");
  } else if (!EXECUTE) {
    skip("Clasificación isCurrent: agrega --fix-accounts para corregir el Balance General");
    log("");
  }

  // ── Paso 5: VOID-DUPES — Anular asientos AJUSTE duplicados ───────────────────
  if (VOID_DUPLICATES) {
    log("▶ Paso 5: Buscando asientos AJUSTE duplicados (--void-duplicates)...");

    // Buscar todos los AJUSTE activos con referencia AJUSTE-xxx
    const allAjustes = await prisma.transaction.findMany({
      where: {
        companyId,
        type: "AJUSTE",
        status: "POSTED",
        reference: { startsWith: "AJUSTE-" },
      },
      include: {
        entries: { select: { accountId: true, amount: true, description: true } },
      },
      orderBy: { number: "asc" }, // el primero (menor número) es el canónico
    });

    // Agrupar por referencia
    const byRef = new Map<string, typeof allAjustes>();
    for (const t of allAjustes) {
      if (!t.reference) continue;
      if (!byRef.has(t.reference)) byRef.set(t.reference, []);
      byRef.get(t.reference)!.push(t);
    }

    // Los duplicados son todos salvo el primero en cada grupo
    const toVoid: typeof allAjustes = [];
    for (const [ref, group] of byRef.entries()) {
      if (group.length > 1) {
        info(`  Referencia "${ref}": ${group.length} asientos — conservando ${group[0].number}, anulando el resto.`);
        toVoid.push(...group.slice(1));
      }
    }

    if (toVoid.length === 0) {
      ok("No se encontraron asientos AJUSTE duplicados.");
    } else {
      warn(`Encontrados ${toVoid.length} asiento(s) duplicado(s) — serán anulados.`);
      toVoid.forEach(t => warn(`  ${t.number} (ref: ${t.reference})`));

      if (!activePeriod) {
        warn("No hay período OPEN — los asientos de anulación no se pueden crear.");
        warn("Abre un período para Mayo (o el mes actual) y vuelve a ejecutar --void-duplicates.");
      } else {
        for (const dup of toVoid) {
          const voidDate = new Date();
          const voidNumber = await generateTransactionNumber(companyId, voidDate);
          const voidDesc = `ANULACIÓN: Asiento duplicado ${dup.number} — corrección GL (fix-demo-company)`;

          await prisma.$transaction(async (tx) => {
            // Crear asiento espejo con montos invertidos (patrón TransactionService.voidTransaction)
            const voidTx = await tx.transaction.create({
              data: {
                number: voidNumber,
                companyId,
                userId,
                description: voidDesc,
                reference: dup.reference ?? undefined,
                date: voidDate,
                type: "AJUSTE",
                status: "POSTED",
                periodId: activePeriod.id,
                entries: {
                  create: dup.entries.map(e => ({
                    accountId: e.accountId,
                    amount: new Decimal(e.amount.toString()).negated(),
                    description: e.description ? `ANULACIÓN: ${e.description}` : undefined,
                  })),
                },
              },
              select: { id: true, number: true },
            });

            // Marcar duplicado como VOIDED y vincular con el asiento de anulación
            await tx.transaction.update({
              where: { id: dup.id },
              data: { status: "VOIDED", voidedById: voidTx.id },
            });

            await tx.auditLog.create({
              data: {
                companyId,
                entityId: dup.id,
                entityName: "Transaction",
                action: "VOID",
                userId,
                ipAddress: null,
                userAgent: "fix-demo-company-script --void-duplicates",
                oldValue: { number: dup.number, reference: dup.reference, status: "POSTED" },
                newValue: { voidTx: voidTx.number, reason: "Duplicate AJUSTE — script PC-01 ran twice" },
              },
            });

            ok(`Anulado ${dup.number} → asiento reverso ${voidTx.number}`);
          });
        }
        ok(`${toVoid.length} asiento(s) duplicado(s) anulados exitosamente.`);
      }
    }
    log("");
  } else {
    skip("VOID-DUPES: agrega --void-duplicates para anular asientos duplicados.");
    log("");
  }

  // ── Resumen final ─────────────────────────────────────────────────────────────
  log(SEP);
  log(" COMPLETADO");
  log(SEP);
  log("");

  if (pendingRetentions.length > 0) {
    warn(`RF-02: Quedan ${pendingRetentions.length} retención(es) PENDING — estos deben enterarse manualmente en la UI:`);
    pendingRetentions.forEach(r => {
      log(`   • ${r.voucherNumber ?? "(sin comprobante)"} | ${r.providerName} | ${r.totalRetention.toFixed(2)} Bs.`);
    });
    log("");
  }

  if (!CLOSE_PERIOD && activePeriod) {
    info(`El período ${activePeriod.month}/${activePeriod.year} sigue OPEN.`);
    info(`Para cerrarlo: vuelve a ejecutar con --execute --close-period`);
    info(`O ve a Configuración → Períodos → Cerrar período en la UI.`);
    log("");
  }

  log("✅ Script finalizado exitosamente.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
