# ADR-022 — PaymentBatch: Distribución de Pagos A/P (Fase 36C)

- **Estado**: DECIDIDO
- **Fecha**: 2026-05-05
- **Fase**: 36C
- **Depende de**: ADR-002 (Decimal), ADR-003 (onDelete Restrict), ADR-004 (companyId isolation), ADR-006 (Security hardening)

---

## Contexto

En ContaFlow, una empresa puede emitir una sola transferencia bancaria que cancela múltiples facturas de proveedor (A/P) de manera simultánea. El modelo `InvoicePayment` existente (Fase 16) vincula un pago a exactamente una factura (`invoiceId` NOT NULL). Aplicar N pagos individuales para cubrir N facturas genera N registros sin traza de que todos pertenecen a un mismo comprobante de transferencia — pérdida de trazabilidad para conciliación bancaria y para el libro auxiliar de proveedores.

**Caso motivador**: Empresa paga a un proveedor Bs. 500.000 en una sola transferencia que salda 3 facturas pendientes de Bs. 150.000, Bs. 200.000 y Bs. 150.000. Hoy requiere crear 3 `InvoicePayment` independientes con la misma referencia bancaria — no hay vínculo estructural entre ellos.

**Scope**: Solo A/P (facturas de proveedor). A/R (cuentas por cobrar) usa `InvoicePayment` directamente y no se toca.

---

## Hallazgo crítico pre-diseño: no existe modelo `PurchaseInvoice`

El schema actual no tiene un modelo `PurchaseInvoice`. Las facturas de proveedor se representan con `Invoice` donde `type = InvoiceType.PURCHASE`. `PaymentBatchLine.invoiceId` referencia a `Invoice` — **el service layer es el responsable de validar que `invoice.type === 'PURCHASE'` y que `invoice.companyId === batch.companyId`** antes de aplicar cualquier línea. El constraint de tipo no puede expresarse como FK en Prisma; se aplica en `PaymentBatchService.applyBatch()` como guard explícito.

---

## Decisiones

### D-1: Modelo `PaymentBatch` — cabecera

`PaymentBatch` representa el comprobante de pago único. Un lote en estado `DRAFT` es editable. Una vez `APPLIED`, es inmutable excepto para la operación de `VOID`. El monto total es un campo desnormalizado (`totalAmountVes`) — se valida en el service contra `SUM(lines.amountVes)` antes de aplicar. No hay CHECK constraint en DB para la suma (no es expresable con FKs en PostgreSQL de manera simple); la invariante vive en `PaymentBatchService.validateSumInvariant()`.

**Estado `DRAFT`**: el batch existe en DB pero no ha generado ningún `InvoicePayment` ni asiento. Las líneas pueden agregarse, editarse o eliminarse.

**Estado `APPLIED`**: el service ha creado un `InvoicePayment` por cada línea dentro de un mismo `$transaction` Serializable, ha actualizado `Invoice.pendingAmount` y `Invoice.paymentStatus` para cada factura, y ha creado los `AuditLog` correspondientes. El batch se vuelve inmutable.

**Estado `VOID`**: el batch fue anulado. Los `InvoicePayment` generados al aplicar deben marcarse con `deletedAt = now()` (soft-delete, patrón ya existente en `InvoicePayment.deletedAt`). Las facturas revierten su `pendingAmount` y `paymentStatus`. Los asientos contables se contrapartidean con un asiento de anulación. `voidReason` es obligatorio en el input Zod al hacer void.

### D-2: Modelo `PaymentBatchLine` — líneas

Cada línea apunta a una factura de proveedor (`Invoice.type = PURCHASE`) y contiene el monto que ese batch cancela de esa factura. El monto puede ser parcial (cancelación parcial) o total.

`igtfAmount` en `PaymentBatchLine` — ver D-6.

Al crear un `InvoicePayment` desde una línea, el service copia los datos del batch (`method`, `currency`, `exchangeRateId`, `referenceNumber`, `originBank`, `destBank`, `date`) más los datos de la línea (`amountVes`, `igtfAmount`). El `InvoicePayment.idempotencyKey` se genera como `batch:{batchId}:line:{lineId}` — garantiza que un reintento del apply no duplique pagos (idempotencia).

### D-3: FK `invoiceId` en `PaymentBatchLine` apunta a `Invoice` (no a un modelo separado)

**Decisión**: `invoiceId String` → `Invoice` con `onDelete: Restrict`.

