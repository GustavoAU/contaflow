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

## 23C — NC/ND Workflow (ARCH 2026-04-12)

- Estado: DECIDIDO ✅

### Decisiones arquitectónicas

**D-1 — Self-relation en Invoice (auto-referencia NC/ND → FACTURA original).**
La vinculación jurídica entre una nota y su documento origen es una relación 1:N dentro del mismo modelo: una FACTURA puede tener N notas; cada nota tiene exactamente 1 factura origen. La auto-referencia de Prisma (`@relation("CreditDebitNotes")`) es el mecanismo correcto. No se crea un modelo separado: no hay campos adicionales en la relación que lo justifiquen (YAGNI).

**D-2 — relatedDocNumber: derivado en servidor, nunca del cliente.**
El campo `relatedDocNumber` ya existe en `model Invoice` desde Fase 16 (BLOQUEANTE 4). En Fase 23C queda formalmente prohibido que el cliente lo envíe cuando `docType === NOTA_CREDITO || NOTA_DEBITO`: se deriva server-side a partir de `original.invoiceNumber`. Esta restricción cierra el finding MEDIUM de security-agent: un cliente malicioso no puede falsificar el número del documento relacionado.

**D-3 — Concurrencia: Serializable obligatorio.**
Dos NC concurrentes contra la misma FACTURA pueden ambas pasar la verificación `nc.totalAmountVes <= original.pendingAmount` antes de que cualquiera confirme (TOCTOU clásico). El único cierre correcto es `$transaction({ isolationLevel: 'Serializable' })`, consistente con ADR-001. Este patrón resuelve simultáneamente CRITICAL-1 (cross-tenant) y CRITICAL-2 (TOCTOU): la re-lectura de la factura original dentro de la transacción serializable garantiza tanto el guard de tenant como la lectura no-fantasma del `pendingAmount`.

**D-4 — Prevención de bucles: docType === FACTURA obligatorio en original.**
Una nota no puede apuntar a otra nota. El guard `original.docType === "FACTURA"` en el servicio previene cadenas NC→NC→NC que generarían ciclos en la auto-referencia y contabilidad incoherente.

**D-5 — Asiento compensador tipo AJUSTE.**
El asiento generado por `createCreditNote` y `createDebitNote` usa `TransactionType.AJUSTE` (ya existe en el enum). No se introduce un nuevo tipo. La lógica de reversión de IVA (NC: Débito IVA por cobrar / Crédito Clientes; ND: inverso) se genera automáticamente a partir de las `taxLines` de la nota, consistente con el patrón de `createInvoiceAction`.

---

### 1. Schema Prisma — campos a agregar en `model Invoice`

Agregar al final del bloque `model Invoice`, antes del cierre `}`, inmediatamente después de `invoicePayments InvoicePayment[]`:

```prisma
  // Fase 23C: NC/ND Workflow — auto-referencia
  relatedInvoiceId  String?
  relatedInvoice    Invoice?   @relation("CreditDebitNotes", fields: [relatedInvoiceId], references: [id], onDelete: Restrict)
  creditDebitNotes  Invoice[]  @relation("CreditDebitNotes")
```

Agregar índice al bloque `@@index` existente del modelo:

```prisma
  @@index([relatedInvoiceId])
```

**Bloque completo de índices e índices únicos resultante en `model Invoice`:**

```prisma
  @@unique([companyId, invoiceNumber, type])
  @@index([companyId, type, date])
  @@index([companyId, type, paymentStatus])
  @@index([companyId, type, dueDate])
  @@index([relatedInvoiceId])
```

**Nombre de migración:** `feat_23c_nc_nd_self_relation`

**SQL equivalente (referencia para revisión manual):**
```sql
ALTER TABLE "Invoice"
  ADD COLUMN "relatedInvoiceId" TEXT
  REFERENCES "Invoice"("id") ON DELETE RESTRICT;

CREATE INDEX "Invoice_relatedInvoiceId_idx" ON "Invoice"("relatedInvoiceId");
```

---

### 2. Análisis de riesgo de migración

