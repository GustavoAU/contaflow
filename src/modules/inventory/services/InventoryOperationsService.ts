// src/modules/inventory/services/InventoryOperationsService.ts
// Dominio ADMINISTRATIVE — gestión de ítems y registro de movimientos en DRAFT
// No genera asientos contables — eso es responsabilidad de InventoryAccountingService

import prisma from "@/lib/prisma";
import type {
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
} from "../schemas/inventory-item.schema";
import type { CreateMovementInput, VoidMovementInput } from "../schemas/inventory-movement.schema";
import Decimal from "decimal.js";

// ─── Items ────────────────────────────────────────────────────────────────────

export async function createInventoryItem(
  input: CreateInventoryItemInput,
  userId: string
) {
  const { companyId, accountId, cogsAccountId, ...rest } = input;

  // CRITICAL-2: verificar que accountId y cogsAccountId pertenecen a la empresa
  if (accountId) {
    await prisma.account.findFirstOrThrow({
      where: { id: accountId, companyId },
      select: { id: true },
    });
  }
  if (cogsAccountId) {
    await prisma.account.findFirstOrThrow({
      where: { id: cogsAccountId, companyId },
      select: { id: true },
    });
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.inventoryItem.create({
      data: {
        companyId,
        accountId: accountId ?? null,
        cogsAccountId: cogsAccountId ?? null,
        createdBy: userId,
        ...rest,
      },
    });

    await tx.auditLog.create({
      data: {
        entityId: created.id,
        entityName: "InventoryItem",
        action: "CREATE",
        userId,
        newValue: { sku: created.sku, name: created.name, companyId },
      },
    });

    return created;
  });

  return item;
}

export async function updateInventoryItem(
  input: UpdateInventoryItemInput,
  userId: string
) {
  const { itemId, companyId, accountId, cogsAccountId, ...rest } = input;

  // CRITICAL-1: verificar que el ítem pertenece a la empresa
  const existing = await prisma.inventoryItem.findFirstOrThrow({
    where: { id: itemId, companyId, deletedAt: null },
  });

  // CRITICAL-2: verificar ownership de cuentas
  if (accountId) {
    await prisma.account.findFirstOrThrow({
      where: { id: accountId, companyId },
      select: { id: true },
    });
  }
  if (cogsAccountId) {
    await prisma.account.findFirstOrThrow({
      where: { id: cogsAccountId, companyId },
      select: { id: true },
    });
  }

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        ...(rest.sku !== undefined && { sku: rest.sku }),
        ...(rest.name !== undefined && { name: rest.name }),
        ...(rest.description !== undefined && { description: rest.description }),
        ...(rest.unit !== undefined && { unit: rest.unit }),
        ...(accountId !== undefined && { accountId: accountId ?? null }),
        ...(cogsAccountId !== undefined && { cogsAccountId: cogsAccountId ?? null }),
      },
    });

    await tx.auditLog.create({
      data: {
        entityId: itemId,
        entityName: "InventoryItem",
        action: "UPDATE",
        userId,
        oldValue: { sku: existing.sku, name: existing.name },
        newValue: { sku: updated.sku, name: updated.name },
      },
    });

    return updated;
  });

  return item;
}

export async function softDeleteInventoryItem(itemId: string, companyId: string, userId: string) {
  // CRITICAL-1: verificar ownership
  await prisma.inventoryItem.findFirstOrThrow({
    where: { id: itemId, companyId, deletedAt: null },
  });

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.inventoryItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        entityId: itemId,
        entityName: "InventoryItem",
        action: "SOFT_DELETE",
        userId,
        newValue: { deletedAt: deleted.deletedAt },
      },
    });

    return deleted;
  });
}

// ─── Movements (DRAFT only) ───────────────────────────────────────────────────

export async function createDraftMovement(
  input: CreateMovementInput,
  userId: string
) {
  const { companyId, itemId, type, quantity, unitCost, invoiceId, ...rest } = input;

  // CRITICAL-1: verificar ownership del ítem
  const item = await prisma.inventoryItem.findFirstOrThrow({
    where: { id: itemId, companyId, deletedAt: null },
  });

  // Verificar idempotencyKey no duplicada
  const existing = await prisma.inventoryMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return existing; // idempotente — devuelve el movimiento existente sin error
  }

  // Para SALIDA/AJUSTE: unitCost se toma del CPP vigente del ítem
  const resolvedUnitCost =
    type === "ENTRADA"
      ? new Decimal(unitCost ?? 0)
      : new Decimal(item.averageCost);

  // Validar stock suficiente para SALIDA
  if (type === "SALIDA") {
    const qtyDecimal = new Decimal(quantity);
    if (new Decimal(item.stockQuantity).lt(qtyDecimal)) {
      throw new Error(
        `Stock insuficiente: disponible ${item.stockQuantity}, solicitado ${quantity}`
      );
    }
  }

  // Verificar invoiceId ownership si se proporciona
  if (invoiceId) {
    await prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, companyId },
      select: { id: true },
    });
  }

  const movement = await prisma.$transaction(async (tx) => {
    const created = await tx.inventoryMovement.create({
      data: {
        companyId,
        itemId,
        type,
        status: "DRAFT",
        quantity: new Decimal(quantity),
        unitCost: resolvedUnitCost,
        totalCost: resolvedUnitCost.mul(quantity),
        invoiceId: invoiceId ?? null,
        date: new Date(rest.date),
        idempotencyKey: rest.idempotencyKey,
        reference: rest.reference ?? null,
        notes: rest.notes ?? null,
        createdBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        entityId: created.id,
        entityName: "InventoryMovement",
        action: "CREATE_DRAFT",
        userId,
        newValue: {
          itemId,
          type,
          quantity: quantity.toString(),
          unitCost: resolvedUnitCost.toString(),
        },
      },
    });

    return created;
  });

  return movement;
}

export async function voidDraftMovement(input: VoidMovementInput, userId: string) {
  const { movementId, companyId, notes } = input;

  // CRITICAL-1: verificar ownership y estado
  const movement = await prisma.inventoryMovement.findFirstOrThrow({
    where: { id: movementId, companyId },
  });

  if (movement.status !== "DRAFT") {
    throw new Error(
      `Solo se pueden anular movimientos en DRAFT. Estado actual: ${movement.status}`
    );
  }

  return prisma.$transaction(async (tx) => {
    const voided = await tx.inventoryMovement.update({
      where: { id: movementId },
      data: { status: "VOIDED" },
    });

    await tx.auditLog.create({
      data: {
        entityId: movementId,
        entityName: "InventoryMovement",
        action: "VOID_DRAFT",
        userId,
        oldValue: { status: "DRAFT" },
        newValue: { status: "VOIDED", notes: notes ?? null },
      },
    });

    return voided;
  });
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getInventoryItems(companyId: string) {
  return prisma.inventoryItem.findMany({ // ADR-004: companyId en where
    where: { companyId, deletedAt: null },
    include: { account: true, cogsAccount: true },
    orderBy: { name: "asc" },
  });
}

export async function getDraftMovements(companyId: string) {
  return prisma.inventoryMovement.findMany({ // ADR-004: companyId en where
    where: { companyId, status: "DRAFT" },
    include: { item: true },
    orderBy: { createdAt: "desc" },
  });
}
