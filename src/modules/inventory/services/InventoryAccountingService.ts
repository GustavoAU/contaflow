// src/modules/inventory/services/InventoryAccountingService.ts
// Dominio ACCOUNTANT — aprobación de movimientos, generación de asientos, anulación
// NUNCA importar desde InventoryOperationsService — comunicación solo via estado de InventoryMovement

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { assertBalancedGLEntries, quantizeGLEntries } from "@/lib/gl-assertions";
import type { PostMovementInput, VoidMovementInput } from "../schemas/inventory-movement.schema";
import {
  resolveLotAllocations,
  validateLotAllocation,
  applyLotMovement,
  voidLotMovement,
} from "./LotTrackingService";
import {
  createSerials,
  validateSerialAvailability,
  applySerialMovement,
  voidSerialMovement,
} from "./SerialTrackingService";
import { p2002TargetIncludes } from "@/lib/prisma-errors";
import { assertEntradaCounterpart, assertMovementPeriodOpen } from "./inventory-guards";

const MSG_FACTURA_SIN_ASIENTO =
  "La factura de esta entrada aún no tiene asiento contable. Contabilice la factura antes de registrar la entrada de inventario.";
// Un solo texto para "no es una factura de compra de esta empresa" y "el movimiento no es línea de
// ella": el usuario no necesita (ni debe) saber cuál de las dos falló, y no se filtra si la factura
// existe en otra empresa.
const MSG_FACTURA_NO_ES_COMPRA =
  "La entrada indica una factura que no es una factura de compra de esta empresa, o de la cual no es una línea. No se puede contabilizar: elimine este borrador y registre la entrada sin factura, con su contrapartida.";
const MSG_ASIENTO_FACTURA_NO_VIGENTE =
  "El asiento de la factura de esta entrada no está vigente (anulado). No se puede registrar la entrada de inventario.";
// M-1 (paliativo): InventoryMovement.transactionId es único, y InvoiceService enlaza TODOS los
// movimientos de una factura al mismo asiento. La solución de fondo (relación 1:N) es otra spec.
const MSG_OTRA_ENTRADA_ENLAZADA =
  "Esta factura ya tiene otra entrada de inventario enlazada a su asiento. Por ahora el sistema solo admite una entrada de inventario por factura; esta limitación está en revisión.";
const MSG_ANULAR_ENTRADA_DE_FACTURA =
  "Esta entrada pertenece a una factura: anule la factura o emita una nota de crédito.";
const MSG_ANULAR_ASIENTO_NO_CUADRA =
  "El asiento original de este movimiento no cuadra (dato previo, por ejemplo sin contrapartida). No se puede anular automáticamente; corrija con un asiento manual.";

// Cómo se contabiliza una ENTRADA (null en SALIDA / AJUSTE). Se decide ANTES de escribir nada:
//  - FACTURA: la factura ya tiene su asiento (Dr Inventario / Cr Proveedores); se enlaza a él.
//  - CONTRAPARTIDA: sin factura, la entrada crea su propio asiento Dr Inventario / Cr contrapartida.
type EntradaDestino =
  | { via: "FACTURA"; transactionId: string }
  | { via: "CONTRAPARTIDA"; accountId: string };

// ─── postMovement: DRAFT → POSTED  (Serializable SSI obligatorio) ─────────────
// Actualiza averageCost + stockQuantity + genera Transaction + JournalEntry atómicamente.
// Si P2034 (write-write conflict): caller retorna error descriptivo — sin retry automático.
// Ningún camino crea un asiento de una sola línea (SPEC-007, RN-5): toda ENTRADA lleva
// contrapartida o se enlaza al asiento de su factura.

