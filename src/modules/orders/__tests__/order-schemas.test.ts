// src/modules/orders/__tests__/order-schemas.test.ts
// Regresión auditoría Compras/Ventas 2026-07 (hallazgo ALTO Parte 1): el form enviaba
// inventoryItemId pero QuotationItemSchema no tenía el campo — Zod lo stripeaba y el
// vínculo al catálogo NUNCA se persistía (la conversión a factura no generaba
// movimiento de inventario). El schema DEBE preservar el campo.
import { describe, it, expect } from "vitest";
import { QuotationItemSchema, CreateQuotationSchema } from "../schemas/quotation.schema";
import { CreateOrderSchema } from "../schemas/order.schema";

const BASE_ITEM = {
  description: "Producto de Auditoría Fiscal SENIAT Test",
  unit: "und",
  quantity: "1",
  unitPrice: "25.00",
  taxRate: "16" as const,
};

describe("QuotationItemSchema — inventoryItemId (OM-08)", () => {
  it("preserva inventoryItemId cuando el ítem viene vinculado al catálogo", () => {
    const r = QuotationItemSchema.safeParse({
      ...BASE_ITEM,
      inventoryItemId: "cmpsohr9f0008ncukccq8xnjq",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.inventoryItemId).toBe("cmpsohr9f0008ncukccq8xnjq");
  });

  it("acepta null (ítem de texto libre) y omitido", () => {
    const conNull = QuotationItemSchema.safeParse({ ...BASE_ITEM, inventoryItemId: null });
    expect(conNull.success).toBe(true);
    if (conNull.success) expect(conNull.data.inventoryItemId).toBeNull();

    const sinCampo = QuotationItemSchema.safeParse(BASE_ITEM);
    expect(sinCampo.success).toBe(true);
    if (sinCampo.success) expect(sinCampo.data.inventoryItemId).toBeUndefined();
  });

  it("rechaza un inventoryItemId que no es cuid", () => {
    const r = QuotationItemSchema.safeParse({ ...BASE_ITEM, inventoryItemId: "'; DROP--" });
    expect(r.success).toBe(false);
  });
});

describe("CreateOrderSchema / CreateQuotationSchema — items con vínculo", () => {
  it("CreateOrderSchema preserva inventoryItemId en los items", () => {
    const r = CreateOrderSchema.safeParse({
      type: "SALE",
      counterpartName: "Cliente Directo",
      items: [{ ...BASE_ITEM, inventoryItemId: "cmpsohr9f0008ncukccq8xnjq" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0]!.inventoryItemId).toBe("cmpsohr9f0008ncukccq8xnjq");
  });

  it("CreateQuotationSchema preserva inventoryItemId en los items", () => {
    const r = CreateQuotationSchema.safeParse({
      type: "SALE",
      counterpartName: "Cliente Directo",
      validUntil: "2026-08-15",
      items: [{ ...BASE_ITEM, inventoryItemId: "cmpsohr9f0008ncukccq8xnjq" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0]!.inventoryItemId).toBe("cmpsohr9f0008ncukccq8xnjq");
  });
});
