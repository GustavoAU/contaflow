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

## 15.1 closeFiscalYear — Cierre de Ejercicio Económico (ARCH 2026-03-30)

- Estado: DECIDIDO ✅

---

### Decisiones Arquitectónicas

#### A. Modelo separado `FiscalYearClose`

**Decisión:** Tabla `FiscalYearClose` separada. NO campos en `AccountingPeriod`.

**Razón:** `AccountingPeriod` gestiona cierres **mensuales** (`year + month`). El cierre de ejercicio es una operación **anual** que afecta todos los períodos del año simultáneamente. Son eventos contables distintos con ciclos de vida propios. Mezclarlos viola SRP y genera ambigüedad en queries de reporting.

**Constraint de idempotencia:** `@@unique([companyId, year])` — el registro existente es la prueba física de que el ejercicio está cerrado. No se necesita enum de estado adicional (YAGNI).

#### B. Cuentas de cierre configurables en Company

**Decisión:** Dos campos opcionales en `Company`:
- `resultAccountId String?` — cuenta "Resultado del Ejercicio" (debe ser `AccountType.EQUITY`)
- `retainedEarningsAccountId String?` — cuenta "Utilidades Retenidas / Pérdidas Acumuladas" (debe ser `AccountType.EQUITY`)

**Razón:** El plan de cuentas en ContaFlow es configurable por empresa. No hay código de cuenta estándar universal en VEN-NIF. La configuración debe ser explícita y auditada. Ambos campos deben estar configurados antes de ejecutar el cierre (validación en la Server Action).

#### C. Concurrencia y prevención de doble cierre

**Decisión:** `$transaction({ isolationLevel: 'Serializable' })` — idéntico al patrón de `getNextControlNumber` y `getNextVoucherNumber`.

**Flujo de guard dentro de la tx:**
1. Verificar que `FiscalYearClose` NO existe para `(companyId, year)` → error de negocio si existe
2. Verificar que todos los períodos EXISTENTES del año tienen `status: CLOSED` → error bloqueante si hay alguno `OPEN`
3. Verificar que `resultAccountId` y `retainedEarningsAccountId` están configurados
4. Ejecutar → insertar `FiscalYearClose` + transacciones de cierre en la misma tx

**Prevención de asientos en años cerrados:**
- Guard en `createTransaction` / `createTransactionAction`: si existe `FiscalYearClose` para el año de la fecha del asiento → rechazar con error de negocio.
- Guard en `reopenPeriod` (Fase 5): si existe `FiscalYearClose` para el año del período → rechazar.

#### D. Asientos de cierre VEN-NIF (dos asientos `type: CIERRE`)

**Asiento 1 — Cierre de cuentas de resultado (obligatorio):**
- Débito: cada cuenta `AccountType.REVENUE` por su saldo acreedor neto (saldo negativo en nuestro sistema de signos → entrada positiva)
- Crédito: cada cuenta `AccountType.EXPENSE` por su saldo deudor neto (entrada negativa)
- Diferencia neta → a la cuenta `resultAccount` (crédito si ganancia, débito si pérdida)
- Resultado: saldo neto de todas las cuentas REVENUE y EXPENSE queda en 0 para el año

**Asiento 2 — Apropiación (opcional, diferible post-AGO):**
- Débito: cuenta `resultAccount`
- Crédito: cuenta `retainedEarningsAccount`
- Solo ejecutable si el asiento 1 ya existe (`closingTransactionId` no nulo)
- Solo ejecutable si `appropriationTransactionId` es nulo (idempotencia)

**Inmutabilidad post-cierre:**
- Los asientos del ejercicio cerrado son **absolutamente inmutables** — no VOID, no edición, aunque el usuario sea ADMIN.
- La corrección de errores se realiza mediante asientos en el ejercicio siguiente.
- Esto aplica aun si el `AccountingPeriod` mensual fuera técnicamente re-abierto (el `FiscalYearClose` tiene precedencia).

---

### Schema Prisma

```prisma
// Cierre de ejercicio económico anual
model FiscalYearClose {
  id                         String       @id @default(cuid())
  companyId                  String
  company                    Company      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  year                       Int
  closedAt                   DateTime     @default(now())
  closedBy                   String       // userId (Clerk)

  // Asiento 1: cierre de cuentas de resultado (OBLIGATORIO)
  closingTransactionId       String       @unique
  closingTransaction         Transaction  @relation("ClosingTransaction", fields: [closingTransactionId], references: [id], onDelete: Restrict)

  // Asiento 2: apropiación resultado → patrimonio (OPCIONAL — post-AGO)
  appropriationTransactionId String?      @unique
  appropriationTransaction   Transaction? @relation("AppropriationTransaction", fields: [appropriationTransactionId], references: [id], onDelete: Restrict)

  // Snapshot inmutable de los montos calculados al momento del cierre
  totalRevenue               Decimal      @db.Decimal(19, 4)
  totalExpenses              Decimal      @db.Decimal(19, 4)
  netResult                  Decimal      @db.Decimal(19, 4)  // positivo = ganancia, negativo = pérdida

  createdAt                  DateTime     @default(now())

  @@unique([companyId, year])
  @@index([companyId])
}
```

**Cambios en `Company`:**
```prisma
  // Cuentas de cierre configurables (Fase 15)
  resultAccountId             String?
  resultAccount               Account?      @relation("ResultAccount", fields: [resultAccountId], references: [id], onDelete: Restrict)
  retainedEarningsAccountId   String?
  retainedEarningsAccount     Account?      @relation("RetainedEarningsAccount", fields: [retainedEarningsAccountId], references: [id], onDelete: Restrict)
  fiscalYearCloses            FiscalYearClose[]
```

**Cambios en `Account` (relaciones inversas Prisma):**
```prisma
  companiesAsResult           Company[]  @relation("ResultAccount")
  companiesAsRetainedEarnings Company[]  @relation("RetainedEarningsAccount")
```

**Cambios en `Transaction` (relaciones inversas Prisma):**
```prisma
  fiscalYearCloseAsClosing       FiscalYearClose? @relation("ClosingTransaction")
  fiscalYearCloseAsAppropriation FiscalYearClose? @relation("AppropriationTransaction")
```

Migración a generar: `feat_15_fiscal_year_close`

---

### Contratos de función

