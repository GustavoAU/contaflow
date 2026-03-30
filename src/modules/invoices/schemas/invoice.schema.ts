// src/modules/invoices/schemas/invoice.schema.ts
import { z } from "zod";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";

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

// ─── Tax Line ─────────────────────────────────────────────────────────────────
export const TaxLineSchema = z.object({
  taxType: TaxLineTypeSchema,
  base: z.string().min(1, { error: "La base es requerida" }),
  rate: z.string().min(1, { error: "La tasa es requerida" }),
  amount: z.string().min(1, { error: "El monto es requerido" }),
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
  counterpartName: z.string().min(1, { error: "El nombre es requerido" }),
  counterpartRif: z
    .string()
    .min(1, { error: "El RIF es requerido" })
    .regex(VEN_RIF_REGEX, { error: "RIF inválido. Formato: J-12345678-9" }),

  // Líneas de impuesto dinámicas
  taxLines: z.array(TaxLineSchema).min(0),

  // Retenciones
  ivaRetentionAmount: z.string().default("0"),
  ivaRetentionVoucher: z.string().optional(),
  ivaRetentionDate: z.coerce.date().optional(),
  islrRetentionAmount: z.string().default("0"),

  // IGTF — solo ventas en divisas
  igtfBase: z.string().default("0"),
  igtfAmount: z.string().default("0"),

  // Relaciones opcionales
  transactionId: z.string().optional(),
  periodId: z.string().optional(),

  createdBy: z.string().min(1, { error: "El usuario es requerido" }),
  idempotencyKey: z.string().uuid({ error: "Clave de idempotencia inválida" }).optional(),
});

// ─── Filtros para el libro ─────────────────────────────────────────────────────
export const InvoiceBookFilterSchema = z.object({
  companyId: z.string().min(1),
  type: InvoiceTypeSchema,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

// ─── Types ────────────────────────────────────────────────────────────────────
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type InvoiceBookFilter = z.infer<typeof InvoiceBookFilterSchema>;
export type TaxLineInput = z.infer<typeof TaxLineSchema>;
