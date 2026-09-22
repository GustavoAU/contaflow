# ADR-049 — Integridad del IVA: el monto de cada línea debe cuadrar con base × tasa

**Estado:** Aceptado (decisión del dueño, 2026-09-21)
**Fecha:** 2026-09-21
**Relacionados:** Z-2 (cálculo de impuestos), R-5 (cero flotantes), ADR-006 D-3 (tasa canónica por `taxType`), ADR-042 (esquemas por país), ADR-048 (totales del libro)

## Contexto

`TaxLineSchema` validaba el rango de `base` y `amount` y que la `rate` fuera la canónica del `taxType`, pero **nadie comprobaba
que `amount` fuera coherente con `base × rate`**, y `InvoiceService.create` guarda el `amount` recibido. Comprobado el 2026-09-21
con el esquema real: una línea IVA_GENERAL de base 1000,00 al 16 % con monto 1,00 (o 0,00) se aceptaba. Ese monto pasa al libro
de compras/ventas, a la Forma 30, al total, a la retención de IVA (75 %/100 % del IVA) y al asiento. Datos de producción ese día: 38 líneas con IVA
(29 al 16 %, 6 al 8 %, 3 exentas), desviación máxima 0,00: el hueco no había causado daño.

## Decisión

Se valida en el servidor, en `create.superRefine` del esquema de facturas (necesita `type`, `docType` y `currency`; `creditDebitNote` la
hereda). Por cada línea: `esperado = round(base × rate_canónica / 100, 2, HALF_UP)` con Decimal.js y `diferencia = |amount − esperado|`.
`rate_canónica` es la del `taxType` en el servidor (`cfg.taxLineRates`, ADR-006 D-3) — **nunca** el string `rate` que envía el cliente (ver
"Revisión fiscal y de seguridad" más abajo: usar el `rate` del cliente para el cálculo fue el hueco que dejaba evadir toda la regla).

| Documento | Tolerancia por línea |
|---|---|
| Venta FACTURA / NOTA_CREDITO / NOTA_DEBITO (las emite ContaFlow) | **0,01** (redondeo de un céntimo) |
| Compra (cualquier docType), moneda VES | **1,00** (Bs.) |
| Venta REPORTE_Z / RESUMEN_VENTAS / PLANILLA_IMPORTACION / OTRO (impresora fiscal), moneda VES | **1,00** (Bs.) |
| **Cualquier documento en moneda extranjera (USD/EUR)** | **0,01** de esa moneda |

- **En compras el IVA viene impreso en la factura del proveedor y ese monto manda**: se guarda tal cual, la tasa es solo referencia
  (criterio del dueño). Se rechaza únicamente cuando la diferencia supera 1,00 Bs (un error real, como un IVA de 1,00 sobre 1000 al 16 %).
- Los reportes Z y resúmenes suman muchas operaciones con su propio redondeo, por eso usan la tolerancia amplia.
- Un borde exacto (diferencia igual a la tolerancia) se acepta. Si se supera, no se guarda nada y el issue apunta a `["taxLines", i, "amount"]`
  con un mensaje que trae el monto recibido, el esperado y la tolerancia.
- **No se recalcula en silencio**: el servidor guardaría algo distinto de lo que el usuario vio y de la factura física del proveedor.
- **Unidad.** Los montos llegan en la moneda del documento (`currency`), no siempre en Bs. (el servicio guarda `currency` y la tasa, pero no
  convierte). "Máximo Bs. 1,00" (dueño) no se puede cumplir por debajo de la unidad mínima de una moneda: 1,00 USD serían ≈ Bs. 549, así
  que en moneda extranjera se usa siempre la tolerancia estricta (0,01). Es un valor conservador: cuando exista la entrada de "IVA impreso"
  hay que revisarlo con datos reales. El mensaje de error nombra la moneda del documento (`Bs.`, `USD`, `EUR`).
- **Clasificación a prueba de omisiones.** La tolerancia estricta es el valor POR DEFECTO; la amplia se concede solo a la lista explícita de
  documentos de impresora fiscal y a las compras en VES. Un `docType` nuevo de venta queda estricto hasta que alguien decida lo contrario.
- `createWithLines` calcula el IVA en el servidor y no cambia.

## Consecuencias

- Una compra con un descuadre mayor de 1 Bs. entre el IVA impreso y `base × tasa` no se puede registrar tal cual: hay que revisar la
  factura (o pedir nota de crédito al proveedor). Es deliberado: ese descuadre contamina el libro y la retención.
