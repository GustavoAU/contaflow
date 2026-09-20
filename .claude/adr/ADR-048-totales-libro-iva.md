# ADR-048 — Totales de columna del Libro de Compras/Ventas

**Estado:** Aceptado con criterio **pendiente de confirmar por el contador** (no hay texto legal en el repo)
**Fecha:** 2026-09-20
**Relacionados:** Z-2 (cálculo de impuestos), R-5 (cero flotantes), Providencia 0071, ADR-018 (alícuota adicional de lujo)

## Contexto

Al exportar por primera vez el Libro de Compras de mayo 2026 de la empresa demo, la fila **TOTALES** mostraba
Base 270,00 e IVA 43,20 mientras las filas sumaban Base 787.700,00 e IVA 63.037,60 (una línea era IVA Reducido 8 %).
La columna Total (850.737,60) sí sumaba todo, y el resumen por alícuota también.

Causas, verificadas en el código:

1. La fila TOTALES usaba solo `totalBaseGeneral` / `totalIvaGeneral` (tabla, PDF y Excel).
2. Lujo (`ADICIONAL_31`) se guarda como **dos** `InvoiceTaxLine` con la **misma base** (`IVA_GENERAL` + `IVA_ADICIONAL`);
   `InvoiceTaxLine` no tiene `luxuryGroupId`. La columna Total sumaba `base + monto` de todas las líneas y contaba esa
   base dos veces (base 1000 → 2310 en vez de 1310).
3. Las notas de crédito se guardan con importes **positivos** y `getBook` no miraba `docType`: sumaban.
4. Los totales se calculaban en el navegador con `parseFloat` (R-5).

## Decisión

Se calcula **una sola vez en `InvoiceService.getBook` con Decimal** y la pantalla, el PDF y el Excel solo lo leen.

- **Base** de una factura = general + reducida + exenta + `max(0, adicional − general)`: la base de lujo cuenta una vez
  (sin `luxuryGroupId`, la parte adicional que excede a la general se trata como base propia).
- **IVA** = suma de todas las alícuotas (general, reducida y adicional). **Total = Base + IVA**.
- **IGTF fuera del Total**: es un tributo aparte y tiene su columna. (Antes el Total de la pantalla lo incluía.)
- **`NOTA_CREDITO` resta** en los totales (×−1); `NOTA_DEBITO` y el resto suman. También el resumen por alícuota,
  las retenciones y el IGTF. Las **filas** conservan su magnitud positiva.
- Nuevos campos: `InvoiceBookRow.total` y `InvoiceBookSummary.totalBase|totalIva|totalAmount`. Se aplica a los dos
  caminos que arman filas (`getBook` y `getInvoiceBookPaginated`).

## A confirmar con el contador

1. ¿Las notas de crédito deben mostrarse con **signo negativo en la propia fila** del libro? Hoy restan solo en TOTALES.
2. ¿El Total del libro de ventas debe incluir el IGTF? (SIVIT lo excluye.)
3. La base exenta va en la misma columna Base; ¿debe ir aparte?

## Fuera de alcance (pendiente)

- Persistir `luxuryGroupId` (cambio de schema, arch-agent): permitiría el panel "31 % lujo" y la base única en la Forma 30.
- **TXT SIVIT** (`export-helpers.ts`): suma la base adicional dentro de Base16 (duplica) y su pie omite la adicional, y
  `SivitExportService` usa `.find()` y descarta líneas repetidas. Es un formato regulatorio: no se toca sin su especificación.
- Exclusión de facturas anuladas (`VOIDED`) en el libro: hoy solo filtra `deletedAt`.
- La ruta legacy de creación y las NC/ND suman `base + monto` de todas las líneas; un `IVA_ADICIONAL` manual duplicaría
  `totalAmountVes` y el asiento (`total − iva`).
