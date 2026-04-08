# ADR-008 — Ajuste por Inflación Fiscal (INPC / VEN-NIF 3)

- **Status**: DECIDED ✅
- **Date**: 2026-04-07
- **Author**: arch-agent
- **Phase**: Fase 22
- **Applies to**: INPCRate, InflationAdjustment, Company (inflationBase fields), runInflationAdjustmentAction

---

## Context

VEN-NIF 3 (equivalente a NIC 29) exige que los estados financieros de entidades que operan en economías hiperinflacionarias sean reexpresados en unidades de poder adquisitivo corriente al cierre de cada período. En Venezuela, el índice de referencia oficial es el INPC (Índice Nacional de Precios al Consumidor) publicado por el BCV/INE.

La reexpresión afecta **todas las partidas no monetarias**: activos, pasivos y patrimonio con naturaleza no monetaria, y también las partidas de resultado (ingresos y gastos) del período — estos últimos se reexpresan desde la fecha de la transacción hasta el cierre del período (factor de ajuste parcial).

El ajuste produce un asiento contable formal que debe quedar registrado en el libro mayor con el mismo rigor que cualquier otro asiento (`Transaction` + `TransactionLine`). Dejarlo sin respaldo contable constituye una violación de VEN-NIF 3 y del Código de Comercio venezolano.

---

## Decisiones

### D-1: transactionId NON-NULLABLE en InflationAdjustment

Cada fila de `InflationAdjustment` representa una línea de asiento de reexpresión. Sin el `transactionId` que la ancla a un `Transaction` registrado, el ajuste existe como dato flotante sin respaldo contable — violación de VEN-NIF 3.

**Regla**: `transactionId String` (no nullable). La transacción de ajuste se crea dentro del mismo `$transaction` de Prisma, antes de insertar los registros `InflationAdjustment`. Si la transacción falla, ambos rollback juntos.

Referencia: ADR-003 (onDelete: Restrict), ADR-005 (inmutabilidad contable).

### D-2: baseYear / baseMonth en InflationAdjustment (trazabilidad del índice base)

Cada registro almacena el período base (`baseYear`, `baseMonth`) utilizado para calcular el factor acumulado. Esto permite auditar el cálculo: `factor = INPC(periodYear, periodMonth) / INPC(baseYear, baseMonth)`.

Sin estos campos, una auditoría posterior no puede verificar el factor aplicado sin depender de que la fila `INPCRate` base exista — lo cual no está garantizado (un administrador podría corregir el índice histórico).

### D-3: inflationBaseYear / inflationBaseMonth en Company (base corporativa configurable)

La empresa define en qué período histórico ancla su base de reexpresión (típicamente el año de adopción de VEN-NIF 3 o el año de constitución). Este valor es corporativo — no varía por período de ajuste.

Campos: `inflationBaseYear Int?` e `inflationBaseMonth Int?` en el modelo `Company`. Nullable porque empresas creadas antes de Fase 22 no tienen este valor hasta que el ADMIN lo configure.

Migración separada: `add_inflation_base_to_company` — agrega dos columnas `Int?` a la tabla existente. Sin backfill requerido (nullable). Sin downtime.

### D-4: Scope de partidas ajustadas — TODOS los AccountType

`runInflationAdjustmentAction` ajusta cuentas de todos los tipos:

| AccountType | Tratamiento VEN-NIF 3 | Factor |
|---|---|---|
| ASSET | Partida no monetaria: reexpresión completa | INPC(cierre) / INPC(adquisición) |
| LIABILITY | Partida no monetaria: reexpresión completa | INPC(cierre) / INPC(adquisición) |
| EQUITY | Reexpresión completa | INPC(cierre) / INPC(base corporativo) |
| REVENUE | Partida de resultado: factor desde fecha de devengo | INPC(cierre) / INPC(mes de transacción) |
| EXPENSE | Partida de resultado: factor desde fecha de devengo | INPC(cierre) / INPC(mes de transacción) |