| Factor | Evaluación |
|---|---|
| Filas afectadas | 0 — columna nullable (`String?`), sin backfill requerido |
| Filas existentes | Ninguna row obtiene un valor distinto de NULL; la migración es non-destructiva |
| Rollback | `ALTER TABLE "Invoice" DROP COLUMN "relatedInvoiceId"` — seguro si no hay datos en la columna |
| Bloqueo de tabla | `ADD COLUMN ... NULL` en PostgreSQL 14+ es instantáneo (no reescribe filas) |
| Índice | `CREATE INDEX` sin `CONCURRENTLY` es aceptable en tabla Invoice existente; en producción con carga alta, usar `CREATE INDEX CONCURRENTLY` en la migración manual |
| FK auto-referencial | PostgreSQL soporta FK a la misma tabla; `onDelete: Restrict` bloquea borrar una FACTURA que tenga NCs/NDs hijas — consistente con ADR-003 |
| @@unique existente | `@@unique([companyId, invoiceNumber, type])` no es afectado — las notas tienen su propio `invoiceNumber` |

**Backfill requerido:** No. Las facturas existentes tendrán `relatedInvoiceId = NULL`, lo cual es correcto: son FACTURAs anteriores sin nota vinculada.

---

### 3. Contratos de función

```typescript
// Archivo owner: src/modules/invoices/services/InvoiceService.ts (extensión)
// Importaciones adicionales necesarias: Decimal from "decimal.js", Prisma.TransactionClient

// ─── Tipos NC/ND ──────────────────────────────────────────────────────────────

/**
 * Datos de entrada para crear una Nota de Crédito o Débito.
 * relatedDocNumber está AUSENTE: se deriva server-side de original.invoiceNumber.
 * El cliente NO puede inyectar este campo cuando docType es NC o ND.
 */
export type CreateCreditDebitNoteData = {
  relatedInvoiceId: string        // FK hacia la FACTURA original
  invoiceNumber: string           // número propio de la nota
  controlNumber?: string          // número de control SENIAT de la nota
  date: Date
  counterpartName: string
  counterpartRif: string
  taxLines: TaxLineInput[]        // bases e IVA de la nota (puede ser parcial)
  ivaRetentionAmount?: string     // default "0"
  ivaRetentionVoucher?: string
  ivaRetentionDate?: Date
  islrRetentionAmount?: string    // default "0"
  igtfBase?: string               // default "0"
  igtfAmount?: string             // default "0"
  currency: "VES" | "USD" | "EUR"
  exchangeRateId?: string
  periodId?: string
  idempotencyKey?: string         // UUID para idempotencia
  notes?: string
}

// ─── createCreditNote ─────────────────────────────────────────────────────────

/**
 * Crea una Nota de Crédito vinculada a una Factura original.
 * Base legal: Reglamento IVA Art. 58 (Venezuela).
 *
 * Precondiciones (verificadas dentro de la tx Serializable):
 *   1. relatedInvoiceId existe y pertenece a companyId                       [CRITICAL-1: ADR-004]
 *   2. original.docType === "FACTURA"                                         [D-4: loop prevention]
 *   3. original.deletedAt IS NULL                                             [soft delete guard]
 *   4. original.paymentStatus !== "VOIDED"                                    [void guard]
 *   5. nc.totalAmountVes <= original.pendingAmount (Decimal, tolerancia 0)   [CRITICAL-2: TOCTOU-safe]
 *   6. companyMember.role !== "VIEWER"                                        [ADR-006 D-1]
 *   7. El año de la fecha de la nota no está cerrado (FiscalYearClose guard) [Fase 15 guard]
 *
 * Proceso (dentro de $transaction({ isolationLevel: 'Serializable' })):
 *   1. Fetch original: findFirst({ where: { id: relatedInvoiceId, companyId } })
 *      — el companyId guard aquí resuelve CRITICAL-1 y CRITICAL-2 simultáneamente
 *   2. Verificar precondiciones 2–7 (dentro de la tx)
 *   3. Derivar relatedDocNumber = original.invoiceNumber (nunca del input del cliente)
 *   4. Calcular totalAmountVes de la nota a partir de taxLines + igtfAmount
 *   5. Crear Invoice con docType: "NOTA_CREDITO", relatedInvoiceId, relatedDocNumber
 *   6. Actualizar original.pendingAmount -= nc.totalAmountVes (Decimal.js)
 *   7. Recalcular original.paymentStatus:
 *        pendingAmount <= 0   → "PAID"
 *        pendingAmount > 0    → "PARTIAL"
 *        (original.pendingAmount nunca puede quedar negativo — error de negocio)
 *   8. Generar Transaction type: AJUSTE con JournalEntries compensadoras
 *        Ejemplo ventas: Débito "IVA por cobrar" / Crédito "Clientes"
 *        Las cuentas se resuelven igual que en createInvoiceAction
 *   9. AuditLog x2 dentro del mismo $transaction:
 *        { entityName: "Invoice", action: "CREATE_NC", entityId: nc.id }
 *        { entityName: "Invoice", action: "PENDING_AMOUNT_UPDATE", entityId: original.id,
 *          oldValue: { pendingAmount: original.pendingAmount.toString() },
 *          newValue: { pendingAmount: newPendingAmount.toString() } }
 *
 * Postcondiciones:
 *   - NC Invoice creada con relatedInvoiceId y relatedDocNumber = original.invoiceNumber
 *   - original.pendingAmount decrementado por nc.totalAmountVes
 *   - original.paymentStatus actualizado (PARTIAL o PAID)
 *   - Asiento compensador type: AJUSTE registrado
 *   - AuditLog x2 en la misma tx
 *
 * Errores de negocio (string — nunca exponer errores Prisma):
 *   - "Factura original no encontrada o no pertenece a esta empresa"
 *   - "Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)"
 *   - "La factura original está anulada"
 *   - "El monto de la nota supera el saldo pendiente de la factura original"
 *   - "El ejercicio económico {year} está cerrado"
 *
 * Concurrencia (ADR-001):
 *   - Serializable SSI — previene TOCTOU en pendingAmount bajo concurrencia
 *   - Patrón idéntico a getNextControlNumber y closeFiscalYear
 */
async function createCreditNote(
  companyId: string,
  data: CreateCreditDebitNoteData,
  createdBy: string
): Promise<Invoice>

// ─── createDebitNote ──────────────────────────────────────────────────────────

/**
 * Crea una Nota de Débito vinculada a una Factura original.
 * Base legal: Reglamento IVA Art. 58 (Venezuela).
 *
 * Precondiciones (simétricas a createCreditNote, excepto punto 5):
 *   1. relatedInvoiceId existe y pertenece a companyId                       [CRITICAL-1: ADR-004]
 *   2. original.docType === "FACTURA"                                         [D-4: loop prevention]
 *   3. original.deletedAt IS NULL
 *   4. original.paymentStatus !== "VOIDED"
 *   5. (sin restricción de monto máximo — ND puede incrementar la deuda)
 *   6. companyMember.role !== "VIEWER"                                        [ADR-006 D-1]
 *   7. El año de la fecha de la nota no está cerrado (FiscalYearClose guard)
 *
 * Proceso (dentro de $transaction({ isolationLevel: 'Serializable' })):
 *   1. Fetch original con companyId guard (CRITICAL-1)
 *   2. Verificar precondiciones 2–7
 *   3. Derivar relatedDocNumber = original.invoiceNumber
 *   4. Calcular totalAmountVes de la nota
 *   5. Crear Invoice con docType: "NOTA_DEBITO", relatedInvoiceId, relatedDocNumber
 *   6. Actualizar original.pendingAmount += nd.totalAmountVes (Decimal.js)
 *   7. Recalcular original.paymentStatus:
 *        pendingAmount > 0 y antes era PAID → "PARTIAL"
 *        pendingAmount > 0 y antes era UNPAID/PARTIAL → sin cambio de status (ya estaba pendiente)
 *   8. Generar Transaction type: AJUSTE con JournalEntries compensadoras
 *        Ejemplo ventas: Débito "Clientes" / Crédito "IVA por cobrar"
 *   9. AuditLog x2 dentro del mismo $transaction (mismo patrón que createCreditNote)
 *
 * Postcondiciones:
 *   - ND Invoice creada con relatedInvoiceId y relatedDocNumber = original.invoiceNumber
 *   - original.pendingAmount incrementado por nd.totalAmountVes
 *   - original.paymentStatus actualizado si corresponde
 *   - Asiento compensador type: AJUSTE registrado
 *   - AuditLog x2 en la misma tx
 *
 * Errores de negocio:
 *   - "Factura original no encontrada o no pertenece a esta empresa"
 *   - "Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)"
 *   - "La factura original está anulada"
 *   - "El ejercicio económico {year} está cerrado"
 *
 * Concurrencia (ADR-001):
 *   - Serializable SSI — igual que createCreditNote
 *   - Justificación: aunque ND no verifica un techo de monto, la actualización de
 *     pendingAmount debe ser atómica para que paymentStatus sea consistente
 */
async function createDebitNote(
  companyId: string,
  data: CreateCreditDebitNoteData,
  createdBy: string
): Promise<Invoice>

// ─── getCreditDebitNotes ──────────────────────────────────────────────────────

/**
 * Retorna todas las notas (NC y ND) activas vinculadas a una factura original.
 *
 * Precondiciones:
 *   - originalInvoiceId pertenece a companyId (ADR-004)
 *
 * Postcondiciones:
 *   - Solo notas con deletedAt IS NULL
 *   - Ordenadas por date ASC, createdAt ASC
 *   - Read Committed suficiente (solo lectura, sin correlativo)
 */
async function getCreditDebitNotes(
  originalInvoiceId: string,
  companyId: string
): Promise<Invoice[]>
```

