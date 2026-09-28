#!/usr/bin/env node
/**
 * scripts/backfill-fiscal-year.ts
 *
 * ADR-055 — Backfill de FiscalYear para empresas Alpha existentes bajo el
 * modelo viejo de AccountingPeriod (mensual, secuencial, sin agrupación de
 * ejercicio). Ver .claude/adr/ADR-055-ejercicio-fiscal-anual.md §Plan de
 * migración para el algoritmo completo.
 *
 * Por cada (companyId, year) con al menos un AccountingPeriod:
 *   - status = CLOSED si ya existe FiscalYearClose{companyId, year}, si no OPEN.
 *   - Crea (o reutiliza) FiscalYear{companyId, year, startMonth:1, status}.
 *     startMonth=1 siempre es correcto aquí: ninguna empresa existente usa
 *     régimen distinto del regular hoy (hecho verificado en ADR-055).
 *   - Asigna fiscalYearId a todos los AccountingPeriod del grupo.
 *   - Si CLOSED: asigna fiscalYearId al FiscalYearClose correspondiente.
 *   - Paso sensible — el único grupo OPEN por empresa (el ejercicio en curso):
 *     crea los AccountingPeriod de los meses 1-12 que falten (en OPEN) y
 *     REABRE cualquier mes de ese grupo que haya sido cerrado individualmente
 *     bajo el flujo viejo (nunca fue un cierre real en términos VEN-NIF sin
 *     FiscalYearClose para ese año) — cada reapertura genera un AuditLog
 *     BACKFILL_REOPEN.
 *
 * Idempotente: cada paso hace upsert/skip-if-exists por (companyId, year) —
 * correrlo dos veces no duplica ni corrompe nada.
 *
 * USO:
 *   # Vista previa (sin cambios) — SIEMPRE correr esto primero:
 *   npx tsx --env-file=.env.local scripts/backfill-fiscal-year.ts
 *
 *   # Aplicar:
 *   npx tsx --env-file=.env.local scripts/backfill-fiscal-year.ts --execute
 *
 * Requiere DATABASE_URL_DIRECT (o DATABASE_URL) en el entorno.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const EXECUTE = process.argv.includes("--execute");

const DB_URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌ DATABASE_URL (o DATABASE_URL_DIRECT) no está configurado");
  console.error("   Ejecuta con: npx tsx --env-file=.env.local scripts/backfill-fiscal-year.ts");
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString: DB_URL,
  connectionTimeoutMillis: 15_000,
  max: 2,
});
const prisma = new PrismaClient({ adapter });

const SEP = "─".repeat(70);
function log(msg: string) { console.log(msg); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }
function dry(msg: string) { console.log(`  🔵 [DRY] ${msg}`); }

const SYSTEM_USER = "system-backfill-adr055";

async function main() {
  log("");
  log(SEP);
  log(" ADR-055 — Backfill FiscalYear");
  log(` Modo: ${EXECUTE ? "EJECUTAR (cambios reales)" : "DRY-RUN (solo vista previa)"}`);
  log(SEP);
  log("");

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  info(`${companies.length} empresa(s) en la base de datos.`);
  log("");

  let totalFiscalYearsCreated = 0;
  let totalFiscalYearsReused = 0;
  let totalPeriodsLinked = 0;
  let totalPeriodsCreated = 0;
  let totalPeriodsReopened = 0;

  for (const company of companies) {
    const periods = await prisma.accountingPeriod.findMany({
      where: { companyId: company.id },
      select: { id: true, year: true, month: true, status: true },
    });
    if (periods.length === 0) continue; // demo/onboarding nuevo — sin tocar

    const byYear = new Map<number, typeof periods>();
    for (const p of periods) {
      if (!byYear.has(p.year)) byYear.set(p.year, []);
      byYear.get(p.year)!.push(p);
    }

    log(`▶ Empresa "${company.name}" (${company.id}) — ${byYear.size} año(s) con períodos`);

    for (const [year, group] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
      const fiscalClose = await prisma.fiscalYearClose.findUnique({
        where: { companyId_year: { companyId: company.id, year } },
        select: { id: true, fiscalYearId: true, closedAt: true, closedBy: true },
      });
      const status = fiscalClose ? "CLOSED" : "OPEN";

      let fiscalYear = await prisma.fiscalYear.findUnique({
        where: { companyId_year: { companyId: company.id, year } },
        select: { id: true, status: true },
      });

      if (fiscalYear) {
        totalFiscalYearsReused++;
        info(`  Año ${year}: FiscalYear ya existe (${fiscalYear.status}) — reutilizando.`);
      } else {
        totalFiscalYearsCreated++;
        if (EXECUTE) {
          fiscalYear = await prisma.fiscalYear.create({
            data: {
              companyId: company.id,
              year,
              startMonth: 1,
              status,
              openedBy: SYSTEM_USER,
              // Hallazgo LOW security-agent: antes dejaba closedAt/closedBy en NULL para un
              // FiscalYear backfilleado en CLOSED (dato inconsistente — "cerrado" sin metadata
              // de cierre). fiscalClose siempre existe aquí porque status==="CLOSED" se deriva
              // exactamente de su existencia (ver arriba).
              ...(status === "CLOSED" && fiscalClose
                ? { closedAt: fiscalClose.closedAt, closedBy: fiscalClose.closedBy }
                : {}),
            },
            select: { id: true, status: true },
          });
          ok(`  Año ${year}: FiscalYear creado (${status}, id: ${fiscalYear.id})`);
        } else {
          dry(`Año ${year}: crearía FiscalYear (startMonth:1, status:${status})`);
        }
      }

      // Asignar fiscalYearId a los períodos del grupo que aún no lo tengan.
      const unlinked = group.filter((p) => true); // re-chequeo real contra DB abajo
      if (EXECUTE && fiscalYear) {
        const result = await prisma.accountingPeriod.updateMany({
          where: { companyId: company.id, year, fiscalYearId: null },
          data: { fiscalYearId: fiscalYear.id },
        });
        totalPeriodsLinked += result.count;
        if (result.count > 0) ok(`  Año ${year}: ${result.count} período(s) vinculados a FiscalYear`);
      } else {
        dry(`Año ${year}: vincularía ${unlinked.length} período(s) existentes a FiscalYear`);
      }

      // FiscalYearClose.fiscalYearId
      if (fiscalClose && !fiscalClose.fiscalYearId) {
        if (EXECUTE && fiscalYear) {
          await prisma.fiscalYearClose.update({
            where: { id: fiscalClose.id },
            data: { fiscalYearId: fiscalYear.id },
          });
          ok(`  Año ${year}: FiscalYearClose vinculado a FiscalYear`);
        } else {
          dry(`Año ${year}: vincularía FiscalYearClose existente a FiscalYear`);
        }
      }

      // ── Paso sensible: solo para el grupo OPEN (el ejercicio en curso) ──────
      if (status === "OPEN") {
        const existingMonths = new Set(group.map((p) => p.month));
        const missingMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(
          (m) => !existingMonths.has(m)
        );
        const closedMonthsToReopen = group.filter((p) => p.status === "CLOSED");

        if (missingMonths.length > 0) {
          warn(`  Año ${year}: faltan ${missingMonths.length} mes(es) — ${missingMonths.join(", ")}`);
          if (EXECUTE && fiscalYear) {
            for (const month of missingMonths) {
              await prisma.accountingPeriod.create({
                data: {
                  companyId: company.id,
                  year,
                  month,
                  status: "OPEN",
                  openedBy: SYSTEM_USER,
                  fiscalYearId: fiscalYear.id,
                },
              });
              totalPeriodsCreated++;
            }
            ok(`  Año ${year}: ${missingMonths.length} mes(es) creados en OPEN`);
          } else {
            dry(`Año ${year}: crearía los meses faltantes ${missingMonths.join(", ")} en OPEN`);
          }
        }

        if (closedMonthsToReopen.length > 0) {
          warn(
            `  Año ${year}: ${closedMonthsToReopen.length} mes(es) cerrados individualmente bajo el flujo viejo, sin FiscalYearClose para el año — se reabrirán: ${closedMonthsToReopen.map((p) => p.month).join(", ")}`
          );
          if (EXECUTE) {
            for (const p of closedMonthsToReopen) {
              await prisma.$transaction(async (tx) => {
                const updated = await tx.accountingPeriod.update({
                  where: { id: p.id },
                  data: { status: "OPEN", closedAt: null, closedBy: null },
                });
                await tx.auditLog.create({
                  data: {
                    companyId: company.id,
                    entityId: p.id,
                    entityName: "AccountingPeriod",
                    action: "BACKFILL_REOPEN",
                    userId: SYSTEM_USER,
                    ipAddress: null,
                    userAgent: "backfill-fiscal-year.ts (ADR-055)",
                    oldValue: { status: "CLOSED", month: p.month, year: p.year },
                    newValue: { status: updated.status, month: p.month, year: p.year },
                  },
                });
              });
              totalPeriodsReopened++;
            }
            ok(`  Año ${year}: ${closedMonthsToReopen.length} mes(es) reabiertos (con AuditLog BACKFILL_REOPEN)`);
          } else {
            dry(
              `Año ${year}: reabriría ${closedMonthsToReopen.length} mes(es) — ${closedMonthsToReopen
                .map((p) => p.month)
                .join(", ")} (con AuditLog BACKFILL_REOPEN)`
            );
          }
        }
      }
    }
    log("");
  }

  log(SEP);
  log(" RESUMEN");
  log(SEP);
  info(`FiscalYear creados: ${totalFiscalYearsCreated}`);
  info(`FiscalYear ya existentes (reutilizados): ${totalFiscalYearsReused}`);
  info(`AccountingPeriod vinculados a un FiscalYear: ${totalPeriodsLinked}`);
  info(`AccountingPeriod nuevos creados (meses faltantes del ejercicio en curso): ${totalPeriodsCreated}`);
  info(`AccountingPeriod reabiertos (cierre individual bajo el flujo viejo): ${totalPeriodsReopened}`);
  log("");

  if (!EXECUTE) {
    log("ℹ️  Modo DRY-RUN — no se realizó ningún cambio. Agrega --execute para aplicar.");
  } else {
    log("✅ Backfill completado.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
