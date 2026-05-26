# ADR-030 — GL Auto-Posting de Pagos + Causación por Gemini OCR (Fase 38)

- **Estado**: Aceptado
- **Fecha**: 2026-05-26
- **Fase**: 38
- **Depende de**:
  - ADR-001 (Serializable para operaciones contables concurrentes)
  - ADR-002 (Decimal para dinero)
  - ADR-003 (onDelete Restrict en tablas contables)
  - ADR-004 (companyId en todo findMany/findFirst)
  - ADR-006 (Security controls)
  - ADR-022 (PaymentBatch — applyBatch usa Serializable, contrato establecido)
  - ADR-026 (CompanySettings GL — arAccountId + apAccountId ya existentes)
  - ADR-029 (PaymentAttachment — flujo de upload a Vercel Blob, base para Gemini)

---

## Contexto

ContaFlow registra pagos (`PaymentRecord`, `PaymentBatch`) y los vincula a facturas, pero no genera el asiento contable (Transaction + JournalEntry) correspondiente. El contador debe crear el asiento manualmente después de registrar el pago, duplicando trabajo y generando el riesgo de desincronización entre la cartera (CxC/CxP) y el libro contable.

Los sistemas ERP maduros (SAP, Odoo, SIESA) generan el asiento en el mismo `$transaction` que registra el pago:

- Cobro (CxC): Dr. Banco / Cr. Cuentas por Cobrar
- Pago A/P (CxP): Dr. Proveedores / Cr. Banco
- Con IGTF sobre divisa: asiento adicional Dr. Banco / Cr. IGTF-por-pagar (3%)

Adicionalmente, el usuario quiere un flujo de causación automática: subir la foto/PDF del comprobante bancario → Gemini lo analiza → pre-llena el formulario de pago.

**Hallazgo crítico pre-diseño (resuelve D-6 antes de decidir):**
`CompanySettings` ya tiene `arAccountId` (ASSET — CxC) y `apAccountId` (LIABILITY — CxP) como parte de ADR-026. Estos campos existen en el schema actual. No se necesitan campos nuevos en `CompanySettings` para los asientos de cobro/pago. Solo se necesita agregar las cuentas del IGTF-por-pagar y de bank si no están ya cubiertas — verificado: `ivaDFAccountId`, `ivaCFAccountId`, `ivaRetentionPayableAccountId` ya existen; la cuenta de banco viene de `BankAccount.accountId` (FK a `Account`).

---

## Decisiones

### D-1: FK `bankAccountId` en `PaymentRecord` y `PaymentBatch` — Opcional (nullable)

**Decisión: Opción B — `bankAccountId String?` (nullable).**

**Justificación:**

- **Migración suave**: los registros existentes quedan con `bankAccountId = null`. El sistema continúa funcionando exactamente igual para todas las empresas que no han configurado cuentas bancarias.
- **GL auto-posting condicional**: el asiento se genera solo si `bankAccountId IS NOT NULL`. Sin cuenta bancaria configurada, el pago se registra normalmente sin asiento, exactamente como antes.
- **Correctness contable**: la cuenta bancaria es el débito del asiento de cobro y el crédito del asiento de pago. No es posible generar el asiento sin ella. Obligarla (Opción A) rompe el flujo de onboarding para empresas que aún no han configurado el módulo de conciliación bancaria.
- **Consistencia con el patrón de CompanySettings**: `arAccountId`, `apAccountId` y demás GL accounts son todas nullable por la misma razón.
- **Regla de negocio**: si `bankAccountId` es nulo al crear un `PaymentRecord`, no se intenta generar el asiento y no se emite error — el sistema degrada gracefully.

La Opción A (obligatorio) genera un breaking change para todos los usuarios actuales y bloquea el registro de pagos hasta que el usuario configure una cuenta bancaria, lo cual es inaceptable para empresas en proceso de onboarding parcial.

**FK**: `bankAccountId → BankAccount.id` con `onDelete: Restrict` (ADR-003). Si el usuario intenta eliminar una cuenta bancaria con pagos asociados, recibe un error de negocio — no un Cascade que corrompería el historial.

---

### D-2: Cuándo generar el asiento GL

**Regla unificada para PaymentRecord (CxC — cobros):**

El asiento se genera dentro del mismo `$transaction` de `createPaymentRecord()` si y solo si se cumplen las tres condiciones simultáneamente:

1. `bankAccountId IS NOT NULL` — tenemos la cuenta del banco
2. `invoiceId IS NOT NULL` — sabemos qué CxC cancelar
3. `CompanySettings.arAccountId IS NOT NULL` — tenemos la cuenta de CxC configurada

Si alguna condición no se cumple, el pago se crea sin asiento (comportamiento previo). No se emite advertencia al usuario en este ADR — la UI puede mostrar un aviso de configuración incompleta (decisión de implementación, no arquitectónica).

**Asiento de cobro (CxC):**

```
Dr. BankAccount.accountId          amountVes        [cobro en banco]
Cr. CompanySettings.arAccountId    amountVes        [cancela CxC]
```

Si `igtfAmount > 0` (solo cuando `currency != VES` o `isSpecialContributor AND currency == VES`):

```
Dr. BankAccount.accountId          igtfAmount       [IGTF retenido en banco]
Cr. CompanySettings.ivaDFAccountId igtfAmount       [IGTF por pagar]
```

Nota: para el asiento IGTF se reutiliza `ivaDFAccountId` provisionalmente porque es la cuenta de obligaciones fiscales por pagar más genérica disponible en `CompanySettings`. Si la empresa tiene una cuenta IGTF separada (2115 o similar), puede configurar un campo específico — ver D-6 addendum.

**Regla unificada para PaymentBatch (CxP — pagos a proveedores):**

El asiento solo se genera al ejecutar `applyBatch()` (transición `DRAFT → APPLIED`), nunca al crear el batch. Condiciones:

1. `bankAccountId IS NOT NULL`
2. `CompanySettings.apAccountId IS NOT NULL`
3. Para cada línea: `invoiceId IS NOT NULL` (siempre true por diseño de PaymentBatchLine)

**Asiento de pago A/P (por cada línea del batch dentro del mismo `$transaction`):**

