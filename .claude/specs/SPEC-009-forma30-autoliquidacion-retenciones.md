---
id: SPEC-009
titulo: Forma 30 — la Autoliquidación replica la planilla SENIAT 99030 (dos saldos separados, retenciones)
estado: BORRADOR
fecha: 2026-10-04
rama: fix/forma30-autoliquidacion
arbol: "[2]"       # también toca [8] (PDF/Excel) y [10] (UI fiscal)
zonas: [Z-2]
adrs: [ADR-009]    # D-5 y los tipos de Sección C/E se ENMIENDAN; ADR-006 D-2 (tope); ADR-058 (regla del céntimo, aplicada por analogía)
---

# Forma 30 — la Autoliquidación replica la planilla SENIAT 99030

> **Renglón vs. casilla.** La planilla numera dos cosas distintas: el **renglón** (1–48, columna izquierda) y la **casilla** (código de cada cifra: 20, 39, 53, 60…). Esta spec usa **solo casillas**. Ejemplo de la confusión a evitar: el renglón 41 es "Percepciones acumuladas" (casilla 57), mientras que la casilla 41 es "Ventas de exportación".

## 1. Problema

El contador no puede copiar la cifra que calcula ContaFlow a la planilla oficial, y el saldo que arrastra al mes siguiente queda mal. La Sección E mezcla dos saldos que la planilla mantiene **separados** (excedente de crédito fiscal y retenciones soportadas) y resta una retención que la planilla **no** resta. Además, las notas de crédito de compra **suman** crédito fiscal en vez de restarlo, y ninguna casilla se cuantiza a 2 decimales.

Con las cifras de una planilla real (persona natural, enero 2026), sin retenciones practicadas:

| | Planilla oficial | ContaFlow hoy |
|---|---|---|
| Empresa Contribuyente Especial | A pagar 0; excedente de crédito fiscal 0; saldo de retenciones **107.198,41** | "Saldo a favor" de 41.404,08 (mezcla ambos saldos) |
| Empresa que NO es Contribuyente Especial | A pagar 0; saldo de retenciones 107.198,41 | "Cuota a pagar" de **26.064,18** (ignora las retenciones que le hicieron) |

Hoy tampoco se representan las "retenciones acumuladas por descontar" (casilla 54): la planilla de enero arrastra Bs. 65.794,33 de meses anteriores.

## 2. Base legal / contable

- **Planilla oficial FORMA IVA 99030** (SENIAT), casillas 20, 39, 53, 54, 55, 56, 60, 66, 67, 71, 74, 78, 90. Fuente primaria: dos planillas reales presentadas ante el SENIAT (persona natural 01/2026 y persona jurídica 09/2026), aportadas por la contadora el 2026-10-04. Las cifras de ambas se verificaron con aritmética y el algoritmo de la sección 4 las reproduce al céntimo (CA-1 y CA-2).
- **Respuestas de la contadora (2026-10-04):** (a) las retenciones que un cliente le hace a la empresa se restan en su declaración "así seamos contribuyentes especiales o no"; (b) el IVA y la retención de IVA "funcionan distinto", y la planilla no tiene línea para las retenciones que la empresa practica a sus proveedores.
- **Artículos de la LIVA y de la Providencia 0049: el repo NO documenta base legal** para el excedente trasladable ni para el descuento de retenciones (revisión de `fiscal-agent`, 2026-10-04). Esta spec no cita artículos de memoria. El comentario del código "PA-0049 Art. 11-12: solo retenciones ya enteradas generan crédito fiscal" no tiene respaldo y se elimina junto con C2. El repo cita dos providencias distintas para retenciones ("0049" y "SNAT/2005/0056"); cuál rige es **NO VERIFICADO** y se pregunta a la contadora cuando se redacte el ADR.

## 3. Alcance