```typescript
// Archivo owner: src/modules/fiscal-close/services/FiscalYearCloseService.ts

/**
 * Ejecuta el cierre de ejercicio económico para una empresa y año dados.
 *
 * Precondiciones:
 *   - El usuario tiene rol ADMIN en la empresa
 *   - Todos los períodos AccountingPeriod de (companyId, year) que existen tienen status CLOSED
 *   - NO existe FiscalYearClose para (companyId, year) — verificado dentro de la tx
 *   - company.resultAccountId y company.retainedEarningsAccountId están configurados
 *   - Las cuentas configuradas tienen AccountType.EQUITY y pertenecen a la empresa
 *
 * Proceso (dentro de $transaction({ isolationLevel: 'Serializable' })):
 *   1. Re-verificar precondiciones dentro de la tx
 *   2. Calcular saldos netos de todas las cuentas REVENUE y EXPENSE del año
 *   3. Generar Transaction type: CIERRE con JournalEntries que cierran cada cuenta
 *   4. Insertar FiscalYearClose con snapshot de montos
 *   5. Registrar AuditLog dentro de la misma tx
 *
 * Postcondiciones:
 *   - FiscalYearClose registrado con closingTransactionId
 *   - No pueden crearse nuevas transacciones con fecha del año cerrado
 *   - Los períodos del año no pueden re-abrirse
 *   - appropriationTransactionId queda en null (pendiente post-AGO)
 *
 * Errores de negocio (nunca exponer errores Prisma crudos):
 *   - "El ejercicio económico {year} ya está cerrado"         → FiscalYearClose existe
 *   - "Existen períodos abiertos en el ejercicio {year}"     → algún period.status === OPEN
 *   - "Cuentas de cierre no configuradas"                     → resultAccountId nulo
 *   - "No hay movimientos en cuentas de resultado"            → sum revenue + expenses = 0
 */
async function closeFiscalYear(
  companyId: string,
  year: number,
  closedBy: string  // userId Clerk
): Promise<FiscalYearCloseResult>

type FiscalYearCloseResult = {
  fiscalYearCloseId: string
  closingTransactionId: string
  totalRevenue: Decimal
  totalExpenses: Decimal
  netResult: Decimal          // positivo = ganancia, negativo = pérdida
  closingEntriesCount: number // número de JournalEntries generadas
}

/**
 * Genera el asiento de apropiación del resultado del ejercicio a patrimonio.
 * Ejecutable después del AGO (Asamblea General Ordinaria).
 *
 * Precondiciones:
 *   - Existe FiscalYearClose para (companyId, year)
 *   - FiscalYearClose.appropriationTransactionId es NULL
 *   - company.retainedEarningsAccountId está configurado
 *   - El usuario tiene rol ADMIN
 *
 * Postcondiciones:
 *   - FiscalYearClose.appropriationTransactionId actualizado
 *   - Transaction type: CIERRE generada con 2 JournalEntries
 *   - AuditLog registrado en la misma tx
 */
async function appropriateFiscalYearResult(
  companyId: string,
  year: number,
  approvedBy: string  // userId Clerk
): Promise<{ appropriationTransactionId: string }>

/**
 * Verifica si un año fiscal está cerrado para una empresa.
 * Usado como guard en createTransaction y reopenPeriod.
 *
 * Notas:
 *   - Llamada fuera de transacción — Read Committed es suficiente
 *   - Cacheable a nivel de request (no persiste entre requests)
 */
async function isFiscalYearClosed(
  companyId: string,
  year: number
): Promise<boolean>

/**
 * Obtiene el historial de cierres de ejercicio de una empresa.
 */
async function getFiscalYearCloseHistory(
  companyId: string
): Promise<FiscalYearCloseSummary[]>

type FiscalYearCloseSummary = {
  id: string
  year: number
  closedAt: Date
  closedBy: string
  totalRevenue: Decimal
  totalExpenses: Decimal
  netResult: Decimal
  hasAppropriation: boolean
}
```

---

### Rutas nuevas

```
/company/[companyId]/fiscal-close           → historial de cierres + botón "Cerrar Ejercicio"
/company/[companyId]/settings               → configuración de cuentas de cierre (resultAccountId, retainedEarningsAccountId)
```

---

### Bloqueantes confirmados (2026-03-30)

**BLOQUEANTE 1 — Períodos parciales:** Solo períodos EXISTENTES deben estar CLOSED. No se exigen 12 meses completos. Una empresa que comenzó en abril solo necesita tener cerrados los períodos que existen (abril–diciembre).

**BLOQUEANTE 2 — Configuración Contable:** Sección nueva "Configuración Contable" dentro de Settings, separada de la configuración general de empresa. Campos: `resultAccountId` y `retainedEarningsAccountId` con selector de cuenta (AccountType.EQUITY).

**BLOQUEANTE 3 — Bloqueo total post-cierre:** Bloqueo estricto en tres puntos:
- (a) No nuevas transacciones con fecha en el año cerrado → guard en `createTransactionAction`
- (b) No re-apertura de períodos del año cerrado → guard en `reopenPeriodAction`
- (c) No nuevas facturas ni retenciones con fecha en el año cerrado → guard en `createInvoiceAction` y `createRetentionAction`

Estándar requerido para competir con Gálac/CG1.

### Checklist arch-agent

- [x] Idempotencia: `@@unique([companyId, year])` previene doble cierre
- [x] Serializable SSI: consistente con patrón canónico del proyecto
- [x] Guard en createTransaction: rechazar si FiscalYearClose existe para ese año
- [x] Guard en reopenPeriod: rechazar si FiscalYearClose existe para ese año
- [x] Guard en createInvoice + createRetencion: rechazar si FiscalYearClose existe para el año de la fecha
- [x] onDelete: Restrict en todas las relaciones — nunca Cascade
- [x] AuditLog dentro del mismo `$transaction`
- [x] Snapshot de montos inmutable en FiscalYearClose (totalRevenue, totalExpenses, netResult)
- [x] Apropiación separada y diferible — no forzada en el cierre
- [x] Inmutabilidad post-cierre: los asientos del ejercicio cerrado no pueden VOID ni editar
- [x] Cuentas de cierre configurables por empresa (no hardcodeadas)
- [x] Validación de AccountType.EQUITY antes de asignar cuentas de cierre
- [x] Solo períodos existentes requeridos (no 12 meses completos)

---

## 16.1 Cartera CxC/CxP con Antigüedad de Saldos (ARCH 2026-03-30)

- Estado: IMPLEMENTADO ✅ — completado 2026-03-31, 254/254 tests verde

### Bloqueantes confirmados (2026-03-30)

**BLOQUEANTE 1 — dueDate:** Opción B — plazo configurable por empresa. Campo `paymentTermDays Int @default(30)` en `Company`. Al crear factura: `dueDate = date + paymentTermDays días`. El usuario puede editar `paymentTermDays` en Settings.

**BLOQUEANTE 2 — Integración con asientos:** Opción B — Desacoplado para Fase 16. El pago actualiza `paymentStatus` y `pendingAmount` en Invoice solamente. El contador genera el asiento manualmente. Opción A (auto-asiento) diferida a Fase 16B.

**BLOQUEANTE 3 — Semántica de PaymentRecord:** Opción B — Separar modelos. `PaymentRecord` se mantiene para medios de pago digitales (PagoMóvil, Zelle, Cashea). Nuevo modelo `InvoicePayment` para cancelación de cartera CxC/CxP. Son semánticamente distintos bajo VEN-NIF.

**BLOQUEANTE 4 — Notas de Crédito:** Opción A — `NOTA_CREDITO` reduce automáticamente `pendingAmount` de la factura original via `relatedDocNumber`. Vinculación jurídica obligatoria bajo Reglamento IVA Art. 58.

**BLOQUEANTE 5 — DocTypes en aging:** `FACTURA` + `NOTA_DEBITO` suman deuda. `NOTA_CREDITO` la reduce (ver BLOQUEANTE 4). `REPORTE_Z` y `RESUMEN_VENTAS` excluidos del aging — son comprobantes de venta al detal, no instrumentos de cartera.

### Contratos de función

