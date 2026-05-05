// src/modules/inventory/services/LotTrackingService.ts
// Fase 35G — ADR-021 D-2, D-5, D-6
// Operaciones de lote dentro de un $transaction Serializable existente.
// NUNCA llamar directamente — siempre desde InventoryAccountingService.

import type { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface LotAllocationInput {
  lotId: string;
  quantity: string; // string Decimal — R-5 / ADR-002
}

// Resuelve asignaciones de lote para SALIDA.
// Si el input provee lotAllocations → las usa directamente.
// Si no → calcula FEFO automático (ORDER BY expiresAt ASC NULLS LAST, createdAt ASC).
// FEFO en PostgreSQL ASC: NULLs van al final por defecto — lotes sin vencimiento se consumen al último.
export async function resolveLotAllocations(
  tx: Tx,
  companyId: string,
  itemId: string,
  quantityInBase: Decimal,
  manualAllocations?: LotAllocationInput[]
): Promise<{ allocations: LotAllocationInput[]; fefoOverridden: boolean }> {
  if (manualAllocations && manualAllocations.length > 0) {
    return { allocations: manualAllocations, fefoOverridden: true };
  }

  // FEFO automático — ADR-021 D-6
  const lots = await tx.inventoryLot.findMany({
    where: {
      companyId, // ADR-021 CRITICAL-1: companyId siempre desde DB, nunca del cliente
      itemId,
      quantityOnHand: { gt: 0 },
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, quantityOnHand: true },
  });

  const allocations: LotAllocationInput[] = [];
  let remaining = new Decimal(quantityInBase);

  for (const lot of lots) {
    if (remaining.lte(0)) break;
    const available = new Decimal(lot.quantityOnHand);
    const take = Decimal.min(available, remaining);
    allocations.push({ lotId: lot.id, quantity: take.toString() });
    remaining = remaining.minus(take);
  }

  if (remaining.gt(0)) {
    throw new Error(
      `Stock insuficiente en lotes: faltan ${remaining.toString()} unidades para completar el movimiento`
    );
  }

  return { allocations, fefoOverridden: false };
}

// Valida que las asignaciones sumen a quantityInBase y cada lote tenga saldo suficiente.
// Guard CRITICAL-1: verifica que cada lotId pertenece a companyId+itemId desde DB.
// Debe ejecutarse dentro del $transaction Serializable — los FOR UPDATE implícitos de SSI
// detectan conflictos de escritura concurrentes sobre los mismos lotes.
export async function validateLotAllocation(
  tx: Tx,
  companyId: string,
  itemId: string,
  quantityInBase: Decimal,
  allocations: LotAllocationInput[]
): Promise<void> {
  if (allocations.length === 0) {
    throw new Error("Se requiere al menos una asignación de lote para este movimiento");
  }

  const totalAllocated = allocations.reduce(
    (sum, a) => sum.plus(new Decimal(a.quantity)),
    new Decimal(0)
  );

  if (!totalAllocated.equals(quantityInBase)) {
    throw new Error(
      `Las asignaciones de lote (${totalAllocated}) no coinciden con la cantidad del movimiento (${quantityInBase})`
    );
  }

  for (const allocation of allocations) {
    const qty = new Decimal(allocation.quantity);
    if (qty.lte(0)) {
      throw new Error("La cantidad asignada a cada lote debe ser positiva");
    }

    // CRITICAL-1: lookup siempre incluye companyId e itemId desde DB
    const lot = await tx.inventoryLot.findFirst({
      where: { id: allocation.lotId, companyId, itemId },
      select: { id: true, quantityOnHand: true },
    });

    if (!lot) {
      throw new Error("Lote no encontrado o acceso denegado");
    }

    if (new Decimal(lot.quantityOnHand).lt(qty)) {
      throw new Error(
        `Stock insuficiente en lote: disponible ${lot.quantityOnHand}, solicitado ${qty}`
      );
    }
  }
}

export interface LotEntradaData {
  lotNumber: string;
  expiresAt?: Date | null;
  notes?: string | null;
  receivedAt?: Date;
}

// Aplica un movimiento de lote:
// - ENTRADA: crea o actualiza el lote, crea InventoryMovementLot
// - SALIDA/AJUSTE: decrementa quantityOnHand de los lotes asignados, crea InventoryMovementLot
// Siempre dentro del $transaction Serializable del caller.
export async function applyLotMovement(
  tx: Tx,
  companyId: string,
  itemId: string,
  movementId: string,
  movementType: "ENTRADA" | "SALIDA" | "AJUSTE",
  quantityInBase: Decimal,
  allocations: LotAllocationInput[],
  userId: string,
  lotEntradaData?: LotEntradaData
): Promise<void> {
  if (movementType === "ENTRADA") {
    if (!lotEntradaData) {
      throw new Error("Se requiere lotData para movimientos de ENTRADA con seguimiento por lote");
    }

    // Buscar lote existente por companyId+itemId+lotNumber (CRITICAL-1: companyId desde caller, no del cliente)
    const existingLot = await tx.inventoryLot.findFirst({
      where: { companyId, itemId, lotNumber: lotEntradaData.lotNumber },
      select: { id: true, quantityOnHand: true },
    });

    let lotId: string;
    if (existingLot) {
      await tx.inventoryLot.update({
        where: { id: existingLot.id },
        data: {
          quantityOnHand: new Decimal(existingLot.quantityOnHand).plus(quantityInBase),
        },
      });
      lotId = existingLot.id;
    } else {
      const newLot = await tx.inventoryLot.create({
        data: {
          companyId,
          itemId,
          lotNumber: lotEntradaData.lotNumber,
          expiresAt: lotEntradaData.expiresAt ?? null,
          quantityOnHand: quantityInBase,
          notes: lotEntradaData.notes ?? null,
          receivedAt: lotEntradaData.receivedAt ?? new Date(),
          createdBy: userId,
        },
      });
      lotId = newLot.id;
    }

    await tx.inventoryMovementLot.create({
      data: { movementId, lotId, quantity: quantityInBase },
    });
  } else {
    // SALIDA o AJUSTE: decrementar los lotes asignados
    for (const allocation of allocations) {
      const qty = new Decimal(allocation.quantity);
      await tx.inventoryLot.update({
        where: { id: allocation.lotId },
        data: { quantityOnHand: { decrement: qty } },
      });
      await tx.inventoryMovementLot.create({
        data: { movementId, lotId: allocation.lotId, quantity: qty },
      });
    }
  }
}

// Revierte un movimiento de lote (void path — ADR-021 HIGH-1).
// - Void ENTRADA: resta la cantidad devuelta al lote
// - Void SALIDA/AJUSTE: restaura la cantidad a cada lote
// Guard CRITICAL-1: verifica companyId en cada lotId antes de modificar.
export async function voidLotMovement(
  tx: Tx,
  companyId: string,
  movementId: string,
  originalMovementType: "ENTRADA" | "SALIDA" | "AJUSTE"
): Promise<void> {
  const lotLines = await tx.inventoryMovementLot.findMany({
    where: { movementId },
    select: { lotId: true, quantity: true },
  });

  if (lotLines.length === 0) return;

  // CRITICAL-1: verificar que todos los lotes pertenecen a esta empresa
  for (const line of lotLines) {
    const lot = await tx.inventoryLot.findFirst({
      where: { id: line.lotId, companyId },
      select: { id: true },
    });
    if (!lot) throw new Error("Error de integridad: lote no pertenece a esta empresa");
  }

  for (const line of lotLines) {
    const qty = new Decimal(line.quantity);
    if (originalMovementType === "ENTRADA") {
      // Void ENTRADA: restar lo que se sumó
      await tx.inventoryLot.update({
        where: { id: line.lotId },
        data: { quantityOnHand: { decrement: qty } },
      });
    } else {
      // Void SALIDA/AJUSTE: restaurar lo que se consumió
      await tx.inventoryLot.update({
        where: { id: line.lotId },
        data: { quantityOnHand: { increment: qty } },
      });
    }
  }
}