**Incluye:**
- `DeclaracionIVAService`: Autoliquidación con las casillas 39, 53, 60, 54, 66, 74, 55, 67, 90 (sección 4).
- Retenciones sufridas (C1 → casilla 66) **independientes** de `isSpecialContributor`.
- Las retenciones practicadas a proveedores (C2) **salen** del cálculo y del resultado.
- Las notas de crédito de **compra** restan del crédito fiscal (casilla 71), igual que las de venta restan del débito (bug existente de la Sección B).
- Cuantización a 2 decimales de cada casilla y derivación de las siguientes desde valores ya cuantizados.
- Segunda entrada manual de arrastre: "Retenciones acumuladas por descontar" (casilla 54), junto a la del crédito fiscal (casilla 20).
- Salidas "para el mes siguiente" (casillas 60 y 67) con botón que las copia a las entradas.
- El desglose "Ver comprobantes" de C1 con el mismo criterio que el total (notas de crédito con signo, suma exactamente la casilla 66).
- Consumidores del resultado: tipos, `generarForma30Action`, `exportForma30PDFAction`, `Forma30View`, `Forma30PDFService` y `ExportService` (ver sección 7).
- Fábrica del schema de arrastre con el nombre del campo en los mensajes de error (hoy dicen "crédito fiscal" fijo).
- Documentos que describen el esquema viejo (sección 7).
- Tests con las dos planillas reales como fixtures (**solo cifras**, sin RIF ni nombres).

**No incluye (explícito):**
- Persistir declaraciones: se mantiene ADR-009 D-1 (cálculo al vuelo); el arrastre sigue siendo manual (decisión D1). Por eso **no soporta declaración sustitutiva**: no conoce lo pagado en la declaración sustituida (casillas 22, 51, 24 en cero).
- Casillas en cero y que no se ofrecen: ajustes a débitos y créditos (48, 38), certificados de entes exonerados (80, 82), reintegros (21, 81), prorrata (70, 37), cesión y recuperación de retenciones (72, 73), percepciones (57, 58, 68, 69, 75, 76, 77). Ver P3 y R-6/R-7.
- La declaración de retenciones practicadas (otra planilla y otro módulo).
- Unificar el origen de las retenciones sufridas (factura vs. cobro): riesgo R-1, spec aparte.
- Rediseñar el PDF para replicar la planilla completa, y casillas de compras no gravadas / importaciones por alícuota (la Sección B no coincide 1 a 1 con 30–36; `fiscal-agent` lo marca como NO VERIFICADO).

## 4. Reglas de negocio

Notación: números = casillas de la planilla 99030. Todo con `Decimal`.

