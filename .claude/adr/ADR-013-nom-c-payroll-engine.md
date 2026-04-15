# ADR-013 — NOM-C: Motor de Cálculo de Nómina — Decisiones Arquitectónicas

**Fecha:** 2026-04-15
**Estado:** DECIDIDO
**Fase:** NOM-C — Motor de Cálculo de Nómina
**Basado en:** security-agent audit (NOM-C-01 a NOM-C-18) + arch-agent design session

---

## Decisión 1 — Doble-proceso: Read Committed + P2002 (no Serializable)

**Decidido:** `@@unique([companyId, periodStart, periodEnd])` + captura de P2002 es suficiente.

**Razonamiento:** No es un ciclo read-modify-write sobre estado compartido (a diferencia de `getNextControlNumber` del ADR-001). El INSERT simplemente falla con P2002 si el run ya existe — PostgreSQL garantiza atomicidad del constraint. El catch DEBE mapear P2002 a mensaje amigable: `"Ya existe un proceso de nómina para este período"`.

**Diferencia con ADR-001:** `getNextControlNumber` hace SELECT → cálculo → UPDATE sobre un valor que DEBE ser consistente. `createPayrollRun` hace INSERT puro; el constraint DB es el mutex.

---

## Decisión 2 — Snapshot de salario: FK + snapshot (opción C)

**Decidido:** `PayrollRunLine` almacena `salaryHistoryId` (FK para trazabilidad) Y `salarySnapshotAmount` (snapshot inmutable del monto).

**Razonamiento:** Si alguien inserta un `SalaryHistory` con `effectiveFrom` anterior al período ya calculado, el run histórico NO debe cambiar. El `salarySnapshotAmount` es la verdad inmutable. La FK `salaryHistoryId` permite responder "¿qué registro era vigente al calcular?".

**Regla de vigencia:** el calculador usa `max(effectiveFrom) <= periodStart` para determinar el salario correcto. La fecha de corte es `periodStart`, no `now()`.

---

## Decisión 3 — Cuentas contables: configurables en PayrollConfig

**Decidido:** 5 campos nullable en `PayrollConfig`: `expenseAccountId`, `payableAccountId`, `ivssPayableAccountId`, `faovPayableAccountId`, `incesPayableAccountId`.

**Razonamiento:** El plan de cuentas es por empresa. No existe código de cuenta universal para Venezuela. Sin las 5 cuentas configuradas, `approvePayrollRunAction` lanza error explicativo antes de crear el asiento.

**UI:** El wizard NOM-A (PayrollWizard) se extiende con un paso adicional "Cuentas Contables" post-NOM-C, o se muestra un warning en el detalle del run.

---

## Decisión 4 — Asiento consolidado por run (no por empleado)

**Decidido:** Un solo `Transaction` con múltiples `JournalEntry` por `PayrollRun`.

**Razonamiento:** YAGNI. La descripción del asiento incluye período y `employeeCount`. Si en el futuro se requiere detalle por empleado, se crea un campo auxiliar o tabla de detalle de asiento.

**Estructura del asiento:**
```
DÉBITO   expenseAccount        totalEarnings
CRÉDITO  payableAccount        totalNet
CRÉDITO  ivssPayableAccount    Σ IVSS_OBR lines
CRÉDITO  faovPayableAccount    Σ FAOV_OBR lines
CRÉDITO  incesPayableAccount   Σ INCES_OBR lines
```
Verificación: `totalDebits === totalCredits` dentro del `$transaction`.

---

## Decisión 5 — approve(): Read Committed + updateMany mutex (no Serializable)

**Decidido:** `updateMany({ where: { id, companyId, status: 'DRAFT' } })` es el mutex atómico.

**Razonamiento:** La transición de estado es sobre una sola fila. `updateMany` con predicado `status: 'DRAFT'` es atómico bajo Read Committed: si la segunda transacción concurrente llega después del commit de la primera, `count === 0` y se lanza error. Sin ciclo read-modify-write sobre estado compartido entre múltiples filas → Serializable no aporta garantías adicionales.

**Diferencia con closePeriodAction:** el período contable tiene checks adicionales (¿existen entradas sin balance?) que sí requieren Serializable. `approvePayrollRun` solo cambia el status de una fila + crea registros nuevos — no hay lectura previa que deba ser consistente con el UPDATE.

---

