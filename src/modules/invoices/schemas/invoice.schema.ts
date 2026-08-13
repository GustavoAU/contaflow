// src/modules/invoices/schemas/invoice.schema.ts
//
// MP-5a (ADR-042 D-1) — schemas construidos POR PAÍS.
//
// Contrato de la factory: varía VALORES (regex del ID tributario, alícuotas
// canónicas, formato del Nº de control, mensajes), NUNCA la ESTRUCTURA. Por eso
// `z.infer` es invariante por país y ni los componentes ni los tests existentes
// cambian.
//
// Las constantes exportadas al final son el **ancla VEN de compatibilidad**:
// PERMANENTE, no deuda. Fijan los tipos y sirven a los call sites de UI y tests
// que no tienen país a mano. Las actions, que sí lo tienen (`ctx.country` del
// guard, ADR-042 D-2), usan `getInvoiceSchemas(getFiscalConfig(ctx.country))`.
import { z } from "zod";
import { Decimal } from "decimal.js";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";
import { getDefaultFiscalConfig, memoizePerCountry } from "@/lib/countries";
import type { FiscalConfig } from "@/lib/countries/types";
import { checkControlNumber, strictDecimal, zBusinessDate, zTaxId } from "@/lib/zod-helpers";

// ─── Enums ────────────────────────────────────────────────────────────────────
// Invariantes por país: son los enums de Prisma. Un país nuevo AGREGA valores al
// enum (migración), no redefine estos schemas. Qué subconjunto usa cada país lo
// declara `cfg.taxLineRates`.
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
export const IvaLineRateSchema = z.enum(["EXENTO", "REDUCIDO_8", "GENERAL_16", "ADICIONAL_31"]);

// ─── Helper de monto (sin dependencia de país) ────────────────────────────────
const withinAmountRange = (v: string) => {
  try {
    return strictDecimal(v).abs().lte(new Decimal(MAX_INVOICE_AMOUNT));
  } catch {
    return false;
  }
};
const amountField = () =>
  z.string().refine(withinAmountRange, { error: "Monto fuera del rango permitido" });

// ─── Schemas sin dependencia de país ──────────────────────────────────────────
// Se quedan a nivel de módulo a propósito: meterlos en la factory solo añadiría
// indirección sin ganar nada.