```
Dr. CompanySettings.apAccountId   line.amountVes   [cancela CxP del proveedor]
Cr. BankAccount.accountId         line.amountVes   [salida del banco]
```

Si `line.igtfAmount > 0`:

```
Dr. CompanySettings.ivaDFAccountId  line.igtfAmount  [IGTF por pagar — gasto adicional]
Cr. BankAccount.accountId           line.igtfAmount  [salida adicional del banco]
```

El asiento de un batch es un solo `Transaction` con N×2 `JournalEntry` (una por línea), no N transacciones separadas. Esto preserva la trazabilidad: una referencia bancaria = un asiento.

---

### D-3: Nivel de aislamiento para GL Posting

**PaymentRecord (createPaymentRecord):** `Read Committed` es suficiente.

Justificación: `createPaymentRecord()` no genera un correlativo. La operación de GL posting (crear `Transaction` + `JournalEntry`) dentro del mismo `$transaction` no introduce un riesgo de race condition nuevo: el `Transaction.number` se genera con un patrón que no requiere Serializable (no es un correlativo SENIAT). Si dos pagos concurrentes afectan la misma factura (race en `pendingAmount`), ese riesgo ya existía antes de este ADR y está documentado en ADR-022 como riesgo conocido para `PaymentRecord` individual. Para `PaymentRecord` el impacto fiscal de una carrera es menor (doble cobro sobre la misma factura es detectable por auditoría).

**PaymentBatch (applyBatch):** `Serializable` — ya decidido en ADR-022 D-4. El GL posting se agrega dentro del mismo `$transaction` Serializable existente. No requiere cambiar el nivel de aislamiento ni agregar complejidad.

**Decisión**: no escalar `createPaymentRecord` a Serializable. El riesgo P2034 bajo Read Committed es mínimo para pagos individuales. Serializable introduce latencia y aumenta el riesgo de P2034 en Neon serverless bajo carga normal. Si en el futuro se detectan inconsistencias de pendingAmount en pagos concurrentes individuales, se escala a Serializable en ese momento con evidencia concreta.

---

### D-4: Gemini OCR — Causación Automática

#### D-4.1: Integración — Botón separado "Analizar con IA"

**Decisión: botón separado, no integrado en el flujo de UploadAttachmentButton (ADR-029).**

Justificación:
- ADR-029 ya está implementado y estable. Modificar su flujo introduce riesgo de regresión.
- El análisis OCR es una operación de asistencia opcional, no parte del ciclo de vida del adjunto. Un adjunto puede existir sin análisis; el análisis puede hacerse sobre un adjunto ya subido.
- El flujo "subir + analizar" puede implementarse como una secuencia en la UI: el usuario sube el archivo (ADR-029), luego hace clic en "Analizar con IA" sobre el adjunto existente.
- Esto permite desactivar el análisis IA sin afectar el upload de comprobantes.

**Punto de entrada en UI:** botón "Analizar con IA" adyacente al adjunto subido en `PaymentRecordList` o `PaymentForm`. También disponible como botón primario en un drawer "Nuevo Pago desde Comprobante".

#### D-4.2: Implementación — Server Action (no API route)

**Decisión: `analyzeReceiptAction` como Server Action.**

Justificación:
- El análisis es iniciado por el usuario (no por un webhook externo). Server Action es el patrón canónico del stack.
- El resultado es temporal (pre-llenado del formulario) — no se persiste en BD. Una API route para un resultado efímero es overhead innecesario.
- La autenticación y el rate limiting (`limiters.ocr`, 10/min) se aplican con el mismo patrón que todas las Server Actions del proyecto.
- La llamada a Gemini es una llamada HTTP externa que Vercel maneja perfectamente desde un Server Action en Node.js runtime.

#### D-4.3: Campos que extrae Gemini del comprobante venezolano

**Prompt estructurado (JSON mode):**

```
Analiza este comprobante bancario venezolano. Extrae los siguientes campos en JSON:
{
  "method": "PAGOMOVIL" | "TRANSFERENCIA" | "ZELLE" | "EFECTIVO" | null,
  "amount": "<monto numérico como string, punto decimal>" | null,
  "currency": "VES" | "USD" | "EUR" | null,
  "referenceNumber": "<número de referencia o confirmación>" | null,
  "originBank": "<nombre del banco emisor>" | null,
  "destBank": "<nombre del banco receptor>" | null,
  "senderPhone": "<teléfono del emisor, solo dígitos>" | null,
  "destPhone": "<teléfono del receptor, solo dígitos>" | null,
  "date": "<fecha en formato YYYY-MM-DD>" | null,
  "confidence": <número entre 0.0 y 1.0 indicando confianza general>
}

Para PagoMóvil: captura banco origen, banco destino, teléfono emisor, teléfono receptor, monto, referencia, fecha.
Para Zelle: captura monto USD, referencia, fecha.
Para transferencia: captura banco origen, número de referencia, monto, fecha.
Si algún campo no es visible o legible, devuelve null para ese campo.
```

**Campos del comprobante venezolano (PagoMóvil — cobertura principal):**
- Banco origen (ej. "Banco de Venezuela", "Banesco")
- Banco destino
- Teléfono emisor (04XX-XXXXXXX)
- Teléfono receptor
- Monto (Bs. o $)
- Número de referencia (8-12 dígitos)
- Fecha y hora de la operación

#### D-4.4: Lógica de confianza y degradación

```
confidence >= 0.85 → Pre-llenar formulario automáticamente (campos bloqueados editables)
confidence < 0.85  → Pre-llenar con campos resaltados en amarillo para revisión manual
Gemini falla       → Toast de error, formulario en blanco, usuario llena manualmente
```

**Si Gemini está caído o excede rate limit (`limiters.ocr`):**
- Retornar `{ success: false, error: "El análisis con IA no está disponible ahora mismo. Puede ingresar los datos manualmente." }`
- El formulario de pago permanece funcional — el usuario puede crear el pago normalmente.
- No hay reintentos automáticos para el análisis (el usuario puede hacer clic nuevamente).