El service implementa el guard explícito:
```typescript
// En PaymentBatchService.validateLines()
const invoice = await tx.invoice.findFirstOrThrow({
  where: {
    id: line.invoiceId,
    companyId: batch.companyId,     // guard multi-tenant (ADR-004)
    type: 'PURCHASE',               // guard A/P
    deletedAt: null,                // no anulada
  }
});
if (invoice.paymentStatus === 'VOIDED') {
  throw new BusinessError(`Factura ${invoice.invoiceNumber} está anulada`);
}
```

Este guard corre dentro del mismo `$transaction` Serializable de `applyBatch()`.

### D-4: Nivel de aislamiento

**`Serializable` obligatorio** para `applyBatch()` y `voidBatch()`.

Justificación: ambas operaciones leen y modifican `Invoice.pendingAmount` y `Invoice.paymentStatus`. Dos `applyBatch` concurrentes sobre la misma factura pueden causar sobrepago silencioso (ambos leen `pendingAmount = 100`, ambos restan `100`, el saldo queda en `-100`). SSI detecta el conflicto de escritura y falla la segunda transacción con P2034, que el service expone al frontend como "operación en conflicto — reintente".

`createBatch()` y `updateBatchLines()` en estado DRAFT no requieren Serializable — Read Committed es suficiente porque no hay invariante contable que proteger hasta el momento del apply.

### D-5: `VOID` no borra líneas

`PaymentBatch.status = VOID` jamás elimina `PaymentBatchLine` ni `InvoicePayment`. El soft-delete de `InvoicePayment` usa el campo `deletedAt` ya existente. Los registros históricos permanecen para auditoría. `voidedAt` y `voidedBy` en `PaymentBatch` documentan quién y cuándo anuló. Esta política es simétrica con el patrón VOID establecido en toda la aplicación (ADR-003).

### D-6: IGTF — ubicación en cabecera, distribución en líneas

**Decisión**: El campo `totalIgtfAmount` en `PaymentBatch` es el monto total de IGTF del pago. `PaymentBatchLine.igtfAmount` registra la porción de IGTF asignada a cada línea.

**Justificación**: El IGTF grava el medio de pago, no la factura individual. El total corresponde al batch completo. Sin embargo, para generar el `InvoicePayment` correcto por línea (que incluye `igtfAmount` para el libro fiscal), el service puede prorratear proporcionalmente o el usuario puede asignarlo manualmente. La responsabilidad de la distribución es del service; el schema solo almacena el resultado.

**Regla de consistencia**: `SUM(lines.igtfAmount) == totalIgtfAmount` — validada en `validateSumInvariant()` junto con la suma de `amountVes`.

### D-7: Sin correlativo propio para `PaymentBatch`

`PaymentBatch` no tiene número correlativo fiscal (no es un documento SENIAT). Se identifica con su `id` (CUID) y `referenceNumber` (la referencia bancaria del pago). No requiere `ControlNumberSequence` ni nivel Serializable por correlativo.

### D-8: Unicidad de líneas — una factura por batch

`@@unique([paymentBatchId, invoiceId])` en `PaymentBatchLine`. Una factura solo puede aparecer una vez por batch. Si se necesita distribuir pagos parciales de la misma factura en distintos batches, cada batch tiene su propia línea.

### D-9: Relación con `BankTransaction` (conciliación bancaria)

`PaymentBatch` tiene un campo opcional `bankTransactionId` para enlazar el batch con la línea del estado de cuenta bancario al conciliar (Fase 17). Este campo es nullable — un batch puede existir antes de que se importe el estado de cuenta. La relación es `PaymentBatch → BankTransaction` con `onDelete: Restrict`.

### D-10: `idempotencyKey` en `PaymentBatch`

Obligatorio para prevenir doble-submit desde la UI. El frontend genera un UUID v4 antes de llamar a `createBatchAction`. Si la acción se reintenta, el `@@unique` sobre `idempotencyKey` retorna P2002, que el service captura y convierte en "El lote ya fue creado — refresque la página".

---

## Alternativas descartadas

### A-1: Reusar `PaymentRecord` con array de `invoiceId`

`PaymentRecord` fue diseñado para pagos digitales simples (PagoMóvil, Zelle) vinculados a una factura. Agregarle un array de facturas rompe el modelo existente, requiere una migración destructiva y mezcla semánticas distintas. Descartado: viola SOLID-S y contamina el modelo de pagos digitales existente.

### A-2: Múltiples `InvoicePayment` con el mismo `referenceNumber`

Solución sin schema nuevo — solo convención de datos. Descartado: no hay relación estructural entre los pagos, imposible garantizar atomicidad (si el apply de la tercera factura falla, las primeras dos ya están aplicadas), y no hay `totalAmountVes` que verificar contra la suma. Genera deuda técnica en conciliación bancaria.

### A-3: Incluir A/R y A/P en el mismo modelo `PaymentBatch`