---

### 4. Cambio en Zod Schema — `CreateInvoiceSchema`

**Problema:** `relatedDocNumber: z.string().optional()` en el schema actual permite que el cliente lo envíe libremente. Cuando `docType` es `NOTA_CREDITO` o `NOTA_DEBITO`, el campo debe ser rechazado del input del cliente y derivado server-side.

**Decisión:** Añadir una transformación en `CreateInvoiceSchema` usando `.superRefine()` que elimina silenciosamente `relatedDocNumber` del input cuando `docType` es NC o ND, y que exige `relatedInvoiceId` cuando `docType` es NC o ND.

**Bloque exacto a agregar en `invoice.schema.ts`:**

```typescript
// ─── Schema NC/ND — Fase 23C ──────────────────────────────────────────────────

/**
 * Extiende CreateInvoiceSchema con las reglas NC/ND:
 *   1. relatedInvoiceId es OBLIGATORIO cuando docType === NOTA_CREDITO | NOTA_DEBITO
 *   2. relatedDocNumber es IGNORADO del input del cliente cuando docType === NOTA_CREDITO | NOTA_DEBITO
 *      (el servicio lo deriva de original.invoiceNumber — ADR-006 D-3 spirit, MEDIUM finding)
 */
export const CreateCreditDebitNoteSchema = CreateInvoiceSchema
  .extend({
    relatedInvoiceId: z.string().min(1, { error: "El ID de la factura original es requerido" }),
  })
  .transform((data) => {
    // Silently strip relatedDocNumber — it is always derived server-side
    const { relatedDocNumber: _stripped, ...rest } = data;
    return rest;
  });

export type CreateCreditDebitNoteInput = z.infer<typeof CreateCreditDebitNoteSchema>;
```