- RN-1: Total créditos fiscales (39) = créditos fiscales deducibles del período (71, = total de la Sección B) + excedente de créditos fiscales del mes anterior (20).
- RN-2: Cuota tributaria (53) = máx(0, total débitos fiscales (49) − 39).
- RN-3: Excedente de crédito fiscal para el mes siguiente (60) = máx(0, 39 − 49). 53 y 60 nunca son ambos mayores que cero.
- RN-4: Retenciones del período (66) = suma del IVA retenido por clientes en las facturas de **venta** del período (por fecha de factura hasta que se responda P2), **sin importar** si la empresa es Contribuyente Especial. Las notas de crédito restan.
- RN-5: Retenciones acumuladas por descontar (54) es una entrada manual: decimal ≥ 0, máximo 2 decimales, tope `MAX_INVOICE_AMOUNT` (ADR-006 D-2). Omitida = 0.
- RN-6: Total retenciones (74) = 54 + 66.
- RN-7: Retenciones soportadas y descontadas (55) = mín(53, 74). Nunca supera la cuota ni el total disponible.
- RN-8: Saldo de retenciones no aplicado (67) = 74 − 55 ≥ 0. Es el valor que el mes siguiente se ingresa como 54. Se rotula "antes de cesión o recuperación de retenciones (casillas 72 y 73, no soportadas)".
- RN-9: Total a pagar (90) = 53 − 55 ≥ 0. (Sin percepciones, 90 = sub-total 56.)
- RN-10: Los dos saldos son independientes: 60 nunca se compensa con retenciones y 67 nunca se compensa con créditos.
- RN-11: Las retenciones practicadas a proveedores no intervienen en ninguna casilla; no se suman ni se restan, y el resultado ya no las expone.
- RN-12: El crédito del mes anterior (20) conserva su validación actual (string decimal ≥ 0, 2 decimales, tope ADR-006 D-2).
- RN-13: Las notas de crédito de compra restan de la casilla 71 (misma regla de signo que ya aplica a las ventas). Sujeto a P5.
- RN-14: **Cuantización.** Cada casilla (49, 71, 66, 39, 53, 60, 74, 55, 67, 90) se redondea a 2 decimales con `ROUND_HALF_UP` y las siguientes se derivan de los valores ya redondeados, para que lo mostrado cuadre (`53 = 49 − 39` con las cifras visibles). Regla del céntimo de ADR-058, aplicada por analogía: ADR-058 trata asientos, no declaraciones.
- RN-15: **Sin recorte silencioso.** Si el neto de débitos (49), créditos (71) o retenciones del período (66) resulta **negativo** (notas de crédito mayores que el movimiento del mes), la Forma 30 no se calcula y devuelve un error de negocio que dice cuál casilla quedó negativa. Se mantiene hasta que la contadora diga cómo se declara (P4).
- RN-16: Sin retenciones (66 = 0 y 54 = 0) y sin notas de crédito de compra, el resultado coincide con el cálculo anterior sin retenciones (regresión).
- RN-17: En pantalla, PDF y Excel, cada cifra de este bloque lleva el nombre y el número de casilla de la planilla (p. ej. "Casilla 60 — Excedente de crédito fiscal para el mes siguiente").

## 5. Asientos contables

No genera ni modifica asientos (la Forma 30 es de solo lectura, ADR-009 D-7).

## 6. Modelo de datos

Sin cambios de schema (ADR-009 D-1: cálculo al vuelo, sin modelo `DeclaracionIVA`).

## 7. Contrato de servicio y actions

```ts
// services/DeclaracionIVAService.ts
static async calculate(
  companyId: string, year: number, month: number,
  tx?: PrismaClient,
  creditoFiscalPeriodoAnterior: Decimal = ZERO,   // casilla 20
  retencionesAcumuladas: Decimal = ZERO            // casilla 54 (NUEVO)
): Promise<Forma30Result>

// types/forma30.types.ts  (cambio de contrato — rompe consumidores)
interface SeccionC {                // solo C1; se elimina C2 (retencionesIvaPracticadas) y totalRetenciones
  retencionesIvaDelPeriodo: Decimal;   // casilla 66
}
interface SeccionE {                // "Autoliquidación"
  creditoFiscalPeriodoAnterior: Decimal;  // 20 (entrada)
  totalCreditosFiscales: Decimal;         // 39
  cuotaTributaria: Decimal;               // 53 (≥ 0)
  excedenteCreditoFiscal: Decimal;        // 60 (≥ 0)
  retencionesAcumuladas: Decimal;         // 54 (entrada)
  totalRetenciones: Decimal;              // 74
  retencionesDescontadas: Decimal;        // 55
  saldoRetencionesNoAplicado: Decimal;    // 67
  totalAPagar: Decimal;                   // 90
}
// Se eliminan cuotaPeriodo y esSaldoAFavor (se derivan de 53/60).

// actions — requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter }) (ADR-041), sin cambios de guard
generarForma30Action(companyId, year, month, creditoFiscalPeriodoAnterior?: string, retencionesAcumuladas?: string)
exportForma30PDFAction(companyId, year, month, creditoFiscalPeriodoAnterior?: string, retencionesAcumuladas?: string)
// schema: fábrica creditoFiscalSchema(etiqueta) usada para casilla 20 y casilla 54, con la etiqueta en los mensajes.
```

