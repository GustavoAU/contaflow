# ADR-036 — Caja Chica: Custodio, Liquidación al Cierre y Validación de Tipos de Cuenta

- **Estado:** ACCEPTED
- **Fecha:** 2026-06-21
- **Fase:** Auditoría Caja Chica — Fase 2 (rama `feat/cajachica-custodio-cierre`)
- **Autor:** arch-agent
- **Relacionados:** ADR-035 (Caja Chica Fase 1 — índice parcial reembolsos), ADR-002 (Decimal), ADR-003 (onDelete Restrict), ADR-004 (companyId guard), ADR-006 (security), R-5/R-6, Z-2/Z-3
- **Hallazgos que resuelve:** HC-03 (custodio), HC-05/HC-06 (cierre sin liquidación ni confirmación), HC-09 (selector de cuenta sin filtro de tipo, raíz de HC-04)

## Contexto

El módulo de Caja Chica (Fase 35D) implementa un fondo fijo (imprest) con el flujo contable:

- `createDeposit`: **Dr** cuenta caja / **Cr** cuenta origen → sube el saldo GL de la cuenta caja.
- `postReimbursement`: **Dr** cuentas de gasto / **Cr** cuenta caja → baja el saldo GL de la cuenta caja.
- Saldo GL de la cuenta caja = Σ depósitos `POSTED` − Σ reembolsos `POSTED`.
- `closeCajaCaja` (`CajaCajaService.ts:149`) **hoy solo cambia `status` a `CLOSED` + AuditLog**. No genera asiento de liquidación (HC-05) ni pide confirmación (HC-06).

La auditoría externa (María F. Rojas, CPC 45.821, 2026-06-20) detectó tres deficiencias de control interno y contable que la Fase 2 debe cerrar:

1. **HC-03** — No hay responsable (custodio) del fondo. COSO exige que cada fondo fijo tenga un responsable identificable.
2. **HC-05/HC-06** — Cerrar una caja deja saldo GL "colgado" en la cuenta caja sin devolver el efectivo remanente a su origen (banco/caja general); además no hay confirmación.
3. **HC-09** (raíz de HC-04) — El selector de cuenta no filtra por tipo: se puede asignar un banco como "cuenta de la caja" o una cuenta no-gasto como "cuenta de gasto del movimiento". El diagnóstico previo "contabiliza contra banco" (HC-04) era un síntoma de esto.

## Decisiones

### D-1 (HC-03) — Custodio como FK a Employee

El custodio es una **FK nullable a `Employee`** con `onDelete: Restrict`.

- **Nullable en DB**: las cajas existentes (pre-Fase 2) no tienen custodio → la columna debe admitir `NULL` para no romper el backfill.
- **Requerido en el schema Zod de creación** de aquí en adelante: `createCajaCajaSchema` exige `custodianId` no vacío. La capa de datos tolera `NULL` (legacy), la capa de aplicación lo exige para cajas nuevas. La edición de una caja legacy debe permitir asignar el custodio faltante.
- `onDelete: Restrict` (ADR-003): un empleado que es custodio de una caja no puede borrarse — es trazabilidad de control interno. Coherente con todas las FK a `Employee` del schema (todas `Restrict`).
- **Guard cross-tenant (ADR-004)**: en el service hay que validar que el `Employee` resuelto pertenece al mismo `companyId` que la caja (mismo patrón que OM-08 con `inventoryItemId` en QuotationItem/OrderItem). No basta con la FK: un atacante podría pasar el `id` de un empleado de otra empresa.

Relación inversa en `Employee`: `cajaCajas CajaCaja[] @relation("CajaCajaCustodian")`.
Índice: `@@index([companyId, custodianId])` — soporta "cajas a cargo de X" y el Restrict-check al borrar empleado.

### D-2 (HC-05/HC-06) — Asiento de liquidación al cierre + trazabilidad

#### D-2.1 `closeTransactionId` — espejo de deposit/reimbursement

Se agrega `closeTransactionId String? @unique` FK → `Transaction` con `onDelete: Restrict`, idéntico patrón a `CajaCajaDeposit.transactionId` y `CajaCajaReimbursement.transactionId`. Es nullable porque:

- El cierre con remanente 0 **no genera asiento** (ver D-2.4) → la columna queda `NULL` legítimamente.
- Cajas cerradas antes de esta fase (si las hubiera) no tienen asiento de cierre.

`@unique` garantiza 1 asiento de liquidación por caja como máximo (idempotencia estructural).

#### D-2.2 `returnAccountId` — NO se persiste como columna

La cuenta de retorno se elige en el diálogo de cierre (decisión de negocio confirmada). **No se almacena como columna fija** en `CajaCaja` porque:

- Es un input puntual del acto de cierre, no un atributo permanente de la caja.
- Queda **plenamente trazada** en: (a) el `JournalEntry` Dr del `closeTransaction` (apunta a `returnAccountId`), y (b) el `AuditLog` del cierre (`newValue.returnAccountId`, `newValue.remainingAmount`). R-6 ya exige IP/UA en ese AuditLog.

