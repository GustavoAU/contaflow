// src/modules/invoices/services/InvoiceSequenceService.ts
import { Prisma, InvoiceType } from "@prisma/client"

/**
 * Obtiene y reserva el siguiente número de control correlativo para una empresa
 * en formato "00-XXXXXXXX" (Providencia 0071 SENIAT, Art. 14).
 *
 * Precondiciones:
 *   - `tx` DEBE ser un cliente dentro de `prisma.$transaction({ isolationLevel: 'Serializable' })`
 *   - La fila ControlNumberSequence para (companyId, invoiceType) debe existir
 *     o será creada con upsert atómico dentro de la misma transacción
 *
 * Postcondiciones:
 *   - Retorna un string único, no reutilizado, con formato "00-XXXXXXXX"
 *   - `lastNumber` en ControlNumberSequence queda incrementado en 1
 *   - Nunca retorna el mismo número dos veces para la misma (companyId, invoiceType)
 *
 * Notas de concurrencia:
 *   - Serializable SSI (PostgreSQL 14+) — sin advisory lock adicional
 *   - El UPDATE atómico sobre la fila de secuencia actúa como row-level lock
 *   - Compatible con Neon serverless + @prisma/adapter-pg (PgBouncer transaction mode)
 */
export async function getNextControlNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  invoiceType: InvoiceType
): Promise<string> {
  // Upsert + UPDATE atómico — patrón O(1) sin SELECT MAX()
  const sequence = await tx.controlNumberSequence.upsert({
    where: { companyId_invoiceType: { companyId, invoiceType } },
    create: { companyId, invoiceType, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  })

  // Formato 00-XXXXXXXX con zero-padding a 8 dígitos
  const padded = String(sequence.lastNumber).padStart(8, "0")
  return `00-${padded}`
}
