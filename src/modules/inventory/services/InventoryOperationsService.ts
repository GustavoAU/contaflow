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
import { resolveQuantity } from "./InventoryUomService";

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
        // Fase 35F: baseUnit denorm — se actualizará en Sub-fase B via InventoryUomService
        baseUnitName: rest.unit ?? "unidad",
        baseUnitAbbr: (rest.unit ?? "UN").substring(0, 10).toUpperCase(),
        ...rest,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: created.id,
        entityName: "InventoryItem",
        action: "CREATE",
        userId,
        ipAddress: null,
        userAgent: null,
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
        companyId,
        entityId: itemId,
        entityName: "InventoryItem",
        action: "UPDATE",
        userId,
        ipAddress: null,
        userAgent: null,
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
        companyId,
        entityId: itemId,
        entityName: "InventoryItem",
        action: "SOFT_DELETE",
        userId,
        ipAddress: null,
        userAgent: null,
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
  const { companyId, itemId, type, quantity, unitCost, unitId, invoiceId, ...rest } = input;

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

  // Fase 35F Sub-fase B: si se especifica unitId, convertir a unidad base
  // HIGH-1: resolveQuantity verifica internamente que unitId pertenece a companyId
  const quantityDecimal = new Decimal(quantity);
  let quantityInBase: Decimal;
  let conversionSnapshot: Decimal;
  let resolvedUnitId: string | null;

  if (unitId) {
    const resolved = await resolveQuantity(companyId, unitId, quantityDecimal);
    quantityInBase = resolved.quantityInBase;
    conversionSnapshot = resolved.conversionFactor;
    resolvedUnitId = unitId;
  } else {
    // Sin unitId: unidad base implícita, factor = 1
    quantityInBase = quantityDecimal;
    conversionSnapshot = new Decimal(1);
    resolvedUnitId = null;
  }

  // Para SALIDA/AJUSTE: unitCost se toma del CPP vigente del ítem
  const resolvedUnitCost =
    type === "ENTRADA"
      ? new Decimal(unitCost ?? 0)
      : new Decimal(item.averageCost);

  // Validar stock suficiente para SALIDA (usando cantidad en unidad base)
  if (type === "SALIDA") {
    if (new Decimal(item.stockQuantity).lt(quantityInBase)) {
      throw new Error(
        `Stock insuficiente: disponible ${item.stockQuantity}, solicitado ${quantityInBase}`
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
        quantity: quantityInBase,                      // siempre en unidad base
        unitCost: resolvedUnitCost,
        totalCost: resolvedUnitCost.mul(quantityInBase),
        unitId: resolvedUnitId,
        quantityInUnit: quantityDecimal,               // cantidad tal como la ingresó el usuario
        conversionSnapshot,                            // snapshot inmutable del factor (ADR-018 D-3)
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
        companyId,
        entityId: created.id,
        entityName: "InventoryMovement",
        action: "CREATE_DRAFT",
        userId,
        ipAddress: null,
        userAgent: null,
        newValue: {
          itemId,
          type,
          quantityInBase: quantityInBase.toString(),
          quantityInUnit: quantityDecimal.toString(),
          conversionSnapshot: conversionSnapshot.toString(),
          unitId: resolvedUnitId,
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
        companyId,
        entityId: movementId,
        entityName: "InventoryMovement",
        action: "VOID_DRAFT",
        userId,
        ipAddress: null,
        userAgent: null,
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

export async function getItemMovements(companyId: string, itemId: string) {
  // CRITICAL-1: verificar ownership del ítem antes de devolver sus movimientos
  await prisma.inventoryItem.findFirstOrThrow({
    where: { id: itemId, companyId },
    select: { id: true },
  });

  return prisma.inventoryMovement.findMany({
    where: { companyId, itemId },
    select: {
      id: true,
      type: true,
      status: true,
      quantity: true,
      unitCost: true,
      totalCost: true,
      date: true,
      reference: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { date: "desc" },
  });
}
