// src/modules/inventory/services/InventoryAccountingService.ts
// Dominio ACCOUNTANT — aprobación de movimientos, generación de asientos, anulación
// NUNCA importar desde InventoryOperationsService — comunicación solo via estado de InventoryMovement

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
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
        const txCount = await tx.transaction.count({ where: { companyId } });
        const txNumber = `INV-${String(txCount + 1).padStart(6, "0")}`;

        // ── Generar asiento contable ──────────────────────────────────────────
        const totalCost = new Decimal(movement.totalCost);

        // ENTRADA: Débito Inventario / Crédito (cta. destino — normalmente CxP o Efectivo)
        // SALIDA:  Débito COGS / Crédito Inventario
        // AJUSTE:  Débito/Crédito dependiendo de dirección — aquí tratamos como SALIDA
        const journalEntries =
          movement.type === "ENTRADA"
            ? [
                // Débito: Inventario (activo aumenta)
                { accountId: item.accountId, amount: totalCost, description: `ENTRADA inventario — ${item.name} × ${qty}` },
                // Crédito: COGS/contrapartida no requerida en ENTRADA standalone — omitir
                // (el asiento de compra completo se genera via InvoiceService)
              ]
            : [
                // Débito: COGS (gasto)
                { accountId: item.cogsAccountId!, amount: totalCost, description: `COGS — Costo venta ${item.name} × ${qty}` },
                // Crédito: Inventario (activo disminuye)
                { accountId: item.accountId, amount: totalCost.negated(), description: `${movement.type} inventario — ${item.name} × ${qty}` },
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
        const currentAvgCost = new Decimal(item.averageCost);
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