## Decisión 6 — DDD boundary: Server Action como orquestador

**Decidido:** `approvePayrollRunAction` es el único punto donde se cruzan los bounded contexts `payroll` y `accounting`.

**Patrón:** La action llama directamente a `prisma.transaction.create` y `prisma.journalEntry.createMany` dentro del mismo `$transaction`. Ningún service del módulo `payroll` importa nada del módulo `accounting` y viceversa.

---

## Decisión 7 — ISLR en NOM-C

**Decidido:** `ISLR_RET` NO se calcula automáticamente en NOM-C. Es un `ManualConceptInput` ingresado por el contador.

**Razonamiento:** El cálculo correcto de ISLR requiere la Declaración Anual de Rentas del empleado (ARI / ARCV) — datos disponibles solo anualmente. El motor NOM-C no tiene acceso a esa información. El cálculo automático es alcance de NOM-D.

---

## Decisión 8 — Estados de PayrollRun

```
DRAFT → APPROVED → PAID (futuro NOM-D)
  ↓
CANCELLED (solo desde DRAFT)
```

Un run `APPROVED` **no es cancelable** directamente — requiere un `voidPayrollRunAction` separado (NOM-C residual o NOM-D) que crea asiento de reversión antes de cancelar. Un run `PAID` **nunca es cancelable**.

---

## Tasas legales (constantes inmutables — ADR-006 D-3)

Las siguientes tasas son constantes en `PayrollCalculatorService`. **NUNCA provienen del input del cliente.**

```typescript
const IVSS_WORKER_RATE = new Decimal('0.04');    // 4% — LSS Art. 62
const INCES_RATE = new Decimal('0.02');           // 2% — Ley INCES Art. 30
const FAOV_WORKER_RATE = new Decimal('0.01');     // 1% — LAH Art. 172
const HE_DAY_MULTIPLIER = new Decimal('1.5');     // 50% recargo — LOTTT Art. 118
const HE_NIGHT_MULTIPLIER = new Decimal('1.75');  // 75% recargo — LOTTT Art. 118
```

Los flags `ivssEnabled/incesEnabled/banavihEnabled` de `PayrollConfig` controlan si el concepto aplica (booleano), no la tasa.

---

## Findings de security-agent resueltos en diseño

| Finding | Severidad | Resolución |
|---|---|---|
| NOM-C-01 IDOR | CRITICAL | `findFirst({ where: { id, companyId } })` en todo service |
| NOM-C-02 doble-proceso | CRITICAL | P2002 capturado + msg amigable (Decisión 1) |
| NOM-C-03 approve concurrente | CRITICAL | `updateMany` mutex (Decisión 5) |
| NOM-C-04 cancel sobre APPROVED | CRITICAL | Solo DRAFT es cancelable; APPROVED requiere void futuro |
| NOM-C-05 horas negativas | HIGH | Zod: `hours.min(0).max(744)` |
| NOM-C-06 periodEnd futuro | HIGH | Zod: `periodEnd <= today + 45 días` |
| NOM-C-07 conceptId cross-tenant | HIGH | Calculador usa solo `getSystemConcepts(companyId)` |
| NOM-C-08 rate limiting | HIGH | `checkRateLimit(limiters.fiscal)` en create/approve/cancel |
| NOM-C-09 roles | HIGH | create/approve/cancel = ADMIN_ONLY; list/get = ACCOUNTING |
| NOM-C-10 netPayable negativo | HIGH | Guard pre-INSERT en PayrollRunService |
| NOM-C-11 AuditLog | HIGH | `auditLog.create` en mismo `$transaction` de create/approve/cancel |
| NOM-C-12 tasas desde cliente | HIGH | Constantes internas (Decisión 7 y este ADR) |
| NOM-C-13 período cerrado | MEDIUM | Guard `AccountingPeriod.status !== 'CLOSED'` en create/approve |
| NOM-C-14 totales desde cliente | MEDIUM | Calculados server-side, nunca del input |
| NOM-C-15 ConceptService AuditLog | MEDIUM | Fixed en mismo branch (residual NOM-B) |
| NOM-C-16 salary amount max | MEDIUM | Fixed en AddSalarySchema (residual NOM-B) |
| NOM-C-17 paginación | LOW | `list()` sin `include: { lines }` |
| NOM-C-18 terminate rate limit | LOW | Fixed en terminateEmployeeAction (residual NOM-B) |
