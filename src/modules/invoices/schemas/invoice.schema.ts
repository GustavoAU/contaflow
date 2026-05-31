// src/modules/invoices/schemas/invoice.schema.ts
import { z } from "zod";
import { Decimal } from "decimal.js";
import { VEN_RIF_REGEX, MAX_INVOICE_AMOUNT, CONTROL_NUMBER_REGEX } from "@/lib/fiscal-validators";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const InvoiceTypeSchema = z.enum(["SALE", "PURCHASE"]);
export const InvoiceDocTypeSchema = z.enum([
  "FACTURA",
  "NOTA_DEBITO",
  "NOTA_CREDITO",
  "REPORTE_Z",
  "RESUMEN_VENTAS",
  "PLANILLA_IMPORTACION",
  "OTRO",
]);
export const TaxCategorySchema = z.enum([
  "GRAVADA",
  "EXENTA",
  "EXONERADA",
  "NO_SUJETA",
  "IMPORTACION",
]);
export const TaxLineTypeSchema = z.enum(["IVA_GENERAL", "IVA_REDUCIDO", "IVA_ADICIONAL", "EXENTO"]);

// Canonical tax rates (%) per taxType — ADR-006 D-3
const CANONICAL_TAX_RATES: Record<string, string> = {
  IVA_GENERAL: "16",
  IVA_REDUCIDO: "8",
  IVA_ADICIONAL: "15",
  EXENTO: "0",
};

// ─── Tax Line ─────────────────────────────────────────────────────────────────
export const TaxLineSchema = z
  .object({
    taxType: TaxLineTypeSchema,
    description: z.string().optional(),
    base: z
      .string()
      .min(1, { error: "La base es requerida" })
      .refine(
        (v) => {
          try {
            return new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
          } catch {
            return false;
          }
        },
        { error: "Monto fuera del rango permitido" }
      ),
    rate: z.string().min(1, { error: "La tasa es requerida" }),
    amount: z
      .string()
      .min(1, { error: "El monto es requerido" })
      .refine(
        (v) => {
          try {
            return new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
          } catch {
            return false;
          }
        },
        { error: "Monto fuera del rango permitido" }
      ),
  })
  .superRefine((data, ctx) => {
    // ADR-006 D-3: validate rate matches canonical value for taxType
    const expected = CANONICAL_TAX_RATES[data.taxType];
    if (expected !== undefined) {
      let rateMatches = false;
      try {
        rateMatches = new Decimal(data.rate).eq(new Decimal(expected));
      } catch {
        rateMatches = false;
      }
      if (!rateMatches) {
        ctx.addIssue({
          code: "custom",
          message: `Tasa inválida para ${data.taxType}: debe ser ${expected}%`,
          path: ["rate"],
        });
      }
    }
  });

// ─── Crear factura ─────────────────────────────────────────────────────────────
export const CreateInvoiceSchema = z.object({
  companyId: z.string().min(1, { error: "La empresa es requerida" }),
  type: InvoiceTypeSchema,
  docType: InvoiceDocTypeSchema.default("FACTURA"),
  taxCategory: TaxCategorySchema.default("GRAVADA"),

  // Datos del documento
  invoiceNumber: z.string().min(1, { error: "El número de factura es requerido" }),
  controlNumber: z.string().optional(),
  relatedDocNumber: z.string().optional(),
  importFormNumber: z.string().optional(),
  reportZStart: z.string().optional(),
  reportZEnd: z.string().optional(),
  date: z.coerce.date(),

  // Contraparte
  counterpartName: z.string().min(1, { error: "El nombre es requerido" }).trim().max(200),
  counterpartRif: z
    .string()
    .min(1, { error: "El RIF es requerido" })
    .regex(VEN_RIF_REGEX, { error: "RIF inválido. Formato: J-12345678-9" }),

  // Líneas de impuesto dinámicas
  taxLines: z.array(TaxLineSchema).min(0),

  // Retenciones
  ivaRetentionAmount: z
    .string()
    .default("0")
    .refine(
      (v) => {
        try {
          return new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
        } catch {
          return false;
        }
      },
      { error: "Monto fuera del rango permitido" }
    ),
  ivaRetentionVoucher: z.string().optional(),
  ivaRetentionDate: z.coerce.date().optional(),
  islrRetentionAmount: z
    .string()
    .default("0")
    .refine(
      (v) => {
        try {
          return new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
        } catch {
          return false;
        }
      },
      { error: "Monto fuera del rango permitido" }
    ),

  // IGTF — solo ventas en divisas
  igtfBase: z
    .string()
    .default("0")
    .refine(
      (v) => {
        try {
          return new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
        } catch {
          return false;
        }
      },
      { error: "Monto fuera del rango permitido" }
    ),
  igtfAmount: z
    .string()
    .default("0")
    .refine(
      (v) => {
        try {
          return new Decimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
        } catch {
          return false;
        }
      },
      { error: "Monto fuera del rango permitido" }
    ),

  // Multimoneda — Fase 14
  currency: z.enum(["VES", "USD", "EUR"]).default("VES"),
  exchangeRateId: z.string().optional(),

  // Relaciones opcionales
  transactionId: z.string().optional(),
  periodId: z.string().optional(),

  createdBy: z.string().optional(), // kept for backward compat — action uses auth() userId
  idempotencyKey: z.string().uuid({ error: "Clave de idempotencia inválida" }).optional(),
}).superRefine((data, ctx) => {
  if (data.type === "PURCHASE") {
    if (!data.controlNumber) {
      ctx.addIssue({
        code: "custom",
        message: "El Nº Control es obligatorio en compras. Formato: 00-00000001",
        path: ["controlNumber"],
      });
    } else if (!CONTROL_NUMBER_REGEX.test(data.controlNumber)) {
      ctx.addIssue({
        code: "custom",
        message: "Nº Control inválido. Formato: 00-00000001",
        path: ["controlNumber"],
      });
    }
  }
});