```typescript
// Archivo owner: src/modules/receivables/services/ReceivableService.ts

/**
 * Retorna el portfolio de CxC (type=SALE) o CxP (type=PURCHASE).
 * Incluye solo facturas con paymentStatus !== VOIDED y deletedAt IS NULL.
 * Calcula antigüedad de saldos (aging) al momento de la llamada.
 */
async function getReceivables(companyId: string): Promise<InvoiceWithAging[]>
async function getPayables(companyId: string): Promise<InvoiceWithAging[]>

type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+'

type InvoiceWithAging = {
  id: string
  invoiceNumber: string
  counterpartName: string
  counterpartRif: string
  date: Date
  dueDate: Date | null
  totalAmountVes: Decimal
  pendingAmount: Decimal
  paymentStatus: InvoicePaymentStatus
  agingBucket: AgingBucket
  daysOverdue: number
}

/**
 * Clasifica una factura en su bucket de antigüedad (pure function, sin DB).
 * Referencia: today = fecha de llamada. dueDate puede ser null (sin vencimiento definido).
 */
function classifyAgingBucket(dueDate: Date | null, today: Date): AgingBucket

/**
 * Registra un pago de cartera sobre una factura.
 *
 * Precondiciones:
 *   - La factura pertenece a companyId
 *   - La factura tiene deletedAt IS NULL y paymentStatus !== VOIDED
 *   - amount <= pendingAmount (con tolerancia de 1 centavo)
 *   - El año de la factura no está cerrado (FiscalYearClose guard)
 *
 * Proceso (dentro de $transaction ReadCommitted):
 *   1. Verificar precondiciones (re-leer Invoice dentro de la tx)
 *   2. Crear InvoicePayment con idempotencyKey
 *   3. Actualizar Invoice.pendingAmount -= amount
 *   4. Actualizar Invoice.paymentStatus (PARTIAL o PAID según pendingAmount resultante)
 *   5. Si currency != VES y isSpecialContributor: calcular y crear IGTFTransaction
 *   6. AuditLog dentro del mismo $transaction
 *
 * Postcondiciones:
 *   - InvoicePayment creado
 *   - Invoice.pendingAmount actualizado
 *   - Invoice.paymentStatus actualizado
 */
async function recordPayment(
  companyId: string,
  invoiceId: string,
  amount: Decimal,
  currency: Currency,
  method: PaymentMethod,
  recordedBy: string,
  idempotencyKey: string,
  options?: {
    exchangeRateId?: string
    amountOriginal?: Decimal
    referenceNumber?: string
    originBank?: string
    destBank?: string
    commissionPct?: Decimal
    igtfAmount?: Decimal
    date?: Date
    notes?: string
  }
): Promise<InvoicePayment>

/**
 * Anula (soft delete) un pago de cartera y revierte pendingAmount en la factura.
 *
 * Precondiciones:
 *   - El pago pertenece a companyId
 *   - El pago tiene deletedAt IS NULL
 *   - El año de la factura no está cerrado (FiscalYearClose guard)
 *   - El usuario tiene rol ADMIN o ACCOUNTANT (ADR-006 D-1)
 *
 * Proceso (dentro de $transaction ReadCommitted):
 *   1. Soft delete del InvoicePayment (deletedAt = now, deletedBy = userId)
 *   2. Revertir Invoice.pendingAmount += payment.amount
 *   3. Recalcular Invoice.paymentStatus
 *   4. AuditLog dentro del mismo $transaction
 */
async function cancelPayment(
  companyId: string,
  paymentId: string,
  cancelledBy: string
): Promise<void>

// Pagos activos de una factura (deletedAt IS NULL), ordenados por date ASC
async function getPaymentsByInvoice(invoiceId: string, companyId: string): Promise<InvoicePaymentSummary[]>
```

---

### Rutas nuevas

```
/company/[companyId]/receivables   → Cartera CxC + Aging Report + registrar cobro
/company/[companyId]/payables      → Cartera CxP + Aging Report + registrar pago
```

---

### Tests requeridos

```
ReceivableService.test.ts:
  classifyAgingBucket — todos los buckets (pure function)
  getReceivables — filtros correctos, NOTA_CREDITO netea, REPORTE_Z excluido
  getPayables — idem con type=PURCHASE
  recordPayment — idempotencia, pendingAmount actualizado, error si amount > pending
  cancelPayment — soft delete, reversión pendingAmount, error si año cerrado
  Integration: factura con retenciones → pendingAmount correcto
  Integration: NOTA_CREDITO reduce pendingAmount de factura original

receivable.actions.test.ts:
  getReceivablesAction — auth, membership, serialización
  getPayablesAction — idem
  recordPaymentAction — auth, rate limit, guard año cerrado
  cancelPaymentAction — auth, solo ADMIN/ACCOUNTANT
  exportAgingReportPDFAction — buffer PDF serializable
```

---

### Checklist arch-agent (Fase 16)

- [x] BLOQUEANTE 1 resuelto: `paymentTermDays` en Company, `dueDate` auto-calculado
- [x] BLOQUEANTE 2 resuelto: Opción B desacoplada, Opción A diferida a Fase 16B
- [x] BLOQUEANTE 3 resuelto: nuevo modelo `InvoicePayment` separado de `PaymentRecord`
- [x] BLOQUEANTE 4 resuelto: NOTA_CREDITO netea via `relatedDocNumber`
- [x] BLOQUEANTE 5 resuelto: FACTURA + NOTA_DEBITO suman; REPORTE_Z excluido
- [ ] Enum `InvoicePaymentStatus` creado
- [ ] `paymentTermDays` añadido a `Company`
- [ ] `dueDate`, `totalAmountVes`, `pendingAmount`, `paymentStatus` añadidos a `Invoice`
- [ ] Modelo `InvoicePayment` creado con `idempotencyKey` + `deletedAt`
- [ ] Índices compuestos en Invoice para aging queries
- [ ] `classifyAgingBucket` como pure function aislada
- [ ] Guard `FiscalYearClose` en `recordPaymentAction` y `cancelPaymentAction`
- [ ] IGTF en `recordPayment` si divisa != VES
- [ ] `pendingAmount` inicial = `totalAmountVes - ivaRetentionAmount - islrRetentionAmount`
- [ ] Rate limiting `limiters.fiscal` en todas las actions
- [ ] AuditLog dentro del mismo `$transaction` en `recordPayment` y `cancelPayment`
- [ ] PDF aging report con `@react-pdf/renderer`
- [ ] Tests: todos en verde antes de continuar

---

## 17. Conciliación Bancaria (ARCH 2026-03-31)

- Estado: DECIDIDO ✅

### Decisiones arquitectónicas (B1–B5 — no re-decidir)

- **B1** DECIDIDO ✅ — `BankStatement` como contenedor obligatorio. Toda importación crea un BankStatement; las transacciones son hijas de él. Garantiza trazabilidad completa: quién importó, cuándo, qué período cubre.
- **B2** DECIDIDO ✅ — Matching manual puro. No hay algoritmo de sugerencia automática en scope mínimo. El contador elige explícitamente qué `BankTransaction` corresponde a qué `InvoicePayment`.
- **B3** DECIDIDO ✅ — Solo `InvoicePayment` en scope mínimo. `matchedJournalEntryId` permanece como `String?` sin FK hasta Fase 18, cuando se implemente matching con asientos contables directos.
- **B4** DECIDIDO ✅ — `BankAccount.closingBalance` como saldo de referencia actual. Se actualiza al importar cada nuevo BankStatement.
- **B5** DECIDIDO ✅ — Columnas CSV fijas: `date | description | debit | credit | balance`. Sin soporte de formatos variables en scope mínimo.

---

### 17.1 Contrato de Schema — BankAccount, BankStatement, BankTransaction

#### Schema TARGET completo (listo para migración complementaria)

```prisma
model BankAccount {
  id             String    @id @default(cuid())
  companyId      String
  company        Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)
  accountId      String    @unique
  account        Account   @relation(fields: [accountId], references: [id], onDelete: Restrict)
  name           String
  bankName       String
  accountNumber  String?                         // número de cuenta bancaria visible al usuario
  currency       Currency  @default(VES)
  closingBalance Decimal   @db.Decimal(19, 4) @default(0)  // saldo actual (B4)
  isActive       Boolean   @default(true)
  deletedAt      DateTime?                       // soft delete
  createdAt      DateTime  @default(now())
  createdBy      String

  statements     BankStatement[]

  @@index([companyId])
}

model BankStatement {
  id             String              @id @default(cuid())
  bankAccountId  String
  bankAccount    BankAccount         @relation(fields: [bankAccountId], references: [id], onDelete: Restrict)
  periodStart    DateTime            @db.Date
  periodEnd      DateTime            @db.Date
  openingBalance Decimal             @db.Decimal(19, 4)
  closingBalance Decimal             @db.Decimal(19, 4)
  status         BankStatementStatus @default(OPEN)
  importedAt     DateTime            @default(now())
  importedBy     String
  deletedAt      DateTime?

  transactions   BankTransaction[]

  @@index([bankAccountId])
}
```

