# ADR-026: Causación Automática de Facturas al Libro Mayor

**Estado:** Aprobado  
**Fecha:** 2026-05-11  
**Autor:** Gustavo / Claude  
**Afecta:** `InvoiceService`, `CompanySettings`, `InvoiceGLPostingService`

---

## Contexto

Las facturas registradas en ContaFlow generaban el `InvoiceTaxLine` correcto (base fiscal para Forma 30/IVA), pero **no creaban asiento contable** en el Libro Mayor (`Transaction` + `JournalEntry`). El campo `Invoice.transactionId` quedaba siempre `NULL`.

Consecuencias:
- Balance General incompleto (faltan CxC, Ingresos, IVA-DF, CxP, IVA-CF)
- `PendingTasksService` marcaba "Facturas sin asiento contable" como ERROR
- Violación del principio VEN-NIF de doble partida para toda operación fiscal

## Opciones consideradas

1. **Manual con UI** — El usuario aprueba cada asiento individualmente  
2. **Batch nocturno** — Job diario que postea facturas pendientes  
3. **Automático al crear** ← elegido  

## Decisión

Causación automática en el mismo `$transaction` que la creación de la factura, condicionada a que `CompanySettings` tenga las cuentas GL configuradas. Si falta alguna cuenta requerida, la factura se crea sin asiento y `PendingTasksService` la detecta.

## Diseño

### Nuevos campos en `CompanySettings`

| Campo | Tipo | Uso |
|---|---|---|
| `arAccountId` | `String?` | ASSET — Cuentas por Cobrar (facturas venta) |
| `apAccountId` | `String?` | LIABILITY — Proveedores (facturas compra) |
| `salesAccountId` | `String?` | REVENUE — ingreso por defecto |
| `purchaseExpenseAccountId` | `String?` | EXPENSE — gasto por defecto |
| `ivaDFAccountId` | `String?` | LIABILITY — IVA Débito Fiscal |
| `ivaCFAccountId` | `String?` | ASSET — IVA Crédito Fiscal |

### Asiento de venta (SALE)

```
Dr: CxC (arAccount)       = totalAmountVes
Cr: Ventas (salesAccount) = Σ taxLine.base   (negativo)
Cr: IVA-DF (ivaDFAccount) = Σ taxLine.amount (negativo, solo si > 0)
```

Invariante: `totalAmountVes = Σ base + Σ ivaAmount` por diseño de `InvoiceService`. Cuadre garantizado.

### Asiento de compra (PURCHASE)

```
Dr: Gasto  (purchaseExpenseAccount) = Σ taxLine.base
Dr: IVA-CF (ivaCFAccount)           = Σ taxLine.amount (solo si > 0)
Cr: CxP    (apAccount)              = totalAmountVes   (negativo)
```

### Verificación paranoica

`InvoiceGLPostingService.postInvoice()` calcula `Σ entries` antes de ejecutar el `tx.transaction.create`. Si el resultado no es 0 ± 0.01, lanza error (imposible en condiciones normales, pero protege contra bugs futuros).

### Atomicidad

`InvoiceService.create()` envuelve todas las escrituras (`invoice.create`, `createInvoiceLinesInTx`, `transaction.create`, `invoice.update`) en un único `$transaction({ timeout: 10000 })`. Si el caller ya provee `outerTx`, se usa el suyo.

### Guard: no doble-posteo

Si `input.transactionId` ya viene definido (el caller vincula una transacción existente), se omite el auto-posting para evitar duplicados.

## Consecuencias

- **Positivo**: Toda factura nueva con GL configurado queda causada en el mismo atomic write.
- **Positivo**: Balance General cuadrado desde la primera factura.
- **Positivo**: `PendingTasksService` dejará de mostrar ERROR para nuevas facturas.
- **Neutral**: Facturas existentes (≤2026-05-11) requieren `prisma/fix-invoice-gl.ts` para backfill.
- **Trade-off**: El `$transaction` interno agrega latencia (~50ms en Neon). Timeout 10s para cold start.
- **Limitación**: Una sola cuenta de ingreso/gasto por defecto. Multi-cuenta requiere líneas con `accountId` por ítem (roadmap post-lanzamiento).

## Notas de implementación

- `fix-invoice-gl.ts`: script one-time para causar facturas existentes sin asiento.
- `seed-demo.ts`: configura `CompanySettings` con cuentas del Plan de Cuentas demo.
- Migration: `prisma/migrations/20260511_invoice_gl_config/migration.sql`.
