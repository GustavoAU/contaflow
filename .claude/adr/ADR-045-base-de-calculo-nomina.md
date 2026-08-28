# ADR-045 — Base de cálculo de nómina: naturaleza salarial, moneda y aportes parafiscales

- **Estado:** Propuesto
- **Fecha:** 2026-08-24
- **Contexto legal:** verificado contra Gaceta Oficial (ver § Fuentes)
- **Reemplaza parcialmente:** el modelo de base única de `PayrollCalculatorService` (Fase NOM-C)

---

## Contexto

`PayrollCalculatorService` deriva la base de **las cuatro** cotizaciones
(IVSS, FAOV, INCES, RPE) de un único número: `SalaryHistory.amount`. Ese número
no dice en qué moneda está expresado a efectos de cotización, ni de qué
conceptos se compone.

De ahí salieron cuatro defectos, tres ya corregidos y uno estructural:

1. **H-4 (corregido, `fd7af82`).** Los topes son múltiplos del salario mínimo,
   un monto en bolívares, y se comparaban contra el sueldo sin mirar su moneda.
   Un sueldo en USD recibía "Bs. 650" como si fueran "USD 650".
2. **Topes de RPE e INCES (corregido, `78e89da`).** El RPE topaba en 5× sin piso
   cuando la ley dice 1× a 10×; el INCES patronal topaba en 5× cuando la ley no
   fija tope.
3. **INCES del trabajador (pendiente).** Se descuenta 0,5% mensual sobre el
   sueldo; la ley grava las utilidades anuales.
4. **Estructural (este ADR).** Una sola base para cuatro tributos que legalmente
   tienen bases distintas, y ninguna forma de que la empresa declare qué parte
   de la remuneración tiene incidencia salarial.

El punto 4 es el que bloquea al resto. Hoy, si una empresa paga parte en
bolívares como salario y parte en dólares como bonificación —lo que hacen las
empresas que atendemos, y lo que hace el propio Estado con el Bono contra la
Guerra Económica— ContaFlow no puede representarlo: mete todo en la base o nada.

### Lo que ya existe y no se usa

`PayrollConcept.affectsSalaryIntegral` está en el schema desde la Fase NOM-C y
está **correctamente poblado** (`CESTA_TICKET` y `BONO_ALIM_EFECT` en `false`).
Pero su único consumidor es `BenefitAccrualService`, para prestaciones. El
calculador de cotizaciones lo ignora por completo.

---

## Decisión

### D-1 · La naturaleza salarial es ternaria, no booleana

Un booleano no puede representar la ley. La LOTTT distingue **tres** categorías,
y las horas extraordinarias son el caso de libro que lo demuestra: son salario
(Art. 104 las nombra) pero **no** son salario normal (Art. 104 tercer aparte
excluye "las percepciones de carácter accidental").

```prisma
enum SalaryNature {
  NO_SALARIAL          // LOTTT Art. 105 (lista cerrada) o decreto expreso
  SALARIO_NORMAL       // devengado "en forma regular y permanente"
  SALARIAL_ACCIDENTAL  // es salario, pero no entra en el salario normal
}
```

`PayrollConcept.salaryNature` sustituye a `affectsSalaryIntegral`. Clasificación
inicial de los conceptos del sistema:

| Concepto | salaryNature | Fundamento |
|---|---|---|
| `SAL_BASE` | `SALARIO_NORMAL` | Art. 104 |
| `BONO_NOCHE` | `SALARIO_NORMAL` | recargo regular y permanente si hay turno nocturno fijo |
| `HE_DIURNA`, `HE_NOCTURNA` | `SALARIAL_ACCIDENTAL` | Art. 178: carácter eventual o accidental |
| `DOM_FERIADO`, `DESCANSO_COMP` | `SALARIAL_ACCIDENTAL` | accidental |
| `CESTA_TICKET`, `BONO_ALIM_EFECT` | `NO_SALARIAL` | Art. 105 numeral 2 |
| Bono en divisas / de guerra | `NO_SALARIAL` **por defecto, configurable** | ver D-2 |

### D-2 · La clasificación de un bono en divisas la declara la empresa, y queda auditada

El anclaje legal existe pero es **estrecho**: el Decreto 4.805 (G.O. 6.746 Extr.,
01-05-2023) Art. 2 crea el Bono contra la Guerra Económica "sin incidencia
salarial" de forma expresa. Fuera de ese decreto:

- La LOTTT Art. 105 es una **lista cerrada de siete conceptos** y un bono en
  divisas no está en ella.