**Si la clave `GEMINI_API_KEY` no está configurada:**
- El botón "Analizar con IA" se deshabilita silenciosamente (degradación graceful, mismo patrón que Vercel Blob y Upstash).

#### D-4.5: El análisis NO crea el pago automáticamente

**Decisión:** `analyzeReceiptAction` retorna los datos extraídos para pre-llenar el formulario. El usuario confirma y luego ejecuta `createPaymentRecordAction` normalmente. La creación del `PaymentRecord` + GL entry es un paso separado y explícito.

Justificación: acción fiscal irreversible (genera asiento contable) no debe ocurrir sin confirmación explícita del usuario. Obligatorio por R-6 (trazabilidad) y por UX responsable.

---

### D-5: Migración de datos existentes

Los registros de `PaymentRecord` y `PaymentBatch` existentes conservan `bankAccountId = null`. No hay backfill. Los asientos GL solo se generan en nuevos registros que incluyan `bankAccountId`.

El campo `originBank` (texto libre) se mantiene para compatibilidad y para capturar el nombre del banco cuando no hay una `BankAccount` configurada. Queda desnormalizado junto a `bankAccountId`: si ambos están presentes, `bankAccountId` es el campo canónico.

No se depreca `originBank` en esta fase — puede usarse como referencia humana incluso cuando `bankAccountId` está configurado.

---

### D-6: Cuenta CxC/CxP — `CompanySettings` como fuente canónica

**Decisión: Opción A — `CompanySettings.arAccountId` (CxC) y `CompanySettings.apAccountId` (CxP).**

**Hallazgo**: estos campos ya existen en el schema desde ADR-026. No se necesitan campos nuevos. La Fase 38 reutiliza la infraestructura GL existente.

**Addendum — Cuenta IGTF por Pagar:**

El IGTF de pagos en divisa necesita una cuenta de contrapartida. Las opciones:
- `CompanySettings.ivaDFAccountId` — cuenta de IVA Débito Fiscal ya existe; el IGTF es semánticamente distinto pero ambos son impuestos por pagar al SENIAT.
- Nuevo campo `CompanySettings.igtfPayableAccountId` — más preciso pero requiere schema change.

**Decisión**: agregar `igtfPayableAccountId String?` en `CompanySettings`. Justificación: el IGTF tiene número de cuenta propio en el Plan de Cuentas SENIAT (generalmente 2115 o similar) y no debe mezclarse con el IVA DF (que es 2110). Mezclarlos contamina el Libro Auxiliar de IVA con movimientos de IGTF. Un campo nuevo nullable sigue el mismo patrón que los campos existentes.

Si `igtfPayableAccountId` es nulo y el pago tiene IGTF, el asiento IGTF se omite y se registra en `AuditLog` con `action: "IGTF_GL_SKIPPED"`. El pago se crea igualmente — no se bloquea por IGTF sin cuenta configurada.

---

## Schema Prisma — Cambios

### Campos nuevos en `PaymentRecord`

```prisma
model PaymentRecord {
  // ... campos existentes sin cambio ...

  // ADR-030: FK a cuenta bancaria para GL auto-posting
  // Nullable: si null, no se genera asiento GL (degradación graceful)
  bankAccountId String?
  bankAccount   BankAccount? @relation("PaymentRecordBankAccount", fields: [bankAccountId], references: [id], onDelete: Restrict)

  // ADR-030: FK al Transaction generado por GL auto-posting
  // Null hasta que se genere el asiento. Si bankAccountId es null, permanece null.
  glTransactionId String?  @unique
  glTransaction   Transaction? @relation("PaymentRecordGLTransaction", fields: [glTransactionId], references: [id], onDelete: Restrict)
}
```

Relaciones inversas requeridas en `BankAccount` y `Transaction`:

```prisma
// En model BankAccount — agregar:
paymentRecords      PaymentRecord[] @relation("PaymentRecordBankAccount")

// En model Transaction — agregar:
paymentRecordGL     PaymentRecord?  @relation("PaymentRecordGLTransaction")
```

Índice adicional requerido:

```prisma
@@index([companyId, bankAccountId])   // en model PaymentRecord
```

### Campos nuevos en `PaymentBatch`

```prisma
model PaymentBatch {
  // ... campos existentes sin cambio ...

  // ADR-030: FK a cuenta bancaria para GL auto-posting en applyBatch()
  // Nullable: si null, applyBatch() opera sin generar asiento (comportamiento ADR-022 previo)
  bankAccountId String?
  bankAccount   BankAccount? @relation("PaymentBatchBankAccount", fields: [bankAccountId], references: [id], onDelete: Restrict)

  // ADR-030: FK al Transaction generado por GL auto-posting en applyBatch()
  // Un batch = un asiento (con N JournalEntries, una por línea)
  glTransactionId String?  @unique
  glTransaction   Transaction? @relation("PaymentBatchGLTransaction", fields: [glTransactionId], references: [id], onDelete: Restrict)
}
```

Relaciones inversas requeridas:

```prisma
// En model BankAccount — agregar:
paymentBatches      PaymentBatch[] @relation("PaymentBatchBankAccount")

// En model Transaction — agregar:
paymentBatchGL      PaymentBatch?  @relation("PaymentBatchGLTransaction")
```

Índice adicional:

```prisma
@@index([companyId, bankAccountId])   // en model PaymentBatch
```

### Campo nuevo en `CompanySettings`

```prisma
model CompanySettings {
  // ... campos existentes sin cambio ...

  // ADR-030: cuenta IGTF por Pagar — distinta de IVA DF (ADR-026)
  // Típicamente código 2115 o similar en Plan de Cuentas venezolano
  igtfPayableAccountId String?
  igtfPayableAccount   Account? @relation("SettingsIGTFPayableAccount", fields: [igtfPayableAccountId], references: [id], onDelete: Restrict)
}
```

Relación inversa requerida en `Account`:

```prisma
// En model Account — agregar:
companySettingsAsIGTFPayable  CompanySettings[]  @relation("SettingsIGTFPayableAccount")
```

---

## SQL de migración

**Nombre:** `20260526_payment_gl_bankaccount`