### Contratos de función (BankingService)

```typescript
// Archivo owner: src/modules/bank-reconciliation/services/BankingService.ts

/**
 * Importa un extracto bancario desde filas CSV ya parseadas.
 *
 * Precondiciones:
 *   - bankAccountId pertenece a companyId
 *   - csvRows.length >= 1
 *   - openingBalance + sum(credits) - sum(debits) === closingBalance (tolerancia 0.01)
 *
 * Proceso (dentro de $transaction ReadCommitted):
 *   1. Verificar que bankAccount.companyId === companyId
 *   2. Crear BankStatement con periodStart/End inferidos de las fechas CSV
 *   3. Crear BankTransaction[] hijos
 *   4. Actualizar BankAccount.closingBalance = closingBalance del statement
 *   5. AuditLog
 *
 * Postcondiciones:
 *   - BankStatement creado con todas sus transacciones
 *   - BankAccount.closingBalance actualizado
 */
async function importStatement(
  bankAccountId: string,
  companyId: string,
  csvRows: CsvRow[]
): Promise<BankStatement>

/**
 * Retorna las transacciones sin conciliar de una cuenta bancaria.
 *
 * Filtro: isReconciled = false AND deletedAt IS NULL
 * Orden: date ASC, createdAt ASC
 */
async function getUnreconciledTransactions(
  bankAccountId: string,
  companyId: string
): Promise<BankTransaction[]>

/**
 * Concilia una transacción bancaria con un pago de factura.
 *
 * Precondiciones:
 *   - transactionId pertenece a companyId (vía statement → bankAccount → companyId)
 *   - invoicePaymentId pertenece a companyId
 *   - BankTransaction.isReconciled === false
 *   - BankTransaction.deletedAt IS NULL
 *   - InvoicePayment.deletedAt IS NULL
 *
 * Proceso (dentro de $transaction ReadCommitted):
 *   1. Verificar precondiciones dentro de la tx
 *   2. Actualizar BankTransaction: matchedPaymentId, matchedAt, matchedBy, isReconciled = true
 *   3. AuditLog dentro del mismo $transaction
 *
 * Postcondiciones:
 *   - BankTransaction.isReconciled === true
 *   - BankTransaction.matchedPaymentId === invoicePaymentId
 *
 * Errores de negocio:
 *   - "La transacción ya está conciliada"
 *   - "El pago no pertenece a esta empresa"
 *   - "La transacción no pertenece a esta empresa"
 */
async function reconcileTransaction(
  transactionId: string,
  invoicePaymentId: string,
  companyId: string,
  reconciledBy: string  // userId Clerk
): Promise<BankTransaction>

/**
 * Desconcilia una transacción bancaria.
 *
 * Precondiciones:
 *   - transactionId pertenece a companyId
 *   - BankTransaction.isReconciled === true
 *   - BankTransaction.deletedAt IS NULL
 *
 * Proceso (dentro de $transaction ReadCommitted):
 *   1. Limpiar matchedPaymentId, matchedAt, matchedBy
 *   2. Establecer isReconciled = false
 *   3. AuditLog dentro del mismo $transaction
 */
async function unreconcileTransaction(
  transactionId: string,
  companyId: string,
  unreconciledBy: string
): Promise<BankTransaction>
```

### Contratos de función (CsvImporter)

```typescript
/**
 * Tipo de fila CSV ya parseada y normalizada.
 * Invariante: debit XOR credit tiene valor — nunca ambos, nunca ninguno.
 */
type CsvRow = {
  date: Date           // parseado desde dd/mm/yyyy o yyyy-mm-dd
  description: string  // string limpio, sin espacios extra
  debit: Decimal | null   // null si la fila es un crédito
  credit: Decimal | null  // null si la fila es un débito
  balance: Decimal | null // opcional — puede no estar presente en el CSV
}

type ValidationResult =
  | { valid: true }
  | { valid: false; expected: Decimal; actual: Decimal }

/**
 * Parsea el texto completo de un CSV bancario venezolano con columnas fijas.
 *
 * Formato esperado (columnas, separador coma o punto y coma):
 *   date | description | debit | credit | balance
 *
 * Reglas de parseo:
 *   - date: acepta dd/mm/yyyy y yyyy-mm-dd. Lanza error si no puede parsear.
 *   - debit/credit: acepta formato venezolano "1.000,50" → Decimal("1000.50")
 *                   acepta formato internacional "1000.50" → Decimal("1000.50")
 *                   celda vacía o "0" o "0,00" → null (no hay movimiento en esa columna)
 *   - balance: opcional — si la columna no existe o está vacía → null
 *   - Primera fila ignorada si es encabezado (detectado por presencia de texto no numérico en columna date)
 *   - Filas completamente vacías ignoradas
 *
 * Postcondiciones:
 *   - Retorna array de CsvRow con al menos 1 elemento
 *   - Cada CsvRow cumple el invariante: (debit !== null) XOR (credit !== null)
 *
 * Errores:
 *   - Lanza Error("CSV vacío o sin filas válidas") si no hay filas parseables
 *   - Lanza Error("Fila {n}: fecha inválida '{value}'") si una fecha no puede parsearse
 *   - Lanza Error("Fila {n}: monto inválido '{value}'") si debit y credit son ambos no-nulos
 */
function parseBankCsv(csvText: string): CsvRow[]

/**
 * Verifica que el conjunto de filas CSV cuadra contablemente con los balances declarados.
 *
 * Fórmula: openingBalance + sum(credits) - sum(debits) === closingBalance
 * Tolerancia: diferencia absoluta <= Decimal("0.01") (redondeo centavos)
 *
 * Uso: llamar antes de importStatement para detectar CSVs corruptos o incompletos.
 */
function validateCsvBalance(
  rows: CsvRow[],
  openingBalance: Decimal,
  closingBalance: Decimal
): ValidationResult
```

---

### Rutas nuevas

```
/company/[companyId]/bank-reconciliation              → lista de cuentas bancarias + botón "Nueva Cuenta"
/company/[companyId]/bank-reconciliation/[accountId]  → extractos de una cuenta + importar CSV
/company/[companyId]/bank-reconciliation/[accountId]/[statementId]  → conciliación línea a línea
```

---

### Tests requeridos

```
BankingService.test.ts:
  importStatement — crea statement + transactions, actualiza closingBalance en BankAccount
  importStatement — rechaza CSV con balance que no cuadra
  importStatement — rechaza período duplicado (mismo bankAccountId + fechas solapadas)
  getUnreconciledTransactions — solo isReconciled=false, ordenadas por date ASC
  reconcileTransaction — sets isReconciled=true, matchedPaymentId, matchedAt
  reconcileTransaction — rechaza si transacción ya conciliada
  reconcileTransaction — rechaza si pago no pertenece a la empresa
  unreconcileTransaction — limpia campos, isReconciled=false
  unreconcileTransaction — rechaza si transacción no está conciliada
  getReconciliationSummary — conteos correctos, difference=0 en extracto balanceado

CsvParserService.test.ts:
  parseBankCsv — formato venezolano "1.000,50" → Decimal("1000.50")
  parseBankCsv — formato internacional "1000.50" → Decimal("1000.50")
  parseBankCsv — fecha dd/mm/yyyy → Date correcta
  parseBankCsv — fecha yyyy-mm-dd → Date correcta
  parseBankCsv — fila encabezado ignorada
  parseBankCsv — filas vacías ignoradas
  parseBankCsv — lanza error en fecha inválida
  parseBankCsv — lanza error en CSV vacío
  validateCsvBalance — { valid: true } cuando cuadra (tolerancia 0.01)
  validateCsvBalance — { valid: false, expected, actual } cuando no cuadra

banking.actions.test.ts:
  importStatementAction — auth, membership, rate limit (limiters.fiscal)
  reconcileTransactionAction — auth, guard empresa, AuditLog
  unreconcileTransactionAction — auth, guard empresa
  getReconciliationSummaryAction — auth, serialización Decimal→string
```

