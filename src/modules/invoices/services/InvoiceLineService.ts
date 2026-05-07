// src/modules/invoices/services/InvoiceLineService.ts
// Dominio ACCOUNTANT — gestión de líneas de detalle de factura (ADR-024 D-1 / D-2)
// Coexiste con InvoiceTaxLine (contrato SENIAT). InvoiceLine es la capa comercial.

import Decimal from "decimal.js";
import type { Prisma, IvaLineRate, StockControlLevel } from "@prisma/client";
import { resolveQuantity } from "@/modules/inventory/services/InventoryUomService";
import { createHash } from "crypto";
import type { InvoiceLineInput } from "../schemas/invoice.schema";

// ─── Tasas decimales por IvaLineRate ─────────────────────────────────────────
const IVA_RATES: Record<IvaLineRate, Decimal> = {
  EXENTO: new Decimal("0"),
  REDUCIDO_8: new Decimal("0.08"),
  GENERAL_16: new Decimal("0.16"),
  ADICIONAL_31: new Decimal("0.31"),
};

// Mapeo IvaLineRate → TaxLineType(s) para derivar InvoiceTaxLine (ADR-024 D-1.3)
export type DerivedTaxLineInput = {
  taxType: "IVA_GENERAL" | "IVA_REDUCIDO" | "IVA_ADICIONAL" | "EXENTO";
  base: Decimal;
  rate: Decimal;
  amount: Decimal;
  description?: string;
  luxuryGroupId?: string;
};

export type ComputedLine = {
  input: InvoiceLineInput;
  quantity: Decimal;
  unitPriceVes: Decimal;
  subtotal: Decimal;
  ivaAmount: Decimal;
  total: Decimal;
  // Solo para ADICIONAL_31
  luxuryGroupId?: string;
};

// ─── Computar totales de cada línea (R-5: todo Decimal.js) ───────────────────
export function computeLineTotals(lines: InvoiceLineInput[]): ComputedLine[] {
  return lines.map((line, idx) => {
    const quantity = new Decimal(line.quantity);
    const unitPriceVes = new Decimal(line.unitPriceVes);
    const subtotal = quantity.mul(unitPriceVes);
    const rate = IVA_RATES[line.ivaRate];
    const ivaAmount = line.ivaRate === "EXENTO" ? new Decimal(0) : subtotal.mul(rate);
    const total = subtotal.plus(ivaAmount);
    const luxuryGroupId = line.ivaRate === "ADICIONAL_31"
      ? `luxury-${idx}-${Date.now()}`
      : undefined;
    return { input: line, quantity, unitPriceVes, subtotal, ivaAmount, total, luxuryGroupId };
  });
}

// ─── Derivar InvoiceTaxLines desde líneas computadas (ADR-024 D-1.3) ─────────
// Agrupa por ivaRate → produce los registros de InvoiceTaxLine SENIAT
export function deriveInvoiceTaxLines(computed: ComputedLine[]): DerivedTaxLineInput[] {
  const map = new Map<string, { base: Decimal; amount: Decimal; luxuryGroupId?: string }>();

  for (const c of computed) {
    const rate = c.input.ivaRate;

    if (rate === "ADICIONAL_31") {
      // ADICIONAL_31 → dos registros: IVA_GENERAL (16%) + IVA_ADICIONAL (15%)
      // Misma base para ambos — ver CLAUDE.md Z-2 y best-practices.md §3.1
      const generalKey = `IVA_GENERAL::${c.luxuryGroupId}`;
      const additionalKey = `IVA_ADICIONAL::${c.luxuryGroupId}`;
      const generalAmt = c.subtotal.mul(new Decimal("0.16"));
      const additionalAmt = c.subtotal.mul(new Decimal("0.15"));

      const existing = map.get(generalKey);
      if (existing) {
        existing.base = existing.base.plus(c.subtotal);
        existing.amount = existing.amount.plus(generalAmt);
      } else {
        map.set(generalKey, { base: c.subtotal, amount: generalAmt, luxuryGroupId: c.luxuryGroupId });
      }
      const existingAdditional = map.get(additionalKey);
      if (existingAdditional) {
        existingAdditional.base = existingAdditional.base.plus(c.subtotal);
        existingAdditional.amount = existingAdditional.amount.plus(additionalAmt);
      } else {
        map.set(additionalKey, { base: c.subtotal, amount: additionalAmt, luxuryGroupId: c.luxuryGroupId });
      }
      continue;
    }

    const taxType = rateTaxType(rate);
    const key = taxType;
    const existing = map.get(key);
    if (existing) {
      existing.base = existing.base.plus(c.subtotal);
      existing.amount = existing.amount.plus(c.ivaAmount);
    } else {
      map.set(key, { base: c.subtotal, amount: c.ivaAmount });
    }
  }

  const result: DerivedTaxLineInput[] = [];
  for (const [key, val] of map.entries()) {
    if (key.startsWith("IVA_GENERAL::")) {
      result.push({
        taxType: "IVA_GENERAL",
        base: val.base,
        rate: new Decimal("16"),
        amount: val.amount,
        luxuryGroupId: val.luxuryGroupId,
      });
    } else if (key.startsWith("IVA_ADICIONAL::")) {
      result.push({
        taxType: "IVA_ADICIONAL",
        base: val.base,
        rate: new Decimal("15"),
        amount: val.amount,
        luxuryGroupId: val.luxuryGroupId,
      });
    } else {
      const taxType = key as "IVA_GENERAL" | "IVA_REDUCIDO" | "EXENTO";
      result.push({
        taxType,
        base: val.base,
        rate: ratePercent(taxType),
        amount: val.amount,
      });
    }
  }
  return result;
}