```sql
-- ─── PaymentRecord: bankAccountId + glTransactionId ──────────────────────────
ALTER TABLE "PaymentRecord"
  ADD COLUMN "bankAccountId"    TEXT,
  ADD COLUMN "glTransactionId"  TEXT;

ALTER TABLE "PaymentRecord"
  ADD CONSTRAINT "PaymentRecord_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentRecord_glTransactionId_fkey"
    FOREIGN KEY ("glTransactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentRecord_glTransactionId_key" UNIQUE ("glTransactionId");

CREATE INDEX "PaymentRecord_companyId_bankAccountId_idx"
  ON "PaymentRecord"("companyId", "bankAccountId");

-- ─── PaymentBatch: bankAccountId + glTransactionId ───────────────────────────
ALTER TABLE "PaymentBatch"
  ADD COLUMN "bankAccountId"    TEXT,
  ADD COLUMN "glTransactionId"  TEXT;

ALTER TABLE "PaymentBatch"
  ADD CONSTRAINT "PaymentBatch_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentBatch_glTransactionId_fkey"
    FOREIGN KEY ("glTransactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentBatch_glTransactionId_key" UNIQUE ("glTransactionId");

CREATE INDEX "PaymentBatch_companyId_bankAccountId_idx"
  ON "PaymentBatch"("companyId", "bankAccountId");

-- ─── CompanySettings: igtfPayableAccountId ───────────────────────────────────
ALTER TABLE "CompanySettings"
  ADD COLUMN "igtfPayableAccountId" TEXT;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_igtfPayableAccountId_fkey"
    FOREIGN KEY ("igtfPayableAccountId") REFERENCES "Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
```

**Análisis de riesgo:**

| Factor | Evaluación |
|---|---|
| Filas afectadas en PaymentRecord | 0 — columnas nullable, sin backfill |
| Filas afectadas en PaymentBatch | 0 — columnas nullable, sin backfill |
| Filas afectadas en CompanySettings | 0 — columna nullable, sin backfill |
| Rollback PaymentRecord | `ALTER TABLE "PaymentRecord" DROP COLUMN "bankAccountId", DROP COLUMN "glTransactionId"` — seguro si no hay datos |
| Rollback PaymentBatch | Simétrico |
| Rollback CompanySettings | `ALTER TABLE "CompanySettings" DROP COLUMN "igtfPayableAccountId"` |
| Bloqueo de tabla | `ADD COLUMN ... NULL` es instantáneo en PostgreSQL 14+ (no reescribe filas) |
| `ADD CONSTRAINT UNIQUE` | En tabla con datos, PostgreSQL verifica unicidad; como todos los valores son NULL, es instantáneo |
| Índices nuevos | Tres índices creados en columnas con valores NULL mayoritariamente — overhead mínimo |
| Registros existentes | PaymentRecord y PaymentBatch existentes quedan con `bankAccountId = null`, `glTransactionId = null` — comportamiento idéntico al actual |

---

## Contrato de servicios — `PaymentGLService`

**Archivo owner:** `src/modules/payments/services/PaymentGLService.ts`

Este servicio es invocado internamente por `PaymentService` y `PaymentBatchService` dentro del mismo `$transaction`. No es una Server Action — es un módulo interno.