- Roles: `MEMBER_ANY` (lectura), sin cambios. Limiter: `fiscal` (generar) / `export` (PDF).
- AuditLog: no aplica (lectura; igual que hoy). Período CLOSED: no bloquea (lectura; R-3 no aplica).
- **ExportService** (`ExportService.ts` ~L286–319, CSV/Excel mensual del ZIP): llama a `calculate` sin arrastre, así que 53, 60, 55, 67 y 90 saldrían como si los saldos de entrada fueran 0. Decisión D3.
- Consumidores a actualizar: `Forma30View`, `Forma30PDFService`, `ExportService` (columnas "Ret. IVA Sufridas/Practicadas", "Cuota / Saldo a Favor", "Es Saldo a Favor"), `serializeForma30`, `getRetencionesSufridas`.
- Documentos que describen el esquema viejo y se actualizan: `docs/homologacion/manual-usuario-v1.0.0.md` (~L257–262), `docs/homologacion/diagramas-flujo-fiscal.md` (~L534–547, además dice que C1 sale de `Retencion`, lo que no hace el código), `docs/homologacion/manual-tecnico-v1.0.0.md` (~L137–139), `contaflow-context-v3.md` (~L1540–1558) y ADR-009 D-5.

## 8. UI

- `Forma30View`, ruta de la Forma 30 existente.
- **Entradas** (junto al mes y año): "Excedente de crédito fiscal del mes anterior (casilla 20)" y "Retenciones acumuladas por descontar (casilla 54)". Ambas con `MoneyInput`, ayuda: "Cópialo de la casilla 60 / 67 de la declaración del mes anterior".
- **Sección C**: una sola fila "Retenciones de IVA que te hicieron tus clientes en el mes (casilla 66)" con el desglose "Ver comprobantes" existente. Se elimina la fila de retenciones practicadas.
- **Sección "Autoliquidación"** (reemplaza la E), una fila por casilla: 39, 53, 60, 54, 66, 74, 55, 67, 90. Casillas 60 y 67 con botón "Usar como casilla 20 del mes siguiente" / "Usar como casilla 54 del mes siguiente" (copia el valor a la entrada).
- Total a pagar (90) destacado. Si 60 > 0: "Tienes excedente de crédito fiscal para el mes siguiente". Si 67 > 0: "Quedan retenciones por descontar en los próximos meses (antes de cesión o recuperación de retenciones)".
- Error de negocio de RN-15: mensaje en la banda de errores existente, con la casilla afectada.
- Estados: vacío, calculando (`disabled={isPending}` + `aria-busy` en "Calcular Forma 30"), error, éxito.
- Accesibilidad: labels asociados a cada entrada, resultados anunciados en región `aria-live="polite"`, contraste AA.

## 9. Criterios de aceptación

Fixtures: planilla A (persona natural 01/2026) y planilla B (persona jurídica 09/2026), solo cifras.