**Validación adicional en la Server Action** (no en el schema — depende de DB):
```typescript
// En createCreditNoteAction / createDebitNoteAction — ANTES de llamar al servicio:
if (!["NOTA_CREDITO", "NOTA_DEBITO"].includes(parsed.data.docType)) {
  return { success: false, error: "docType debe ser NOTA_CREDITO o NOTA_DEBITO" };
}
// relatedDocNumber NO se pasa al servicio desde el input — el servicio lo deriva
```

---

### 5. SCHEMA_AUDITOR checklist — campo `relatedInvoiceId` en `model Invoice`

```
[x] Relación a tabla contable tiene onDelete: Restrict
    — Invoice es tabla contable (ADR-003). relatedInvoiceId → Invoice con onDelete: Restrict. CONFORME.

[x] onDelete: Cascade AUSENTE en la nueva relación
    — La relación "CreditDebitNotes" usa Restrict en ambos sentidos de la auto-referencia. CONFORME.

[x] Campo monetario — No aplica
    — relatedInvoiceId es FK String, no campo monetario. ADR-002 no aplica directamente.
    — Los campos de monto de la nota (totalAmountVes, pendingAmount) ya heredan Decimal(19,4)
      de la definición existente del modelo Invoice. CONFORME.

[x] Campo porcentaje — No aplica
    — No se introduce campo de tasa. CONFORME.

[x] Soft delete presente
    — Invoice ya tiene deletedAt DateTime?. La nota hereda este mecanismo. CONFORME.

[x] idempotencyKey presente
    — Invoice ya tiene idempotencyKey String? @unique. Las notas lo heredan. CONFORME.

[x] Unicidad de negocio incluye companyId
    — @@unique([companyId, invoiceNumber, type]) ya existe — no hay riesgo de colisión
      cross-tenant en el número de la nota. CONFORME.

[x] Índice en la nueva FK relatedInvoiceId
    — @@index([relatedInvoiceId]) agregado. Justificación: el patrón más frecuente es
      "dame todas las NCs/NDs de esta factura" (getCreditDebitNotes), que filtra por
      relatedInvoiceId. Sin índice → seq scan sobre Invoice completa. REQUERIDO Y AGREGADO.

[x] AuditLog requerido
    — createCreditNote y createDebitNote generan AuditLog x2 dentro del mismo $transaction.
      Entidades auditadas: Invoice (CREATE_NC/ND) + Invoice original (PENDING_AMOUNT_UPDATE).
      CONFORME.

[x] Riesgo de migración documentado
    — Sección 2 de este contrato documenta: 0 filas afectadas, no backfill, rollback seguro,
      ADD COLUMN NULL es instantáneo en PG 14+. CONFORME.

[x] Acción destructiva verifica companyMember.role (ADR-006 D-1)
    — createCreditNote y createDebitNote requieren role !== "VIEWER". CONFORME.

[x] Campos de monto en Zod tienen .max() ceiling (ADR-006 D-2)
    — CreateCreditDebitNoteSchema extiende CreateInvoiceSchema que ya aplica
      MAX_INVOICE_AMOUNT en todos los campos monetarios vía .refine(). CONFORME.

[x] Campo de tasa no aceptado del cliente (ADR-006 D-3)
    — TaxLineSchema ya fuerza tasas canónicas via CANONICAL_TAX_RATES. CONFORME.

[x] AuditLog es append-only (ADR-006 D-4)
    — No hay auditLog.update ni auditLog.delete en los contratos. Solo prisma.auditLog.create.
      CONFORME.

[x] Mutación financiera tiene rate limiting (ADR-006 D-5)
    — createCreditNoteAction y createDebitNoteAction deben aplicar limiters.fiscal
      (patrón existente en createInvoiceAction). REQUERIDO — implementar en la action.

[x] La auto-referencia NO crea problema de @@unique constraint
    — @@unique([companyId, invoiceNumber, type]) no es afectado. Una NC tiene su propio
      invoiceNumber distinto al de la FACTURA original. No hay colisión. CONFORME.

[x] La FK auto-referencial no crea ciclos en onDelete: Restrict
    — Restrict en este contexto significa: no se puede borrar la FACTURA si tiene NCs/NDs.
      Las NCs/NDs sí pueden borrarse (soft delete: deletedAt). Correcto.
      No hay ciclo: NC→FACTURA (Restrict) + FACTURA no apunta a NC. CONFORME.
```