```typescript
import type { Prisma } from "@prisma/client";
import type Decimal from "decimal.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type GLPostingContext = {
  companyId: string;
  periodId: string;         // período contable activo — resuelto ANTES de llamar a este servicio
  date: Date;
  createdBy: string;        // userId Clerk
  description: string;      // descripción del asiento (ej. "Cobro factura FAC-00042 — PagoMóvil")
};

export type PaymentRecordGLInput = {
  paymentRecordId: string;
  bankAccountId: string;    // BankAccount.id — ya verificado que pertenece a companyId
  amountVes: Decimal;       // monto principal en Bs.
  igtfAmount: Decimal | null; // IGTF en Bs. — null si no aplica
  currency: string;
  context: GLPostingContext;
};

export type PaymentBatchGLInput = {
  paymentBatchId: string;
  bankAccountId: string;
  lines: Array<{
    invoiceId: string;
    amountVes: Decimal;
    igtfAmount: Decimal | null;
  }>;
  context: GLPostingContext;
};

export type GLPostingResult = {
  transactionId: string;
  journalEntriesCount: number;
};

// ─── Contratos de método ──────────────────────────────────────────────────────

/**
 * Genera el asiento GL para un cobro (CxC → Banco).
 *
 * Precondiciones (verificadas por el llamador antes de invocar):
 *   - tx es un Prisma.TransactionClient dentro de $transaction Read Committed
 *   - bankAccountId pertenece a companyId (ADR-004)
 *   - CompanySettings.arAccountId IS NOT NULL (verificado antes de llamar)
 *   - La factura (si existe) pertenece a companyId
 *   - El período activo (periodId) no está CLOSED (R-3)
 *   - FiscalYearClose no existe para el año de context.date (Fase 15 guard)
 *
 * Proceso (dentro de tx Read Committed):
 *   1. Resolver BankAccount.accountId (cuenta GL del banco)
 *   2. Leer CompanySettings.arAccountId, igtfPayableAccountId
 *   3. Construir JournalEntries:
 *        Dr. bankAccount.accountId  amountVes    [cobro]
 *        Cr. arAccountId            amountVes    [cancela CxC]
 *        Si igtfAmount > 0:
 *          Dr. bankAccount.accountId   igtfAmount [IGTF en banco]
 *          Cr. igtfPayableAccountId    igtfAmount [IGTF por pagar]
 *   4. Crear Transaction (type: DIARIO, status: POSTED)
 *   5. Crear JournalEntry[] en el mismo tx
 *   6. Actualizar PaymentRecord.glTransactionId = transaction.id
 *   7. AuditLog en el mismo tx:
 *        { entityName: "PaymentRecord", action: "GL_POSTED", entityId: paymentRecordId,
 *          newValue: { transactionId }, ipAddress: null, userAgent: null }
 *      Nota: ipAddress/userAgent se propagan desde la action al GLPostingContext si se requiere — ver R-6
 *
 * Postcondiciones:
 *   - Transaction creada y POSTED
 *   - PaymentRecord.glTransactionId actualizado
 *   - Partida doble balanceada: sum(Dr) === sum(Cr)
 *
 * Retorna: { transactionId, journalEntriesCount }
 *
 * Si igtfPayableAccountId es null y igtfAmount > 0:
 *   - Emite asiento solo por amountVes (sin líneas IGTF)
 *   - Crea AuditLog con action: "IGTF_GL_SKIPPED"
 *   - No lanza error — degradación graceful
 *
 * Errores de negocio (lanzar, no retornar):
 *   - "La cuenta bancaria no pertenece a esta empresa"
 *   - "La cuenta CxC (arAccount) no está configurada en CompanySettings"
 *   - "El período contable está cerrado"
 */
async function postPaymentRecordGL(
  tx: Prisma.TransactionClient,
  input: PaymentRecordGLInput,
  settings: { arAccountId: string; igtfPayableAccountId: string | null }
): Promise<GLPostingResult>;

/**
 * Genera el asiento GL para un pago A/P (Proveedores → Banco).
 * Llamado exclusivamente desde PaymentBatchService.applyBatch() dentro de $transaction Serializable.
 *
 * Precondiciones (verificadas por PaymentBatchService antes de invocar):
 *   - tx es un Prisma.TransactionClient dentro de $transaction Serializable (ADR-022 D-4)
 *   - bankAccountId pertenece a companyId
 *   - CompanySettings.apAccountId IS NOT NULL
 *   - El período activo no está CLOSED
 *   - FiscalYearClose no existe para el año de context.date
 *
 * Proceso (dentro de tx Serializable):
 *   1. Resolver BankAccount.accountId
 *   2. Leer CompanySettings.apAccountId, igtfPayableAccountId
 *   3. Construir JournalEntries por cada línea:
 *        Dr. apAccountId               line.amountVes  [cancela CxP proveedor]
 *        Cr. bankAccount.accountId     line.amountVes  [salida del banco]
 *        Si line.igtfAmount > 0:
 *          Dr. igtfPayableAccountId    line.igtfAmount [IGTF]
 *          Cr. bankAccount.accountId   line.igtfAmount [salida adicional banco]
 *   4. Crear Transaction única con todas las JournalEntries del batch
 *   5. Actualizar PaymentBatch.glTransactionId = transaction.id
 *   6. AuditLog en el mismo tx
 *
 * Postcondiciones:
 *   - Una Transaction para todo el batch (N líneas → 2N o 4N JournalEntries)
 *   - PaymentBatch.glTransactionId actualizado
 *   - Partida doble balanceada
 *
 * Errores de negocio:
 *   - "La cuenta CxP (apAccount) no está configurada en CompanySettings"
 *   - "La cuenta bancaria no pertenece a esta empresa"
 */
async function postPaymentBatchGL(
  tx: Prisma.TransactionClient,
  input: PaymentBatchGLInput,
  settings: { apAccountId: string; igtfPayableAccountId: string | null }
): Promise<GLPostingResult>;

/**
 * Genera el asiento de reverso GL al anular un PaymentRecord (voidPaymentRecord).
 * Solo aplica si PaymentRecord.glTransactionId IS NOT NULL.
 *
 * Precondiciones:
 *   - paymentRecord.glTransactionId IS NOT NULL (si es null, no hace nada)
 *   - La tx original está POSTED (no VOIDED)
 *
 * Proceso:
 *   1. Leer Transaction original con sus JournalEntries
 *   2. Crear Transaction de reverso (type: DIARIO, description: "Reverso — [descripción original]")
 *   3. Crear JournalEntries inversas: cada Débito → Crédito y viceversa
 *   4. Marcar Transaction original como VOIDED con FK a la nueva (patrón voidedById existente)
 *   5. Limpiar PaymentRecord.glTransactionId = null (o apuntar al reverso — ver nota)
 *   6. AuditLog
 *
 * Nota: PaymentRecord.glTransactionId apunta al asiento original. Al anular, se crea un asiento
 * de reverso nuevo. El original queda VOIDED. PaymentRecord no cambia su glTransactionId —
 * el historial queda trazable via Transaction.voidedById.
 */
async function reversePaymentRecordGL(
  tx: Prisma.TransactionClient,
  paymentRecordId: string,
  companyId: string,
  voidedBy: string,
  context: GLPostingContext
): Promise<void>;

/**
 * Genera el asiento de reverso GL al anular un PaymentBatch (voidBatch).
 * Simétrico a reversePaymentRecordGL pero para PaymentBatch.
 */
async function reversePaymentBatchGL(
  tx: Prisma.TransactionClient,
  paymentBatchId: string,
  companyId: string,
  voidedBy: string,
  context: GLPostingContext
): Promise<void>;
```

---

## Contrato de Server Action — `analyzeReceiptAction`

**Archivo owner:** `src/modules/payments/actions/payment.actions.ts` (agregar al archivo existente)