Recuperar la cuenta de retorno = leer el asiento enlazado por `closeTransactionId`. No hay pérdida de información.

#### D-2.3 Cálculo del remanente — vía GL real, no sumando filas de la caja

El monto a liquidar = saldo GL remanente de la cuenta caja = **suma neta de los `JournalEntry` de la `Account` de la caja** dentro del `$transaction`, filtrando por `Transaction.status = POSTED`.

Recomendación: **consultar el GL real** (`SUM(JournalEntry.amount)` para `accountId = caja.accountId` con `transaction.status = POSTED` y `transaction.companyId = caja.companyId`), no recalcular sumando `deposits − reimbursements`. Razones:

- **El GL es la fuente de verdad** (R-1: el Libro Mayor manda). VOID ya revierte vía contrapartida POSTED, por lo que sumar entries POSTED da el saldo correcto sin lógica especial para VOIDED.
- Sumar `deposits POSTED − reimbursements POSTED` duplica una invariante que ya vive en el Mayor y puede divergir si algún flujo futuro toca la cuenta caja sin pasar por estos dos modelos.
- La convención del schema: `JournalEntry.amount` positivo = Débito, negativo = Crédito (`JournalEntry` línea 490). El saldo de una cuenta ASSET = Σ entries (débitos positivos − créditos en negativo). El remanente es directamente esa suma.

> Nota de implementación para ledger-agent: la cuenta caja es **ASSET**, su saldo natural es deudor (positivo). El remanente esperado es `>= 0`.

#### D-2.4 Diseño del asiento de liquidación

- **Asiento:** `Dr returnAccount (remanente) / Cr cuenta caja (remanente)`. Devuelve el efectivo de la caja chica a su origen y deja el saldo GL de la cuenta caja en 0.
- `type = DIARIO`, fecha = hoy, `description` = `"Liquidación de caja chica: {name}"`.
- **Remanente = 0:** **no se genera asiento** (un asiento de monto 0 viola `assertBalancedGLEntries` y no aporta nada). La caja pasa a `CLOSED`, `closeTransactionId` queda `NULL`, y el AuditLog registra `remainingAmount = 0`.
- **Remanente < 0:** **error de integridad** → abortar el cierre con mensaje de negocio ("La cuenta de la caja tiene saldo acreedor inesperado; revise los asientos antes de cerrar."). Un saldo negativo en una cuenta ASSET de caja chica indica corrupción contable (más reembolsos POSTED que depósitos), y nunca debería ocurrir bajo el guard de cierre existente (solo cierra si todo está `REIMBURSED`/`VOIDED`). No silenciar.
- **Validaciones del returnAccount** (server-side, dentro del tx):
  - Debe ser `type = ASSET` (devolución de efectivo → cuenta de activo: banco o caja general).
  - Debe ser `!= caja.accountId` (no liquidar contra sí misma → asiento sin efecto / posible auto-anulación).
  - Debe pertenecer al mismo `companyId` (ADR-004) y no estar soft-deleted (`deletedAt = null`).
- **AuditLog** en el mismo `$transaction` (R-6) con `action = "CAJA_CAJA_CLOSED"`, `newValue = { returnAccountId, remainingAmount, closeTransactionId }`, IP/UA.

#### D-2.5 Período e isolation level

- **Período:** usar el período `OPEN` actual (mismo patrón que `postReimbursement`). La fecha del asiento = hoy, y debe caer en el período OPEN. Reutilizar `PeriodService.assertDateInOpenPeriod` (introducido en Fase 1, HC-02) antes de postear. Si no hay período OPEN → error de negocio (Z-3).
- **Isolation level: `Serializable`.** El cierre crea una `Transaction` con correlativo (`@@unique([companyId, number])`) → Z-1 / regla "Serializable para correlativos". Es coherente con `postReimbursement`, que ya usa `Serializable`. Capturar P2002 en el correlativo con mensaje de negocio ("Error transitorio — intenta de nuevo.").

### D-3 (HC-09) — Validación de tipos de cuenta en el servidor

Defensa en servidor (el filtro de UI es complemento, no sustituto — ADR-006: nunca confiar en el cliente):

- **`createCajaCaja`**: `accountId` debe resolver a una `Account` con `type = ASSET`, mismo `companyId`, `deletedAt = null`. Si no → error de negocio.
- **`createMovement`**: `expenseAccountId` debe resolver a una `Account` con `type = EXPENSE`, mismo `companyId`, `deletedAt = null`.
- **`closeCajaCaja`**: `returnAccountId` debe ser `type = ASSET` (D-2.4).

**Helper compartido** (DRY): un guard reutilizable en el módulo, p. ej.:

