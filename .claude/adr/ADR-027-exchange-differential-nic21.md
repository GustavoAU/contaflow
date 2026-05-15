# ADR-027: Diferencial Cambiario NIC 21 / VEN-NIF BA-5

**Estado:** Aceptado  
**Fecha:** 2026-05-15  
**Rama:** feat/bloque-a-factura-asiento (Bloque C, ítem 3)

---

## Contexto

ContaFlow opera en Venezuela donde la moneda funcional es el Bolívar (VES) pero muchas empresas facturan y cobran en USD (dólar BCV). La NIC 21 «Efectos de las Variaciones en las Tasas de Cambio de la Moneda Extranjera» y la norma venezolana VEN-NIF BA-5 exigen que al cierre de cada período se revalen los saldos monetarios en moneda extranjera a la tasa de cierre, reconociendo la diferencia como ganancia o pérdida en el estado de resultados.

**Situación previa (gap):**
- Las facturas en USD registran `totalAmountVes` a la tasa de la fecha de emisión.
- No existía mecanismo para revaluar los saldos de CxC/CxP en USD al cierre del período.
- Las cuentas `fxGainAccountId` y `fxLossAccountId` no existían en `CompanySettings`.

---

## Decisión

### Alcance: Revaluación periódica (no diferencial realizado)

Se implementa la revaluación **no realizada** (unrealized) al cierre de período como asiento de ajuste de tipo `AJUSTE`. El diferencial realizado en el momento del cobro/pago queda fuera del alcance de esta versión por requerir GL-posting de pagos (no implementado).

### Algoritmo de cálculo

Para cada factura abierta en moneda extranjera (`paymentStatus IN [UNPAID, PARTIAL]`, `currency != VES`):

```
foreignTotal    = invoice.totalAmountVes / invoice.exchangeRate.rate
paidForeign     = Σ(invoicePayment.amountOriginal ?? ip.amount / originalRate)
outstanding     = foreignTotal - paidForeign

vesAtOriginal   = outstanding × originalRate
vesAtReval      = outstanding × revalRate
differential    = vesAtReval - vesAtOriginal
```

### Asiento contable generado

| Tipo    | differential > 0 (devaluación)         | differential < 0 (apreciación)           |
|---------|----------------------------------------|------------------------------------------|
| SALE    | Dr CxC / Cr Ganancia Cambiaria         | Dr Pérdida Cambiaria / Cr CxC            |
| PURCHASE| Dr Pérdida Cambiaria / Cr CxP          | Dr CxP / Cr Ganancia Cambiaria           |

**Invariante GL:** `netCxC + (-netCxP) + (-totalFxGain) + totalFxLoss = 0` ✓

El asiento se registra como `Transaction.type = "AJUSTE"` con número `FX-REVAL-YYYYMM`.

### Guard anti-duplicación

Antes de registrar se verifica que no exista ya un `Transaction` con `number = FX-REVAL-YYYYMM` en la empresa. Si existe, se devuelve error descriptivo al usuario.

### Configuración GL

Se añaden dos campos opcionales a `CompanySettings`:
- `fxGainAccountId` → cuenta REVENUE para ganancia cambiaria
- `fxLossAccountId` → cuenta EXPENSE para pérdida cambiaria

El formulario GL en `Configuración → Libro Mayor` expone estos campos como sección «Diferencial Cambiario (NIC 21 / VEN-NIF BA-5)» marcada como «Opcional».

---

## Alternativas Descartadas

### A. Diferencial realizado en momento del pago
Requiere añadir GL-posting de pagos (actualmente `PaymentRecord` no genera asientos). Se difiere a una fase posterior.

### B. Revaluación automática al cerrar período
Más conveniente para el usuario pero introduce efectos secundarios en el flujo de cierre (`FiscalYearClose`). Se prefiere acción manual explícita para dar control al contador.

---

## Consecuencias

- **Nuevas columnas:** `CompanySettings.fxGainAccountId`, `fxGainAccountId` (FK a `Account`).
- **Nuevo servicio:** `ExchangeDifferentialService` con `calculate()` + `post()` + `aggregate()`.
- **Nueva página:** `/company/[id]/fx-revaluation` accesible por roles ACCOUNTING+.
- **AuditLog:** cada asiento de revaluación registra `ipAddress`, `userAgent` y metadatos del cálculo (R-6 compliant).
- **R-5:** Todo el cálculo usa `Decimal.js` — ningún `number` en variables monetarias.
- **Sin cambio de correlativo:** Número `FX-REVAL-YYYYMM` no usa `ControlNumberSequence`.

---

## Referencias

- NIC 21 (IFRS Foundation) §23-28: Partidas monetarias
- VEN-NIF BA-5: Efectos de la hiperinflación en diferencias de cambio
- ADR-026: Causación automática de facturas (precursor GL)
- CLAUDE.md Zona Z-2: Cálculo de impuestos — Decimal.js obligatorio