// ─── Filtros para el libro ─────────────────────────────────────────────────────
// Soporta dos modos:
//   Período  → { year, month } — mes calendario completo
//   Rango    → { startDate, endDate } — máx 366 días (compatible con SIVIT)
export const InvoiceBookFilterSchema = z.object({
  companyId: z.string().min(1),
  type: InvoiceTypeSchema,
  year:      z.number().int().min(2000).max(2100).optional(),
  month:     z.number().int().min(1).max(12).optional(),
  startDate: z.coerce.date().optional(),
  endDate:   z.coerce.date().optional(),
}).superRefine((data, ctx) => {
  const hasRange  = !!(data.startDate && data.endDate);
  const hasPeriod = data.year !== undefined && data.month !== undefined;
  if (!hasRange && !hasPeriod) {
    ctx.addIssue({ code: "custom", message: "Debe especificar año+mes o un rango de fechas", path: ["year"] });
  }
  if (data.startDate && data.endDate) {
    if (data.startDate > data.endDate) {
      ctx.addIssue({ code: "custom", message: "La fecha inicial debe ser anterior a la final", path: ["endDate"] });
    }
    const diffDays = (data.endDate.getTime() - data.startDate.getTime()) / 86_400_000;
    if (diffDays > 366) {
      ctx.addIssue({ code: "custom", message: "El rango no puede superar 366 días (SIVIT)", path: ["endDate"] });
    }
  }
});

// ─── Crear Nota de Crédito / Nota de Débito ───────────────────────────────────
export const CreateCreditDebitNoteSchema = CreateInvoiceSchema
  .extend({
    relatedInvoiceId: z
      .string({ error: "relatedInvoiceId de la factura original es requerido" })
      .min(1, { error: "relatedInvoiceId de la factura original es requerido" }),
  })
  .transform((data) => {
    const { relatedDocNumber: _stripped, ...rest } = data;
    return rest;
  });

// ─── InvoiceLine (Fase 37A) ───────────────────────────────────────────────────
export const IvaLineRateSchema = z.enum(["EXENTO", "REDUCIDO_8", "GENERAL_16", "ADICIONAL_31"]);

export const InvoiceLineInputSchema = z.object({
  inventoryItemId: z.string().optional(),
  nameSnapshot: z.string().min(1, { error: "El nombre del ítem es requerido" }),
  skuSnapshot: z.string().optional(),
  // Prov. 00071: el libro debe identificar la naturaleza de la operación; si se ingresa no puede estar vacía
  description: z.string().min(1, { error: "La glosa no puede estar vacía" }).optional(),
  quantity: z
    .string()
    .min(1, { error: "La cantidad es requerida" })
    .refine(
      (v) => {
        try {
          return new Decimal(v).gt(0);
        } catch {
          return false;
        }
      },
      { error: "La cantidad debe ser mayor a cero" }
    ),
  unitId: z.string().optional(),
  unitPriceVes: z
    .string()
    .min(1, { error: "El precio en VES es requerido" })
    .refine(
      (v) => {
        try {
          return new Decimal(v).gte(0);
        } catch {
          return false;
        }
      },
      { error: "El precio debe ser mayor o igual a cero" }
    ),
  unitPriceUsd: z.string().optional(),
  ivaRate: IvaLineRateSchema.default("GENERAL_16"),
  lineNumber: z.number().int().min(1),
});

// Extensión de CreateInvoiceSchema con soporte de líneas — Fase 37A
export const CreateInvoiceWithLinesSchema = CreateInvoiceSchema.extend({
  lines: z.array(InvoiceLineInputSchema).optional(),
  // Flag de confirmación para StockControlLevel.CONFIRM — el cliente lo envía
  // cuando ya le mostramos el diálogo y el usuario aceptó stock negativo
  stockConfirmed: z.boolean().default(false),
});

// ─── Types ────────────────────────────────────────────────────────────────────
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type CreateInvoiceWithLinesInput = z.infer<typeof CreateInvoiceWithLinesSchema>;
export type InvoiceLineInput = z.infer<typeof InvoiceLineInputSchema>;
export type InvoiceBookFilter = z.infer<typeof InvoiceBookFilterSchema>;
export type TaxLineInput = z.infer<typeof TaxLineSchema>;
export type CreateCreditDebitNoteInput = z.output<typeof CreateCreditDebitNoteSchema>;
