// src/modules/expenses/schemas/expense.schema.ts
import { z } from "zod";
import { Decimal } from "decimal.js";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";

const MAX_AMOUNT = "999999999999999"; // 19 dígitos, compatible con @db.Decimal(19,4)

// ─── Crear categoría ──────────────────────────────────────────────────────────
export const CreateExpenseCategorySchema = z.object({
  companyId: z.string().min(1, { error: "La empresa es requerida" }),
  name: z.string().min(1, { error: "El nombre es requerido" }).max(100),
  description: z.string().max(255).optional(),
  accountId: z.string().optional(),
});

// ─── Crear gasto ──────────────────────────────────────────────────────────────
export const CreateExpenseSchema = z
  .object({
    companyId: z.string().min(1, { error: "La empresa es requerida" }),
    // Proveedor: vendorId O supplierName obligatorio
    vendorId: z.string().optional(),
    supplierName: z.string().max(200).optional(),

    concept: z.string().min(1, { error: "El concepto es requerido" }).max(500),
    categoryId: z.string().min(1, { error: "La categoría es requerida" }),

    amount: z
      .string()
      .min(1, { error: "El monto es requerido" })
      .refine(
        (v) => {
          try {
            const d = new Decimal(v);
            return d.gt(0) && d.lte(new Decimal(MAX_AMOUNT));
          } catch {
            return false;
          }
        },
        { error: "El monto debe ser mayor a cero y dentro del rango permitido" }
      ),

    currency: z.enum(SUPPORTED_CURRENCIES).default("VES"),

    exchangeRate: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (!v) return true;
          try {
            return new Decimal(v).gt(0);
          } catch {
            return false;
          }
        },
        { error: "La tasa de cambio debe ser mayor a cero" }
      ),

    hasIva: z.boolean().default(false),
    ivaAmount: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (!v) return true;
          try {
            return new Decimal(v).gte(0);
          } catch {
            return false;
          }
        },
        { error: "El monto de IVA debe ser mayor o igual a cero" }
      ),

    isDeductible: z.boolean().default(true),

    invoiceNumber: z.string().max(50).optional(),
    invoiceDate: z.coerce.date().optional(),
    attachmentUrl: z.string().url({ error: "URL de comprobante inválida" }).optional(),

    expenseAccountId: z.string().optional(),
    idempotencyKey: z.string().uuid({ error: "Clave de idempotencia inválida" }),
  })
  .superRefine((data, ctx) => {
    // Validar que vendorId O supplierName estén presentes
    if (!data.vendorId && !data.supplierName) {
      ctx.addIssue({
        code: "custom",
        message: "Se requiere proveedor registrado o nombre de proveedor",
        path: ["vendorId"],
      });
    }
    // exchangeRate obligatorio si currency != VES
    if (data.currency !== "VES" && !data.exchangeRate) {
      ctx.addIssue({
        code: "custom",
        message: "La tasa de cambio es requerida para moneda extranjera",
        path: ["exchangeRate"],
      });
    }
    // ivaAmount obligatorio si hasIva = true
    if (data.hasIva && !data.ivaAmount) {
      ctx.addIssue({
        code: "custom",
        message: "El monto de IVA es requerido cuando hasIva = true",
        path: ["ivaAmount"],
      });
    }
  });

// ─── Confirmar gasto ──────────────────────────────────────────────────────────
export const ConfirmExpenseSchema = z.object({
  expenseId: z.string().min(1),
  companyId: z.string().min(1),
  // Cuenta contable opcional — si no se provee, no se genera asiento
  expenseAccountId: z.string().optional(),
});

// ─── Anular gasto ─────────────────────────────────────────────────────────────
export const VoidExpenseSchema = z.object({
  expenseId: z.string().min(1),
  companyId: z.string().min(1),
  reason: z.string().min(1, { error: "El motivo de anulación es requerido" }).max(500),
});

// ─── Filtros para listado ─────────────────────────────────────────────────────
export const ListExpensesSchema = z.object({
  companyId: z.string().min(1),
  status: z.enum(["DRAFT", "CONFIRMED", "VOIDED"]).optional(),
  categoryId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(50),
});

// ─── Types ────────────────────────────────────────────────────────────────────
export type CreateExpenseCategoryInput = z.infer<typeof CreateExpenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;
export type ConfirmExpenseInput = z.infer<typeof ConfirmExpenseSchema>;
export type VoidExpenseInput = z.infer<typeof VoidExpenseSchema>;
export type ListExpensesInput = z.infer<typeof ListExpensesSchema>;