---

### Checklist arch-agent (Fase 17)

- [x] B1 documentado: BankStatement como contenedor obligatorio
- [x] B2 documentado: matching manual puro — sin sugerencia automática en scope mínimo
- [x] B3 documentado: matchedJournalEntryId sin FK hasta Fase 18
- [x] B4 documentado: BankAccount.closingBalance como saldo de referencia
- [x] B5 documentado: columnas CSV fijas date|description|debit|credit|balance
- [x] onDelete: Restrict en todas las relaciones — nunca Cascade
- [x] Decimal(19,4) en todos los campos monetarios — nunca float
- [x] isReconciled Boolean explícito — no inferir desde matchedPaymentId IS NULL
- [x] AuditLog dentro del mismo $transaction en reconcile y unreconcile
- [x] Read Committed suficiente para importStatement y reconcile (no genera correlativo)
- [x] Soft delete (deletedAt) en BankAccount, BankStatement, BankTransaction
- [x] Rate limiting limiters.fiscal en todas las actions de banking
- [x] matchedPaymentId FK real mantenida — decisión registrada como DECIDIDO
- [x] Estrategia de renombramiento uploadedAt→importedAt con columna legacy transitoria
- [ ] ADD COLUMN accountNumber en BankAccount
- [ ] ADD COLUMN closingBalance en BankAccount
- [ ] ADD COLUMN deletedAt en BankAccount
- [ ] ADD COLUMN importedAt + importedBy en BankStatement (columnas legacy conservadas)
- [ ] ADD COLUMN deletedAt en BankStatement
- [ ] ADD COLUMN isReconciled en BankTransaction
- [ ] ADD COLUMN deletedAt en BankTransaction
- [ ] Migración `add_banking_reconciliation_v2` ejecutada y verificada
- [ ] BankingService implementado con todos los métodos del contrato
- [ ] CsvParserService implementado con parseBankCsv + validateCsvBalance
- [ ] Tests: todos en verde antes de continuar

---

## 13C-B1 Auditoría companyId — Aislamiento Multi-Tenant (2026-04-01)

- Estado: DECIDIDO ✅

### Resultado

**3 hallazgos CRITICOS detectados y RESUELTOS ✅ (2026-04-04)**

#### CRITICO-1 ✅ RESUELTO
- Archivo: `src/modules/accounting/actions/account.actions.ts` (línea 190)
- Query original: `prisma.account.findFirst({ where: { code: data.code, NOT: { id } } })`
- Fix aplicado: `findFirst({ where: { code, companyId: before.companyId, NOT: { id }, deletedAt: null } })`
- Verificado en código: ✅

#### CRITICO-2 ✅ RESUELTO
- Archivo: `src/modules/retentions/actions/retention.actions.ts` (línea 70)
- Query original: `prisma.retencion.findFirst({ where: { idempotencyKey } })`
- Fix aplicado: `findFirst({ where: { idempotencyKey, companyId: data.companyId } })`
- Verificado en código: ✅

#### CRITICO-3 ✅ RESUELTO
- Archivo: `src/modules/retentions/actions/retention.actions.ts` (línea 164)
- Query original: `prisma.retencion.findFirst({ where: { idempotencyKey: input.idempotencyKey } })`
- Fix aplicado: `findFirst({ where: { idempotencyKey: input.idempotencyKey, companyId: input.companyId } })`
- Verificado en código: ✅

Test arquitectural `company-isolation.test.ts`: `KNOWN_CRITICAL_FINDINGS = []` — 378/378 tests GREEN ✅

---

### Queries ACEPTABLES documentadas

| Archivo | Query | Justificación |
|---|---|---|
| `BankStatementService.ts` | `findMany({ where: { bankAccountId } })` | `bankAccountId` fue verificado contra `companyId` por el caller (`BankingService.importStatement`). La cadena de ownership está garantizada. |
| `BankStatementService.ts` | `findUnique({ where: { id: statementId } })` | PK lookup. La acción caller (`getReconciliationSummaryAction`) verifica membership antes de delegar. |
| `TransactionService.ts` | `findUnique({ where: { id: transactionId } })` en `voidTransaction` | PK CUID globalmente único. No hay riesgo de cross-tenant leak. Operación interna de mutación, no de listado. |
| `CompanyService.ts` | `findUnique({ where: { id: companyId } })` | PK lookup sobre entidad raíz. No filtra datos de tenant, es la entidad que DEFINE el tenant. |
| `FiscalYearCloseService.ts` | `findFirst({ where: { companyId, number: { startsWith: prefix } } })` | Incluye `companyId` — ACEPTABLE. |
| `GeminiOCRService.ts` | Sin queries Prisma | Servicio de parseo de texto puro — no accede a DB. |
| `IGTFService.ts` | Sin queries Prisma | Calculadora pura — no accede a DB. |
| `InvoiceSequenceService.ts` | Upsert con `companyId` | Sin `findMany`/`findFirst`. |

---

### Conteo final

- CRITICOS: 3 → 0 (todos resueltos 2026-04-04)
- ACEPTABLES documentados: 8
- Sin queries DB (allowlist completa): 3 archivos (GeminiOCRService, IGTFService, InvoiceSequenceService)

---

### Test arquitectural

`src/__tests__/architecture/company-isolation.test.ts`

Patrón detectado: `findMany` / `findFirst` / `aggregate` / `count` sin `companyId` en los próximos 15 tokens/líneas del where clause.

Estrategia del test:
- Lee cada archivo como texto con `fs.readFileSync`
- Aplica regex pragmático: detecta `prisma.[model].(findMany|findFirst|aggregate|count)({` sin `companyId` en ventana de 15 líneas
- Excluye: `findUnique` (PK — ACEPTABLE por diseño), bloques con `statement:` / `bankAccount:` (FK chain implícito)
- Allowlist explícita para archivos sin DB y para hallazgos con scope implícito documentado
- `KNOWN_CRITICAL_FINDINGS = []` — 0 hallazgos conocidos, test bloquea CI en cualquier nueva violación
- Falla con mensaje claro si aparece un archivo NUEVO con `findMany` sin `companyId` no documentado

Allowlist archivos sin DB:
- `src/modules/ocr/services/GeminiOCRService.ts`
- `src/modules/igtf/services/IGTFService.ts`
- `src/modules/invoices/services/InvoiceSequenceService.ts`
- `src/modules/retentions/services/RetentionService.ts`

Allowlist scope implícito (ACEPTABLE documentado):
- `src/modules/bank-reconciliation/services/BankStatementService.ts`
- `src/modules/accounting/services/TransactionService.ts`
- `src/modules/company/services/CompanyService.ts`
- `src/modules/fiscal-close/services/FiscalYearCloseService.ts`

---

### Fixes aplicados (2026-04-04) ✅

1. `account.actions.ts` `updateAccountAction`: `companyId` agregado al `findFirst` de unicidad ✅
2. `retention.actions.ts` fast-path idempotencia: `companyId: data.companyId` agregado ✅
3. `retention.actions.ts` P2002 recovery: `companyId: input.companyId` agregado ✅

`KNOWN_CRITICAL_FINDINGS` vaciado a `[]`. El test bloquea CI automáticamente ante cualquier nueva violación.

---

## 13C-B3 Snapshots de Saldos por Período (ARCH 2026-04-05)

- Estado: DECIDIDO ✅

### Decisión

