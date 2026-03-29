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

## 18.2 Librería PDF (ARCH 2026-03-29)
- Estado: DECIDIDO ✅

### Decisión
**Librería:** @react-pdf/renderer

El equipo ya escribe TSX para toda la UI del libro; reutilizar esa mentalidad declarativa en el PDF elimina la curva de aprendizaje y hace el template mantenible por cualquier dev del equipo. El PDF se genera en Server Action (Node.js runtime, no edge), por lo que el bundle de ~500 KB no impacta al cliente. jsPDF fue descartado porque su API imperativa de coordenadas manuales dificulta mantener el formato tabular estricto que exige Providencia 0071 con múltiples taxLines por factura.

### Instalación
```bash
npm install @react-pdf/renderer
```

### Formato SENIAT
**Encabezado (repetido por página):**
- Nombre de la empresa
- RIF
- Período: mes/año (ej. "Enero 2026")
- Tipo de libro: "Libro de Compras" o "Libro de Ventas"

**Columnas — idénticas al Excel export existente (`InvoiceBook.tsx`):**

Compras y Ventas (comunes):
`Fecha | Proveedor/Cliente | RIF | N° Factura | N° Control | Tipo Doc | Categoría | N° Doc Rel. | Impuesto | Base Imponible | Tasa % | Monto IVA | IVA Retenido | Comprobante IVA`

Solo Compras (adicionales):
`N° Planilla Imp. | ISLR Retenido`

Solo Ventas (adicionales):
`Base IGTF | Monto IGTF`

**Totales al pie (fila TOTALES):**
- Base Imponible total (IVA General) | IVA General total | IVA Retenido total
- Compras: + ISLR Retenido total
- Ventas: + IGTF total

**Paginación:** "Página X de Y" en pie de página (centrado).

### Contrato de función
```typescript
// Archivo owner: src/modules/invoices/services/InvoiceBookPDFService.ts
import type { InvoiceBookRow, InvoiceBookSummary } from "./InvoiceService";

async function generateInvoiceBookPDF(
  params: {
    companyId: string
    companyName: string
    companyRif: string
    periodId: string
    periodLabel: string          // "Enero 2026"
    invoiceType: "SALE" | "PURCHASE"
    invoices: InvoiceBookRow[]   // mismo tipo del Excel export (InvoiceService.ts)
    summary: InvoiceBookSummary  // totales al pie — misma fuente que el Excel export
  }
): Promise<Buffer>
// Postcondiciones: retorna Buffer con PDF válido, listo para Response con Content-Type: application/pdf
// Notas: llamar solo desde Server Action o Route Handler — no desde componente cliente
//        Usar renderToBuffer() de @react-pdf/renderer (API server-side, sin DOM)
//        Las columnas deben coincidir exactamente con handleExportExcel() en InvoiceBook.tsx
```

---

## 18.4 Link Retention ↔ Invoice (ARCH 2026-03-29)

- Estado: DECIDIDO ✅

### Checklist arch-agent
- [x] onDelete: Restrict — correcto para entidad fiscal
- [x] Índice en invoiceId — @@index([invoiceId])
- [x] deletedAt — agregado (no existía en schema anterior)
- [x] idempotencyKey — agregado con @unique (no existía en schema anterior)
- [x] Relación opcional (invoiceId String?) — retención puede existir sin factura (pago directo)
- [x] Índice compuesto [companyId, invoiceId] — para queries multitenancy

### Schema Prisma (modelo completo)

```prisma
model Retencion {
  id               String          @id @default(cuid())
  companyId        String
  company          Company         @relation(fields: [companyId], references: [id], onDelete: Restrict)
  providerName     String
  providerRif      String
  invoiceNumber    String
  invoiceDate      DateTime
  invoiceAmount    Decimal         @db.Decimal(19, 4)
  taxBase          Decimal         @db.Decimal(19, 4)
  ivaAmount        Decimal         @db.Decimal(19, 4)
  ivaRetention     Decimal         @db.Decimal(19, 4)
  ivaRetentionPct  Decimal         @db.Decimal(5, 2)
  islrAmount       Decimal?        @db.Decimal(19, 4)
  islrRetentionPct Decimal?        @db.Decimal(5, 2)
  totalRetention   Decimal         @db.Decimal(19, 4)
  type             RetentionType
  status           RetentionStatus @default(PENDING)
  transactionId    String?
  transaction      Transaction?    @relation(fields: [transactionId], references: [id], onDelete: Restrict)
  invoiceId        String?
  invoice          Invoice?        @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  idempotencyKey   String          @unique
  deletedAt        DateTime?
  createdAt        DateTime        @default(now())
  createdBy        String

  @@index([companyId])
  @@index([invoiceId])
  @@index([companyId, invoiceId])
}
```

Migración: `link_retention_invoice`

```sql
ALTER TABLE "Retencion" ADD COLUMN "invoiceId" TEXT REFERENCES "Invoice"("id") ON DELETE RESTRICT;
ALTER TABLE "Retencion" ADD COLUMN "idempotencyKey" TEXT NOT NULL;
ALTER TABLE "Retencion" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Retencion_idempotencyKey_key" ON "Retencion"("idempotencyKey");
CREATE INDEX "Retencion_companyId_idx" ON "Retencion"("companyId");
CREATE INDEX "Retencion_invoiceId_idx" ON "Retencion"("invoiceId");
CREATE INDEX "Retencion_companyId_invoiceId_idx" ON "Retencion"("companyId", "invoiceId");
```

### Contratos de función

```typescript
// Archivo owner: src/modules/retentions/services/RetentionService.ts

/**
 * Vincula una retención existente a una factura de la misma empresa.
 *
 * Precondiciones:
 *   - La retención identificada por retentionId pertenece a companyId
 *   - La factura identificada por invoiceId pertenece a companyId
 *   - Ambas entidades tienen deletedAt IS NULL
 *
 * Postcondiciones:
 *   - Retencion.invoiceId === invoiceId
 *   - AuditLog registrado dentro del mismo $transaction
 *
 * Notas:
 *   - Ejecutar dentro de $transaction sin isolationLevel Serializable
 *     (no genera correlativo — Read Committed por defecto es suficiente)
 */
async function linkRetentionToInvoice(
  retentionId: string,
  invoiceId: string,
  companyId: string
): Promise<Prisma.RetencionGetPayload<{ include: { invoice: true } }>>

/**
 * Retorna todas las retenciones activas vinculadas a una factura.
 *
 * Precondiciones:
 *   - La factura identificada por invoiceId pertenece a companyId
 *
 * Postcondiciones:
 *   - Retorna únicamente retenciones con deletedAt IS NULL
 *   - Resultado ordenado por createdAt ASC
 */
async function getRetentionsByInvoice(
  invoiceId: string,
  companyId: string
): Promise<Prisma.RetencionGetPayload<{}>[]>
```

---

## 18.5 Voucher PDF Retención (ARCH 2026-03-29)
- Estado: DECIDIDO ✅ (implementado — desbloqueado por 18.2)

### Implementación
- Owner: src/modules/retentions/services/RetentionVoucherPDFService.ts
- Librería: @react-pdf/renderer (misma que 18.2)
- Formato: A4 portrait, comprobante único por retención
- Cumple: Providencia 0071 + Decreto 1808

### Contrato de función
```typescript
async function generateRetentionVoucherPDF(params: RetentionVoucherParams): Promise<Buffer>
```

---
