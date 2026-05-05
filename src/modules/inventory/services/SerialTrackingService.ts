// src/modules/inventory/services/SerialTrackingService.ts
// Fase 35G — ADR-021 D-3, D-5
// Operaciones de número de serie dentro de un $transaction Serializable existente.
// NUNCA llamar directamente — siempre desde InventoryAccountingService.
//
// Error messages: códigos opacos — nunca exponer serialNumber en mensajes al cliente (ADR-021 MEDIUM-3).

import type { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// Crea N registros InventorySerial + N links InventoryMovementSerial para una ENTRADA.
// Usa createMany ÚNICAMENTE — PROHIBIDO upsert/update de seriales existentes (ADR-021 HIGH-3).
// Si algún serialNumber ya existe en (companyId, itemId): error de negocio opaco.
export async function createSerials(
  tx: Tx,
  companyId: string,
  itemId: string,
  movementId: string,
  serialNumbers: string[],
  userId: string,
  notes?: string | null
): Promise<void> {
  // Detectar duplicados dentro del mismo lote de entrada
  const uniqueSet = new Set(serialNumbers);
  if (uniqueSet.size !== serialNumbers.length) {
    throw new Error("ERR_SERIAL_DUPLICATE_BATCH: el lote contiene números de serie repetidos");
  }

  // CRITICAL-1: verificar que ningún serial ya existe para companyId+itemId
  const existing = await tx.inventorySerial.findMany({
    where: { companyId, itemId, serialNumber: { in: serialNumbers } },
    select: { status: true },
  });

  if (existing.length > 0) {
    // Mensaje opaco — no expone qué serial ni cuántos (MEDIUM-3)
    throw new Error(
      `ERR_SERIAL_ALREADY_EXISTS: uno o más números de serie ya existen para este artículo`
    );
  }

  await tx.inventorySerial.createMany({
    data: serialNumbers.map((sn) => ({
      companyId,
      itemId,
      serialNumber: sn,
      status: "AVAILABLE" as const,
      notes: notes ?? null,
      createdBy: userId,
    })),
  });

  // Recuperar los IDs recién creados para crear los links de movimiento
  const created = await tx.inventorySerial.findMany({
    where: { companyId, itemId, serialNumber: { in: serialNumbers } },
    select: { id: true },
  });

  await tx.inventoryMovementSerial.createMany({
    data: created.map((s) => ({ movementId, serialId: s.id })),
  });
}

// Valida que los serialIds provistos estén AVAILABLE y pertenezcan a companyId+itemId.
// Guard CRITICAL-1: lookup siempre con companyId desde DB, nunca del input del cliente.
// Debe ejecutarse dentro del $transaction Serializable — SSI detecta conflictos concurrentes.
export async function validateSerialAvailability(
  tx: Tx,
  companyId: string,
  itemId: string,
  serialIds: string[],
  quantityInBase: Decimal
): Promise<void> {
  if (serialIds.length === 0) {
    throw new Error("ERR_SERIAL_REQUIRED: se requiere al menos un número de serie para este movimiento");
  }

  if (!new Decimal(serialIds.length).equals(quantityInBase)) {
    throw new Error(
      `ERR_SERIAL_COUNT_MISMATCH: la cantidad de seriales (${serialIds.length}) debe coincidir exactamente con la cantidad del movimiento (${quantityInBase})`
    );
  }

  // CRITICAL-1: verificar companyId+itemId en el lookup — cross-tenant guard
  const serials = await tx.inventorySerial.findMany({
    where: { id: { in: serialIds }, companyId, itemId },
    select: { id: true, status: true },
  });

  if (serials.length !== serialIds.length) {
    throw new Error("ERR_SERIAL_NOT_FOUND: uno o más números de serie no encontrados o acceso denegado");
  }

  const notAvailable = serials.filter((s) => s.status !== "AVAILABLE");
  if (notAvailable.length > 0) {
    throw new Error(
      `ERR_SERIAL_UNAVAILABLE: ${notAvailable.length} número(s) de serie no están disponibles`
    );
  }
}

// Aplica movimiento SALIDA: marca los seriales como SOLD y crea links InventoryMovementSerial.
export async function applySerialMovement(
  tx: Tx,
  companyId: string,
  itemId: string,
  movementId: string,
  serialIds: string[]
): Promise<void> {
  await tx.inventorySerial.updateMany({
    where: { id: { in: serialIds }, companyId, itemId },
    data: { status: "SOLD", soldAt: new Date() },
  });

  await tx.inventoryMovementSerial.createMany({
    data: serialIds.map((serialId) => ({ movementId, serialId })),
  });
}

// Revierte un movimiento de serial (void path — ADR-021 HIGH-1, void sequences).
// - Void SALIDA: retorna los seriales a AVAILABLE (soldAt = null)
// - Void ENTRADA: marca los seriales como VOIDED (nunca AVAILABLE — ADR-021 D-3)
// Guard CRITICAL-1: updateMany siempre incluye companyId para defensa en profundidad.
export async function voidSerialMovement(
  tx: Tx,
  companyId: string,
  movementId: string,
  originalMovementType: "ENTRADA" | "SALIDA" | "AJUSTE"
): Promise<void> {
  const serialLines = await tx.inventoryMovementSerial.findMany({
    where: { movementId },
    select: { serialId: true },
  });

  if (serialLines.length === 0) return;

  const serialIds = serialLines.map((l) => l.serialId);

  if (originalMovementType === "SALIDA" || originalMovementType === "AJUSTE") {
    // Void SALIDA: devolver a AVAILABLE — el producto vuelve al stock
    await tx.inventorySerial.updateMany({
      where: { id: { in: serialIds }, companyId },
      data: { status: "AVAILABLE", soldAt: null },
    });
  } else {
    // Void ENTRADA: estado terminal VOIDED — un serial creado y luego anulado nunca se reutiliza
    await tx.inventorySerial.updateMany({
      where: { id: { in: serialIds }, companyId },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
  }
}