Un campo `direction: AP | AR` en el batch podría cubrir ambos casos. Descartado por YAGNI: A/R tiene flujos completamente distintos (la aplicación de pagos de clientes requiere lógica de retenciones IVA/ISLR que no aplica a A/P). Mezclar en un solo modelo aumenta la complejidad del service sin beneficio inmediato. Si A/R necesita batch en el futuro, se crea `PaymentBatchAR` como modelo separado o se extiende este ADR.

### A-4: IGTF solo en cabecera, sin campo en línea

Descartado porque `InvoicePayment.igtfAmount` (modelo existente que se genera por línea) es un campo relevante para el libro fiscal de cada factura. Si el IGTF no se distribuye a las líneas, los `InvoicePayment` generados quedan con `igtfAmount = null` y se pierde trazabilidad fiscal por factura.

---

## Consecuencias

### Positivas
- Atomicidad completa: o todas las facturas del batch quedan aplicadas o ninguna (Serializable `$transaction`).
- Trazabilidad bancaria: un batch = una referencia de transferencia = N facturas canceladas.
- Conciliación bancaria: `bankTransactionId` permite vincular directamente el batch a la línea del estado de cuenta.
- Idempotencia de apply: `InvoicePayment.idempotencyKey = batch:{id}:line:{id}` elimina riesgo de doble-pago en reintentos.
- Compatible con el soft-delete de `InvoicePayment` existente — VOID no requiere cambios al modelo `InvoicePayment`.

### Restricciones y riesgos
- La invariante `SUM(lines.amountVes) == totalAmountVes` vive en el service, no en DB. Un bug en `validateSumInvariant()` podría crear batches con monto inconsistente. Mitigado con tests de unidad explícitos para el invariante.
- No hay `PurchaseInvoice` en el schema — el guard `invoice.type === 'PURCHASE'` en el service es la única barrera entre A/P y A/R. Si ese guard falla, un batch A/P podría afectar una factura de venta. Mitigado con test de integración que verifica el guard.
- P2034 en `applyBatch` / `voidBatch` bajo concurrencia: el frontend debe mostrar botón de reintento. Patrón ya establecido en ADR-011 y ADR-021.
- Batches en `DRAFT` son editables — no hay versioning de líneas. Si dos usuarios del mismo tenant editan líneas de un mismo DRAFT concurrentemente, la última escritura gana. Aceptable para PYMEs (escenario improbable). Documentado como riesgo conocido.

---

## SCHEMA_AUDITOR checklist

- [x] Todas las relaciones a tablas contables tienen `onDelete: Restrict`
- [x] `onDelete: Cascade` AUSENTE
- [x] `totalAmountVes`, `amountVes`, `igtfAmount`, `commissionAmount` usan `Decimal @db.Decimal(19,4)`
- [x] `commissionPct` usa `Decimal @db.Decimal(5,2)`
- [x] `deletedAt DateTime?` en `PaymentBatch` — entidad fiscal con necesidad de soft-delete
- [x] `idempotencyKey String @unique` en `PaymentBatch` — previene doble-submit
- [x] Unicidad de negocio: `@@unique([paymentBatchId, invoiceId])` en `PaymentBatchLine` — scoped por batch
- [x] `@@index([companyId])`, `@@index([companyId, date])`, `@@index([paymentBatchId])`, `@@index([invoiceId])` presentes
- [x] `AuditLog` en mismo `$transaction` que `applyBatch()` y `voidBatch()` — mandatorio en service
- [x] Análisis de riesgo documentado (D-4, consecuencias)
- [x] Acciones destructivas (`applyBatchAction`, `voidBatchAction`) deben verificar `companyMember.role` — OWNER | ADMIN | ACCOUNTANT (ADR-006 D-1)
- [x] Campos de monto en Zod input tienen `.max()` ceiling (ADR-006 D-2) — `totalAmountVes.max('999999999999999')` (límite Decimal 19,4 con margen seguro)
- [x] No se acepta tasa impositiva del cliente (ADR-006 D-3) — no aplica a este módulo
- [x] `AuditLog` append-only — no `auditLog.update/delete` en ningún service nuevo (ADR-006 D-4)
- [x] `applyBatchAction` y `voidBatchAction` incluyen rate limiting `limiters.fiscal` (ADR-006 D-5)
- [x] `companyId` en todo `findMany`/`findFirst` de `PaymentBatch` y `PaymentBatchLine` (ADR-004)
- [x] Guard `invoice.type === 'PURCHASE'` y `invoice.companyId === batch.companyId` en service antes de crear `InvoicePayment`

---

## Nombre del branch sugerido

```
feat/fase-36c-payment-batch
```