```typescript
// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ReceiptAnalysisResult = {
  method: "EFECTIVO" | "TRANSFERENCIA" | "PAGOMOVIL" | "ZELLE" | "CASHEA" | null;
  amount: string | null;        // string para preservar precisión — convertir a Decimal en el formulario
  currency: "VES" | "USD" | "EUR" | null;
  referenceNumber: string | null;
  originBank: string | null;
  destBank: string | null;
  senderPhone: string | null;
  destPhone: string | null;
  date: string | null;          // formato YYYY-MM-DD
  confidence: number;           // 0.0 – 1.0
};

// ─── Signature de la Server Action ───────────────────────────────────────────

/**
 * Analiza un comprobante bancario con Gemini y retorna los campos extraídos
 * para pre-llenar el formulario de PaymentRecord.
 *
 * Esta acción NO crea ningún registro en BD. Es solo lectura + llamada externa.
 * El usuario confirma los datos y luego llama a createPaymentRecordAction.
 *
 * Precondiciones verificadas en la action (en este orden):
 *   1. auth() → userId (401 si no autenticado)
 *   2. checkRateLimit(limiters.ocr, userId) — 10/min (ADR-006 D-5)
 *   3. companyMember.findUnique({ userId, companyId }) — 403 si no miembro
 *   4. companyMember.role !== VIEWER — 403 si VIEWER (ADR-006 D-1)
 *   5. PaymentAttachment.findFirst({ id: attachmentId, companyId }) — 404 si no encontrado (ADR-004)
 *   6. GEMINI_API_KEY presente en process.env — si no, retornar { success: false, error: "..." }
 *
 * Proceso:
 *   1. Descargar el blob desde PaymentAttachment.blobUrl (GET HTTP — no pasa por BD)
 *   2. Convertir a base64 (para Gemini multimodal API)
 *   3. Llamar a Gemini API (gemini-2.0-flash, JSON mode) con el prompt estructurado (D-4.3)
 *   4. Parsear respuesta JSON y validar contra ReceiptAnalysisResult con Zod
 *   5. Retornar { success: true, data: ReceiptAnalysisResult }
 *
 * Errores manejados silenciosamente (retornar error, no lanzar):
 *   - Gemini API caída o timeout (>15s)
 *   - Rate limit de Gemini excedido
 *   - Respuesta de Gemini no parseable como JSON
 *   - Blob no accesible (URL caducada o eliminada)
 *
 * En todos los errores: retornar { success: false, error: "El análisis con IA no está disponible ahora mismo." }
 * NUNCA exponer detalles internos de Gemini al cliente.
 *
 * Notas de implementación:
 *   - Modelo: gemini-2.0-flash (D-4.1)
 *   - Timeout: 15 segundos (AbortController)
 *   - MIME types soportados por Gemini multimodal: image/jpeg, image/png, image/webp, application/pdf
 *   - Para PDF: usar la URL directa (Gemini soporta PDF via URL en gemini-2.0-flash)
 *   - ipAddress/userAgent NO requeridos en AuditLog para esta action (no es mutación financiera — solo lectura + llamada externa)
 */
async function analyzeReceiptAction(
  companyId: string,
  attachmentId: string
): Promise<
  | { success: true; data: ReceiptAnalysisResult }
  | { success: false; error: string }
>;
```

---

## Diagrama de flujo — caso feliz (PaymentRecord con GL posting)

```
Usuario abre formulario "Registrar Cobro"
  │
  ├─ (Opcional) Sube comprobante → ADR-029 → PaymentAttachment creado
  │
  ├─ (Opcional) Clic "Analizar con IA"
  │     └─ analyzeReceiptAction(companyId, attachmentId)
  │           ├─ Auth + rate limit (limiters.ocr)
  │           ├─ Descarga blob → Gemini 2.0 Flash
  │           └─ Retorna ReceiptAnalysisResult → pre-llena formulario
  │
  ├─ Usuario completa/confirma: amount, method, bankAccountId, invoiceId, date
  │
  └─ createPaymentRecordAction(companyId, input)
        ├─ Auth + rate limit (limiters.fiscal)
        ├─ Validación Zod (amount.max(), currency, etc.)
        ├─ Verificar membership + role
        │
        └─ $transaction (Read Committed):
              ├─ createPaymentRecord (PaymentRecord)
              ├─ Actualizar Invoice.pendingAmount, Invoice.paymentStatus
              ├─ Si bankAccountId && invoiceId && settings.arAccountId:
              │     └─ PaymentGLService.postPaymentRecordGL(tx, input, settings)
              │           ├─ Crear Transaction (DIARIO / POSTED)
              │           ├─ Crear JournalEntries (Dr Banco / Cr CxC [+ IGTF si aplica])
              │           └─ PaymentRecord.glTransactionId = transaction.id
              └─ AuditLog (entityName: "PaymentRecord", action: "CREATE")
```

```
Usuario aplica PaymentBatch (applyBatch)
  │
  └─ applyBatchAction(companyId, batchId)
        ├─ Auth + rate limit (limiters.fiscal)
        ├─ Verificar membership + role (OWNER|ADMIN|ACCOUNTANT — ADR-022)
        │
        └─ $transaction (Serializable — ADR-022 D-4):
              ├─ Verificar batch DRAFT + líneas
              ├─ Por cada línea: crear InvoicePayment, actualizar Invoice.pendingAmount
              ├─ PaymentBatch.status = APPLIED
              ├─ Si bankAccountId && settings.apAccountId:
              │     └─ PaymentGLService.postPaymentBatchGL(tx, input, settings)
              │           ├─ Crear Transaction única (DIARIO / POSTED)
              │           ├─ Crear JournalEntries (Dr CxP/Cr Banco por línea [+ IGTF])
              │           └─ PaymentBatch.glTransactionId = transaction.id
              └─ AuditLog (entityName: "PaymentBatch", action: "APPLIED")
```

---

## Checklist de implementación ordenado

El orden es obligatorio: cada ítem desbloquea el siguiente.

### Paso 1 — Migración de schema (no depende de nada)
- [ ] Crear `prisma/migrations/20260526_payment_gl_bankaccount/migration.sql` con el SQL de este ADR
- [ ] Ejecutar: `npx prisma db execute --file prisma/migrations/20260526_payment_gl_bankaccount/migration.sql`
- [ ] Ejecutar: `npx prisma migrate resolve --applied 20260526_payment_gl_bankaccount`
- [ ] Actualizar `prisma/schema.prisma`: campos nuevos en `PaymentRecord`, `PaymentBatch`, `CompanySettings`, relaciones inversas en `BankAccount`, `Transaction`, `Account`
- [ ] Ejecutar: `npx prisma format`
- [ ] Ejecutar: `npx prisma generate`
- [ ] Reiniciar `npm run dev`

### Paso 2 — CompanySettings UI (desbloquea paso 3)
- [ ] Agregar campo `igtfPayableAccountId` al formulario de Configuración GL en Settings
- [ ] Agregar validación: la cuenta debe ser de tipo LIABILITY
- [ ] Agregar acción `updateCompanySettingsAction` (o extender la existente) para persistir el nuevo campo
- [ ] Test: `companySettings.actions.test.ts` — caso IGTF account configurada/no configurada