- El Art. 104 va en dirección contraria: es salario toda remuneración "siempre
  que pueda evaluarse en moneda de curso legal", y "los subsidios o facilidades
  que el patrono otorgue... tienen carácter salarial".
- El TSJ ha declarado salarial un bono en divisas regular, permanente y de libre
  disposición.

Por tanto **el software no decide esto**. `salaryNature` es editable por la
empresa sobre conceptos no-sistema, con `AuditLog` de quién lo cambió y cuándo
(R-6). El default es `NO_SALARIAL` porque es la práctica del mercado, pero el
registro del cambio es lo que protege a la empresa si un tribunal lo revisa.

### D-3 · Las cotizaciones se calculan en bolívares

El salario mínimo, los topes y las declaraciones a IVSS/BANAVIH/INCES están todos
en bolívares. Un componente en USD se convierte a Bs. con la tasa BCV del
período (`ExchangeRate`, misma ventana que usa `approve()` para el asiento).

Esto sustituye a la solución interina de H-4, que convierte el *tope* a dólares
para dejar la deducción en la moneda del sueldo. El estado final es el inverso:
la base va a bolívares y **la línea de deducción es un monto en Bs.**, aunque el
recibo esté en dólares. Es lo que ocurre en la realidad: te pagan en divisas y te
retienen bolívares.

`PayrollRunLine` gana `currency` y `exchangeRateApplied` para poder expresarlo.

### D-4 · Cada tributo declara su propia base

| Tributo | Base | Piso | Techo | Período | Condición |
|---|---|---|---|---|---|
| IVSS obrero 4% / patronal 9-11% | salario normal | — | 5× salario mínimo | mensual | — |
| RPE 0,5% / 2,0% | salario normal | 1× | 10× | mensual | — |
| INCES patronal 2% | salario normal | — | **sin tope** | **trimestral** | ≥ 5 trabajadores |
| INCES trabajador 0,5% | **utilidades anuales** | — | sin tope | **anual** | ≥ 5 trabajadores |
| FAOV 1% / 2% | salario integral | — | **sin tope** | mensual | — |

`salario normal` = Σ componentes `SALARIO_NORMAL`.
`salario integral` = salario normal + alícuota de bono vacacional + alícuota de
utilidades (Art. 122).

### D-5 · La base es la del mes inmediatamente anterior

LOTTT Art. 107: toda contribución se calcula "considerando el salario normal
correspondiente al mes inmediatamente anterior a aquél en que se causó". La LRPE
Art. 46 lo repite para el RPE. Hoy se usa el mes en curso.

Se aplica **después** de D-1 a D-4: sin la base correcta, cambiar el período de
referencia sólo mueve un número equivocado.

### D-6 - La naturaleza de las horas extra depende del empleado, no del concepto

Criterio aportado por Gustavo (2026-08-24), respaldado en los Arts. 104, 118 y
178 y en doctrina reiterada de la Sala de Casacion Social:

- **Como se pagan.** Art. 118 segundo aparte: "para el calculo de lo que
  corresponda al trabajador o trabajadora por causa de horas extras, se tomara
  como base el **salario normal** devengado durante la jornada respectiva". La
  hora extra se calcula sobre el salario NORMAL, nunca sobre el integral.
- **Escenario A - eventuales.** Art. 178: las horas extraordinarias "son de
  caracter eventual o accidental para atender imprevistos o trabajos de
  emergencia". Trabajadas de forma aislada NO inciden en el salario integral:
  son `SALARIAL_ACCIDENTAL` y quedan fuera de prestaciones.
- **Escenario B - regulares y permanentes.** Si se laboran de forma fija por la
  naturaleza del puesto (vigilancia, choferes, produccion continua), la
  continuidad rompe la excepcionalidad: pasan a ser salario normal por
  habitualidad (Art. 104), lo que eleva el salario integral y obliga a
  **recalcular retroactivamente** las alicuotas de utilidades, bono vacacional y
  la garantia de prestaciones.

**Consecuencia de modelo, y es la parte incomoda:** `salaryNature` vive en
`PayrollConcept`, o sea es global a la empresa. Pero el escenario A y el B son
el mismo concepto con distinto patron de uso, y ese patron es **por empleado y
por historia**. Ni un booleano ni un enum en el concepto pueden expresarlo.

La salida NO es que el software decida. Igual que en D-2:

1. `HE_DIURNA`/`HE_NOCTURNA` quedan `SALARIAL_ACCIDENTAL` por defecto: es el
   supuesto que la propia Ley declara como regla (Art. 178).
