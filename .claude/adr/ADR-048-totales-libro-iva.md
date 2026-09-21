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

### Consumidores del `summary` (revisión fiscal independiente, 2026-09-20)

Como el `summary` pasó a ir firmado, se revisó cada lector; dos eran regresiones reales y se corrigieron:

- **TXT SIVIT** (`buildInvoiceBookTXT`): las líneas imprimen las NC sin signo (tipo `03`) y el pie leía el `summary`
  ya neteado, así que con cualquier NC el archivo no cuadraba consigo mismo. El pie ahora suma **las celdas
  impresas** (Decimal), no el `summary`. Los importes por línea no se tocaron.
- **Panel de resumen por alícuota**: ocultaba la fila cuando el neto era `<= 0`; un mes con más NC que facturas
  de esa alícuota desaparecía. Ahora solo se oculta el cero exacto.
- **PDF**: la fila TOTALES era una sola celda con un `flex` igual al nº de columnas; midiendo las coordenadas del
  PDF real, las cifras quedaban **32 pt** a la izquierda de su columna (react-pdf no reparte ese peso como la suma
  de las columnas que reemplaza). Ahora TOTALES se emite celda por celda con los mismos estilos que la cabecera y
  las filas; medido después: 0 pt de desfase en Compras y en Ventas.
- El ZIP SIVIT (`SivitExportService`) tiene su propia consulta y no lee el `summary`; ni Forma 30 ni el dashboard
  llaman a `getBook`.

## A confirmar con el contador

1. ¿Las notas de crédito deben mostrarse con **signo negativo en la propia fila** del libro? Hoy restan solo en TOTALES.
2. ¿El Total del libro de ventas debe incluir el IGTF? (SIVIT lo excluye.)
3. La base exenta va en la misma columna Base; ¿debe ir aparte? (Con base 700 e IVA 80 la fila no cuadra por
   alícuota; la alternativa es "Base gravada" + columna "Exento", con el mismo Total.)
4. Facturas anuladas: hoy el libro excluye `deletedAt` (y nada escribe `paymentStatus = VOIDED` en facturas). ¿Deben
   figurar con montos en cero para no dejar huecos en el correlativo?

Recomendación para 1: signo negativo en la propia fila, así Σ de la columna visible = TOTALES. No se hizo porque
cambiaría también las líneas del TXT SIVIT (regulatorio) y el criterio es del contador.

## Fuera de alcance (pendiente)

- **Prioridad alta — total inflado al CREAR facturas de lujo por el formulario.** `InvoiceForm` envía `taxLines`
  sin `lines`, o sea la ruta legacy de `InvoiceService.create` (`totalAmountVes = Σ(base + monto)` de todas las
  líneas, ~línea 254), y el par `IVA_GENERAL`/`IVA_ADICIONAL` lleva la misma base: base 1000 → `totalAmountVes` 2310
  (correcto 1310), `pendingAmount` y el asiento (Ingresos 2000 / CxC 2310) heredan el error; el subtotal del
  formulario (`InvoiceForm.tsx:461`) y `igtfBase` también suman la base dos veces. La ruta con `lines` sí da 1310.
  El libro, tras este ADR, muestra el valor correcto, así que difiere de CxC. Va en su propia rama (toca creación,
  GL y datos ya guardados: requiere data-fix).

- Persistir `luxuryGroupId` (cambio de schema, arch-agent): permitiría el panel "31 % lujo" y la base única en la Forma 30.
- **TXT SIVIT** (`export-helpers.ts`): las líneas suman la base adicional dentro de Base16 (duplica la base de lujo)
  y `SivitExportService` usa `.find()` y descarta líneas repetidas (una factura mixta da 730 en el ZIP contra 1890 en
  el libro). Es un formato regulatorio: no se tocan las líneas sin su especificación. El pie ya es coherente con ellas.
- Exclusión de facturas anuladas (`VOIDED`) en el libro: hoy solo filtra `deletedAt`.
- ~~La ruta legacy de creación y las NC/ND suman `base + monto`...~~ RESUELTO 2026-09-20, ver el addendum.

## Addendum 2026-09-20 — el criterio pasa a `src/lib/invoice-amounts.ts` (rama `fix/factura-lujo-total`)

`invoiceBaseAndIva` / `invoiceTotalAmount` (módulo puro, solo decimal.js) reemplazan a `bookAmounts` y son la fuente única
del criterio de lujo. Se aplican en: creación legacy (`InvoiceService.create`, la única que usan el formulario y el import),
NC y ND, `SeniatXMLService`, QR (`invoice.actions` y `DocumentService`), PDF del voucher, guard de base de las retenciones
y el subtotal/IGTF del formulario. Una factura de lujo de base 1000 da 1310 en todos (antes 2310 al crear y 2000 de base
mostrada). El asiento (`InvoiceGLPostingService`, `total − iva`) era correcto y solo heredaba el total inflado; el
`igtfBase` que envía el formulario también heredaba el error (IGTF 69,30 en vez de 39,30).

- **Datos históricos**: la BD de producción no tiene facturas con `IVA_ADICIONAL` (0 de 39): no hay data-fix. En otro
  entorno habría que detectar las creadas antes del fix (`totalAmountVes` > base una vez + IVA) y corregirlas con asientos
  correctores (ADR-015 si el período cerró); los `SeniatSubmission` pendientes conservan el total viejo.
- **Seguimientos** (no van aquí: piden especificación del formato, criterio del contador o schema): Base16 del TXT SIVIT
  (`export-helpers.ts`) y `ExportService` (`.find`); Forma 30 repite la base de lujo en A1/A3 (`DeclaracionIVAService`);
  la retención de una venta de lujo fija 16 % (`retention.actions`, `calculate`); una NC por el total de una factura
  retenida se rechaza porque `InvoiceCreditDebitNoteService` compara el total bruto con el pendiente neto de retención
  (preexistente); el panel rotula "31 %" con el IVA de 15 %; `superRefine` en `CreateInvoiceSchema` (ΣA ≤ ΣG) es política
  de negocio; persistir `luxuryGroupId` (arch-agent); `IGTFService.applies` usa AND y best-practices §3.2 usa OR. **Integridad del IVA (preexistente, hallazgo del security-agent,
  verificado en el schema)**: `TaxLineSchema` solo valida rango y tasa canónica; nadie comprueba que `monto = base × tasa`
  y `InvoiceService.create` guarda el `amount` que envía el cliente, así que un IVA mal calculado (o manipulado) entra en
  el libro, la Forma 30 y el total. Arreglo posible: recalcular el IVA en el servidor o un `superRefine` con tolerancia de
  redondeo; cambia lo que se acepta, por eso es decisión de negocio y va en su propia rama.