Las cuentas monetarias (efectivo, equivalentes, cuentas bancarias en moneda funcional) se **excluyen** del ajuste — son monetarias por definición. La distinción monetaria/no monetaria es responsabilidad del servicio de inflación, implementada via un flag o lista de cuentas excluidas (decisión de implementación, fuera del scope de este ADR).

**Consecuencia**: el scope incluye REVENUE y EXPENSE — corrección aprobada respecto al plan inicial que solo contemplaba activos no monetarios.

### D-5: Idempotencia vía @@unique([companyId, periodYear, periodMonth, accountId])

Un segundo llamado a `runInflationAdjustmentAction` para el mismo período y cuenta debe fallar con `P2002` (unique constraint), no crear un ajuste duplicado. El servicio debe capturar `P2002` y retornar un error de negocio descriptivo: "El ajuste por inflación para este período ya fue registrado."

Si se requiere re-ejecutar el ajuste (por corrección de índices INPC), el flujo correcto es:
1. VOID del `Transaction` de ajuste anterior (ADR-005).
2. Eliminar las filas `InflationAdjustment` asociadas (excepción controlada: estas filas son datos de ajuste, no asientos primarios — se pueden eliminar físicamente cuando su `Transaction` es VOIDado, dentro del mismo `$transaction`).
3. Generar el nuevo ajuste.

### D-6: Isolation level — Serializable obligatorio

`runInflationAdjustmentAction` lee saldos de cuentas del período (`TransactionLine` aggregates) y luego escribe `Transaction` + `TransactionLine` + `InflationAdjustment`. Existe riesgo de phantom read si dos ejecuciones concurrentes leen el mismo saldo antes de que una de ellas escriba el asiento. **Serializable mandatory** (ADR-001).

### D-7: Guard FiscalYearClose

Antes de ejecutar el ajuste, verificar que el `AccountingPeriod` para `(companyId, year, month)` no esté `CLOSED`. Mismo patrón que `recordPaymentAction`:

```typescript
const period = await tx.accountingPeriod.findFirst({
  where: { companyId, year: periodYear, month: periodMonth }
});
if (!period || period.status === 'CLOSED') {
  throw new Error('El período está cerrado. No se puede registrar el ajuste.');
}
```

### D-8: RLS — nuevas tablas bajo withCompanyContext (ADR-007)

Las tablas `INPCRate` e `InflationAdjustment` tienen `companyId` — deben ser incluidas en las políticas RLS de la migración de Fase 22. Todo `$transaction` que las toque debe envolver su body con `withCompanyContext(companyId, tx, ...)`.

Migraciones requeridas para RLS (igual que Fase 13D):
```sql
ALTER TABLE "INPCRate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "INPCRate"
  USING (
    "companyId" = current_setting('app.current_company_id', true)
    OR current_setting('app.current_company_id', true) IS NULL
    OR current_setting('app.current_company_id', true) = ''
  );

ALTER TABLE "InflationAdjustment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "InflationAdjustment"
  USING (
    "companyId" = current_setting('app.current_company_id', true)
    OR current_setting('app.current_company_id', true) IS NULL
    OR current_setting('app.current_company_id', true) = ''
  );
```

---

## Schema Prisma aprobado

### Corrección aplicada vs. propuesta original

`originalAmount` y `adjustmentAmount` cambian de `@db.Decimal(18, 2)` a `@db.Decimal(19,4)` — **ADR-002 compliance** (monetary fields must use 19,4 precision).

### INPCRate

```prisma
model INPCRate {
  id          String   @id @default(cuid())
  companyId   String
  year        Int
  month       Int
  indexValue  Decimal  @db.Decimal(18, 6)
  source      String?  @default("BCV")
  createdAt   DateTime @default(now())
  company     Company  @relation(fields: [companyId], references: [id], onDelete: Restrict)

  @@unique([companyId, year, month])
  @@index([companyId])
}
```

### InflationAdjustment