2. ContaFlow **detecta la habitualidad y avisa**: horas extra en N de los
   ultimos M periodos del mismo empleado dispara una alerta en
   `PendingTasksService`, con el aviso de que la reclasificacion obliga a
   recalcular alicuotas hacia atras.
3. La reclasificacion la hace el contador, por empleado, y queda en `AuditLog`.

Esto exige un override por empleado que hoy no existe. Es trabajo de una fase
posterior; lo que entra ahora es el default del punto 1.

**Pendiente detectado con este criterio:** el calculador saca la hora extra de
`SalaryHistory.amount` crudo, no del salario normal. Coinciden mientras
`SAL_BASE` sea el unico concepto con incidencia; divergen en cuanto haya un
`BONO_NOCHE` o un bono regular manual. El Art. 118 pide lo segundo.

---

## Consecuencias

**A favor**

- Deja de haber una base única para cuatro tributos con bases distintas.
- La empresa puede representar el sueldo híbrido sin que ContaFlow decida por
  ella una clasificación con riesgo legal.
- Habilita el arreglo del INCES del trabajador, que hoy no tiene dónde vivir.
- `TerminationService`, `VacationService` y `ProfitSharingService` —que hoy leen
  `salaryHistory.amount` ignorando `currency`— pasan a tener una fuente de
  verdad de la que colgarse.

**En contra**

- Migración de `affectsSalaryIntegral` a `salaryNature` sobre datos de
  producción. Es mecánica (`true → SALARIO_NORMAL`, `false → NO_SALARIAL`) pero
  las horas extra quedan mal clasificadas por el mapeo automático y hay que
  corregirlas explícitamente en la misma migración.
- `PayrollRunLine` gana dos columnas: toda nómina histórica queda con
  `currency` nulo y hay que decidir si se rellena con VES o se deja nulo como
  "desconocido". **Se deja nulo**: rellenar sería inventar un dato.
- Los recibos pasan a poder mezclar monedas. Es más fiel y más difícil de leer.

**Riesgo asumido**

Cambiar bases de cotización cambia lo que se le retiene a personas reales. Cada
paso va con su corrida de comparación antes/después sobre datos de la empresa
demo, y el contador de Alpha valida los números antes de que esto llegue a
producción.

---

## Alternativas descartadas

**Un segundo booleano (`affectsSalarioNormal`) junto al existente.** Dos
booleanos permiten cuatro estados, de los cuales uno —"no es salario pero sí es
salario normal"— es imposible. Un enum de tres valores no admite el estado
inválido.

**Guardar el sueldo híbrido como dos filas de `SalaryHistory`.** Duplica la
noción de "salario vigente" y obliga a resolver desempates en cada consulta. El
problema no son dos sueldos: es un sueldo con componentes de distinta naturaleza.

**Dejar la conversión en dólares (lo que hace H-4 hoy).** Produce el importe
correcto pero en la moneda equivocada para declarar ante el IVSS. Sirve como
paso intermedio, no como destino.

---

## Pendientes que bloquean partes de este ADR

1. ~~Conceptos accidentales en el salario integral~~ **RESUELTO** - ver D-6.
2. ~~Tope del FAOV~~ **RESUELTO con el articulado (2026-08-28).** Texto del
   **Art. 33 de la Ley del Regimen Prestacional de Vivienda y Habitat**, tal
   como quedo en la **G.O. 6.805 Extraordinario del 01-05-2024**, numeral 1:

   > "El aporte mensual en la cuenta de cada trabajadora o trabajador equivalente
   > al tres por ciento (3%) de su salario integral, indicando por separado; los
   > ahorros obligatorios del trabajador equivalentes a un tercio (1/3) del
   > aporte mensual y los aportes obligatorios de los patronos a la cuenta de
   > cada trabajador, equivalente a dos tercios (2/3) del aporte mensual."

   El articulo **no fija ningun maximo**. Lo unico que acota es un PISO, en su
   numeral 5: el Ministerio puede modificar el aporte y la participacion de cada
   parte, pero "en todo caso, el aporte no podra ser menor al tres por ciento
   (3%) establecido en este articulo". Queda confirmado que quitar el tope de
   10x fue correcto, y la celda de D-4 pasa de "por confirmar" a "sin tope".

   El mismo articulo cierra el otro pendiente del FAOV: dice **"salario
   integral"**, no salario normal. El calculador cotizaba sobre el normal, o sea
   por debajo de la base legal en la alicuota de utilidades y de bono vacacional.
   Corregido: la base del FAOV es ahora `integralDailyWageFrom(normal/30, ...)`
   por 30 — la misma funcion que provisiona prestaciones. Si las dos formulas
   divergieran, la nomina y el pasivo laboral dejarian de cuadrar.

   Nota de proceso: el tope se habia quitado ANTES de tener este texto, apoyado
   solo en analisis secundario y en contra del criterio que este mismo ADR se
   habia fijado. Salio bien, pero la decision se tomo sin la evidencia exigida.