- [ ] CA-1: Planilla A — débitos 67.468,26; créditos del período 6.117,78; casilla 20 = 35.286,30; casilla 54 = 65.794,33; retenciones del período 67.468,26 → 39 = 41.404,08; 53 = 26.064,18; 60 = 0; 74 = 133.262,59; 55 = 26.064,18; 67 = 107.198,41; 90 = 0.
- [ ] CA-2: Planilla B — débitos 0; créditos del período 48.428,99; casilla 20 = 274.537,82 → 39 = 322.966,81; 53 = 0; 60 = 322.966,81; 74 = 0; 55 = 0; 67 = 0; 90 = 0.
- [ ] CA-3: Una empresa que NO es Contribuyente Especial, con retenciones sufridas, las cuenta en 66.
- [ ] CA-4: Una retención practicada a un proveedor (enterada o no) no cambia ninguna casilla.
- [ ] CA-5: Cuota 1.000 y retenciones disponibles 400 → 55 = 400; 67 = 0; 90 = 600 (sujeto a P1).
- [ ] CA-6: Cuota 0 y retenciones disponibles 500 → 55 = 0; 67 = 500; 90 = 0.
- [ ] CA-7: Una nota de crédito de venta con retención resta de 66.
- [ ] CA-8: Propiedades para entradas aleatorias no negativas: 55 ≤ mín(53, 74); 53 × 60 = 0; 74 = 55 + 67; 90 = 53 − 55; ninguna casilla negativa.
- [ ] CA-9: Sin retenciones ni casilla 54 ni notas de crédito de compra, el resultado coincide con el cálculo anterior sin retenciones.
- [ ] CA-10: `retencionesAcumuladas` se valida como el crédito: "100,99", "0x64", negativos y más de 2 decimales se rechazan sin llamar al servicio, y el mensaje nombra "retenciones acumuladas", no "crédito fiscal".
- [ ] CA-11: Una nota de crédito de compra resta de la casilla 71 (sujeto a P5).
- [ ] CA-12: Notas de crédito que dejan débitos, créditos o retenciones netos negativos → error de negocio que nombra la casilla; no se devuelve ninguna cifra recortada a 0.
- [ ] CA-13: Con facturas en divisa que producen más de 2 decimales internos, `53 = 49 − 39` se cumple con las cifras ya redondeadas que se muestran.
- [ ] CA-14: El desglose C1 suma exactamente la casilla 66 (con notas de crédito en negativo).
- [ ] CA-15: La UI muestra las casillas 60 y 67 con botón que copia el valor a la entrada del mes siguiente; no muestra retenciones practicadas.
- [ ] CA-16: El PDF y el Excel muestran las casillas con su número y no incluyen retenciones practicadas.
- [ ] CA-17: El ZIP mensual no publica casillas que dependen del arrastre con saldos de entrada inventados (según D3).
- [ ] CA-tenant: un usuario de otra empresa no puede calcular ni exportar la Forma 30 (test existente se conserva).

**Validación manual de aceptación (no automatizable):** comparar el total de créditos (casilla 71) calculado por ContaFlow con el IVA crédito del Libro de Compras de 01/2026 y 09/2026 de las dos empresas de las planillas (6.117,78 y 48.428,99). Es la única comprobación de que la Sección B equivale a la casilla 71.

## 10. Plan de agentes
Lo completa `/implementar`. Dejar vacío al escribir la spec.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas

**PREGUNTAS PARA CONTADOR** (la spec no se aprueba sin respuesta; P1, P2, P4 y P5 bloquean):
- P1: Si el impuesto a pagar (cuota) es **mayor** que las retenciones disponibles, ¿se paga la diferencia en la casilla 90 y el saldo de retenciones queda en cero? Las dos planillas solo muestran el caso en que sobran retenciones.
- P2: Una retención que un cliente le hizo a la empresa, ¿en qué mes se cuenta en "Retenciones del período" (casilla 66): el mes de la **fecha de la factura de venta** o el mes de la **fecha del comprobante de retención** que entrega el cliente? Hoy se usa la fecha de la factura. La respuesta del 2026-10-04 describió ambas fechas pero no dijo cuál manda. (Hipótesis, NO VERIFICADA: la práctica habitual sería la fecha del comprobante.)
- P3: ¿Esta empresa usa alguna vez prorrata, ajustes, certificados de entes exonerados, reintegros, cesión o recuperación de retenciones, o percepciones? Incluye el **reintegro de IVA por baja anticipada de un activo fijo (Art. 66 LIVA)**. Si no, esas casillas pueden quedar en cero sin riesgo.
- P4: Cuando las notas de crédito (de venta, de compra o de retenciones) **superan** el movimiento del mes y el resultado neto sale negativo, ¿cómo se declara? Hasta saberlo, el sistema se detiene con un aviso (RN-15).
- P5: Una nota de crédito de **compra**, ¿reduce el crédito fiscal en su misma casilla o se declara aparte como ajuste?
- P6: El descuento de retenciones (casilla 55), ¿es siempre el máximo posible o la empresa puede descontar menos?
- P7 (dato): en la planilla A las retenciones del período (66 = 67.468,26) son **iguales** al débito fiscal (49). ¿Es real (retención del 100% sobre todas las ventas del mes) o hubo un dato digitado?