**Problema resuelto (Bomba 4):** Sin snapshots, Balance General y Estado de Resultados recalculan todos los JournalEntry históricos en cada request. A 10 000 facturas USD la reconversión se repite en cada carga → timeout 504 en Vercel.

**Solución:** Modelo `PeriodSnapshot` — saldo precalculado por (periodId, accountId) al cierre de cada período contable. Los servicios de reporte leen este snapshot en lugar de recalcular en tiempo real.

**Nota de diseño:** `ExchangeRate` (Fase 14) ya cubre las tasas históricas. No se crea un modelo separado `ExchangeRateSnapshot` (YAGNI).

### Schema Prisma

```prisma
// ─── Fase 13C Bloque 3: Snapshots de Saldos por Período ───────────────────────
model PeriodSnapshot {
  id              String           @id @default(cuid())
  companyId       String
  periodId        String
  accountId       String
  balanceVes      Decimal          @db.Decimal(19,4)
  balanceOriginal Decimal?         @db.Decimal(19,4)
  currency        Currency         @default(VES)
  snapshotAt      DateTime         @default(now())

  company  Company          @relation(fields: [companyId], references: [id], onDelete: Restrict)
  period   AccountingPeriod @relation(fields: [periodId], references: [id], onDelete: Restrict)
  account  Account          @relation(fields: [accountId], references: [id], onDelete: Restrict)

  @@unique([periodId, accountId])
  @@index([companyId, periodId])
}
```

**Relaciones inversas añadidas:**
- `Company.periodSnapshots PeriodSnapshot[]`
- `AccountingPeriod.periodSnapshots PeriodSnapshot[]`
- `Account.periodSnapshots PeriodSnapshot[]`

**Migración:** `prisma/migrations/20260405_feat_13c_period_snapshot/migration.sql`

### Checklist SCHEMA_AUDITOR

- [x] Todas las relaciones tienen `onDelete: Restrict` — nunca Cascade
- [x] Campos monetarios `Decimal @db.Decimal(19,4)` — nunca Float
- [x] `@@unique([periodId, accountId])` — un snapshot por cuenta por período (idempotencia)
- [x] `@@index([companyId, periodId])` — índice para queries de reportes
- [x] `companyId` presente en el modelo — cumple ADR-004 multi-tenant
- [x] `currency` usa enum `Currency` existente (Fase 14) — sin valores hardcodeados
- [x] No se necesita `deletedAt` — el snapshot es inmutable por diseño (re-generar = UPDATE, no soft delete)
- [x] No se necesita `idempotencyKey` separada — `@@unique([periodId, accountId])` es el constraint de idempotencia
- [x] Riesgo de migración: solo ADD TABLE — sin rows afectados, rollback seguro via DROP TABLE
- [x] No hay acciones destructivas en este bloque — ADR-006 D-1/D-5 no aplica

### Concurrencia

`PeriodSnapshotService.upsertSnapshot()` (Bloque 4, ledger-agent) usará `upsert` atómico con `@@unique([periodId, accountId])` como selector. Read Committed es suficiente — el snapshot no es un correlativo fiscal. No requiere Serializable.

### Scope de este bloque

- Bloque 3 (arch-agent): schema + migración — COMPLETADO ✅
- Bloque 4 (ledger-agent): `PeriodSnapshotService` — COMPLETADO ✅ 2026-04-05
- Bloque 4 genera snapshots al cierre de período (`closePeriod`) y los invalida/actualiza ante nuevas transacciones retroactivas.

---

## 13C-B4 PeriodSnapshotService (LEDGER 2026-04-05)

- Estado: COMPLETADO ✅

### Implementación

**Archivos creados/modificados:**
- `src/modules/accounting/services/PeriodSnapshotService.ts` — service nuevo
- `src/modules/accounting/services/PeriodSnapshotService.test.ts` — 9 tests GREEN
- `src/modules/accounting/services/PeriodService.ts` — integración en closePeriod
- `src/modules/accounting/services/PeriodService.test.ts` — actualizado con 6 tests GREEN
- `vitest.config.ts` — fix pool=vmForks (runner context en Windows/Node 22)

**Métodos implementados:**
- `upsertSnapshot(companyId, periodId, accountId, tx)` — calcula balance con Decimal.js, upsert atómico
- `upsertAllSnapshotsForPeriod(companyId, periodId, tx)` — procesa todas las cuentas con movimientos
- `getSnapshot(companyId, periodId, accountId)` — lectura con companyId (ADR-004)
- `invalidateSnapshots(companyId, periodId, tx)` — elimina snapshots al reabrir período

**Integración PeriodService.closePeriod:**
`upsertAllSnapshotsForPeriod` se llama dentro del mismo `$transaction` que el UPDATE del período (best-practices §6.3). Si la generación de snapshots falla, el cierre se revierte — atomicidad ACID garantizada.

**Fix sistémico Vitest:**
El pool `forks` (default) no inicializa el runner context en Windows/Node 22 + Vitest 4.x.
Fix: `pool: "vmForks"` en `vitest.config.ts`. Desbloqueó todos los tests del proyecto (407 tests).

### Checklist ADR compliance

- [x] ADR-002: Decimal.js para todos los cálculos de balance — nunca float
- [x] ADR-004: companyId en todas las queries (upsertSnapshot, getSnapshot, invalidateSnapshots)
- [x] ADR-005: no DELETE en JournalEntry/Transaction — solo lectura de saldos
- [x] best-practices §6.3: AuditLog y snapshots dentro del mismo $transaction que la mutation
- [x] Read Committed es suficiente — no es correlativo fiscal (no requiere Serializable)

---

## 13C-B5 Report Cache — Cache en Memoria para Reportes de Períodos Cerrados (LEDGER 2026-04-05)

- Estado: COMPLETADO ✅

### Implementación

**Archivos creados/modificados:**
- `src/lib/report-cache.ts` — módulo nuevo de cache en memoria
- `src/lib/report-cache.test.ts` — 15 tests GREEN
- `src/modules/accounting/actions/transaction.actions.ts` — integración de cache + nuevas actions

**API del módulo `report-cache.ts`:**
- `makeCacheKey(companyId, periodId, reportType)` — genera key consistente `{company}:{period}:{type}`
- `getCached<T>(key)` — retorna dato o null (expiry lazy por TTL)
- `setCached<T>(key, data, ttlMs?)` — guarda con TTL (default 5 min)
- `invalidatePeriod(companyId, periodId)` — elimina todas las keys del período (por prefijo)
- `withPeriodCache<T>(companyId, periodId, periodStatus, reportType, fn)` — wrapper principal

**Reglas de cache:**
- CLOSED → cachea resultado por 5 minutos (inmutables una vez cerrados)
- OPEN → siempre ejecuta fn en tiempo real (datos pueden cambiar)
- TTL = `CLOSED_PERIOD_TTL_MS` = 5 min (reducir carga sin riesgo de stale)
- Store: `Map<string, CacheEntry>` — sin Redis, sin persistencia (YAGNI para esta fase)

**Nuevas actions en `transaction.actions.ts`:**
- `getTransactionsByPeriodAction(companyId, periodId, cursor?, limit?)` — paginación por período con cache automático
- `invalidatePeriodCache(companyId, periodId)` — exportado para uso desde PeriodService al reabrir período

**Integración de cache en `getTransactionsByPeriodAction`:**
1. Verifica auth (Clerk)
2. Lookup de `AccountingPeriod` con `{ id: periodId, companyId }` — obtiene `status` (ADR-004)
3. `withPeriodCache` con reportType que incluye cursor+limit para manejar paginación correctamente
4. Si CLOSED y cache hit → retorna sin query adicional a Prisma
5. Si CLOSED y cache miss → ejecuta `TransactionService.listTransactions`, cachea y retorna
6. Si OPEN → ejecuta siempre en tiempo real

