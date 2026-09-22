// src/modules/invoices/actions/invoice-batch.actions.ts
// Importación masiva de facturas desde CSV — ALERTA 12 UX
"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { InvoiceService } from "../services/InvoiceService";
import { getNextControlNumber } from "../services/InvoiceSequenceService";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import { hasModuleAccess } from "@/lib/module-access";
import { withSerializableRetry } from "@/lib/tx-helpers";
import { getInvoiceSchemas } from "../schemas/invoice.schema";
import { getFiscalConfig } from "@/lib/countries";
import { isPrismaError, p2002TargetIncludes, mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { assertWriteAllowed } from "@/modules/billing/services/SubscriptionService";
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

    // Auditoría de seguridad: el diálogo anuncia "Máximo 200 filas por archivo" pero nada lo
    // exigía server-side — la action es invocable directamente sin pasar por el diálogo. Mismo
    // patrón que importAccountsAction (src/modules/import/actions/import.actions.ts).
    if (rows.length > 200) {
      return { success: false, error: "El archivo supera el límite de 200 facturas por importación." };
    }

    // Corte por suscripción vencida (solo lectura) — mismo guard que createInvoiceAction.
    await assertWriteAllowed(companyId);

    const userId = ctx.userId;
    const ipAddress = ctx.ipAddress;
    const userAgent = ctx.userAgent;
    const schemas = getInvoiceSchemas(getFiscalConfig(ctx.country));

    let createdCount = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Auditoría fiscal (hallazgo H4): una Nota de Crédito/Débito importada por este camino
        // llega a `InvoiceService.create` directo, sin las validaciones de negocio que solo vive
        // en `InvoiceCreditDebitNoteService` (relatedInvoiceId real, factura original no anulada,
        // período no cerrado, monto no mayor al saldo pendiente). El libro SÍ la resta/suma de los
        // totales (`signOf(docType)`), así que una NC "flotante" sin ese respaldo reduciría ventas
        // declaradas sin trazabilidad. El CSV tampoco tiene columna para `relatedDocNumber`. Se
        // bloquea aquí — usar el formulario de Notas de Crédito/Débito, que sí las vincula.
        if (row.tipo_doc === "NOTA_CREDITO" || row.tipo_doc === "NOTA_DEBITO") {
          errors.push({
            row: i + 1,
            message: "Las notas de crédito/débito no se pueden importar por CSV — usa el formulario de Notas de Crédito/Débito para vincularlas a la factura original.",
          });
          continue;
        }

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

        // Validación completa con el schema del país — mismo criterio que createInvoiceAction
        // (ADR-042 D-1). Cierra el hueco documentado en ADR-049 "Fuera de alcance": esta vía
        // llamaba a InvoiceService.create directo, sin validar RIF, Nº de Control, rango de
        // fecha, tope de monto ni comprobante de retención (H-14, Prov. 0049 Art. 11). El CSV
        // no tiene columna de comprobante, así que una fila con retención > 0 se rechaza aquí:
        // es correcto — antes se aceptaba en violación de la Providencia.
        const parsed = schemas.create.safeParse({
          companyId,
          type,
          docType: row.tipo_doc,
          taxCategory: "GRAVADA",
          invoiceNumber: row.nro_factura?.trim(),
          controlNumber: row.nro_control?.trim() || undefined,
          date: row.fecha,
          counterpartName: row.nombre?.trim(),
          counterpartRif: row.rif?.trim(),
          taxLines,
          ivaRetentionAmount: row.ret_iva || "0",
          islrRetentionAmount: row.ret_islr || "0",
          igtfBase: "0",
          igtfAmount: "0",
          currency: "VES",
          periodId,
          createdBy: userId,
          idempotencyKey: crypto.randomUUID(),
        });
        if (!parsed.success) {
          errors.push({ row: i + 1, message: parsed.error.issues[0].message });
          continue;
        }

        // H-002 (Prov. 0071 Art. 14): SALE usa Serializable para correlativos (Z-1) — el
        // Nº de Control se autogenera si el CSV no trae uno. PURCHASE: ReadCommitted sin
        // correlativo, el Nº de Control del proveedor ya lo exigió el schema arriba.
        const txBody = async (tx: Parameters<typeof withCompanyContext>[1]) =>
          withCompanyContext(companyId, tx, async (tx) => {
            let controlNumber = parsed.data.controlNumber;
            if (parsed.data.type === "SALE" && !controlNumber) {
              controlNumber = await getNextControlNumber(tx, companyId, "SALE");
            }
            const inv = await InvoiceService.create({ ...parsed.data, controlNumber }, tx);
            await tx.auditLog.create({
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
          });

        if (parsed.data.type === "SALE") {
          await withSerializableRetry(txBody);
        } else {
          await prisma.$transaction(txBody);
        }

        createdCount++;
      } catch (e) {
        // Errores Prisma al cliente: nunca raw (quick-reference CLAUDE.md).
        if (isPrismaError(e, "P2002")) {
          // H-002 Z-1: la fila era una venta sin Nº de Control y chocó la secuencia
          // concurrente — transitorio y reintentable, no "número duplicado".
          if (row.tipo === "VENTA" && !row.nro_control?.trim() && p2002TargetIncludes(e, "invoiceType")) {
            errors.push({ row: i + 1, message: "Error transitorio al generar Nº Control — intenta de nuevo." });
          } else {
            errors.push({ row: i + 1, message: "Ya existe una factura con ese número para esta empresa" });
          }
        } else if (isPrismaError(e, "P2003")) {
          errors.push({ row: i + 1, message: "Datos de referencia inválidos" });
        } else {
          // Auditoría de seguridad: el resto de errores (P2034 write-conflict agotado, timeouts
          // de conexión Neon, permisos RLS, etc.) NUNCA deben llegar crudos al CSV de resultados
          // — mapPrismaError es la fuente única que ya blinda esto (CLAUDE.md quick-reference).
          errors.push({ row: i + 1, message: mapPrismaError(e) });
        }
      }
    }

    if (createdCount > 0) revalidatePath(`/company/${companyId}/invoices`);

    return { success: true, data: { created: createdCount, errors } };
  } catch (e) {
    return toActionError(e);
  }
}
