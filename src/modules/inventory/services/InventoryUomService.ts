// src/modules/inventory/services/InventoryUomService.ts
// Dominio ADMINISTRATIVE/ACCOUNTANT — gestión de unidades de medida por ítem.
// Stock y CPP siempre en unidad base. Conversión ocurre antes de tocar stockQuantity.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { CreateUomInput, UpdateUomInput, SoftDeleteUomInput, ListUomsInput } from "../schemas/inventory-item-unit.schema";

// ─── createUnit ──────────────────────────────────────────────────────────────

export async function createUnit(
  input: CreateUomInput,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null
) {
  const { companyId, itemId, name, abbreviation, conversionFactor, isBase } = input;

  // HIGH-1: verificar que el ítem pertenece a la empresa antes de crear unidad
  await prisma.inventoryItem.findFirstOrThrow({
    where: { id: itemId, companyId, deletedAt: null },
    select: { id: true },
  });

  // MEDIUM-4 (doble guardia): rechazar factor <= 0 a nivel de servicio
  // (Zod ya lo valida, pero segunda línea de defensa ante llamadas directas al servicio)
  const factorDecimal = new Decimal(conversionFactor);
  if (factorDecimal.lte(0)) {
    throw new Error("El factor de conversión debe ser mayor que cero");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const unit = await tx.inventoryItemUnit.create({
        data: {
          companyId,
          itemId,
          name,
          abbreviation,
          conversionFactor: factorDecimal,
          isBase,
          createdBy: userId,
        },
      });

      // Si se marca como base, sincronizar denorm en InventoryItem (ADR-018 D-8)
      if (isBase) {
        await tx.inventoryItem.update({
          where: { id: itemId },
          data: {
            baseUnitId: unit.id,
            baseUnitName: name,
            baseUnitAbbr: abbreviation,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: unit.id,
          entityName: "InventoryItemUnit",
          action: "CREATE",
          userId,
          ipAddress: ipAddress ?? null,   // MEDIUM-2: trazabilidad de red
          userAgent: userAgent ?? null,
          newValue: { itemId, name, abbreviation, conversionFactor, isBase },
        },
      });

      return unit;
    });
  } catch (err: unknown) {
    // MEDIUM-3: capturar P2002 del partial index (una sola unidad base por ítem)
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const meta = (err as { meta?: { target?: string[] } }).meta;
      if (meta?.target?.includes("itemId") && isBase) {
        throw new Error(
          "Ya existe una unidad base para este producto. Elimine o cambie la unidad base actual antes de crear una nueva."
        );
      }
      if (meta?.target?.includes("name")) {
        throw new Error(
          `Ya existe una unidad con el nombre "${name}" para este producto.`
        );
      }
    }
    throw err;
  }
}

// ─── updateUnit ──────────────────────────────────────────────────────────────

