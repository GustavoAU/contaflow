# ContaFlow — Contract Registry

---

## 18.1 getNextControlNumber (ARCH 2026-03-29)

- Estado: DECIDIDO ✅

### Decisiones

**Formato:** `00-XXXXXXXX` — prefijo `00` fijo + número secuencial con zero-padding a 8 dígitos (ej. `00-00000001`). Ordenable lexicográficamente; cumple Art. 14 Providencia 0071 SENIAT. Cubre hasta 99 999 999 comprobantes por empresa sin cambio de formato.

**Secuencia:** Opción A — tabla `ControlNumberSequence` con `SELECT ... FOR UPDATE` dentro de transacción Serializable. Descartado `SELECT MAX() + 1`: genera table scan, contención alta y posibles gaps bajo concurrencia en Neon serverless. La tabla de secuencia con fila bloqueada por `FOR UPDATE` es O(1) y es el patrón canónico para correlativos contables.

**Reset:** Global por empresa — sin reset por período contable. Providencia 0071 no exige reset anual para número de control. Reset forzado introduciría colisiones en el libro SENIAT y complejidad operacional sin base normativa.

**Concurrencia:** Serializable SSI (PostgreSQL 14+) + `SELECT ... FOR UPDATE` sobre la fila de secuencia. Sin advisory lock adicional: en Neon serverless con PgBouncer en modo transaction pooling, los advisory locks de sesión no sobreviven al pool y generan deadlocks bajo carga. SSI + row-level lock es suficiente y correcto.

---

### Schema Prisma

```prisma
model ControlNumberSequence {
  id          String      @id @default(cuid())
  companyId   String
  company     Company     @relation(fields: [companyId], references: [id], onDelete: Restrict)
  invoiceType InvoiceType
  lastNumber  Int         @default(0)
  updatedAt   DateTime    @updatedAt

  @@unique([companyId, invoiceType])
  @@index([companyId, invoiceType])
}
```

Migración: `add_control_number_sequence`

Nota: agregar en `model Company` el campo inverso:
```prisma
  controlNumberSequences ControlNumberSequence[]
```

---

### Contrato de función

```typescript
// Archivo owner: src/modules/invoices/services/InvoiceSequenceService.ts

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
 *   - Serializable SSI en PostgreSQL 14+ — sin advisory lock adicional
 *   - El UPDATE atómico sobre la fila de secuencia actúa como row-level lock
 *   - Compatible con Neon serverless + @prisma/adapter-pg (PgBouncer transaction mode)
 */
async function getNextControlNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  invoiceType: InvoiceType   // enum: 'SALE' | 'PURCHASE'  (prisma/schema.prisma)
): Promise<string>           // formato: "00-XXXXXXXX"  ej. "00-00000001"
```

---