### Checklist ADR compliance

- [x] ADR-004: companyId en lookup de período + en query de transacciones
- [x] ADR-005: no DELETE ni mutaciones — solo lectura de reportes
- [x] YAGNI: Map en memoria, no Redis (correcto para esta fase)
- [x] Vitest 4: 15 tests nuevos, todos GREEN (422 total)
- [x] No cachear operaciones de escritura — solo actions de lectura

---

## 13C-B6 Prisma Query Monitoring (LEDGER 2026-04-05)

- Estado: COMPLETADO ✅

### Implementación

**Archivos modificados:**
- `src/lib/prisma.ts` — query monitoring con evento Prisma + Sentry breadcrumb

**Comportamiento:**
- Umbral: `SLOW_QUERY_THRESHOLD_MS = 500` (queries >= 500ms se registran)
- `console.warn('[SLOW_QUERY] {duration}ms — {query.slice(0, 120)}')` en cualquier entorno (no-test)
- En producción: `Sentry.addBreadcrumb` con category `db.slow_query` y level `warning` — nunca `captureException` para no inflar quota
- Import dinámico de `@sentry/nextjs` con catch silencioso para no bloquear la app si Sentry falla
- `NODE_ENV !== 'test'` guard: listener completamente inactivo durante `vitest run`
- NO se loguean params de la query (contienen RIF, montos — PII fiscal, ADR-006)
- Singleton pattern `globalForPrisma` intacto
- Log config cambiado de `["query"]` (stdout) a eventos tipados (`emit: 'event'`) para acceso programático

### Checklist ADR compliance

- [x] ADR-006 D-1: no modifica controles de seguridad existentes
- [x] ADR-006 D-4: AuditLog no tocado — solo observabilidad de infraestructura
- [x] ADR-002: no hay lógica monetaria — solo duración en ms (entero)
- [x] Seguridad: query params excluidos del log (PII fiscal — RIF, montos)
- [x] KISS: una sola función (`$on('query', ...)`) — sin clases, sin wrappers
- [x] Vitest 4: 422 tests, todos GREEN — sin regresiones

---

## Deuda Técnica — RLS (Row Level Security)

**Estado:** Sin RLS en base de datos. La protección actual es exclusivamente a nivel de aplicación:
- ADR-004: `companyId` obligatorio en todos los `findMany`/`findFirst`/`aggregate`
- `src/__tests__/architecture/company-isolation.test.ts` — CI falla si se omite `companyId` sin documentar en allowlist
- Clerk auth → `CompanyMember` lookup en cada Server Action — `companyId` nunca viene del cliente

**Bloqueado por:** conflicto PrismaPg pooled vs `SET LOCAL` — el pool puede reutilizar conexiones entre requests, filtrando variables de sesión.

**Solución futura a evaluar:** Neon RLS nativo con JWT Clerk (no requiere `SET LOCAL` — Neon lee el JWT directamente).

**Prioridad:** implementar después de Fase 17, antes de Fase 19. No bloquea ninguna fase actual.

---

## 19. Declaración Mensual IVA — Forma 30 SENIAT (ARCH 2026-04-07)

- Estado: DECIDIDO ✅
- ADR de referencia: `.claude/adr/ADR-009-forma30-iva.md`

### Decisiones clave (no re-derivar)

- **D-1** DECIDIDO ✅ — Cálculo on-the-fly. Sin modelo `DeclaracionIVA` en Prisma. La Forma 30 es un reporte derivado 100% de datos ya auditados. Riesgo de desync con modelo persistido > beneficio de lectura O(1).
- **D-2** DECIDIDO ✅ — Read Committed. No hay escritura. `$transaction` Serializable no requerido. `tx` opcional para uso embebido en transacciones del caller.
- **D-3** DECIDIDO ✅ — Facturas con `deletedAt != null` excluidas. `NOTA_CREDITO` invierte signo de base y tax en Sección A. `NO_SUJETA` excluida de todos los totales.
- **D-4** DECIDIDO ✅ — Mapeo TaxLineType → secciones: IVA_GENERAL→A1/B1, IVA_REDUCIDO→A2/B2, IVA_ADICIONAL→A3/B3, EXENTO+EXONERADA→A4/B4.
- **D-5** DECIDIDO ✅ — Retenciones sufridas desde `Invoice(SALE).ivaRetentionAmount`; practicadas desde `Retencion.ivaRetention`. Solo si `company.isSpecialContributor = true`.
- **D-6** DECIDIDO ✅ — IGTF desde `IGTFTransaction` filtrado por `createdAt` (gte/lt período completo UTC).
- **D-7** DECIDIDO ✅ — Autorización: cualquier `companyMember` (VIEWER incluido). Rate limiting `limiters.fiscal` aplicado para proteger query costosa.
- **D-8** DECIDIDO ✅ — PDF Export diferido a Fase 19B. Fase 19 produce solo `Forma30Result` JSON.

### Módulo owner

```
src/modules/iva-declaration/
  types/forma30.types.ts          ← Forma30Result + interfaces de secciones
  schemas/generarForma30.schema.ts ← GenerarForma30Schema (Zod)
  services/DeclaracionIVAService.ts ← calculate(companyId, year, month, tx?)
  actions/generarForma30.action.ts  ← generarForma30Action
  __tests__/DeclaracionIVAService.test.ts
  __tests__/generarForma30.action.test.ts
```

### Contrato de generarForma30Action

```typescript
// Flujo de autorización (en este orden):
// 1. auth() → userId
// 2. checkRateLimit(limiters.fiscal, userId)
// 3. safeParse(GenerarForma30Schema, { companyId, year, month })
// 4. companyMember.findUnique({ userId_companyId }) — cualquier role
// 5. FiscalYearCloseService.isFiscalYearClosed(companyId, year) → fiscalYearClosed (informativo, no bloquea)
// 6. DeclaracionIVAService.calculate(companyId, year, month)

async function generarForma30Action(
  companyId: string,
  year: number,
  month: number
): Promise<ActionResult<Forma30Result & { fiscalYearClosed: boolean }>>
```

### Schema Zod de input

```typescript
// src/modules/iva-declaration/schemas/generarForma30.schema.ts
export const GenerarForma30Schema = z.object({
  companyId: z.string().cuid({ error: "companyId inválido" }),
  year: z.number().int().min(2020, { error: "Año mínimo: 2020" }).max(2099, { error: "Año máximo: 2099" }),
  month: z.number().int().min(1, { error: "Mes mínimo: 1" }).max(12, { error: "Mes máximo: 12" }),
});
// Sin campos de tasa fiscal — ADR-006 D-3
```

### Checklist SCHEMA_AUDITOR

- [x] Sin nuevo modelo Prisma — sin migración — riesgo cero
- [x] Todos los campos monetarios en Forma30Result usan Decimal.js — nunca float (ADR-002)
- [x] Todas las queries internas incluyen `companyId` (ADR-004)
- [x] No hay campos de tasa en el schema Zod de input (ADR-006 D-3)
- [x] No hay AuditLog (lectura pura — no aplica ADR-006 D-4)
- [x] Rate limiting `limiters.fiscal` aplicado (ADR-006 D-5 espíritu)
- [x] `generarForma30Action` es lectura: cualquier role, sin role check ADMIN (ADR-006 D-1)
- [x] `DeclaracionIVAService` en allowlist de `company-isolation.test.ts` si no usa `findMany`/`findFirst` directamente

### Tests requeridos

