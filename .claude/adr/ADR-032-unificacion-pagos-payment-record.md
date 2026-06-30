# ADR-032 — Unificación de Pagos: `PaymentRecord` como entidad canónica

- **Estado**: DECIDIDO
- **Fecha**: 2026-06-10
- **Origen**: Auditoría 2026-06-10 — hallazgo crítico C2 (decisión tomada por el usuario)
- **Depende de**: ADR-030 (GL auto-posting de pagos), ADR-022 (PaymentBatch A/P), ADR-004 (aislamiento multi-tenant), ADR-002 (Decimal), ADR-003 (onDelete Restrict / VOID)

---

## Contexto

ContaFlow tiene DOS modelos de pago paralelos y divergentes:

| | `InvoicePayment` (receivables) | `PaymentRecord` (payments) |
|---|---|---|
| Punto de entrada | `ReceivableService.recordPayment` | `createPaymentAction` |
| Actualiza `Invoice.pendingAmount` / `paymentStatus` | ✅ (con guards: sobre-pago, año fiscal cerrado, `idempotencyKey`) | ❌ |
| Postea asiento GL | ❌ — el Libro Mayor NO refleja el cobro | ✅ vía `PaymentGLService` (ADR-030: Dr Banco / Cr CxC + IGTF + diferencial cambiario NIC 21 + retención IVA x cobrar Riesgo-6) |
| IGTF acumulado en factura | ❌ | ✅ |
| Adjuntos OCR (ADR-029) | ❌ | ✅ |
| Conciliación bancaria | ✅ (match tipo 1) | ✅ (match tipo 3) |

**Consecuencia del bug C2**: según la vía usada, el subledger CxC y el GL divergen.
- Solo `InvoicePayment` → cartera baja pero la cuenta CxC del Mayor queda inflada (violación de conciliación subledger↔GL, Art. 32-35 Código de Comercio).
- Solo `PaymentRecord` → el Mayor refleja el cobro pero `pendingAmount` no baja: el aging CxC muestra deuda ya cobrada.
- Ambas vías para el mismo cobro → **doble conteo** (saldo decrementado una vez, GL acreditado una vez, pero dos registros de pago).

**DECISIÓN DEL USUARIO**: `PaymentRecord` es la entidad canónica de pago. `InvoicePayment` se deprecia. `PaymentRecord` ya posee la infraestructura más completa (GL posting ADR-030, IGTF, NIC 21, adjuntos, conciliación, void con reverso GL) — lo único que le falta es la actualización de saldo, que es la pieza más pequeña de las dos.

---

## Decisiones

### D-1: `PaymentRecord` canónico — `InvoicePayment` deprecado

Todo registro de pago nuevo (cobro CxC y, post-F2, pago CxP individual) se crea como `PaymentRecord`. `InvoicePayment` entra en deprecación en 3 fases (D-2 a D-6) y queda al final como **archivo de solo lectura** — sus registros históricos ya impactaron `pendingAmount` y no se migran (ver D-6 y Alternativas A-3).

### D-2: F1 — `PaymentRecord` actualiza saldo en el MISMO `$transaction` (branch `feat/payment-record-saldo`, en implementación)

Cuando `PaymentRecord.invoiceId` está presente, `createPaymentAction` —dentro del MISMO `$transaction` que ya usa para crear el record, postear GL (ADR-030) y escribir `AuditLog`— ejecuta:

1. **Row lock**: `SELECT ... FOR UPDATE` sobre la fila `Invoice` ANTES de leer el saldo:
   ```sql
   SELECT "id" FROM "Invoice"
   WHERE "id" = $1 AND "companyId" = $2
   FOR UPDATE
   ```
   vía `tx.$executeRaw` — `companyId` en el WHERE es obligatorio (ADR-004).
2. **Guards** (paridad con `ReceivableService.recordPayment`, todos PRE-escritura):
   - **Factura anulada**: `deletedAt IS NOT NULL` o `paymentStatus = VOIDED` → rechazo.
   - **Año fiscal cerrado**: `FiscalYearCloseService.isFiscalYearClosed(companyId, invoice.date.getFullYear())` → rechazo (R-3).
   - **Sobre-pago**: `paymentAmount.greaterThan(currentPending)` → rechazo estricto, **tolerancia 0**.
3. **Actualización**: `pendingAmount = currentPending.minus(paymentAmount)` (Decimal.js — R-5); `paymentStatus = newPending.isZero() ? "PAID" : "PARTIAL"`.
4. Marca `appliedToInvoice = true` en el `PaymentRecord` creado (D-3).