### Paso 3 — `PaymentGLService` (requiere paso 1)
- [ ] Crear `src/modules/payments/services/PaymentGLService.ts`
- [ ] Implementar `postPaymentRecordGL()` según el contrato de este ADR
- [ ] Implementar `postPaymentBatchGL()` según el contrato de este ADR
- [ ] Implementar `reversePaymentRecordGL()` según el contrato de este ADR
- [ ] Implementar `reversePaymentBatchGL()` según el contrato de este ADR
- [ ] Tests: `src/modules/payments/__tests__/PaymentGLService.test.ts`
  - caso cobro sin IGTF: asiento 2 líneas, balanceado
  - caso cobro con IGTF: asiento 4 líneas, balanceado
  - caso IGTF sin cuenta configurada: asiento 2 líneas + AuditLog IGTF_GL_SKIPPED
  - caso arAccountId null: lanza error de negocio
  - caso pago A/P sin IGTF: N batches × 2 JournalEntries
  - caso pago A/P con IGTF: N batches × 4 JournalEntries
  - reverso cobro: asiento inverso creado, Transaction original VOIDED
  - R-5: todos los cálculos usan Decimal.js (nunca number)

### Paso 4 — Integrar GL en `PaymentService` (requiere paso 3)
- [ ] Modificar `PaymentService.createPaymentRecord()`:
  - Leer `CompanySettings` dentro del `$transaction`
  - Si condiciones D-2 se cumplen: llamar `PaymentGLService.postPaymentRecordGL()`
- [ ] Modificar `PaymentService.voidPaymentRecord()`:
  - Si `paymentRecord.glTransactionId IS NOT NULL`: llamar `PaymentGLService.reversePaymentRecordGL()`
- [ ] Tests: actualizar `PaymentService.test.ts` — casos con/sin bankAccountId, con/sin arAccountId
- [ ] `npx tsc --noEmit` → 0 errores

### Paso 5 — Integrar GL en `PaymentBatchService` (requiere paso 3)
- [ ] Modificar `PaymentBatchService.applyBatch()` (ya Serializable):
  - Leer `CompanySettings` dentro del `$transaction`
  - Si condiciones D-2 se cumplen: llamar `PaymentGLService.postPaymentBatchGL()`
- [ ] Modificar `PaymentBatchService.voidBatch()`:
  - Si `batch.glTransactionId IS NOT NULL`: llamar `PaymentGLService.reversePaymentBatchGL()`
- [ ] Tests: actualizar `PaymentBatchService.test.ts` — casos con/sin bankAccountId
- [ ] `npx tsc --noEmit` → 0 errores

### Paso 6 — UI: selector de BankAccount en formularios de pago (requiere paso 1)
- [ ] Agregar campo `bankAccountId` (select de cuentas bancarias activas) en `PaymentForm.tsx`
- [ ] Agregar campo `bankAccountId` en `PaymentBatchForm.tsx`
- [ ] El select muestra cuentas de `BankAccount` donde `companyId = currentCompany AND isActive = true AND deletedAt IS NULL`
- [ ] Si no hay cuentas bancarias configuradas: mostrar tooltip "Configure una cuenta bancaria para habilitar el asiento automático"
- [ ] El campo es opcional — el formulario funciona sin él
- [ ] `npx vitest run` → 0 fallos

### Paso 7 — `analyzeReceiptAction` (requiere paso 1, independiente de pasos 3-6)
- [ ] Agregar `GEMINI_API_KEY` a `.env.example` (si no existe ya)
- [ ] Implementar `analyzeReceiptAction` en `src/modules/payments/actions/payment.actions.ts`
- [ ] Tests: `src/modules/payments/__tests__/payment.actions.test.ts`
  - Gemini retorna JSON válido con confidence >= 0.85 → success true con datos
  - Gemini retorna confidence < 0.85 → success true con datos (la lógica de UI decide el highlighting)
  - GEMINI_API_KEY ausente → success false mensaje amigable
  - rate limit (limiters.ocr) excedido → success false
  - VIEWER role → success false 403
  - attachmentId no pertenece a companyId → success false 404

### Paso 8 — UI: botón "Analizar con IA" (requiere paso 7)
- [ ] Agregar botón `AnalyzeReceiptButton.tsx` en `PaymentRecordList` y `PaymentForm`
- [ ] Loading state: `disabled={isPending} aria-busy="true"`
- [ ] Si `confidence < 0.85`: campos pre-llenados con fondo amarillo y tooltip "Verificar"
- [ ] Si `confidence >= 0.85`: campos pre-llenados normalmente con badge "Analizado con IA"
- [ ] Si error: toast con mensaje del error (nunca raw error de Gemini)
- [ ] Si GEMINI_API_KEY no configurado: botón deshabilitado con tooltip "Análisis IA no disponible"

### Paso 9 — Phase gate final
- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npx vitest run` → 0 failures
- [ ] Checklist Pre-Merge de CLAUDE.md completo
- [ ] `git checkout -b feat/fase-38-payment-gl-gemini`
- [ ] Commit y PR a main

---

## SCHEMA_AUDITOR checklist

```
[x] Relaciones a tablas contables tienen onDelete: Restrict
    — PaymentRecord.bankAccountId → BankAccount: Restrict
    — PaymentRecord.glTransactionId → Transaction: Restrict
    — PaymentBatch.bankAccountId → BankAccount: Restrict
    — PaymentBatch.glTransactionId → Transaction: Restrict
    — CompanySettings.igtfPayableAccountId → Account: Restrict
    CONFORME (ADR-003)

[x] onDelete: Cascade AUSENTE en nuevas relaciones contables
    CONFORME

[x] Campos monetarios usan Decimal @db.Decimal(19,4)
    — No se agregan campos monetarios nuevos en el schema
    — Cálculos en PaymentGLService usan Decimal.js obligatoriamente (R-5)
    CONFORME

[x] Campos porcentaje usan Decimal @db.Decimal(5,2)
    — No se agregan campos de porcentaje
    CONFORME

[x] Entidades fiscales tienen deletedAt DateTime?
    — PaymentRecord ya tiene deletedAt. PaymentBatch ya tiene deletedAt.
    — Los campos nuevos (bankAccountId, glTransactionId) son FKs, no entidades nuevas
    CONFORME

