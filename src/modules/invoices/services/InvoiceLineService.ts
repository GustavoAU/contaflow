// src/modules/invoices/services/InvoiceLineService.ts
// Dominio ACCOUNTANT — gestión de líneas de detalle de factura (ADR-024 D-1 / D-2)
// Coexiste con InvoiceTaxLine (contrato SENIAT). InvoiceLine es la capa comercial.

import Decimal from "decimal.js";
import type { Prisma, IvaLineRate, StockControlLevel } from "@prisma/client";
import { resolveQuantity } from "@/modules/inventory/services/InventoryUomService";
import { createHash } from "crypto";
import type { InvoiceLineInput } from "../schemas/invoice.schema";
import { VEN_TAX_RATES } from "@/lib/tax-config";

// ─── Tasas decimales por IvaLineRate ─────────────────────────────────────────
const IVA_RATES: Record<IvaLineRate, Decimal> = {
  EXENTO: new Decimal("0"),
  REDUCIDO_8: new Decimal(VEN_TAX_RATES.ivaReduced),
  GENERAL_16: new Decimal(VEN_TAX_RATES.ivaGeneral),
  ADICIONAL_31: new Decimal(VEN_TAX_RATES.ivaCombined),
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
      const generalAmt = c.subtotal.mul(new Decimal(VEN_TAX_RATES.ivaGeneral));
      const additionalAmt = c.subtotal.mul(new Decimal(VEN_TAX_RATES.ivaLuxury));

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
        rate: new Decimal(VEN_TAX_RATES.ivaGeneral).times(100),
        amount: val.amount,
        luxuryGroupId: val.luxuryGroupId,
      });
    } else if (key.startsWith("IVA_ADICIONAL::")) {
      result.push({
        taxType: "IVA_ADICIONAL",
        base: val.base,
        rate: new Decimal(VEN_TAX_RATES.ivaLuxury).times(100),
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
    case "IVA_GENERAL": return new Decimal(VEN_TAX_RATES.ivaGeneral).times(100);
    case "IVA_REDUCIDO": return new Decimal(VEN_TAX_RATES.ivaReduced).times(100);
    case "EXENTO": return new Decimal("0");
  }
}

// ─── Validación de stock pre-$transaction (ADR-024 D-2.3) ────────────────────
// Lee stockQuantity fuera de la transacción (Read Committed, no Serializable)
// Retorna resultado por línea: si hay stock insuficiente y qué hacer
export type StockWarningItem = { itemId: string; name: string; available: string; requested: string };

export type StockCheckResult =
  | { ok: true; warnings?: StockWarningItem[] }
  | { ok: false; insufficient: StockWarningItem[] };

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
      // WARN: continúa pero reporta los ítems con stock insuficiente al caller
      return { ok: true, warnings: insufficient };
  }
}

// ─── Crear InvoiceLines + InventoryMovements DRAFT en $transaction ────────────
// Llamado desde InvoiceService.create() después de crear la Invoice.
//
// OM-01: invoiceType determina el tipo de movimiento:
//   SALE    → SALIDA  (unitCost = CPP actual del ítem — averageCost)
//   PURCHASE → ENTRADA (unitCost = unitPriceVes de la línea — costo facturado)
//
// Los movimientos quedan en DRAFT; InvoiceService los contabiliza inline
// mediante autoPostMovementInTx si el ítem es trackingType = NONE.
export async function createInvoiceLinesInTx(
  invoiceId: string,
  companyId: string,
  computed: ComputedLine[],
  invoiceDate: Date,
  createdBy: string,
  stockLevel: StockControlLevel,
  tx: Prisma.TransactionClient,
  invoiceType: "SALE" | "PURCHASE" = "SALE"  // OM-01: default SALE para compatibilidad
): Promise<void> {
  for (const c of computed) {
    const line = c.input;
    let inventoryMovementId: string | null = null;

    if (line.inventoryItemId) {
      const isPurchase = invoiceType === "PURCHASE";

      // SALIDA (venta): SELECT FOR UPDATE serializa el write de stock contra concurrencia.
      // ENTRADA (compra): no remueve stock → lock no necesario para la validación de mínimo.
      // ADR-024 D-2.3 paso 2.
      if (!isPurchase && (stockLevel === "CONFIRM" || stockLevel === "WARN")) {
        await tx.$executeRaw`
          SELECT id FROM "InventoryItem"
          WHERE id = ${line.inventoryItemId} AND "companyId" = ${companyId}
          FOR UPDATE
        `;
      }

      // Leer item (post-lock para SALIDA; lectura directa para ENTRADA)
      const item = await tx.inventoryItem.findFirstOrThrow({
        where: { id: line.inventoryItemId, companyId },
        select: { averageCost: true, sku: true, name: true, baseUnitId: true,
                  itemType: true, accountId: true, cogsAccountId: true },
      });

      // A8: ítems físicos DEBEN tener cuentas GL antes de facturar (auto-COGS OM-01 las requiere)
      const PHYSICAL_TYPES = ["GOODS", "RAW_MATERIAL", "FINISHED_GOOD"] as const;
      if ((PHYSICAL_TYPES as readonly string[]).includes(item.itemType)) {
        if (!item.accountId) {
          throw new Error(
            `El ítem "${item.name}" (${item.sku}) no tiene cuenta de inventario configurada. ` +
            `Configúrela en Inventario → Ítems antes de facturar.`,
          );
        }
        if (!isPurchase && !item.cogsAccountId) {
          throw new Error(
            `El ítem "${item.name}" (${item.sku}) no tiene cuenta de costo (COGS) configurada. ` +
            `Configúrela en Inventario → Ítems antes de facturar.`,
          );
        }
      }

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

      // OM-01: unitCost por tipo de movimiento
      // SALIDA  → CPP actual del ítem (averageCost)
      // ENTRADA → precio facturado (unitPriceVes)
      const unitCost = isPurchase
        ? c.unitPriceVes                              // costo de compra
        : new Decimal(item.averageCost.toString());   // CPP vigente para COGS

      const movementType = isPurchase ? "ENTRADA" : "SALIDA";

      // Idempotency key: SHA256(invoiceId | lineNumber | itemId) — inmutable
      const idempotencyKey = createHash("sha256")
        .update(`${invoiceId}|${line.lineNumber}|${line.inventoryItemId}`)
        .digest("hex");

      const movement = await tx.inventoryMovement.create({
        data: {
          companyId,
          itemId: line.inventoryItemId,
          type: movementType,
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