function rateTaxType(rate: IvaLineRate): "IVA_GENERAL" | "IVA_REDUCIDO" | "EXENTO" {
  switch (rate) {
    case "GENERAL_16": return "IVA_GENERAL";
    case "REDUCIDO_8": return "IVA_REDUCIDO";
    case "EXENTO": return "EXENTO";
    default: return "IVA_GENERAL";
  }
}

function ratePercent(taxType: "IVA_GENERAL" | "IVA_REDUCIDO" | "EXENTO"): Decimal {
  switch (taxType) {
    case "IVA_GENERAL": return new Decimal("16");
    case "IVA_REDUCIDO": return new Decimal("8");
    case "EXENTO": return new Decimal("0");
  }
}

// ─── Validación de stock pre-$transaction (ADR-024 D-2.3) ────────────────────
// Lee stockQuantity fuera de la transacción (Read Committed, no Serializable)
// Retorna resultado por línea: si hay stock insuficiente y qué hacer
export type StockCheckResult =
  | { ok: true }
  | { ok: false; insufficient: Array<{ itemId: string; name: string; available: string; requested: string }> };

export async function validateStockForLines(
  lines: InvoiceLineInput[],
  companyId: string,
  stockLevel: StockControlLevel,
  stockConfirmed: boolean,
  tx: Prisma.TransactionClient
): Promise<StockCheckResult> {
  const linesWithItem = lines.filter((l) => l.inventoryItemId);
  if (linesWithItem.length === 0) return { ok: true };

  const insufficient: Array<{ itemId: string; name: string; available: string; requested: string }> = [];

  for (const line of linesWithItem) {
    const itemId = line.inventoryItemId!;

    // ADR-024 D-2.5: verificar multi-tenant IDOR antes de leer stock
    const item = await tx.inventoryItem.findFirst({
      where: { id: itemId, companyId },
      select: { id: true, stockQuantity: true, name: true, baseUnitId: true, sku: true },
    });
    if (!item) {
      throw new Error(`Ítem ${itemId} no encontrado o no pertenece a esta empresa`);
    }

    // Resolver cantidad en unidad base si se especifica unitId
    let quantityInBase: Decimal;
    if (line.unitId) {
      const resolved = await resolveQuantity(companyId, line.unitId, new Decimal(line.quantity));
      quantityInBase = resolved.quantityInBase;
    } else {
      quantityInBase = new Decimal(line.quantity);
    }

    const available = new Decimal(item.stockQuantity.toString());
    if (available.lt(quantityInBase)) {
      insufficient.push({
        itemId,
        name: item.name,
        available: available.toFixed(4),
        requested: quantityInBase.toFixed(4),
      });
    }
  }

  if (insufficient.length === 0) return { ok: true };

  switch (stockLevel) {
    case "BLOCK":
      // BLOCK: rechaza antes de abrir $transaction — error al cliente
      throw new Error(
        `Stock insuficiente para: ${insufficient.map((i) => `${i.name} (disponible: ${i.available}, solicitado: ${i.requested})`).join(", ")}`
      );
    case "CONFIRM":
      // CONFIRM: ya debe venir flag del cliente confirmando stock negativo
      if (!stockConfirmed) {
        const err = new Error("STOCK_CONFIRM_REQUIRED");
        (err as Error & { insufficient: typeof insufficient }).insufficient = insufficient;
        throw err;
      }
      return { ok: true };
    case "WARN":
      // WARN: continúa siempre — stock negativo es permitido por diseño
      return { ok: true };
  }
}

