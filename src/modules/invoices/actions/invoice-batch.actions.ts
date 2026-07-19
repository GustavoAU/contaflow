// src/modules/invoices/actions/invoice-batch.actions.ts
// Importación masiva de facturas desde CSV — ALERTA 12 UX
"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { InvoiceService } from "../services/InvoiceService";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import { hasModuleAccess } from "@/lib/module-access";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { Decimal } from "decimal.js";

export type BatchRow = {
  tipo: "COMPRA" | "VENTA";
  tipo_doc: "FACTURA" | "NOTA_DEBITO" | "NOTA_CREDITO";
  rif: string;
  nombre: string;
  nro_factura: string;
  nro_control: string;
  fecha: string;    // YYYY-MM-DD
  base_16: string;
  base_8: string;
  exento: string;
  ret_iva: string;
  ret_islr: string;
};

export type BatchImportResult = {
  created: number;
  errors: { row: number; message: string }[];
};

export async function importInvoiceBatchAction(
  companyId: string,
  periodId: string | undefined,
  rows: BatchRow[]
): Promise<ActionResult<BatchImportResult>> {
  try {
    // Import masivo (loop de creación) → rate-limit fiscal + captura R-6 (ADR-041)
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.fiscal, captureNet: true });
    if (!ctx.ok) return ctx.error;

    if (!await hasModuleAccess(companyId, ctx.role, "invoicing")) {
      return { success: false, error: "Sin acceso al módulo de facturación" };
    }

    const userId = ctx.userId;
    const ipAddress = ctx.ipAddress;
    const userAgent = ctx.userAgent;

    let createdCount = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const type = row.tipo === "VENTA" ? "SALE" : "PURCHASE";

        const taxLines: Array<{ taxType: "IVA_GENERAL" | "IVA_REDUCIDO" | "IVA_ADICIONAL" | "EXENTO"; base: string; rate: string; amount: string }> = [];

        const b16 = new Decimal(row.base_16 || "0");
        const b8 = new Decimal(row.base_8 || "0");
        const bEx = new Decimal(row.exento || "0");

        if (b16.greaterThan(0)) {
          taxLines.push({ taxType: "IVA_GENERAL", base: b16.toFixed(2), rate: "16", amount: b16.mul("0.16").toFixed(2) });
        }
        if (b8.greaterThan(0)) {
          taxLines.push({ taxType: "IVA_REDUCIDO", base: b8.toFixed(2), rate: "8", amount: b8.mul("0.08").toFixed(2) });
        }
        if (bEx.greaterThan(0)) {
          taxLines.push({ taxType: "EXENTO", base: bEx.toFixed(2), rate: "0", amount: "0.00" });
        }

        if (taxLines.length === 0) {
          errors.push({ row: i + 1, message: "Se requiere base_16, base_8 o exento con valor > 0" });
          continue;
        }

        const parsedDate = new Date(row.fecha);
        if (isNaN(parsedDate.getTime())) {
          errors.push({ row: i + 1, message: `Fecha inválida: "${row.fecha}" — use YYYY-MM-DD` });
          continue;
        }

        await prisma.$transaction(async (tx) =>
          withCompanyContext(companyId, tx, async (txCtx) => {
            const inv = await InvoiceService.create(
              {
                companyId,
                type,
                docType: row.tipo_doc,
                taxCategory: "GRAVADA",
                invoiceNumber: row.nro_factura.trim(),
                controlNumber: row.nro_control?.trim() || undefined,
                date: parsedDate,
                counterpartName: row.nombre.trim(),
                counterpartRif: row.rif.trim(),
                taxLines,
                ivaRetentionAmount: row.ret_iva || "0",
                islrRetentionAmount: row.ret_islr || "0",
                igtfBase: "0",
                igtfAmount: "0",
                currency: "VES",
                periodId,
                createdBy: userId,
                idempotencyKey: crypto.randomUUID(),
              },
              txCtx,
            );
            await txCtx.auditLog.create({
              data: {
                companyId,
                entityId: inv.id,
                entityName: "Invoice",
                action: "BATCH_IMPORT",
                userId,
                ipAddress,
                userAgent,
                newValue: { invoiceNumber: row.nro_factura, type, batchRow: i + 1 },
              },
            });
          })
        );

        createdCount++;
      } catch (e) {
        errors.push({
          row: i + 1,
          message: e instanceof Error ? e.message : "Error desconocido",
        });
      }
    }

    if (createdCount > 0) revalidatePath(`/company/${companyId}/invoices`);

    return { success: true, data: { created: createdCount, errors } };
  } catch (e) {
    return toActionError(e);
  }
}