export async function postMovement(
  input: PostMovementInput,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
) {
  const { movementId, companyId } = input;

  try {
    return await prisma.$transaction(
      async (tx) => {
        // CRITICAL-1: verificar ownership y estado
        const movement = await tx.inventoryMovement.findFirstOrThrow({
          where: { id: movementId, companyId },
          include: { item: true },
        });

        if (movement.status !== "DRAFT") {
          throw new Error(
            `Solo se pueden contabilizar movimientos en DRAFT. Estado actual: ${movement.status}`
          );
        }

        const item = movement.item;

        // Validar cuentas configuradas en el ítem
        if (!item.accountId) {
          throw new Error(
            `El ítem "${item.name}" no tiene cuenta de inventario configurada. Configure la cuenta antes de contabilizar.`
          );
        }
        if (!item.cogsAccountId && movement.type !== "ENTRADA") {
          throw new Error(
            `El ítem "${item.name}" no tiene cuenta de costo (COGS) configurada. Configure la cuenta antes de contabilizar.`
          );
        }

        // ── Validaciones de negocio: TODAS antes de la primera escritura ──────
        // Un rechazo no puede dejar stock, asiento, estado ni auditoría a medias (el rollback del
        // $transaction lo cubriría, pero validar primero es la regla).

        // PA-7 / R-3: createDraftMovement ya mira el período, pero un borrador creado con el período
        // abierto se puede contabilizar después de cerrarlo.
        await assertMovementPeriodOpen(tx, companyId, movement.date);

        let entrada: EntradaDestino | null = null;
        if (movement.type === "ENTRADA") {
          if (movement.invoiceId) {
            // RN-4 / PA-3: con factura NO se crea asiento propio (duplicaría el débito a Inventario
            // en el Libro Mayor). Si la factura aún no tiene asiento, no se registra la entrada.
            // H-1 (PA-9): enlazar el asiento de una factura es heredar SU contabilidad, así que antes
            // se exige que sea una COMPRA de la empresa, que este movimiento sea línea vigente de
            // ella y que su asiento sea de la empresa y esté vigente. Sin esto, una entrada ligada a
            // una factura de venta (o ajena a la línea) quedaba contabilizada sin débito a Inventario.
            const invoice = await tx.invoice.findFirst({
              where: { id: movement.invoiceId, companyId, deletedAt: null }, // ADR-004
              select: { type: true, transactionId: true },
            });
            if (!invoice) throw new Error(MSG_FACTURA_SIN_ASIENTO);
            if (invoice.type !== "PURCHASE") throw new Error(MSG_FACTURA_NO_ES_COMPRA);

            const invoiceLine = await tx.invoiceLine.findFirst({
              where: {
                companyId, // ADR-004
                invoiceId: movement.invoiceId,
                inventoryMovementId: movement.id,
                deletedAt: null,
              },
              select: { id: true },
            });
            if (!invoiceLine) throw new Error(MSG_FACTURA_NO_ES_COMPRA);

            if (!invoice.transactionId) throw new Error(MSG_FACTURA_SIN_ASIENTO);
            const invoiceTransaction = await tx.transaction.findFirst({
              where: { id: invoice.transactionId, companyId }, // ADR-004: nunca el asiento de otra empresa
              select: { id: true, status: true },
            });
            if (!invoiceTransaction) throw new Error(MSG_FACTURA_SIN_ASIENTO);
            if (invoiceTransaction.status !== "POSTED") {
              throw new Error(MSG_ASIENTO_FACTURA_NO_VIGENTE);
            }
            entrada = { via: "FACTURA", transactionId: invoiceTransaction.id };
          } else {
            // RN-1..RN-3: sin factura, la contrapartida es obligatoria y debe ser válida.
            const accountId = await assertEntradaCounterpart(tx, {
              companyId,
              accountId: movement.counterpartAccountId,
              inventoryAccountId: item.accountId,
            });
            entrada = { via: "CONTRAPARTIDA", accountId };
          }
        }

        // ── Calcular nuevos valores de stock (CPP) ────────────────────────────
        const qty = new Decimal(movement.quantity);
        const unitCostSnapshot = new Decimal(movement.unitCost);
        const currentStock = new Decimal(item.stockQuantity);
        const currentAvgCost = new Decimal(item.averageCost);

        let newStock: Decimal;
        let newAvgCost: Decimal;

        if (movement.type === "ENTRADA") {
          // CPP: nuevo_avg = (stock × avg + qty × unitCost) / (stock + qty)
          newStock = currentStock.plus(qty);
          newAvgCost = newStock.isZero()
            ? unitCostSnapshot
            : currentStock.mul(currentAvgCost).plus(qty.mul(unitCostSnapshot)).div(newStock);
        } else {
          // SALIDA o AJUSTE — verifica stock suficiente (HIGH-4 race condition guard)
          if (currentStock.lt(qty)) {
            throw new Error(`Stock insuficiente: disponible ${currentStock}, solicitado ${qty}`);
          }
          newStock = currentStock.minus(qty);
          newAvgCost = currentAvgCost; // CPP no cambia en salidas
        }

        // ── Actualizar stock del ítem ─────────────────────────────────────────
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: {
            stockQuantity: newStock,
            averageCost: newAvgCost,
          },
        });

        // ADR-058 (R-1): el costo total del movimiento (cantidad × CPP) se redondea a 2 decimales
        // en el origen del POST y se persiste así; el costo unitario CPP es un factor y se queda.
        const totalCost = new Decimal(movement.totalCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

        // ── Asiento contable ──────────────────────────────────────────────────
        // ENTRADA con factura: no crea asiento; se enlaza al de la factura (RN-4).
        // ENTRADA sin factura: Dr Inventario / Cr contrapartida (RN-2).
        // SALIDA / AJUSTE:     Dr COGS / Cr Inventario (asiento autosuficiente).
        let ledgerTransaction: { id: string };
        let glResidual = new Decimal(0);
        let glAbsorbedIndex: number | null = null;

        if (entrada?.via === "FACTURA") {
          ledgerTransaction = { id: entrada.transactionId };
        } else {
          // Usa date-based prefix + cuid suffix para evitar P2002 por race condition
          // (count+1 puede colisionar si dos Serializables corren simultáneamente)
          const dateTag = movement.date.toISOString().slice(0, 7).replace("-", ""); // YYYYMM
          const txNumber = `INV-${dateTag}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

          const baseDesc = `${movement.type} inventario — ${item.name} × ${qty}`;
          const rawJournalEntries: {
            accountId: string;
            amount: Decimal;
            description: string;
            noAbsorb?: boolean;
          }[] = entrada
            ? [
                // Partida doble completa: Dr Inventario / Cr Contrapartida
                {
                  accountId: item.accountId,
                  amount: totalCost,
                  description: `${baseDesc} — inventario`,
                  noAbsorb: true, // auxiliar de inventario = kardex
                },
                {
                  accountId: entrada.accountId,
                  amount: totalCost.negated(),
                  description: `${baseDesc} — contrapartida`,
                },
              ]
            : [
                // SALIDA / AJUSTE: Dr COGS / Cr Inventario (siempre balanceado)
                {
                  accountId: item.cogsAccountId!,
                  amount: totalCost,
                  description: `COGS — Costo ${movement.type.toLowerCase()} ${item.name} × ${qty}`,
                },
                {
                  accountId: item.accountId,
                  amount: totalCost.negated(),
                  description: `${baseDesc}`,
                  noAbsorb: true, // auxiliar de inventario = kardex
                },
              ];

          // ADR-058: cuantizar al céntimo ANTES de verificar y de persistir.
          const quantized = quantizeGLEntries(rawJournalEntries);
          const journalEntries = quantized.entries;
          glResidual = quantized.residual;
          glAbsorbedIndex = quantized.absorbedIndex;

          // N4: el cuadre se verifica SIEMPRE (RN-5): no existe asiento de inventario incompleto.
          assertBalancedGLEntries(journalEntries);
          ledgerTransaction = await tx.transaction.create({
            data: {
              companyId,
              number: txNumber,
              date: movement.date,
              description: `Inventario ${movement.type}: ${item.name} × ${qty}`,
              type: "DIARIO",
              userId,
              entries: {
                create: journalEntries.map((e) => ({
                  accountId: e.accountId,
                  amount: e.amount,
                  description: e.description,
                })),
              },
            },
          });
        }

        // ── Fase 35G: Lot/Serial Tracking — ADR-021 D-5 ──────────────────────
        // companyId proviene de la DB (movement.companyId), nunca del input del cliente.
        let fefoOverridden: boolean | null = null;

        if (item.trackingType === "LOT") {
          const movType = movement.type as "ENTRADA" | "SALIDA" | "AJUSTE";
          if (movType === "ENTRADA") {
            if (!input.lotData) {
              throw new Error(
                "Se requiere lotData para movimientos de ENTRADA con seguimiento por lote"
              );
            }
            await applyLotMovement(
              tx,
              movement.companyId,
              item.id,
              movementId,
              movType,
              qty,
              [],
              userId,
              {
                lotNumber: input.lotData.lotNumber,
                expiresAt: input.lotData.expiresAt ? new Date(input.lotData.expiresAt) : null,
                notes: input.lotData.notes ?? null,
                receivedAt: input.lotData.receivedAt
                  ? new Date(input.lotData.receivedAt)
                  : undefined,
              }
            );
            fefoOverridden = false;
          } else {
            // SALIDA o AJUSTE: resolver allocations (manual o FEFO)
            const { allocations, fefoOverridden: overridden } = await resolveLotAllocations(
              tx,
              movement.companyId,
              item.id,
              qty,
              input.lotAllocations
            );
            await validateLotAllocation(tx, movement.companyId, item.id, qty, allocations);
            await applyLotMovement(
              tx,
              movement.companyId,
              item.id,
              movementId,
              movType,
              qty,
              allocations,
              userId
            );
            fefoOverridden = overridden;
          }
        } else if (item.trackingType === "SERIAL") {
          const movType = movement.type as "ENTRADA" | "SALIDA" | "AJUSTE";
          if (movType === "ENTRADA") {
            if (!input.serialNumbers || input.serialNumbers.length === 0) {
              throw new Error(
                "Se requiere serialNumbers para movimientos de ENTRADA con seguimiento por número de serie"
              );
            }
            if (!new Decimal(input.serialNumbers.length).equals(qty)) {
              throw new Error(
                `La cantidad de números de serie (${input.serialNumbers.length}) debe coincidir con la cantidad del movimiento (${qty})`
              );
            }
            await createSerials(
              tx,
              movement.companyId,
              item.id,
              movementId,
              input.serialNumbers,
              userId
            );
          } else {
            // SALIDA o AJUSTE: validar y marcar seriales
            if (!input.serialIds || input.serialIds.length === 0) {
              throw new Error(
                "Se requiere serialIds para movimientos de SALIDA con seguimiento por número de serie"
              );
            }
            await validateSerialAvailability(tx, movement.companyId, item.id, input.serialIds, qty);
            await applySerialMovement(tx, movement.companyId, item.id, movementId, input.serialIds);
          }
        }

        // ── Marcar movimiento como POSTED ─────────────────────────────────────
        let posted;
        try {
          posted = await tx.inventoryMovement.update({
            where: { id: movementId },
            data: {
              status: "POSTED",
              transactionId: ledgerTransaction.id,
              postedAt: new Date(),
              postedBy: userId,
              unitCost: unitCostSnapshot, // snapshot CPP al momento de post
              totalCost,
            },
          });
        } catch (err) {
          // M-1: solo la rama FACTURA enlaza un asiento que ya existe (el de la contrapartida es
          // recién creado y no puede chocar). `p2002TargetIncludes` y no `meta.target` a mano: con
          // Prisma 7.8 + Neon esa clave no existe (LL-014).
          if (entrada?.via === "FACTURA" && p2002TargetIncludes(err, "transactionId")) {
            throw new Error(MSG_OTRA_ENTRADA_ENLAZADA);
          }
          throw err;
        }

        // ── AuditLog ──────────────────────────────────────────────────────────
        await tx.auditLog.create({
          data: {
            companyId,
            entityId: movementId,
            entityName: "InventoryMovement",
            action: "POST",
            userId,
            ipAddress,
            userAgent,
            oldValue: {
              status: "DRAFT",
              stockBefore: currentStock.toString(),
              avgCostBefore: currentAvgCost.toString(),
            },
            newValue: {
              status: "POSTED",
              stockAfter: newStock.toString(),
              avgCostAfter: newAvgCost.toString(),
              transactionId: ledgerTransaction.id,
              // ENTRADA con factura: el asiento es el de la factura, no uno propio (trazabilidad)
              ...(entrada?.via === "FACTURA" && { invoiceId: movement.invoiceId }),
              // L-1: ENTRADA contabilizada por contrapartida: contra qué cuenta se acreditó
              ...(entrada?.via === "CONTRAPARTIDA" && { counterpartAccountId: entrada.accountId }),
              ...(!glResidual.isZero()
                ? {
                    glRounding: {
                      residual: glResidual.toString(),
                      absorbedIndex: glAbsorbedIndex,
                      scale: 2,
                    },
                  }
                : {}),
              // fefoOverridden: trazabilidad de bypass FEFO para ítems LOT (ADR-021 MEDIUM-1)
              ...(fefoOverridden !== null && { fefoOverridden }),
            },
          },
        });

        return {
          movement: posted,
          transaction: ledgerTransaction,
          stockAfter: newStock,
          avgCostAfter: newAvgCost,
        };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err: unknown) {
    // P2034: write-write conflict bajo Serializable SSI
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2034") {
      throw new Error("Conflicto de concurrencia — reintente la operación");
    }
    throw err;
  }
}

// ─── voidPostedMovement: POSTED → VOIDED (Serializable) ──────────────────────
// Revierte el stock y genera un contra-asiento en la misma transacción atómica.
// El contra-asiento es la negación exacta de las LÍNEAS GUARDADAS del asiento original (RN-6, M-2).
// ENTRADA ligada a factura se rechaza; sin asiento original (o sin líneas) solo se revierte el
// stock; un asiento original que no cuadra se rechaza. Nunca un asiento de una sola línea.

export async function voidPostedMovement(
  input: VoidMovementInput,
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
) {
  const { movementId, companyId, notes } = input;

  try {
    return await prisma.$transaction(
      async (tx) => {
        // CRITICAL-1: verificar ownership y estado
        const movement = await tx.inventoryMovement.findFirstOrThrow({
          where: { id: movementId, companyId },
          include: { item: true },
        });

        if (movement.status !== "POSTED") {
          throw new Error(
            `Solo se pueden anular movimientos en POSTED. Estado actual: ${movement.status}`
          );
        }

        const item = movement.item;
        const qty = new Decimal(movement.quantity);
        const currentStock = new Decimal(item.stockQuantity);

        // ── Qué contra-asiento corresponde: se decide ANTES de la primera escritura ──
        // M-2 / RN-6: la anulación deriva de las LÍNEAS GUARDADAS del asiento original, nunca de lo
        // que hoy digan el ítem o el movimiento: si el ítem se reconfiguró entre contabilizar y
        // anular, un contra-asiento armado con sus cuentas de hoy caería en cuentas distintas a las
        // del original y falsearía el mayor. null = no hay asiento que contrarrestar (solo se
        // revierte el stock).
        if (movement.type === "ENTRADA" && movement.invoiceId) {
          // Su asiento es el de la factura: contrarrestar solo el movimiento dejaría la
          // contabilidad descuadrada con la factura. Se anula la factura o se emite nota de crédito.
          // Se rechaza SIEMPRE y antes de leer nada, aunque el movimiento no tenga asiento enlazado.
          throw new Error(MSG_ANULAR_ENTRADA_DE_FACTURA);
        }

        let rawCounterEntries:
          | {
              accountId: string;
              amount: Decimal;
              description: string | null;
              customerId?: string;
              vendorId?: string;
              partnerId?: string;
              employeeId?: string;
            }[]
          | null = null;
        // Sin `transactionId` (dato previo: producción tiene entradas sin asiento) no hay nada que reversar.
        if (movement.transactionId) {
          const originalLines = await tx.journalEntry.findMany({
            // ADR-004: el asiento se acota por empresa a través de su Transaction
            where: { transactionId: movement.transactionId, transaction: { companyId } },
            select: {
              accountId: true,
              amount: true,
              description: true,
              customerId: true,
              vendorId: true,
              partnerId: true,
              employeeId: true,
            },
          });

          // Asiento sin líneas visibles (o de otra empresa): tampoco hay nada que contrarrestar.
          if (originalLines.length > 0) {
            const lines = originalLines.map((l) => ({
              accountId: l.accountId,
              amount: new Decimal(l.amount),
              description: l.description,
              customerId: l.customerId,
              vendorId: l.vendorId,
              partnerId: l.partnerId,
              employeeId: l.employeeId,
            }));
            // Un asiento original que no suma 0 (p. ej. el de una sola línea de antes de la SPEC-007)
            // no se puede espejar: su espejo tampoco cuadraría. Cuadre EXACTO, sin tolerancia.
            const originalSum = lines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));
            if (!originalSum.isZero()) throw new Error(MSG_ANULAR_ASIENTO_NO_CUADRA);

            // Cada línea se niega exacta: misma cuenta, monto opuesto. ADR-054: se conserva el
            // tercero de la línea original; sin él, el gate de Prisma bloquearía la anulación de
            // una línea cuya cuenta exige tercero (VOID siempre debe ser posible, R-3/ADR-005).
            rawCounterEntries = lines.map((l) => ({
              accountId: l.accountId,
              amount: l.amount.negated(),
              description: l.description ? `Anulación — ${l.description}` : null,
              customerId: l.customerId ?? undefined,
              vendorId: l.vendorId ?? undefined,
              partnerId: l.partnerId ?? undefined,
              employeeId: l.employeeId ?? undefined,
            }));
          }
        }

        // Revertir stock según tipo
        let newStock: Decimal;
        if (movement.type === "ENTRADA") {
          newStock = currentStock.minus(qty);
          if (newStock.lt(0)) {
            throw new Error("No se puede anular: el stock resultante sería negativo");
          }
        } else {
          newStock = currentStock.plus(qty);
        }

        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { stockQuantity: newStock },
        });

        // Contra-asiento (solo si hay asiento original que contrarrestar)
        let voidTx: { id: string } | null = null;
        if (rawCounterEntries) {
          const txCount = await tx.transaction.count({ where: { companyId } });
          const txNumber = `INV-VOID-${String(txCount + 1).padStart(6, "0")}`;

          // ADR-058 B2: la anulación deriva de lo ya guardado → negación EXACTA (sin cuantizar).
          const { entries: counterEntries } = quantizeGLEntries(rawCounterEntries, {
            mode: "exact",
          });

          // N4: el cuadre se verifica SIEMPRE (RN-5): ningún contra-asiento queda incompleto.
          // (Redundante con el chequeo del asiento original, pero este es el invariante central.)
          assertBalancedGLEntries(counterEntries);
          voidTx = await tx.transaction.create({
            data: {
              companyId,
              number: txNumber,
              date: new Date(),
              description: `ANULACIÓN Inventario ${movement.type}: ${item.name} × ${qty}${notes ? ` — ${notes}` : ""}`,
              type: "AJUSTE",
              userId,
              entries: { create: counterEntries },
            },
          });
        }

        // ── Fase 35G: revertir lotes/seriales antes de marcar VOIDED (ADR-021 HIGH-1) ─
        if (item.trackingType === "LOT") {
          await voidLotMovement(
            tx,
            movement.companyId,
            movementId,
            movement.type as "ENTRADA" | "SALIDA" | "AJUSTE"
          );
        } else if (item.trackingType === "SERIAL") {
          await voidSerialMovement(
            tx,
            movement.companyId,
            movementId,
            movement.type as "ENTRADA" | "SALIDA" | "AJUSTE"
          );
        }

        // Marcar movimiento como VOIDED
        const voided = await tx.inventoryMovement.update({
          where: { id: movementId },
          data: { status: "VOIDED" },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityId: movementId,
            entityName: "InventoryMovement",
            action: "VOID_POSTED",
            userId,
            ipAddress,
            userAgent,
            oldValue: { status: "POSTED", stock: currentStock.toString() },
            newValue: {
              status: "VOIDED",
              stockAfter: newStock.toString(),
              voidTransactionId: voidTx?.id ?? null,
              notes: notes ?? null,
            },
          },
        });

        return { movement: voided, voidTransaction: voidTx, stockAfter: newStock };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2034") {
      throw new Error("Conflicto de concurrencia — reintente la operación");
    }
    throw err;
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryValuation(companyId: string) {
  const items = await prisma.inventoryItem.findMany({
    // ADR-004: companyId en where
    where: { companyId, deletedAt: null },
    select: {
      id: true,
      sku: true,
      name: true,
      baseUnitName: true,
      stockQuantity: true,
      averageCost: true,
      trackingType: true,
    },
    orderBy: { name: "asc" },
  });

  const totalValue = items.reduce(
    (sum, item) => sum.plus(new Decimal(item.stockQuantity).mul(new Decimal(item.averageCost))),
    new Decimal(0)
  );

  return { items, totalValue };
}

export async function getPendingMovements(companyId: string) {
  return prisma.inventoryMovement.findMany({
    // ADR-004: companyId en where
    where: { companyId, status: "DRAFT" },
    include: { item: true },
    orderBy: { createdAt: "asc" },
  });
}

// ─── autoPostMovementInTx: OM-01 — contabilización inline durante creación de factura ──
//
// Contabiliza un movimiento DRAFT dentro de la transacción ya abierta por InvoiceService.
// Solo aplica a ítems con trackingType = NONE (LOT/SERIAL requieren datos adicionales → manual).
//
// SALIDA (factura de venta):  crea Dr COGS / Cr Inventario (CPP) en nuevo asiento.
// ENTRADA (factura de compra): reutiliza la transacción GL de la factura (ya tiene Dr Inventario)
//   → solo actualiza stock/CPP y marca el movimiento como POSTED.
//
// Si las cuentas de GL no están configuradas en el ítem, el movimiento queda en DRAFT
// para contabilización manual — no lanza error (evita bloquear la factura).
//
// Invariante: se llama SIEMPRE dentro de una $transaction existente (no crea una nueva).
export async function autoPostMovementInTx(
  tx: Prisma.TransactionClient,
  movementId: string,
  companyId: string,
  userId: string,
  invoiceGLTransactionId: string | null // para ENTRADA: transactionId del asiento de la factura
): Promise<void> {
  const movement = await tx.inventoryMovement.findFirst({
    where: { id: movementId, companyId, status: "DRAFT" },
    include: {
      item: {
        select: {
          id: true,
          name: true,
          stockQuantity: true,
          averageCost: true,
          accountId: true,
          cogsAccountId: true,
          trackingType: true,
        },
      },
    },
  });

  if (!movement) return; // movimiento no encontrado, ya posted, o IDOR → skip silencioso

  const item = movement.item;

  // Solo contabilizar ítems sin tracking (LOT/SERIAL requieren datos de lote → manual)
  if (item.trackingType !== "NONE") return;

  const qty = new Decimal(movement.quantity.toString());
  const unitCost = new Decimal(movement.unitCost.toString());
  // ADR-058 (R-1): costo total del documento a 2 decimales en el origen del POST.
  const totalCost = new Decimal(movement.totalCost.toString()).toDecimalPlaces(
    2,
    Decimal.ROUND_HALF_UP
  );
  const currentStock = new Decimal(item.stockQuantity.toString());
  const currentAvgCost = new Decimal(item.averageCost.toString());

  let newStock: Decimal;
  let newAvgCost: Decimal;
  let glTransactionId: string;

  if (movement.type === "ENTRADA") {
    // CPP: nuevo_avg = (stock × avg + qty × unitCost) / (stock + qty)
    newStock = currentStock.plus(qty);
    newAvgCost = newStock.isZero()
      ? unitCost
      : currentStock.mul(currentAvgCost).plus(qty.mul(unitCost)).div(newStock);

    // Reutilizar GL de la factura (la factura ya tiene Dr Inventario / Cr Proveedores)
    // Si no hay transactionId de factura, no podemos contabilizar → dejar en DRAFT
    if (!invoiceGLTransactionId || !item.accountId) return;
    glTransactionId = invoiceGLTransactionId;
  } else {
    // SALIDA / AJUSTE: stock baja (puede quedar negativo si WARN); CPP sin cambio
    newStock = currentStock.minus(qty);
    newAvgCost = currentAvgCost;

    // Necesitamos accountId (Inventario) + cogsAccountId (COGS) del ítem
    if (!item.cogsAccountId || !item.accountId) return; // sin config GL → dejar DRAFT

    // Crear asiento Dr COGS / Cr Inventario
    const txCount = await tx.transaction.count({ where: { companyId } });
    const txNumber = `INV-${String(txCount + 1).padStart(6, "0")}`;

    const rawCogsEntries = [
      {
        accountId: item.cogsAccountId,
        amount: totalCost,
        description: `COGS venta — ${item.name}`,
      },
      {
        accountId: item.accountId,
        amount: totalCost.negated(),
        description: `Inventario salida — ${item.name} × ${qty.toFixed(4)} u.`,
        noAbsorb: true, // auxiliar de inventario = kardex
      },
    ];
    // ADR-058: cuantizar al céntimo ANTES de verificar y de persistir (sin residuo: ±mismo monto).
    const { entries: cogsEntries } = quantizeGLEntries(rawCogsEntries);
    // N4: invariante de partida doble
    assertBalancedGLEntries(cogsEntries);
    const journalTx = await tx.transaction.create({
      data: {
        companyId,
        number: txNumber,
        date: movement.date,
        description: `COGS — Salida inventario ${item.name} × ${qty.toFixed(4)}`,
        type: "DIARIO",
        userId,
        entries: {
          create: cogsEntries.map((e) => ({
            accountId: e.accountId,
            amount: e.amount,
            description: e.description,
          })),
        },
      },
    });
    glTransactionId = journalTx.id;
  }

  // Actualizar stock del ítem
  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { stockQuantity: newStock, averageCost: newAvgCost },
  });

  // Marcar movimiento como POSTED
  await tx.inventoryMovement.update({
    where: { id: movementId },
    data: {
      status: "POSTED",
      transactionId: glTransactionId,
      postedAt: new Date(),
      postedBy: userId,
      unitCost, // snapshot al momento de post
      totalCost,
    },
  });
}