// ─── Crear InvoiceLines + InventoryMovements DRAFT en $transaction ────────────
// Llamado desde InvoiceService.create() después de crear la Invoice
export async function createInvoiceLinesInTx(
  invoiceId: string,
  companyId: string,
  computed: ComputedLine[],
  invoiceDate: Date,
  createdBy: string,
  stockLevel: StockControlLevel,
  tx: Prisma.TransactionClient
): Promise<void> {
  for (const c of computed) {
    const line = c.input;
    let inventoryMovementId: string | null = null;

    if (line.inventoryItemId) {
      // ADR-024 D-2.3 paso 2: SELECT FOR UPDATE en path CONFIRM con stock insuficiente confirmado
      // (para WARN también aplica — serializa el write en caso de concurrencia)
      if (stockLevel === "CONFIRM" || stockLevel === "WARN") {
        await tx.$executeRaw`
          SELECT id FROM "InventoryItem"
          WHERE id = ${line.inventoryItemId} AND "companyId" = ${companyId}
          FOR UPDATE
        `;
      }

      // Leer item (post-lock) para obtener CPP vigente
      const item = await tx.inventoryItem.findFirstOrThrow({
        where: { id: line.inventoryItemId, companyId },
        select: { averageCost: true, sku: true, name: true, baseUnitId: true },
      });

      // Resolver cantidad en unidad base
      let quantityInBase: Decimal;
      let conversionSnapshot: Decimal;
      if (line.unitId) {
        const resolved = await resolveQuantity(companyId, line.unitId, c.quantity);
        quantityInBase = resolved.quantityInBase;
        conversionSnapshot = resolved.conversionFactor;
      } else {
        quantityInBase = c.quantity;
        conversionSnapshot = new Decimal(1);
      }

      const unitCost = new Decimal(item.averageCost.toString());

      // Idempotency key: SHA256(invoiceId | lineNumber | itemId) — inmutable
      const idempotencyKey = createHash("sha256")
        .update(`${invoiceId}|${line.lineNumber}|${line.inventoryItemId}`)
        .digest("hex");

      const movement = await tx.inventoryMovement.create({
        data: {
          companyId,
          itemId: line.inventoryItemId,
          type: "SALIDA",
          status: "DRAFT",
          quantity: quantityInBase,
          unitCost,
          totalCost: unitCost.mul(quantityInBase),
          unitId: line.unitId ?? null,
          quantityInUnit: c.quantity,
          conversionSnapshot,
          invoiceId,
          date: invoiceDate,
          idempotencyKey,
          createdBy,
        },
        select: { id: true },
      });
      inventoryMovementId = movement.id;
    }

    // Crear InvoiceLine
    await tx.invoiceLine.create({
      data: {
        companyId,
        invoiceId,
        inventoryItemId: line.inventoryItemId ?? null,
        skuSnapshot: line.skuSnapshot ?? null,
        nameSnapshot: line.nameSnapshot,
        description: line.description ?? null,
        quantity: c.quantity,
        unitId: line.unitId ?? null,
        unitPriceVes: c.unitPriceVes,
        unitPriceUsd: line.unitPriceUsd ? new Decimal(line.unitPriceUsd) : null,
        ivaRate: line.ivaRate,
        subtotal: c.subtotal,
        ivaAmount: c.ivaAmount,
        total: c.total,
        luxuryGroupId: c.luxuryGroupId ?? null,
        inventoryMovementId,
        lineNumber: line.lineNumber,
      },
    });
  }
}