```prisma
model InflationAdjustment {
  id               String      @id @default(cuid())
  companyId        String
  periodYear       Int
  periodMonth      Int
  baseYear         Int
  baseMonth        Int
  accountId        String
  originalAmount   Decimal     @db.Decimal(19, 4)   // ADR-002: was Decimal(18,2)
  adjustmentAmount Decimal     @db.Decimal(19, 4)   // ADR-002: was Decimal(18,2)
  cumulativeIndex  Decimal     @db.Decimal(18, 6)
  transactionId    String                            // NON-NULLABLE — D-1
  createdAt        DateTime    @default(now())
  company          Company     @relation(fields: [companyId], references: [id], onDelete: Restrict)
  account          Account     @relation(fields: [accountId], references: [id], onDelete: Restrict)
  transaction      Transaction @relation(fields: [transactionId], references: [id], onDelete: Restrict)

  @@unique([companyId, periodYear, periodMonth, accountId])
  @@index([companyId, periodYear, periodMonth])
}
```

### Adición a Company

```prisma
// Fase 22: Base de reexpresión inflacionaria (VEN-NIF 3)
inflationBaseYear   Int?
inflationBaseMonth  Int?
inflationAdjustments InflationAdjustment[]
inpcRates            INPCRate[]
```

### Nombres de migración sugeridos

| Orden | Nombre |
|---|---|
| 1 | `add_inflation_base_to_company` |
| 2 | `add_inpc_rate_and_inflation_adjustment` |

Ejecutar en ese orden: la segunda migración referencia `Company` que ya existe; no hay dependencia entre ambas pero separar la adición de Company fields de la creación de tablas nuevas mantiene rollback granular.

---

## Contrato de función — runInflationAdjustmentAction

```typescript
// Owner: src/modules/inflation/actions/inflation.actions.ts

/**
 * Genera y registra el ajuste por inflación (VEN-NIF 3) para un período.
 *
 * Precondiciones:
 *   - El usuario debe ser ADMIN o ACCOUNTANT en la empresa (ADR-006 D-1)
 *   - El período NO debe estar CLOSED (D-7)
 *   - INPCRate para (companyId, periodYear, periodMonth) debe existir
 *   - INPCRate base (companyId, company.inflationBaseYear, company.inflationBaseMonth) debe existir
 *   - No debe existir InflationAdjustment para (companyId, periodYear, periodMonth) — idempotencia D-5
 *
 * Postcondiciones:
 *   - Transaction creada con type: AJUSTE, status: POSTED
 *   - TransactionLine[] creados (partida doble balanceada)
 *   - InflationAdjustment[] creados, uno por cuenta ajustada
 *   - AuditLog creado en el mismo $transaction
 *   - withCompanyContext aplicado (ADR-007)
 *
 * Isolation: Serializable (ADR-001 / ADR-008 D-6)
 * Rate limit: limiters.fiscal — 30/min (ADR-006 D-5)
 */
async function runInflationAdjustmentAction(
  input: RunInflationAdjustmentInput  // { companyId, periodYear, periodMonth }
): Promise<ActionResult<InflationAdjustmentSummary>>
```

---

## Consecuencias

**Positivas**:
- VEN-NIF 3 compliance: cada ajuste tiene respaldo contable obligatorio (transactionId non-nullable).
- Auditoría completa: baseYear/baseMonth en cada fila permite reconstruir el factor sin depender de datos externos.
- Idempotencia garantizada por constraint de BD — no por lógica de aplicación.
- Scope completo ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE — cumple norma.

**Negativas / costos operacionales**:
- `inflationBaseYear` y `inflationBaseMonth` en Company deben ser configurados por el ADMIN antes de ejecutar el primer ajuste — falta de configuración produce error de negocio explícito (no silencioso).
- Re-ejecución de un ajuste requiere VOID explícito + eliminación de filas `InflationAdjustment` — flujo más complejo que un simple upsert, pero necesario para preservar la integridad del libro mayor.
- Dos migraciones separadas en vez de una — overhead menor aceptado a cambio de rollback granular.

**Tablas afectadas por ADR-007 (RLS)**:
Las tablas `INPCRate` e `InflationAdjustment` se agregan a la lista de tablas bajo RLS (actualmente 14 tablas per ADR-007 §Tables under RLS). La lista pasa a 16 tablas. La migración de Fase 22 debe incluir `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` para ambas.