**Nivel de aislamiento — Read Committed + row lock, NO Serializable.** Justificación: la única invariante es el saldo de UNA fila (`Invoice.pendingAmount`); `FOR UPDATE` serializa los escritores de esa fila sin el costo de P2034/reintentos de SSI. Es el mismo patrón ya establecido por `InvoiceLineService` sobre `InventoryItem` (stock/CPP). No hay correlativo involucrado → Z-1/ADR-001 no aplica. Dos cobros concurrentes sobre la misma factura se ejecutan en serie: el segundo lee el saldo ya decrementado y el guard de sobre-pago lo rechaza si excede.

### D-3: Campo `PaymentRecord.appliedToInvoice Boolean @default(false)`

```prisma
// En model PaymentRecord (ya aplicado en schema.prisma):
// ADR-032 F1: true si este pago decrementó Invoice.pendingAmount al crearse.
// Los registros legacy (pre-ADR-032) nunca tocaron el saldo → false.
// El void solo restaura saldo cuando appliedToInvoice = true.
appliedToInvoice   Boolean   @default(false)
```

**Por qué es imprescindible**: los `PaymentRecord` legacy (pre-F1) NUNCA decrementaron `pendingAmount`. Sin este marcador, anular un pago legacy "restauraría" un saldo que nunca se descontó → **corrupción del saldo** (la factura aparecería con más deuda de la real). `default(false)` es exactamente la semántica correcta para todas las filas existentes — la migración no requiere backfill.

### D-4: Void en espejo — `voidPaymentRecordAction`

`voidPaymentRecordAction` (dentro de su `$transaction` existente, que ya hace soft-delete + reverso GL vía `PaymentGLService.reversePaymentRecordGL` — ADR-030):

- Si `appliedToInvoice = true` y `invoiceId` presente: `SELECT ... FOR UPDATE` sobre la `Invoice`, `pendingAmount = pendingAmount.plus(amountVes)`, y recalcula `paymentStatus` en espejo (quedan otros pagos activos —canónicos aplicados o legacy— → `PARTIAL`; si no → `UNPAID`).
- Si `appliedToInvoice = false`: NO toca el saldo (pago legacy o sin factura).
- Nunca DELETE — void = soft-delete (`deletedAt` + `voidReason`) + asiento GL reverso (ya implementado, ADR-030). Patrón ADR-003.

### D-5: F2 — `recordPaymentAction` (receivables) delega en la vía canónica (siguiente sesión)

- `recordPaymentAction` deja de crear `InvoicePayment` y delega en la vía canónica de `PaymentRecord` (mismos guards, ahora con GL posting incluido).
- **Historial de pagos por factura** = unión de `InvoicePayment` legacy (solo lectura) + `PaymentRecord`. La UI no distingue origen salvo un badge "legacy".
- **Precondición para redirigir payables**: verificar que `PaymentGLService` cubra pagos de CxP individuales (facturas `type = PURCHASE`: Dr CxP `settings.apAccountId` / Cr Banco). Hoy `postPaymentRecordGL` asume cobro CxC (Dr Banco / Cr `arAccountId`); el asiento A/P solo existe en `postPaymentBatchGL` (ADR-022/030). El `TransactionType PAGO` ya existe (sprint Riesgo-6/9) — falta la rama A/P en el posting de `PaymentRecord` individual antes de redirigir pagos de compra.
- **Auditar call-sites de `recordPayment(tx)`**: `ReceivableService.recordPayment` acepta un parámetro `tx` opcional — al delegar, los flujos que componen el pago dentro de otra transacción no deben perder atomicidad.

### D-6: F3 — alerta `CXC_GL_DESCUADRE` + congelar `InvoicePayment` (post-F2)

- **Alerta de dashboard `CXC_GL_DESCUADRE`**: compara `Σ Invoice.pendingAmount` (SALE, no anuladas) vs saldo GL de la cuenta CxC (`settings.arAccountId`). Descuadre mayor a la tolerancia de redondeo → alerta en `PendingTasksWidget` (mismo patrón que `RETENCIONES_SIN_ASIENTO_GL` / `IGTF_GL_INCOMPLETO`).
- **Congelar escrituras a `InvoicePayment`**: ninguna ruta de código crea/actualiza `InvoicePayment` (deprecación total). El modelo permanece en el schema como archivo de solo lectura.
- **NO se migran datos legacy** de `InvoicePayment` a `PaymentRecord`: los registros históricos YA impactaron `pendingAmount` en su momento; re-aplicarlos como `PaymentRecord` con `appliedToInvoice = true` duplicaría el decremento, y postearles GL retroactivo alteraría períodos posiblemente cerrados (R-3). Se documenta como archivo histórico.

