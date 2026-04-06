# ADR-008 — Schema de Conciliación Bancaria: Opción D (Extender BankTransaction)

- **Status**: DECIDED ✅
- **Date**: 2026-04-06
- **Author**: arch-agent
- **Applies to**: `BankTransaction`, `BankStatement`, Fase 17B
- **Supersedes**: spec original de `BankStatementLine` en contaflow-context-v3.md §33

---

## Context

Fase 17 (en producción) introdujo `BankTransaction` con matching exclusivo a `InvoicePayment`.
Fase 17B requiere dos casos de uso adicionales:
1. Match contra `Transaction` (asiento de libro mayor — libro auxiliar bancario).
2. Match contra `PaymentRecord` (pago multi-medio Fase 14B — distinto semánticamente de `InvoicePayment`).

El spec original de Fase 17B proponía un modelo nuevo `BankStatementLine` con ambas FK.

Existen 34 tests que usan `BankTransaction`. Hay datos en producción en `BankTransaction`.

---

## Pre-flight Check

**1. ACCOUNTING IMPACT**
- Ningún número correlativo involucrado.
- La operación de match es una actualización de estado (`isReconciled`, `matchedAt`) — no genera asiento contable en este paso. El asiento IGTF derivado es una operación separada (ver §IGTF auto-detect).
- Isolation level: Read Committed es suficiente para el match simple. Para el asiento IGTF derivado, aplica la regla general de mutaciones financieras multi-tabla.
- `onDelete: Restrict` es obligatorio en las nuevas FK (ADR-003).
- `AuditLog` obligatorio en operaciones de match/unmatch.

**2. ADRs CONSULTADOS**
- ADR-001: no aplica (sin correlativo).
- ADR-002: los campos monetarios ya son `Decimal @db.Decimal(19,4)` — sin cambio.
- ADR-003: nuevas FK deben ser `onDelete: Restrict`.
- ADR-007: `BankTransaction` ya está en la lista de tablas que requieren RLS. Los nuevos campos no cambian esa lista.

**3. LESSONS LEARNED**
- No existe `lessons-learned.md` en `.claude/`. Sin contraindication documentada.

**4. SCHEMA AUDITOR**
- Checklist ejecutado — ver §Schema Prisma más abajo.

**5. RISK ANALYSIS**
- Dos campos nullable añadidos a `BankTransaction` (ADD COLUMN nullable = sin bloqueo de tabla en PostgreSQL 14+).
- Cero filas afectadas retrospectivamente: los campos son optativos y se llenan solo al hacer match.
- Rollback: DROP COLUMN en los dos nuevos campos — no destruye datos existentes.
- Migración parcial fallida: ambas columnas son nullable → sin datos corruptos en estado intermedio.
- Índices necesarios: `matchedTransactionId` y `matchedPaymentRecordId` (ver §Schema).

**6. SECURITY IMPACT (ADR-006)**
- Nueva acción `matchBankTransaction` (destructiva en sentido de modificar estado): debe verificar `companyMember.role` — mínimo ACCOUNTANT; VOID de match requiere ADMIN o ACCOUNTANT. Documentado en §Contratos.
- No hay campos de amount nuevos en input Zod (el amount viene del banco, no del usuario).
- No hay tax rate en input.
- `AuditLog` append-only confirmado.
- La acción de match modifica datos financieros → rate limiting `limiters.fiscal` obligatorio.

---

## Decision

**Opción D — Extender `BankTransaction` con dos FK opcionales adicionales.**

`BankStatementLine` no se crea. El spec original se descarta.

### Razones

| Criterio | Opción A/D | Opción B | Opción C |
|---|---|---|---|
| Tests rotos | 0 (backward compatible) | 34 | 0 |
| Migración en producción | ADD COLUMN nullable (safe) | Migración destructiva | ADD TABLE + relación cruzada confusa |
| Modelos en el dominio | 1 (BankTransaction) | 1 (BankStatementLine) | 2 (ambos) |
| Semántica clara | FK explícitas + constraint de negocio | Nueva entidad sin historia | Confusión: ¿cuál usar? |
| Prerequisito RLS (ADR-007) | Sin cambio — BankTransaction ya está | Requiere actualizar ADR-007 | Requiere actualizar ADR-007 |

**Diferencia entre Opción A y D**: Opción D es explícita en el nombre — los tres tipos de match son distintos semánticamente (`InvoicePayment` = cancelación cartera CxC/CxP; `Transaction` = asiento libre de libro mayor; `PaymentRecord` = pago digital multi-medio). Mantener tres FK separadas es correcto semánticamente. Opción A los trataba como "más campos" sin distinción.

### Constraint de negocio "exactamente uno"

La DB no enforcea "exactamente uno de tres FK". El enforcement es en la capa de servicio:

```
BankReconciliationService.matchTransaction():
  PRECONDICIÓN: isReconciled === false
  ACCIÓN: setear exactamente uno de los tres campos, isReconciled = true
  POSTCONDICIÓN: isReconciled === true, exactamente uno de los tres campos no es null
```

