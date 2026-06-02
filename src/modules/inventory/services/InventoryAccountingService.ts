// src/modules/inventory/services/InventoryAccountingService.ts
// Dominio ACCOUNTANT — aprobación de movimientos, generación de asientos, anulación
// NUNCA importar desde InventoryOperationsService — comunicación solo via estado de InventoryMovement

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
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

// ─── postMovement: DRAFT → POSTED  (Serializable SSI obligatorio) ─────────────
// Actualiza averageCost + stockQuantity + genera Transaction + JournalEntry atómicamente.
// Si P2034 (write-write conflict): caller retorna error descriptivo — sin retry automático.

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
            throw new Error(
              `Stock insuficiente: disponible ${currentStock}, solicitado ${qty}`
            );
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

        // ── Generar número de transacción ─────────────────────────────────────
        // Usa date-based prefix + cuid suffix para evitar P2002 por race condition
        // (count+1 puede colisionar si dos Serializables corren simultáneamente)
        const dateTag = movement.date.toISOString().slice(0, 7).replace("-", ""); // YYYYMM
        const txNumber = `INV-${dateTag}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        // ── Generar asiento contable ──────────────────────────────────────────
        const totalCost = new Decimal(movement.totalCost);

        // ENTRADA: Débito Inventario / Crédito contrapartida (CxP/Caja si está configurada)
        // SALIDA:  Débito COGS / Crédito Inventario (asiento autosuficiente)
        // AJUSTE:  igual que SALIDA — Débito COGS / Crédito Inventario
        //
        // R-04 auditoría SENIAT: si counterpartAccountId está presente en el movimiento,
        // se genera el asiento completo de partida doble (DR Inventario / CR contrapartida).
        // Si no está presente (movimientos legacy o vinculados a factura que ya tiene su propio
        // asiento via InvoiceGLPostingService), se crea solo el DR Inventario para actualizar
        // el saldo del Libro Mayor de la cuenta de inventario.
        const baseDesc = `${movement.type} inventario — ${item.name} × ${qty}`;
        const journalEntries =
          movement.type === "ENTRADA"
            ? movement.counterpartAccountId
              ? [
                  // Partida doble completa: Dr Inventario / Cr Contrapartida
                  { accountId: item.accountId, amount: totalCost, description: `${baseDesc} — inventario` },
                  { accountId: movement.counterpartAccountId, amount: totalCost.negated(), description: `${baseDesc} — contrapartida` },
                ]
              : [
                  // Entrada standalone (ej. stock inicial): solo Dr Inventario
                  // El Cr se genera vía InvoiceGLPostingService si hay factura asociada.
                  { accountId: item.accountId, amount: totalCost, description: `${baseDesc} — inventario` },
                ]
            : [
                // SALIDA / AJUSTE: Dr COGS / Cr Inventario (siempre balanceado)
                { accountId: item.cogsAccountId!, amount: totalCost, description: `COGS — Costo ${movement.type.toLowerCase()} ${item.name} × ${qty}` },
                { accountId: item.accountId, amount: totalCost.negated(), description: `${baseDesc}` },
              ];

        const journalTx = await tx.transaction.create({
          data: {
            companyId,
            number: txNumber,
            date: movement.date,
            description: `Inventario ${movement.type}: ${item.name} × ${qty}`,
            type: "DIARIO",
            userId,
            entries: { create: journalEntries },
          },
        });

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
                receivedAt: input.lotData.receivedAt ? new Date(input.lotData.receivedAt) : undefined,
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
            await applyLotMovement(tx, movement.companyId, item.id, movementId, movType, qty, allocations, userId);
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
            await validateSerialAvailability(
              tx,
              movement.companyId,
              item.id,
              input.serialIds,
              qty
            );
            await applySerialMovement(
              tx,
              movement.companyId,
              item.id,
              movementId,
              input.serialIds
            );
          }
        }

        // ── Marcar movimiento como POSTED ─────────────────────────────────────
        const posted = await tx.inventoryMovement.update({
          where: { id: movementId },
          data: {
            status: "POSTED",
            transactionId: journalTx.id,
            postedAt: new Date(),
            postedBy: userId,
            unitCost: unitCostSnapshot, // snapshot CPP al momento de post
            totalCost,
          },
        });

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
              transactionId: journalTx.id,
              // fefoOverridden: trazabilidad de bypass FEFO para ítems LOT (ADR-021 MEDIUM-1)
              ...(fefoOverridden !== null && { fefoOverridden }),
            },
          },
        });

        return {
          movement: posted,
          transaction: journalTx,
          stockAfter: newStock,
          avgCostAfter: newAvgCost,
        };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err: unknown) {
    // P2034: write-write conflict bajo Serializable SSI
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2034"
    ) {
      throw new Error("Conflicto de concurrencia — reintente la operación");
    }
    throw err;
  }
}

// ─── voidPostedMovement: POSTED → VOIDED (Serializable) ──────────────────────
// Revierte el stock y genera un contra-asiento en la misma transacción atómica.

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
        const totalCost = new Decimal(movement.totalCost);

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

        // Contra-asiento (entradas invertidas)
        const txCount = await tx.transaction.count({ where: { companyId } });
        const txNumber = `INV-VOID-${String(txCount + 1).padStart(6, "0")}`;

        const counterEntries =
          movement.type === "ENTRADA"
            ? [
                { accountId: item.accountId!, amount: totalCost.negated() },
              ]
            : [
                { accountId: item.cogsAccountId!, amount: totalCost.negated() },
                { accountId: item.accountId!, amount: totalCost },
              ];

        const voidTx = await tx.transaction.create({
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
              voidTransactionId: voidTx.id,
              notes: notes ?? null,
            },
          },
        });

        return { movement: voided, voidTransaction: voidTx, stockAfter: newStock };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2034"
    ) {
      throw new Error("Conflicto de concurrencia — reintente la operación");
    }
    throw err;
  }
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryValuation(companyId: string) {
  const items = await prisma.inventoryItem.findMany({ // ADR-004: companyId en where
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
    (sum, item) =>
      sum.plus(new Decimal(item.stockQuantity).mul(new Decimal(item.averageCost))),
    new Decimal(0)
  );

  return { items, totalValue };
}

export async function getPendingMovements(companyId: string) {
  return prisma.inventoryMovement.findMany({ // ADR-004: companyId en where
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
  invoiceGLTransactionId: string | null  // para ENTRADA: transactionId del asiento de la factura
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
  const totalCost = new Decimal(movement.totalCost.toString());
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

    const journalTx = await tx.transaction.create({
      data: {
        companyId,
        number: txNumber,
        date: movement.date,
        description: `COGS — Salida inventario ${item.name} × ${qty.toFixed(4)}`,
        type: "DIARIO",
        userId,
        entries: {
          create: [
            {
              accountId: item.cogsAccountId,
              amount: totalCost,
              description: `COGS venta — ${item.name}`,
            },
            {
              accountId: item.accountId,
              amount: totalCost.negated(),
              description: `Inventario salida — ${item.name} × ${qty.toFixed(4)} u.`,
            },
          ],
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
      unitCost,   // snapshot al momento de post
      totalCost,
    },
  });
}