export async function updateUnit(
  input: UpdateUomInput,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null
) {
  const { unitId, companyId, name, abbreviation, conversionFactor } = input;

  // HIGH-2: verificar ownership antes de cualquier mutación
  const existing = await prisma.inventoryItemUnit.findFirstOrThrow({
    where: { id: unitId, companyId, deletedAt: null },
  });

  // HIGH-3: bloquear cambio de conversionFactor si existen movimientos referenciados
  // Guarda ampliada por security-agent: DRAFT + POSTED + VOIDED (no solo POSTED/VOIDED)
  if (conversionFactor !== undefined) {
    const newFactor = new Decimal(conversionFactor);
    if (!newFactor.eq(new Decimal(existing.conversionFactor))) {
      const linkedMovements = await prisma.inventoryMovement.count({
        where: {
          unitId,
          status: { in: ["DRAFT", "POSTED", "VOIDED"] },
        },
      });
      if (linkedMovements > 0) {
        throw new Error(
          `No se puede cambiar el factor de conversión: existen ${linkedMovements} movimiento(s) que referencian esta unidad. ` +
            "El factor es inmutable una vez que se registra cualquier movimiento."
        );
      }
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (abbreviation !== undefined) updateData.abbreviation = abbreviation;
  if (conversionFactor !== undefined)
    updateData.conversionFactor = new Decimal(conversionFactor);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.inventoryItemUnit.update({
      where: { id: unitId },
      data: updateData,
    });

    // Sincronizar denorm si es la unidad base del ítem (ADR-018 D-8)
    if (existing.isBase) {
      await tx.inventoryItem.update({
        where: { id: existing.itemId },
        data: {
          ...(name !== undefined && { baseUnitName: name }),
          ...(abbreviation !== undefined && { baseUnitAbbr: abbreviation }),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: unitId,
        entityName: "InventoryItemUnit",
        action: "UPDATE",
        userId,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        oldValue: {
          name: existing.name,
          abbreviation: existing.abbreviation,
          conversionFactor: existing.conversionFactor.toString(),
        },
        newValue: updateData as Record<string, string | boolean | null>,
      },
    });

    return updated;
  });
}

// ─── softDeleteUnit ───────────────────────────────────────────────────────────

export async function softDeleteUnit(
  input: SoftDeleteUomInput,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null
) {
  const { unitId, companyId } = input;

  // HIGH-2: verificar ownership
  const existing = await prisma.inventoryItemUnit.findFirstOrThrow({
    where: { id: unitId, companyId, deletedAt: null },
  });

  // ADR-018 D-7: bloquear soft delete si existen movimientos referenciados
  const linkedMovements = await prisma.inventoryMovement.count({
    where: { unitId },
  });
  if (linkedMovements > 0) {
    throw new Error(
      `No se puede eliminar la unidad: existen ${linkedMovements} movimiento(s) que la referencian.`
    );
  }

  // No se puede eliminar la unidad base si tiene movimientos (ya cubierto arriba),
  // pero adicionalmente se bloquea si no existe otra unidad alternativa
  if (existing.isBase) {
    const otherUnits = await prisma.inventoryItemUnit.count({
      where: { itemId: existing.itemId, deletedAt: null, id: { not: unitId } },
    });
    if (otherUnits > 0) {
      throw new Error(
        "No se puede eliminar la unidad base mientras existan otras unidades de medida activas para este producto."
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.inventoryItemUnit.update({
      where: { id: unitId },
      data: { deletedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: unitId,
        entityName: "InventoryItemUnit",
        action: "SOFT_DELETE",
        userId,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        newValue: { deletedAt: deleted.deletedAt, isBase: existing.isBase },
      },
    });

    return deleted;
  });
}

// ─── listUnits ────────────────────────────────────────────────────────────────

export async function listUnits(input: ListUomsInput) {
  const { companyId, itemId } = input;

  // HIGH-1: verificar que el ítem pertenece a la empresa antes de listar sus unidades
  await prisma.inventoryItem.findFirstOrThrow({
    where: { id: itemId, companyId, deletedAt: null },
    select: { id: true },
  });

  return prisma.inventoryItemUnit.findMany({
    where: { itemId, companyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      conversionFactor: true,
      isBase: true,
      createdAt: true,
    },
    orderBy: [{ isBase: "desc" }, { name: "asc" }],
  });
}

// ─── resolveQuantity (helper interno — usado por InventoryOperationsService) ──
// Convierte cantidad en unidad dada a unidad base.
// Solo exportado para uso en InventoryOperationsService y tests.

export async function resolveQuantity(
  companyId: string,
  unitId: string,
  quantityInUnit: Decimal
): Promise<{ quantityInBase: Decimal; conversionFactor: Decimal }> {
  // HIGH-1: verificar que la unidad pertenece a la empresa antes de usar su factor
  const unit = await prisma.inventoryItemUnit.findFirstOrThrow({
    where: { id: unitId, companyId, deletedAt: null },
    select: { conversionFactor: true, isBase: true },
  });

  const factor = new Decimal(unit.conversionFactor);

  // MEDIUM-4: doble guardia — factor nunca puede ser <= 0 (Zod + createUnit ya lo validan)
  if (factor.lte(0)) {
    throw new Error(
      "Factor de conversión inválido en base de datos — contacte soporte."
    );
  }

  const quantityInBase = quantityInUnit.mul(factor);
  return { quantityInBase, conversionFactor: factor };
}