```
DeclaracionIVAService.test.ts:
  calculate — período sin facturas → todos los montos Decimal(0)
  calculate — NOTA_CREDITO invierte signo en SeccionA
  calculate — IVA_ADICIONAL aparece en A3/B3 sin duplicar base de A1/B1
  calculate — deletedAt excluye la factura de todos los totales
  calculate — isSpecialContributor=false → SeccionC.retencionesIvaSufridas = 0
  calculate — isSpecialContributor=true → SeccionC populated desde Retencion
  calculate — IGTF sumado desde IGTFTransaction del período
  calculate — SeccionE.cuotaPeriodo = A.total - B.total - C.total
  calculate — SeccionE.esSaldoAFavor=true si cuotaPeriodo < 0

generarForma30.action.test.ts:
  generarForma30Action — sin auth → error
  generarForma30Action — sin membership → error
  generarForma30Action — input inválido (month=13) → error Zod
  generarForma30Action — año cerrado → fiscalYearClosed=true, NO bloquea
  generarForma30Action — año abierto → fiscalYearClosed=false, calcula normalmente
  generarForma30Action — rate limit excedido → error
```

### Ruta nueva

```
/company/[companyId]/iva-declaration   → selector año/mes → tabla Forma 30 secciones A/B/C/D/E
```

---

## 20. Fase 20 — XML SENIAT + QR en PDF de Factura (ARCH 2026-04-07)

- Estado: DECIDIDO ✅

### Contexto

Venezuela no tiene un sistema de e-facturación mandatorio operativo (SDCA anunciado pero no desplegado). El XML es un artefacto descargable útil hoy para:
1. Importación en software de terceros (Galac, AdminSys)
2. Documentación estructurada interna
3. Compatibilidad futura cuando SENIAT active el SDCA (Option C)

El QR embebido en el PDF permite verificación rápida en auditorías sin necesidad de portal externo.

### Decisiones clave

- **D-1** DECIDIDO ✅ — XML generado como string puro (sin xmlbuilder ni fast-xml-parser). La estructura es estática y conocida; una librería sería over-engineering (KISS).
- **D-2** DECIDIDO ✅ — Namespace `urn:ve:seniat:factura:1.0` — basado en Providencia 0071. No es un namespace oficial publicado por SENIAT (no existe API pública), pero sigue la convención de namespacing por organización/país/dominio.
- **D-3** DECIDIDO ✅ — QR generado server-side con `qrcode` (Node.js) como data URL base64. Se pasa al PDF como `qrCodeDataUrl?: string`. No se agrega QR al libro PDF (solo al comprobante individual).
- **D-4** DECIDIDO ✅ — Contenido del QR: `CONTAFLOW:RIF={rif};FACTURA={nro};CONTROL={ctrl};TOTAL={total};FECHA={fecha};MONEDA={moneda}`. Formato propietario legible por cualquier escáner QR estándar.
- **D-5** DECIDIDO ✅ — `exportInvoiceXMLAction` retorna `{ success: true; xml: string; filename: string }`. El cliente hace `Blob` + download link en el browser (mismo patrón que PDF).
- **D-6** DECIDIDO ✅ — Escape XML obligatorio en todos los valores de texto: `&`, `<`, `>`, `"`, `'` → entidades XML. `escapeXml()` helper privado en `SeniatXMLService`.
- **D-7** DECIDIDO ✅ — Los campos opcionales (`controlNumber`, `companyAddress`, `ivaRetention`, `islrRetention`, `igtf`) se omiten del XML si son null/undefined/cero. XML limpio sin nodos vacíos.
- **D-8** DECIDIDO ✅ — Rate limiting: `exportInvoiceXMLAction` usa `limiters.fiscal` (30/min). Sin rate limit dedicado — el XML es menos costoso que PDF.

### Módulo owner

`src/modules/invoices/services/SeniatXMLService.ts`

### Archivos creados/modificados

```
src/modules/invoices/services/SeniatXMLService.ts          (nuevo)
src/modules/invoices/services/SeniatXMLService.test.ts     (nuevo)
src/modules/invoices/services/InvoiceVoucherPDFService.ts  (+ qrCodeDataUrl param)
src/modules/invoices/actions/invoice.actions.ts            (+ exportInvoiceXMLAction)
src/modules/invoices/actions/invoice.actions.test.ts       (+ tests XML)
src/components/invoices/InvoiceBook.tsx                    (+ botón XML por fila)
```

---

## ADR-010 — Testing Strategy (ARCH 2026-04-08)

- Estado: DECIDIDO ✅

### Contexto

El proyecto acumula 753 tests unitarios con mocks. Los mocks permiten velocidad de desarrollo pero ocultan divergencias entre el comportamiento simulado y el real de PostgreSQL (Neon + Serializable). Necesitamos una estrategia por tiers que sea sostenible sin bloquear el ciclo de desarrollo.

### Decisiones

- **D-1** Unit tests (Vitest + mocks): toda la lógica de negocio pura, services, actions. Sin DB real. Patrón actual. Corren en `vitest run` local y CI. Mock pattern obligatorio: `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`.

- **D-2** Integration tests (Vitest + DB real): operaciones que dependen del comportamiento real de PostgreSQL. **Obligatorio** para:
  - `getNextControlNumber` — Serializable + SELECT FOR UPDATE (race condition no detectable con mocks)
  - `runInflationAdjustmentAction` — guards encadenados FiscalYearClose + Serializable
  - `BankReconciliationService` — 3-way match con transacciones reales
  - Ubicación: `src/__tests__/integration/`
  - Variable de entorno: `DATABASE_URL_TEST` (nunca `DATABASE_URL` de producción)
  - Solo corren con `vitest run --project integration`. Excluidos del `vitest run` por defecto.
  - Tag de identificación: `@integration` en el nombre del describe.

- **D-3** E2E (Playwright — Fase futura): smoke tests de rutas críticas:
  - `/invoices/upload` (OCR → pre-fill)
  - `/iva-declaration` (Forma 30 generación)
  - Flujo completo de conciliación bancaria (PDF → auto-match → confirm)
  - No bloquea ninguna fase actual. Implementar cuando haya staging environment estable.

- **D-4** Cobertura mínima por fase: al menos **2–3 casos negativos no triviales** por servicio nuevo (no solo happy path + auth). Edge cases esperados para ContaFlow:
  - Montos con formato inesperado (string vacío, null donde se espera number, formato no venezolano)
  - PDFs corruptos o ilegibles por Gemini
  - Rate limit excedido (429 de Upstash)
  - Transacciones duplicadas (P2002)
  - Período cerrado al intentar mutación

### Módulo owner

`src/__tests__/integration/` — primer test: `control-number-sequence.test.ts`


---

## ADR-011 — OCR Idempotencia (ARCH 2026-04-08)

- Estado: PENDIENTE — evaluar en la fase que toque OCR

### Problema

`extractInvoiceAction` no tiene `idempotencyKey`. Si el usuario sube el mismo PDF dos veces (doble click, reintento de red), no hay mecanismo que lo detecte: se hacen dos llamadas a Gemini Vision con el mismo contenido y se retornan dos pre-fills independientes. Si el usuario confirma ambos accidentalmente, se crean facturas duplicadas.

### Decisión a tomar

Hash SHA-256 del contenido binario del PDF como `idempotencyKey` opcional. Flujo:
1. Cliente calcula `sha256(pdfBytes)` antes de subir.
2. `extractInvoiceAction` recibe `{ base64Pdf, idempotencyKey }`.
3. Si existe en caché `ocr:idempotency:{companyId}:{hash}` (Redis, TTL 24h) → retorna resultado cacheado sin llamar a Gemini.
4. Si no existe → llama a Gemini → guarda resultado en caché → retorna.

### Beneficio secundario

Reduce consumo de cuota de Gemini Vision: un PDF subido múltiples veces dentro de 24h solo consume 1 llamada.

### Constraint

No implementar hasta que haya un caso real reportado (duplicado de factura por doble submit) — **YAGNI hasta entonces**.