Esta es la misma estrategia usada en `Invoice.transactionId` (opcional, sin constraint DB de "obligatorio si POSTED") — el contrato de servicio es la capa que enforcea.

---

## Schema Prisma — Campos a añadir a `BankTransaction`

```prisma
model BankTransaction {
  id                    String              @id @default(cuid())
  statementId           String
  statement             BankStatement       @relation(fields: [statementId], references: [id], onDelete: Restrict)
  date                  DateTime            @db.Date
  description           String
  type                  BankTransactionType
  amount                Decimal             @db.Decimal(19, 4)
  reference             String?
  isReconciled          Boolean             @default(false)

  // Match contra InvoicePayment (Fase 17 — cancelación cartera CxC/CxP)
  matchedPaymentId      String?
  matchedPayment        InvoicePayment?     @relation(fields: [matchedPaymentId], references: [id], onDelete: Restrict)

  // Match contra Transaction/asiento libro mayor (Fase 17B — NUEVO)
  matchedTransactionId  String?
  matchedTransaction    Transaction?        @relation("BankTransactionMatch", fields: [matchedTransactionId], references: [id], onDelete: Restrict)

  // Match contra PaymentRecord/pago multi-medio (Fase 17B — NUEVO)
  matchedPaymentRecordId  String?
  matchedPaymentRecord    PaymentRecord?    @relation(fields: [matchedPaymentRecordId], references: [id], onDelete: Restrict)

  // Metadatos de match (compartidos — se setean al hacer cualquier tipo de match)
  matchedAt             DateTime?
  matchedBy             String?             // userId Clerk

  // Soft delete
  deletedAt             DateTime?
  createdAt             DateTime            @default(now())

  @@index([statementId])
  @@index([matchedPaymentId])
  @@index([matchedTransactionId])          // NUEVO
  @@index([matchedPaymentRecordId])        // NUEVO
}
```

**Relación inversa obligatoria en `Transaction`:**
```prisma
  bankTransactionMatches  BankTransaction[] @relation("BankTransactionMatch")
```

**Relación inversa obligatoria en `PaymentRecord`:**
```prisma
  bankTransactions  BankTransaction[]
```

(La relación inversa de `InvoicePayment` ya existe: `bankTransactions BankTransaction[]`.)

### SCHEMA_AUDITOR checklist

- [x] Todas las FK nuevas tienen `onDelete: Restrict`
- [x] `onDelete: Cascade` ausente
- [x] Campos monetarios existentes mantienen `Decimal @db.Decimal(19,4)`
- [x] `deletedAt DateTime?` ya existe en `BankTransaction` (Fase 17)
- [x] No hay correlativo en este modelo — no aplica `idempotencyKey`
- [x] Unicidad de negocio: no aplica `@@unique` (una BankTransaction puede existir sin match)
- [x] Índices nuevos en FK frecuentes: `matchedTransactionId`, `matchedPaymentRecordId`
- [x] `AuditLog` requerido en operaciones de match/unmatch
- [x] Acción de match verifica `companyMember.role`
- [x] Sin campos de monto en Zod input de match (el monto viene de la fila bancaria ya importada)
- [x] Sin tax rate en input del cliente
- [x] `AuditLog` solo append-only
- [x] Rate limiting `limiters.fiscal` en `matchBankTransactionAction`

---

## Nombre de migración sugerido

```
20260406_feat_17b_bank_transaction_match_extensions
```

### SQL de migración (additive — sin riesgo)

```sql
ALTER TABLE "BankTransaction"
  ADD COLUMN "matchedTransactionId"   TEXT REFERENCES "Transaction"("id") ON DELETE RESTRICT,
  ADD COLUMN "matchedPaymentRecordId" TEXT REFERENCES "PaymentRecord"("id") ON DELETE RESTRICT;

CREATE INDEX "BankTransaction_matchedTransactionId_idx"   ON "BankTransaction"("matchedTransactionId");
CREATE INDEX "BankTransaction_matchedPaymentRecordId_idx" ON "BankTransaction"("matchedPaymentRecordId");
```

### Rollback (seguro — nullable, sin datos existentes en los campos nuevos)

```sql
DROP INDEX IF EXISTS "BankTransaction_matchedTransactionId_idx";
DROP INDEX IF EXISTS "BankTransaction_matchedPaymentRecordId_idx";
ALTER TABLE "BankTransaction"
  DROP COLUMN IF EXISTS "matchedTransactionId",
  DROP COLUMN IF EXISTS "matchedPaymentRecordId";
```

---

## Modelo BankStatementLine — DESCARTADO

El modelo `BankStatementLine` propuesto en contaflow-context-v3.md §33 queda formalmente descartado.

