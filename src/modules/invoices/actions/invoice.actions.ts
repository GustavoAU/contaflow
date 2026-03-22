// src/modules/invoices/actions/invoice.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { InvoiceService } from "../services/InvoiceService";
import { CreateInvoiceSchema, InvoiceBookFilterSchema } from "../schemas/invoice.schema";

// ─── Crear factura ─────────────────────────────────────────────────────────────
export async function createInvoiceAction(input: unknown) {
  const parsed = CreateInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const invoice = await InvoiceService.create(parsed.data);
    revalidatePath(`/company/${parsed.data.companyId}/invoices`);
    return { success: true as const, data: invoice.id };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002")) {
        return {
          success: false as const,
          error: "Ya existe una factura con ese número para esta empresa",
        };
      }
      if (error.message.includes("P2003")) {
        return {
          success: false as const,
          error: "Datos de referencia inválidos (empresa o período no existe)",
        };
      }
    }
    return { success: false as const, error: "Error al registrar la factura" };
  }
}

// ─── Obtener libro de compras o ventas ─────────────────────────────────────────
export async function getInvoiceBookAction(input: unknown) {
  const parsed = InvoiceBookFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const result = await InvoiceService.getBook(parsed.data);
    return { success: true as const, data: result };
  } catch {
    return { success: false as const, error: "Error al obtener el libro" };
  }
}