**DECISIONES DE PRODUCTO** (Gustavo):
- D1 — Arrastre de saldos: manual con dos entradas (recomendado ahora, mantiene ADR-009 D-1) frente a persistir la declaración presentada (spec futura; ADR-015-BORRADOR propone `Forma30Declaration` versionada).
- D2 — Retenciones practicadas: retirarlas del resultado (recomendado, YAGNI y evita confusión) frente a mostrarlas como dato informativo fuera de las casillas.
- D3 — ZIP/CSV mensual (`ExportService`): omitir las casillas que dependen del arrastre (53, 60, 55, 67, 90) y publicar solo las independientes (49, 71, 66), o calcularlas encadenando mes a mes desde saldos iniciales. Recomendado: omitir.
- D4 — Reintegro Art. 66 (bajas de activo fijo): `DisposeAssetModal` dice que "debe reflejarse en la declaración de IVA como ajuste a los créditos fiscales", pero la Forma 30 no tiene dónde recibirlo. Opciones: aviso en la Forma 30 cuando el período tenga un reintegro, o entrada manual para la casilla 38. Fuera de esta spec; hay que decidir si va en una spec aparte.

**Riesgos:**
- R-1 (origen de las sufridas): `Invoice.ivaRetentionAmount` (factura de venta; tiene comprobante y fecha) y `PaymentRecord.ivaRetentionAmount` (cobro; solo monto, con asiento Dr. IVA Ret. x Cobrar). La Forma 30 solo lee la de la factura: una retención capturada solo en el cobro no llega a la declaración. Hoy no hay doble conteo porque solo se lee una; sumar ambas lo crearía (no hay FK ni deduplicación). El cobro no sirve como fuente fiscal sin cambiar el schema. Spec aparte.
- R-2 (cambio de contrato): se eliminan campos del resultado (`retencionesIvaPracticadas`, `cuotaPeriodo`, `esSaldoAFavor`); UI, PDF, Excel, serialización y tests se actualizan en el mismo cambio.
- R-3 (cifras ya presentadas): quienes declararon con la cifra anterior pueden tener saldos arrastrados mal. Fase Alpha con parallel run; sin migración de datos.
- R-4 (integridad de C1): `retention.actions.ts` busca la factura por número y RIF **sin filtrar el tipo**, y `linkRetentionToInvoice` tampoco filtra: una retención practicada podría vincularse a una factura de venta y sobrescribir su `ivaRetentionAmount`, que entra a la casilla 66. Además no hay tope "retención ≤ IVA de la factura de venta" en el schema de factura (mismo hueco que documentó ADR-048). Issue aparte.
- R-5 (fuera de alcance): `vesRate` asume tasa 1 si una factura en divisa no tiene tasa (`DeclaracionIVAService.ts` ~L33), y la retención se suma sin conversión ("ya están en VES"); NO VERIFICADO qué envía el formulario para una venta en USD. Issue aparte.
- R-6 (prorrata): el repo no tiene lógica de prorrata; la Sección B trata el 100% del IVA de compras como deducible. Señal detectable: ventas gravadas y exentas en el mismo mes. Seguro en cero solo si la empresa vende todo gravado o todo exento (P3).
- R-7 (casillas 70/37, 80/82, 21/81, percepciones): NO VERIFICADO qué hacen exactamente; en cero solo con confirmación de la contadora (P3).
- R-8 (fechas): el rango del período usa `new Date(year, month-1, 1)` en hora local; las fechas de negocio se guardan a medianoche UTC. Sin efecto en Vercel (UTC); en un servidor en VET las facturas del día 1 caerían en el mes anterior. Riesgo bajo.
- R-9 (otros comentarios sin respaldo): `ExportService`/`DeclaracionIVAService` conservan comentarios con "Art." que el repo no sustenta; se retiran junto con C2.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado: ADR-009 (enmienda D-5 y tipos de Sección C/E)
- Lección aprendida (LL-XXX):