---

### 6. Rutas nuevas

```
/company/[companyId]/invoices/[invoiceId]/credit-note   → formulario crear NC
/company/[companyId]/invoices/[invoiceId]/debit-note    → formulario crear ND
```

Los formularios pre-llenan `relatedInvoiceId` y muestran datos de la factura original (número, contraparte, saldo pendiente). El campo `relatedDocNumber` no aparece en el formulario — es invisible al usuario (derivado server-side).

---

### 7. Tests requeridos

```
InvoiceService.test.ts (NC/ND additions):
  createCreditNote — crea NC, reduce pendingAmount, actualiza paymentStatus a PAID
  createCreditNote — crea NC parcial, actualiza paymentStatus a PARTIAL
  createCreditNote — rechaza si nc.totalAmountVes > pendingAmount
  createCreditNote — rechaza si original.docType !== FACTURA (loop prevention)
  createCreditNote — rechaza si original está anulada (deletedAt no nulo)
  createCreditNote — rechaza si original.paymentStatus === VOIDED
  createCreditNote — rechaza si relatedInvoiceId no pertenece a companyId (CRITICAL-1)
  createCreditNote — dos NCs concurrentes: solo una pasa si la suma supera pendingAmount (CRITICAL-2)
  createCreditNote — genera AuditLog x2 en la misma tx
  createCreditNote — genera Transaction type: AJUSTE
  createCreditNote — relatedDocNumber derivado = original.invoiceNumber (nunca del input)
  createDebitNote — crea ND, incrementa pendingAmount
  createDebitNote — ND sobre factura PAID reactiva paymentStatus a PARTIAL
  createDebitNote — rechaza si original.docType !== FACTURA
  createDebitNote — rechaza si relatedInvoiceId no pertenece a companyId (CRITICAL-1)
  createDebitNote — genera AuditLog x2 en la misma tx
  getCreditDebitNotes — retorna solo notas con deletedAt IS NULL, ordenadas por date ASC
  getCreditDebitNotes — guard companyId (ADR-004)

invoice.actions.test.ts (NC/ND additions):
  createCreditNoteAction — auth + rate limit (limiters.fiscal) + role guard VIEWER
  createCreditNoteAction — schema rechaza relatedDocNumber del input del cliente
  createCreditNoteAction — schema exige relatedInvoiceId
  createDebitNoteAction — auth + rate limit + role guard VIEWER
  createDebitNoteAction — schema rechaza relatedDocNumber del input del cliente
```

