// src/modules/orders/utils/sequence.ts
// Correlativo de documentos de Compras y Ventas (COT/PRE/OC/OV) — Serializable + retry P2034.
//
// P1 (audit 2026-07-05): bajo clicks simultáneos de la misma empresa, el upsert
// Serializable puede fallar con P2034 (serialization failure). Sin retry, el usuario
// recibía el error genérico de BD y debía reintentar a mano. Mismo patrón que
// InvoiceService (3 intentos, backoff 0/50/100ms); al agotar → error de negocio.
// El @@unique([companyId, docType]) garantiza que NUNCA hay número duplicado —
// el retry solo elimina la fricción, no cambia la garantía.

import prisma from "@/lib/prisma";
import { type OrderDocType } from "@prisma/client";

const MAX_ATTEMPTS = 3;
const P2034_DELAYS = [0, 50, 100] as const;

function isP2034(err: unknown): err is Error {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "P2034";
}

/** Prefijo visible por tipo de documento (COT-0001, PRE-0001, OC-0001, OV-0001). */
const DOC_PREFIX: Record<OrderDocType, string> = {
  PURCHASE_QUOTATION: "COT",
  SALE_QUOTATION: "PRE",
  PURCHASE_ORDER: "OC",
  SALE_ORDER: "OV",
};

export async function getNextDocumentNumber(
  companyId: string,
  docType: OrderDocType,
): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

    try {
      return await prisma.$transaction(
        async (tx) => {
          const seq = await tx.orderNumberSequence.upsert({
            where: { companyId_docType: { companyId, docType } },
            create: { companyId, docType, lastNumber: 1 },
            update: { lastNumber: { increment: 1 } },
          });
          return `${DOC_PREFIX[docType]}-${String(seq.lastNumber).padStart(4, "0")}`;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      if (isP2034(err)) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS) {
          throw new Error("Conflicto de concurrencia al asignar el número — reintenta la operación");
        }
        continue;
      }
      throw err;
    }
  }

  throw lastErr; // inalcanzable — el loop retorna o lanza
}