3. **IVSS: la clase de riesgo YA quedo, falta la periodicidad.** El patronal
   9/10/11% segun riesgo esta implementado (`ivssRiskClass`, declarable desde
   el wizard) y el techo de 5 salarios minimos sale del Reglamento Art. 98.
   Sigue abierto que la cotizacion es **semanal** (Reglamento Arts. 99/100/102 —
   se cuentan los lunes del mes, no 4,33 semanas fijas), mientras ContaFlow la
   calcula mensual plana. Antes de tocarlo hay que decidir si la base es la del
   Art. 83 de la LSS (que incluye la hora extra regular) o el salario normal de
   la LOTTT: no son la misma cifra.
4. **Topes de horas extra (Art. 178).** El calculador valida que las horas no
   sean negativas y nada mas. La Ley topa en diez horas diarias de trabajo
   efectivo, **diez horas extra semanales y cien anuales**. Ninguna se comprueba.
   El Art. 182 anade que las horas extra laboradas sin autorizacion de la
   Inspectoria se pagan con el **doble** del recargo, dato que ContaFlow no
   captura; y el Art. 183 obliga a llevar un registro de horas extraordinarias
   que tampoco existe.

---

## Hallazgo fuera del alcance de este ADR

**Art. 142(d): el regimen de prestaciones es DUAL y ContaFlow calcula una sola
mitad.** El literal (d) dice que el trabajador "recibira por concepto de
prestaciones sociales el monto que resulte **mayor**" entre:

- (a+b) la garantia depositada: quince dias por trimestre mas los dias
  adicionales por antiguedad, acumulada con los salarios historicos; y
- (c) el calculo al terminar la relacion: **treinta dias por cada ano de
  servicio o fraccion superior a seis meses, calculada al ULTIMO salario**.

`TerminationService` paga unicamente `benefitBalance.currentBalance`, o sea la
rama (a+b). Nunca calcula (c) ni compara. Como (c) aplica el ultimo salario a
todos los anos de antiguedad, en un pais con salarios que suben -y mas si estan
indexados al dolar- (c) suele ser el mayor: **la liquidacion sale corta de forma
sistematica**. Falta tambien el literal (e): menos de tres meses de relacion se
liquidan a cinco dias de salario por mes trabajado.

No es base de cotizaciones y no entra en ADR-045, pero es dinero que se le debe
a personas reales y necesita su propio arreglo.

---

## Fuentes

Todas verificadas sobre el texto de Gaceta Oficial, no sobre resúmenes.

- **LOTTT** — Decreto 8.938, G.O. 6.076 Extraordinario, 07-05-2012.
  Arts. 104 (salario y salario normal), 105 (lista cerrada de beneficios no
  remunerativos), 107 (contribuciones sobre el mes anterior), 122 (base de
  prestaciones), 123 (pago en moneda de curso legal), 178 (HE accidentales),
  192 (bono vacacional tiene carácter salarial).
- **Ley del INCES** — Decreto 1.414, G.O. 6.155 Extraordinario, 19-11-2014.
  Art. 49 (2% patronal, salario normal mensual, trimestral, ≥5 trabajadores, sin
  tope, prohibido descontarlo al trabajador), Art. 50 (0,5% sobre utilidades
  anuales). **Deroga la ley de 2008; los artículos 14 y 30 que citan los
  comentarios viejos del código ya no existen.**
- **Ley del Régimen Prestacional de Empleo** — G.O. 38.281, 27-09-2005.
  Art. 46 (2,50%, 80/20, base entre 1× y 10× salario mínimo urbano), Art. 47.
- **Decreto 4.805** — G.O. 6.746 Extraordinario, 01-05-2023. Art. 2 crea el Bono
  contra la Guerra Económica **"sin incidencia salarial"** (verificado sobre la
  Gaceta impresa el 2026-08-24; el OCR del PDF invertía la frase). Art. 5
  (ajuste mensual según tasa BCV), Art. 6 ("ingreso mínimo mensual").
- **Salario mínimo:** Bs. 130/mes, sin cambios desde 2022.