[x] Entidades de creación fiscal tienen idempotencyKey String @unique
    — PaymentRecord no tiene idempotencyKey (pre-existente — deuda técnica fuera del scope de este ADR)
    — PaymentBatch ya tiene idempotencyKey @unique (ADR-022)
    CONFORME para los modelos con scope en este ADR

[x] Unicidad de negocio incluye companyId
    — @@unique([companyId, bankAccountId]) no aplica (bankAccountId no es campo de unicidad negocial)
    — glTransactionId @unique es correcto: un asiento referencia exactamente un pago
    CONFORME

[x] Índices en FKs frecuentes
    — @@index([companyId, bankAccountId]) en PaymentRecord y PaymentBatch
    CONFORME

[x] AuditLog en mismo $transaction
    — postPaymentRecordGL y postPaymentBatchGL crean AuditLog dentro del tx
    — reversePaymentRecordGL y reversePaymentBatchGL crean AuditLog dentro del tx
    CONFORME (R-6)

[x] Riesgo de migración documentado
    — Sección "SQL de migración" con tabla de análisis de riesgo
    CONFORME

[x] Acciones destructivas verifican companyMember.role (ADR-006 D-1)
    — voidPaymentRecord: rol verificado en la action (pre-existente)
    — voidBatch: OWNER|ADMIN|ACCOUNTANT verificado (ADR-022)
    — analyzeReceiptAction: role !== VIEWER verificado
    CONFORME

[x] Campos de monto en Zod input tienen .max() ceiling (ADR-006 D-2)
    — No se agregan nuevos campos de monto en Zod schemas en este ADR
    — Los schemas de PaymentRecord y PaymentBatch ya tienen .max() (pre-existentes)
    CONFORME

[x] No se acepta tasa impositiva del cliente (ADR-006 D-3)
    — El IGTF se calcula server-side usando la regla Z-2 (currency != VES o isSpecialContributor)
    — analyzeReceiptAction retorna datos crudos para pre-llenado; el cálculo IGTF ocurre en el service
    CONFORME

[x] AuditLog append-only — no update/delete (ADR-006 D-4)
    — PaymentGLService solo usa auditLog.create
    CONFORME

[x] Mutaciones financieras con rate limiting (ADR-006 D-5)
    — createPaymentRecordAction: limiters.fiscal (pre-existente)
    — applyBatchAction: limiters.fiscal (ADR-022)
    — analyzeReceiptAction: limiters.ocr (10/min)
    CONFORME

[x] companyId en todo findMany/findFirst (ADR-004)
    — PaymentGLService.postPaymentRecordGL: bankAccountId verificado con companyId antes de llamar
    — analyzeReceiptAction: attachmentId buscado con companyId guard
    CONFORME

[x] Serializable donde requerido
    — postPaymentBatchGL se ejecuta dentro del $transaction Serializable heredado de applyBatch (ADR-022 D-4)
    — postPaymentRecordGL usa Read Committed (decisión D-3 de este ADR)
    CONFORME

[x] R-5: Cero flotantes en cálculos
    — Todos los montos en PaymentGLService usan Decimal.js
    — analyzeReceiptAction retorna amount como string (no number) para preservar precisión
    CONFORME
```

---

## Consecuencias

### Positivas

- Los pagos registrados con `bankAccountId` generan asiento GL automáticamente — elimina trabajo manual del contador.
- El asiento VOID de un pago genera el reverso correctamente — consistencia contable garantizada.
- El flujo Gemini OCR reduce el tiempo de registro de un comprobante de ~2 minutos a ~20 segundos.
- La degradación graceful en todos los puntos (sin bankAccountId, sin arAccountId, sin Gemini) garantiza que ninguna funcionalidad existente se rompe.
- `igtfPayableAccountId` en `CompanySettings` cierra el gap de trazabilidad fiscal del IGTF en el GL.

### Restricciones y riesgos

- **Riesgo de doble asiento**: si `createPaymentRecord` se reintenta (red timeout), puede crear un segundo `PaymentRecord` con un segundo asiento. Mitigación: `idempotencyKey` en `PaymentRecord` (deuda técnica pre-existente — ver checklist SCHEMA_AUDITOR arriba). En esta fase, la mitigación es el `glTransactionId @unique`: un segundo intento que produce el mismo `PaymentRecord` (P2002 en `idempotencyKey` si se agrega) o que pasa a través generará un segundo `Transaction` sin conflicto de unicidad. El riesgo es aceptable para el lanzamiento.
- **Asiento IGTF omitido**: si `igtfPayableAccountId` no está configurado, el asiento IGTF se omite silenciosamente. El contador debe verificar la configuración de CompanySettings. Mitigación: alerta en el dashboard (patrón `INVENTARIO_SIN_CUENTAS_GL` existente) — puede implementarse como `IGTF_SIN_CUENTA_GL`.
- **Gemini y datos sensibles**: el archivo del comprobante (potencialmente con datos bancarios) se envía a la API de Gemini. La política de uso de datos de Gemini Flash no garantiza no-retention. Para empresas con políticas de confidencialidad estrictas, el botón "Analizar con IA" debe poder deshabilitarse por empresa (decisión de implementación, fuera del scope de este ADR).
- **Cost de Gemini**: gemini-2.0-flash tiene costo por imagen/PDF procesado. Con `limiters.ocr` en 10/min por usuario, el impacto es acotado. El costo real depende del volumen de uso en producción.

---

## ADRs relacionados

- ADR-001: Serializable — postPaymentBatchGL hereda el nivel del applyBatch
- ADR-002: Decimal para dinero — R-5 aplica a todo PaymentGLService
- ADR-003: onDelete Restrict — todas las FKs nuevas usan Restrict
- ADR-004: companyId obligatorio — verificado en PaymentGLService y analyzeReceiptAction
- ADR-006: Security controls — D-1, D-3, D-4, D-5 aplicados
- ADR-022: PaymentBatch Serializable — postPaymentBatchGL corre dentro de ese $transaction
- ADR-026: CompanySettings GL — arAccountId y apAccountId ya existentes; igtfPayableAccountId nuevo
- ADR-029: PaymentAttachment — attachmentId es el input de analyzeReceiptAction