---

## Riesgo transicional explícito (entre F1 y F2)

Durante la ventana F1→F2, **ambas vías decrementan saldo**: `InvoicePayment` (UI receivables) y `PaymentRecord` con `invoiceId` (UI payments). Si un usuario registra el MISMO cobro por ambas UIs → doble decremento de `pendingAmount`.

**Mitigación**:
1. F2 se ejecuta INMEDIATAMENTE en la siguiente sesión — ventana mínima.
2. El guard de sobre-pago (tolerancia 0 en ambas vías) limita el daño: el segundo registro que exceda el saldo restante es rechazado. El doble registro solo es posible mientras el saldo lo permita, y queda trazado en `AuditLog` para corrección vía void.

Riesgo aceptado por el usuario como parte del plan por fases.

---

## Invariantes (verificación pre-flight)

- **R-5**: todos los cálculos de saldo con `Decimal.js` — cero `number` nativo.
- **R-6**: `AuditLog` con `ipAddress`/`userAgent` en el MISMO `$transaction` — ya cumplido en `createPaymentAction`; el payload de AuditLog se enriquece con `appliedToInvoice` (paridad con `recordPayment`).
- **Sobre-pago**: rechazo estricto, tolerancia 0.
- **Nunca DELETE**: void = soft-delete + asiento GL reverso (ya implementado ADR-030).
- **R-3**: guard de año fiscal cerrado en F1 (paridad con `recordPayment`); `postPaymentRecordGL` ya exige período OPEN.
- **ADR-004**: `companyId` en el `SELECT ... FOR UPDATE` y en todo `findFirst` del flujo.

---

## Migración F1

Workflow manual obligatorio (`prisma migrate dev` ROTO — ver CLAUDE.md):

```
prisma/migrations/20260610_payment_record_applied/migration.sql
```

```sql
ALTER TABLE "PaymentRecord" ADD COLUMN "appliedToInvoice" BOOLEAN NOT NULL DEFAULT false;
```

**Análisis de riesgo**:
- **Additiva pura** — una sola sentencia, sin backfill: `DEFAULT false` es semánticamente correcto para el 100% de las filas legacy (ninguna decrementó saldo). Si la migración falla a mitad, no hay estado intermedio (un solo `ALTER`); rollback = `DROP COLUMN`.
- **Índices**: no se requieren nuevos — `appliedToInvoice` solo se lee por PK en el void (`findFirst({ id, companyId })`); nunca es filtro de listado.
- **Filas afectadas**: todas las de `PaymentRecord` reciben el default; operación O(filas) trivial en Neon para el volumen actual (PYME).

Aplicar: `npx prisma db execute --file ...` → `npx prisma migrate resolve --applied 20260610_payment_record_applied` → `npx prisma generate` → reiniciar `npm run dev`.

---

## Alternativas descartadas

### A-1: `InvoicePayment` canónico (agregarle GL posting)

Simétrica a la decisión tomada. Descartada: `PaymentRecord` ya concentra GL posting (ADR-030 con IGTF + NIC 21 + retención IVA Riesgo-6), adjuntos OCR (ADR-029), conciliación bancaria y void con reverso GL. Portar todo eso a `InvoicePayment` es reescribir ADR-030 completo; portar la actualización de saldo a `PaymentRecord` son ~40 líneas con guards ya especificados.

### A-2: Serializable en F1 en vez de `FOR UPDATE`

Descartada para esta operación: la invariante es de UNA fila, sin correlativos (Z-1 no aplica). SSI agregaría P2034 + reintentos en UI sin ganancia de corrección sobre el row lock. Precedente: `InvoiceLineService` + `InventoryItem`. Nota: `PaymentBatchService` (ADR-022 D-4) permanece Serializable — toca N facturas por batch y no se modifica en este ADR.

### A-3: Migrar datos legacy `InvoicePayment` → `PaymentRecord`

Descartada: los `InvoicePayment` históricos ya decrementaron `pendingAmount`; recrearlos como `PaymentRecord` aplicado duplicaría el decremento, y generar sus asientos GL retroactivos contaminaría períodos potencialmente cerrados (R-3). El historial se expone como unión de solo lectura (D-5).

### A-4: Trigger de base de datos para sincronizar saldo