```ts
// src/modules/caja-caja/services/account-type.guard.ts (esquema — lo implementa ledger-agent)
async function assertAccountOfType(
  tx: Prisma.TransactionClient,
  params: { accountId: string; companyId: string; expected: AccountType; label: string },
): Promise<Account> {
  const account = await tx.account.findFirst({
    where: { id: params.accountId, companyId: params.companyId, deletedAt: null },
  });
  if (!account) throw new BusinessError(`${params.label}: cuenta no encontrada.`);
  if (account.type !== params.expected) {
    throw new BusinessError(`${params.label} debe ser de tipo ${params.expected}.`);
  }
  return account;
}
```

El guard consulta `account.type` **dentro del `$transaction`** (consistencia con la mutación) y filtra por `companyId` (ADR-004) — un solo punto que cubre los tres call sites. El filtro de UI (cargar solo `type === "ASSET"` para cuentas de caja/retorno y `type === "EXPENSE"` para cuenta de gasto) lo hace ui-agent en `page.tsx`, pero **no es la línea de defensa**.

## Alternativas consideradas

- **Custodio como texto libre** (rechazada): pierde integridad referencial, no enlaza con el módulo de nómina/empleados, impide reportes "cajas por custodio" y no satisface COSO de forma auditable. La FK es marginalmente más cara (un join) pero correcta.
- **Persistir `returnAccountId` como columna en `CajaCaja`** (rechazada): es un input del acto de cierre, no un atributo de la caja. El asiento + AuditLog ya lo trazan; una columna sería información redundante y potencialmente inconsistente con el asiento.
- **Calcular remanente sumando `deposits − reimbursements`** (rechazada): duplica una invariante que ya vive en el Mayor (R-1). El GL real es la fuente de verdad y maneja VOID sin casos especiales.
- **Validar tipos solo en la UI** (rechazada): viola ADR-006 (no confiar en el cliente). Un POST directo a la action saltaría el filtro.
- **`Read Committed` para el cierre** (rechazada): el cierre genera correlativo de `Transaction` → Z-1 obliga `Serializable`.

## Consecuencias

**Positivas**
- Control interno COSO: cada fondo tiene custodio identificable y trazable.
- El cierre deja el GL consistente (saldo de la cuenta caja en 0) y devuelve el efectivo a su origen, con asiento balanceado y auditable.
- HC-09 cerrado de raíz: imposible asignar tipos de cuenta incorrectos, incluso por POST directo.
- Sin pérdida de información: cuenta de retorno trazada en asiento + AuditLog.

**Negativas / costos**
- Migración con 2 columnas + 2 FK + 1 índice único + 1 índice compuesto (ver SQL).
- `createCajaCajaSchema` ahora exige custodio → la UI de creación necesita el selector de empleados (ui-agent). Las cajas legacy sin custodio requieren un flujo de edición para asignarlo.
- Un empleado custodio no puede borrarse (Restrict) — comportamiento deseado, pero la UI de empleados debe dar un mensaje claro.

**Riesgo de migración**
- `ADD COLUMN ... NULL` + `ADD CONSTRAINT FK` son operaciones no destructivas. No hay backfill obligatorio (custodio nullable; sin asiento de cierre retroactivo).
- Si la migración falla a mitad: cada `ALTER`/`CREATE INDEX` es idempotente con `IF NOT EXISTS` / `IF EXISTS`. Re-ejecutable sin daño.
- Aplicación bajo VPN: por HTTP 443 con script `neon()` de un solo uso (ver memoria `migraciones-neon-vpn-http`) — `prisma migrate dev`/`db execute` están ROTOS bajo VPN (P1001 en TCP 5432).
- Filas afectadas: solo metadata (ALTER TABLE) — 0 filas de datos modificadas.

## Nota de numeración (gate security-agent Fase 2 — MEDIUM)
El número del asiento de liquidación `CCC-LIQ-NNNNNN` se deriva de `count()+1` (mismo patrón que depósitos/movimientos/reembolsos del módulo). **No es un correlativo fiscal SENIAT** (la liquidación de caja chica no es un documento fiscal emitido), por lo que NO aplica la regla Z-1 de `ControlNumberSequence`. Es un identificador interno; su unicidad está garantizada por `@@unique([companyId, number])` en `Transaction` + captura de P2002 → "Error transitorio". Si en el futuro `CCC-LIQ` se volviera fiscalmente relevante, migrar al patrón `getNextX`.

## Checklist SCHEMA_AUDITOR
- [x] FK a Employee (contable/fiscal) con `onDelete: Restrict`
- [x] FK a Transaction con `onDelete: Restrict`
- [x] Cascade ausente
- [x] Sin nuevos campos monetarios en schema (el remanente se calcula, no se almacena)
- [x] `@unique` en `closeTransactionId` (1 asiento por caja)
- [x] Índices en FK frecuentes (`custodianId`, `closeTransactionId`)
- [x] AuditLog existe y se enriquece en el cierre (R-6)
- [x] Guard cross-tenant (`companyId`) en custodio, returnAccount, expenseAccount (ADR-004)
- [x] Validación de tipos en servidor (ADR-006 — no confiar en cliente)
- [x] Riesgo de migración documentado
- [x] `Serializable` en el cierre (correlativo — Z-1)
```