- Los tests y fixtures que usaban un IVA incoherente pasan a usar montos coherentes.
- La tolerancia es una constante única y greppable en `invoice.schema.ts`; cambiarla es una decisión de negocio.

## Revisión fiscal y de seguridad (2026-09-21/22) — 3 huecos cerrados antes de mergear

La primera versión calculaba `esperado` con el `rate` que envía el cliente (validado solo por rango) y ponía la tolerancia amplia en
compras/impresora fiscal sin mirar la moneda. El fiscal-agent y el security-agent (revisión independiente, con fuzzing diferencial de
300k casos el segundo) encontraron el mismo hueco ALTO por dos caminos distintos, más dos MEDIO:

- **Hueco A (ALTO, reproducido y comprobado por mutación).** `taxLine.superRefine` comparaba la `rate` por VALOR
  (`new Decimal(rate).eq(canónica)`); decimal.js considera `"1.6e1"`, `"0x10"`, `"0b10000"` y `"16.0000000000000"` iguales a 16. Con esa
  `rate` "válida", el bloque de esta ADR volvía a leer `line.rate` para el cálculo y aceptaba cualquier `amount`. Fix: (1) `taxLine`
  exige `isPlainDecimal(rate) && rate.length <= 12` además de la igualdad; (2) el bloque de esta ADR **dejó de leer `line.rate`
  por completo** y usa siempre la alícuota canónica del `taxType`. Con esto una `rate` "1.6e1"/"0x10"/etc. se rechaza en
  `["taxLines", i, "rate"]` y, aunque no se rechazara, el cálculo ya no depende de lo que escribió el cliente.
- **Hueco B (MEDIO, comprobado).** Los montos llegan en la moneda del documento (`currency`), no en Bs. — el servicio guarda `currency`
  y la tasa pero no convierte. Fix: `currency !== "VES"` usa siempre la tolerancia estricta (0,01 de esa moneda); el mensaje nombra la
  moneda (`Bs.` solo si es VES). Ver tabla arriba.
- **Hueco C (MEDIO/BAJO, comprobado).** `createCreditNoteAction`/`createDebitNoteAction` parseaban `input` tal cual, así que el `docType`
  que elegía la tolerancia lo declaraba el cliente (una NC de venta con `docType: "OTRO"` obtenía tolerancia 1,00); el servicio recién
  después fuerza `docType: "NOTA_CREDITO"`/`"NOTA_DEBITO"`. Fix: las actions fuerzan `docType` ANTES de parsear (`{ ...input, docType:
  "NOTA_CREDITO" }`), así que el declarado por el cliente no cuenta.

Los tres fixes tienen test RED→GREEN y se verificaron además por **mutación** (revertir cada fix por separado hace fallar exactamente
sus tests: 72/88/24 respectivamente) — no pasan por casualidad. Veredicto de ambos agentes: GO con estas tres condiciones cerradas.

## Fuera de alcance (pendiente — hallazgos de la misma revisión, no bloqueantes)

- La tolerancia proporcional (por número de ítems) y la advertencia con confirmación en compras (con AuditLog): descartadas por ahora.
- La Forma 30, la retención de una venta de lujo y el TXT SIVIT (ver ADR-048).
- `importInvoiceBatchAction` no pasa por ningún schema de factura (RIF, Nº de control, fecha, tope de monto, `ret_iva`/`ret_islr` sin
  validar). El IVA de sus líneas se calcula en el servidor, así que ADR-049 no aplica ahí, pero el resto de huecos siguen abiertos.
- `amountField()` usa `.abs()`: `ivaRetentionAmount`, `islrRetentionAmount`, `igtfBase` e `igtfAmount` aceptan **negativos**, e IGTF y
  las retenciones no se contrastan contra la factura (mismo principio que esta ADR, aplicado a otros montos). Candidato a ADR-050.
- El "IVA impreso manda" en compras es hoy papel: `InvoiceTaxLinesSection.tsx` calcula "Monto IVA" en el cliente y es de solo lectura
  (`calcAmount` = base × tasa), así que el formulario nunca envía un monto distinto del calculado. La tolerancia de 1,00 en compras
  solo se ejercita hoy por API directa; falta una UI de "IVA impreso" editable para que el criterio de esta ADR tenga efecto real.
- El `type` de una NC/ND ("SALE"/"PURCHASE") también lo puede declarar el cliente (`InvoiceCreditDebitNoteService`: `data.type ||
  original.type`) — no se corrigió aquí porque no elige la tolerancia de esta ADR; es un hallazgo aparte de aislamiento de datos.