// Filtros para el libro. Soporta dos modos:
//   Período  → { year, month } — mes calendario completo
//   Rango    → { startDate, endDate } — máx 366 días (compatible con SIVIT)
export const InvoiceBookFilterSchema = z.object({
  companyId: z.string().min(1),
  type: InvoiceTypeSchema,
  year:      z.number().int().min(2000).max(2100).optional(),
  month:     z.number().int().min(1).max(12).optional(),
  startDate: zBusinessDate().optional(),
  endDate:   zBusinessDate().optional(),
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

// InvoiceLine (Fase 37A)
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
          return strictDecimal(v).gt(0);
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
          return strictDecimal(v).gte(0);
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

// ─── Factory por país ─────────────────────────────────────────────────────────

/**
 * Juego de schemas de facturas para un país.
 *
 * Memoizado por `countryCode`: los schemas Zod son caros de construir y son
 * inmutables, así que se arman una vez por país en la vida del proceso.
 */
export const getInvoiceSchemas = memoizePerCountry(buildInvoiceSchemas);

function buildInvoiceSchemas(cfg: FiscalConfig) {
  // Alícuotas canónicas (%) por taxType — ADR-006 D-3. Antes era un objeto
  // literal con los valores venezolanos; ahora se deriva de la config del país.
  const canonicalTaxRates: Record<string, string> = Object.fromEntries(
    Object.entries(cfg.taxLineRates).map(([key, info]) => [key, info.percent]),
  );

  const taxLine = z
    .object({
      taxType: TaxLineTypeSchema,
      description: z.string().optional(),
      base: z.string().min(1, { error: "La base es requerida" }).refine(withinAmountRange, {
        error: "Monto fuera del rango permitido",
      }),
      rate: z.string().min(1, { error: "La tasa es requerida" }),
      amount: z.string().min(1, { error: "El monto es requerido" }).refine(withinAmountRange, {
        error: "Monto fuera del rango permitido",
      }),
    })
    .superRefine((data, ctx) => {
      // ADR-006 D-3: la tasa enviada debe coincidir con la canónica del taxType
      const expected = canonicalTaxRates[data.taxType];
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

  const create = z
    .object({
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
      date: zBusinessDate(),

      // Contraparte — el ID tributario lo valida el país (RIF en VEN, NIT en COL)
      counterpartName: z.string().min(1, { error: "El nombre es requerido" }).trim().max(200),
      counterpartRif: zTaxId(cfg),
      // H-1: Art. 57 Ley IVA — dirección fiscal del contribuyente en el libro
      counterpartAddress: z.string().max(500).optional(),

      // Líneas de impuesto dinámicas
      taxLines: z.array(taxLine).min(0),

      // Retenciones
      ivaRetentionAmount: amountField().default("0"),
      ivaRetentionVoucher: z.string().optional(),
      ivaRetentionDate: zBusinessDate().optional(),
      islrRetentionAmount: amountField().default("0"),

      // IGTF — solo ventas en divisas
      igtfBase: amountField().default("0"),
      igtfAmount: amountField().default("0"),

      // Multimoneda — Fase 14
      currency: z.enum(SUPPORTED_CURRENCIES).default("VES"),
      exchangeRateId: z.string().optional(),

      // Relaciones opcionales
      transactionId: z.string().optional(),
      periodId: z.string().optional(),

      createdBy: z.string().optional(), // kept for backward compat — action uses auth() userId
      idempotencyKey: z.string().uuid({ error: "Clave de idempotencia inválida" }).optional(),
    })
    .superRefine((data, ctx) => {
      // El Nº de control es obligatorio en COMPRAS y su formato lo fija el país.
      // Un país sin Nº de control (checkControlNumber → null) no exige nada.
      if (data.type === "PURCHASE" && cfg.controlNumberRegex) {
        const placeholder = cfg.controlNumberPlaceholder ?? "00-00000001";
        if (!data.controlNumber) {
          ctx.addIssue({
            code: "custom",
            message: `El Nº Control es obligatorio en compras. Formato: ${placeholder}`,
            path: ["controlNumber"],
          });
        } else {
          const err = checkControlNumber(cfg, data.controlNumber);
          if (err) ctx.addIssue({ code: "custom", message: err, path: ["controlNumber"] });
        }
      }
      // H-14: Prov. 0049 — N° Comprobante obligatorio cuando hay retención IVA (Art. 11)
      try {
        if (new Decimal(data.ivaRetentionAmount).greaterThan(0) && !data.ivaRetentionVoucher?.trim()) {
          ctx.addIssue({
            code: "custom",
            message: "El Nº Comprobante de Retención IVA es obligatorio cuando el monto retenido es mayor a cero (Prov. 0049, Art. 11)",
            path: ["ivaRetentionVoucher"],
          });
        }
      } catch {
        // ivaRetentionAmount parse error already caught by field refine
      }
    });

  const creditDebitNote = create
    .extend({
      relatedInvoiceId: z
        .string({ error: "relatedInvoiceId de la factura original es requerido" })
        .min(1, { error: "relatedInvoiceId de la factura original es requerido" }),
    })
    .transform((data) => {
      const { relatedDocNumber: _stripped, ...rest } = data;
      return rest;
    });

  // Extensión con soporte de líneas — Fase 37A
  const createWithLines = create.extend({
    lines: z.array(InvoiceLineInputSchema).optional(),
    // Flag de confirmación para StockControlLevel.CONFIRM — el cliente lo envía
    // cuando ya le mostramos el diálogo y el usuario aceptó stock negativo
    stockConfirmed: z.boolean().default(false),
  });

  return { taxLine, create, creditDebitNote, createWithLines };
}

// ─── Ancla VEN de compatibilidad (PERMANENTE — ADR-042 D-1) ───────────────────
// No es deuda: fija los tipos inferidos y da schemas listos a los call sites sin
// país (componentes cliente, tests). El contrato "misma estructura en todo país"
// es lo que hace que estos tipos valgan para cualquiera.
const VEN_INVOICE_SCHEMAS = getInvoiceSchemas(getDefaultFiscalConfig());

export const TaxLineSchema = VEN_INVOICE_SCHEMAS.taxLine;
export const CreateInvoiceSchema = VEN_INVOICE_SCHEMAS.create;
export const CreateCreditDebitNoteSchema = VEN_INVOICE_SCHEMAS.creditDebitNote;
export const CreateInvoiceWithLinesSchema = VEN_INVOICE_SCHEMAS.createWithLines;

// ─── Types ────────────────────────────────────────────────────────────────────
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type CreateInvoiceWithLinesInput = z.infer<typeof CreateInvoiceWithLinesSchema>;
export type InvoiceLineInput = z.infer<typeof InvoiceLineInputSchema>;
export type InvoiceBookFilter = z.infer<typeof InvoiceBookFilterSchema>;
export type TaxLineInput = z.infer<typeof TaxLineSchema>;
export type CreateCreditDebitNoteInput = z.output<typeof CreateCreditDebitNoteSchema>;