---

### Checklist arch-agent (Fase 23C)

- [x] CRITICAL-1 resuelto: fetchFirst con companyId guard dentro de la tx Serializable
- [x] CRITICAL-2 (TOCTOU) resuelto: $transaction Serializable en createCreditNote y createDebitNote
- [x] ADR-001 referenciado: Serializable obligatorio para mutaciones con pendingAmount check
- [x] ADR-003 confirmado: onDelete: Restrict en relatedInvoiceId (tabla contable)
- [x] ADR-004 confirmado: companyId en findFirst dentro de la tx (re-verificación)
- [x] ADR-006 D-1: role !== VIEWER verificado en ambas actions
- [x] ADR-006 D-2: .max() ceiling heredado de CreateInvoiceSchema via .extend()
- [x] ADR-006 D-3: relatedDocNumber bloqueado del input del cliente
- [x] ADR-006 D-4: AuditLog solo .create — nunca .update/.delete
- [x] ADR-006 D-5: rate limiting limiters.fiscal en createCreditNoteAction y createDebitNoteAction
- [x] BLOQUEANTE 4 (sección 16.1): NC/ND via relatedInvoiceId es la implementación formal de la decisión tomada en Fase 16
- [x] Loop prevention: guard original.docType === "FACTURA" (HIGH finding)
- [x] VOID guard: original.paymentStatus !== "VOIDED"
- [x] FiscalYearClose guard en ambos servicios
- [x] relatedDocNumber derivado server-side — ausente en CreateCreditDebitNoteSchema
- [x] Índice @@index([relatedInvoiceId]) agregado
- [x] Migración nullable — 0 filas afectadas, no backfill, rollback seguro
- [x] TransactionType.AJUSTE para asiento compensador — sin nuevo enum (YAGNI)
- [x] AuditLog x2 dentro del mismo $transaction (NC/ND creation + pendingAmount update)
- [ ] Migración `feat_23c_nc_nd_self_relation` ejecutada y verificada
- [ ] createCreditNote implementado en InvoiceService.ts
- [ ] createDebitNote implementado en InvoiceService.ts
- [ ] getCreditDebitNotes implementado en InvoiceService.ts
- [ ] CreateCreditDebitNoteSchema implementado en invoice.schema.ts
- [ ] createCreditNoteAction implementado en invoice.actions.ts
- [ ] createDebitNoteAction implementado en invoice.actions.ts
- [ ] Tests: todos en verde antes de continuar