Razones:
- Duplica semánticamente `BankTransaction` sin añadir capacidades que no pueda tener con dos campos adicionales.
- Introduce una relación cruzada `BankStatementLine ↔ BankTransaction` que no tiene precedente en el dominio y cuya cardinalidad no está definida.
- No tiene `companyId` directo en el spec original — violación de ADR-004 y ADR-007 (RLS).
- `BankTransaction` ya tiene `deletedAt`, relación a `BankStatement` (que tiene relación a `BankAccount` que tiene `companyId`) — el acceso a `companyId` es indirecto pero existente. Para RLS, la policy requeriría JOIN o columna desnormalizada. Con los campos extendidos de BankTransaction esto ya está resuelto.

---

## Decisiones para los 4 requisitos mínimos de Fase 17B

### 1. CSV Import con column mapper

**No requiere cambio de schema.** El mapper es lógica de transformación en la capa de servicio que produce filas `BankTransaction` estándar. El estado de la transacción post-import es `isReconciled: false`, los tres campos de match en `null`.

Contrato de función a publicar en contaflow-contract.md §17B.1.

### 2. Vista doble columna (banco vs libro auxiliar)

**No requiere cambio de schema.** La vista hace JOIN de `BankTransaction` a cualquiera de las tres entidades según cuál campo de match esté poblado. La query determina el tipo de match con:

```typescript
const matchType =
  bt.matchedPaymentId        ? 'INVOICE_PAYMENT'  :
  bt.matchedTransactionId    ? 'JOURNAL_ENTRY'     :
  bt.matchedPaymentRecordId  ? 'PAYMENT_RECORD'    :
                               'UNMATCHED';
```

### 3. IGTF auto-detect

**No requiere cambio de schema.** La lógica detecta: si una `BankTransaction` de tipo DEBIT tiene `amount = floor(otherTransaction.amount * 0.03)` (tolerancia ±1 centavo por redondeo bancario) y la `otherTransaction` tiene `currency !== VES` → sugerir asiento IGTF.

El asiento IGTF sugerido es un `Transaction` de tipo `DIARIO` con `IGTFTransaction` asociado — creado por el flujo existente de `createIGTFAction`. La conciliación no crea el asiento directamente; lo propone para confirmación del usuario (AlertDialog, regla best-practices §5.3).

El match de la nota de débito IGTF se registra en `matchedTransactionId` (apunta al `Transaction` del asiento IGTF generado).

### 4. Report PDF/Excel (saldo según banco vs saldo según libro)

**No requiere cambio de schema.** El reporte usa:
- Saldo según banco: `BankStatement.closingBalance`
- Saldo según libro: suma de `JournalEntry` en la cuenta bancaria para el período
- Partidas en tránsito: `BankTransaction` con `isReconciled: false`
- Notas de ajuste: `BankTransaction` con `isReconciled: true` y `matchedTransactionId` → asientos de ajuste

Formato VEN-NIF estándar de conciliación bancaria. Librería: `@react-pdf/renderer` (ADR-002 contaflow-contract.md §18.2).

---

## Interaction with Existing ADRs

| ADR | Impacto |
|---|---|
| ADR-001 (Serializable correlativos) | Sin impacto — no hay correlativo bancario |
| ADR-002 (Decimal.js) | Sin cambio — todos los campos monetarios ya son `Decimal @db.Decimal(19,4)` |
| ADR-003 (onDelete: Restrict) | Cumplido — las dos FK nuevas tienen `Restrict` |
| ADR-007 (RLS) | `BankTransaction` ya está en la lista de tablas con RLS. Los dos campos nuevos son FK simples — la policy de `companyId` se hereda via `BankStatement → BankAccount → companyId`. NOTA: la policy SQL requiere JOIN o columna desnormalizada. Ver §Nota RLS. |

### Nota RLS — companyId en BankTransaction

`BankTransaction` no tiene `companyId` directo en el schema actual. La policy de RLS en ADR-007 asume `"companyId"::text = current_setting(...)` directo en la tabla. Antes de ejecutar la migración de Fase 13D, se debe resolver esto mediante una de las siguientes opciones:

**Opción preferida**: añadir `companyId String` desnormalizado a `BankTransaction` con backfill desde `BankStatement.bankAccount.companyId`. Esto también aplica a `BankStatement`.

Esta decisión se delega a la Fase 13D (ADR-007 §Implementation Checklist ya lo contempla: "Confirmar que JournalEntry tiene companyId directo"). El mismo análisis aplica a `BankTransaction` y `BankStatement`.

**Acción requerida**: actualizar el checklist de ADR-007 para incluir `BankTransaction` y `BankStatement` como tablas que requieren verificación de `companyId` directo antes de ejecutar la migración RLS.

---

## Owner Files

- `prisma/schema.prisma` — añadir campos a `BankTransaction` + relaciones inversas
- `prisma/migrations/20260406_feat_17b_bank_transaction_match_extensions/migration.sql`
- `src/modules/banking/services/BankReconciliationService.ts` — lógica de match
- `src/modules/banking/actions/bankReconciliation.actions.ts` — `matchBankTransactionAction`, `unmatchBankTransactionAction`, `importBankStatementCSVAction`
- `src/modules/banking/services/BankReportService.ts` — reporte PDF/Excel conciliación
- `src/modules/banking/__tests__/` — tests de match, IGTF auto-detect, CSV import