Descartada: la lógica de guards (año fiscal cerrado vía `FiscalYearCloseService`, sobre-pago con mensaje de negocio, AuditLog R-6) no es expresable en un trigger sin duplicar reglas de dominio en SQL. Viola el patrón establecido: invariantes de negocio viven en el service layer dentro del `$transaction`.

---

## Consecuencias

### Positivas
- Una sola vía de pago: subledger CxC y GL siempre cuadran a partir de F2 (cobro decrementa saldo Y postea Dr Banco / Cr CxC atómicamente).
- `appliedToInvoice` hace el void seguro tanto para records nuevos como legacy — sin corrupción de saldo.
- Alerta `CXC_GL_DESCUADRE` (F3) detecta cualquier divergencia residual o futura regresión.
- Migración F1 trivial y reversible.

### Restricciones y riesgos
- Ventana F1→F2 con doble vía activa (riesgo de doble decremento — mitigado, ver sección de riesgo transicional).
- `postPaymentRecordGL` aún no cubre A/P individual — precondición bloqueante de F2 para payables (D-5).
- El historial unificado (F2) agrega complejidad de lectura (unión de dos modelos) — aceptado, es solo lectura.
- `InvoicePayment` permanece en el schema indefinidamente como archivo — deuda de schema aceptada a cambio de no tocar datos históricos.
- **Idempotencia (revisión externa de ADRs, hallazgo 6 — MEDIO-ALTO).** El campo
  `idempotencyKey String? @unique` **ya existe** en `PaymentRecord` (schema) y
  `PaymentService.create` lo persiste si se le pasa. **Pero el flujo robusto aún NO está
  cerrado:** (a) el cliente debe generar el UUID *antes* de `createPaymentAction` y (b)
  `PaymentService.create` debe capturar `P2002` sobre `idempotencyKey` y devolver el record
  existente — patrón ADR-022 D-10 (`PaymentBatchService` línea ~287). Hoy esa captura NO
  está en la vía individual, así que un reintento por timeout de red / doble pestaña / POST
  directo crea un **segundo pago real** mientras el saldo lo permita (el guard de sobre-pago
  solo frena cuando se *excede* el saldo, no en pagos parciales legítimos; `disabled={isPending}`
  es solo UI y no sobrevive un retry de red). **Requisito firme (no "evaluar") ANTES de que
  F2 redirija receivables/payables a la vía canónica:** generar UUID en cliente + capturar
  P2002 en el service. Subtileza: la captura debe resolver el lookup del record existente
  *fuera* de la transacción abortada (un P2002 dentro del `$transaction` lo deja en estado
  abort) — pre-check por `idempotencyKey` o reintento en tx nueva. **Estado: PENDIENTE F2**
  (danger-zone Z-2 → requiere security-agent + tests; no se cierra en una pasada de ADRs).

---

## SCHEMA_AUDITOR checklist

- [x] Relaciones a tablas contables con `onDelete: Restrict` — sin cambios de relaciones en F1 (solo columna booleana)
- [x] `onDelete: Cascade` AUSENTE
- [x] Montos siguen en `Decimal @db.Decimal(19,4)` — el campo nuevo es `Boolean`, no monetario
- [x] `deletedAt` ya existe en `PaymentRecord` (void = soft-delete, ADR-030)
- [x] Idempotencia: `idempotencyKey @unique` YA en schema; captura P2002 + UUID cliente PENDIENTE F2 (ver Restricciones, hallazgo 6)
- [x] Índices: sin nuevos — `appliedToInvoice` no es filtro de listado; `@@index([invoiceId])` ya existe
- [x] `AuditLog` en mismo `$transaction` (R-6)
- [x] Análisis de riesgo de migración documentado (additiva, sin backfill, rollback = DROP COLUMN)
- [x] Acciones destructivas (`voidPaymentRecordAction`) verifican `companyMember.role` (ADR-006 D-1) — ya implementado en payments
- [x] Montos en Zod input con `.max()` ceiling (ADR-006 D-2) — sin campos nuevos de monto
- [x] No se acepta tasa impositiva del cliente (ADR-006 D-3) — no aplica
- [x] `AuditLog` append-only (ADR-006 D-4)
- [x] Mutación financiera con rate limiting `limiters.fiscal` (ADR-006 D-5) — ya presente en `createPaymentAction`
- [x] `companyId` en todo `findFirst`/`findMany` y en el `SELECT ... FOR UPDATE` (ADR-004)

---

## Branches

```
F1: feat/payment-record-saldo        (en implementación)
F2: feat/payment-unify-receivables   (siguiente sesión)
F3: feat/cxc-gl-descuadre-alert      (post-F2)
```
