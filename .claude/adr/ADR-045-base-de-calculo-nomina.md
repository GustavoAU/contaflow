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
| FAOV 1% / 2% | salario integral | — | **por confirmar** | mensual | — |

`salario normal` = Σ componentes `SALARIO_NORMAL`.
`salario integral` = salario normal + alícuota de bono vacacional + alícuota de
utilidades (Art. 122).

### D-5 · La base es la del mes inmediatamente anterior

LOTTT Art. 107: toda contribución se calcula "considerando el salario normal
correspondiente al mes inmediatamente anterior a aquél en que se causó". La LRPE
Art. 46 lo repite para el RPE. Hoy se usa el mes en curso.

Se aplica **después** de D-1 a D-4: sin la base correcta, cambiar el período de
referencia sólo mueve un número equivocado.

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

1. **Tope del FAOV.** Falta la Ley del Régimen Prestacional de Vivienda y
   Hábitat. ContaFlow topa en 10× salario mínimo; tres fuentes secundarias dicen
   que no hay tope. Quitarlo **sube** la deducción del trabajador, así que no se
   toca sin el artículo. D-4 queda con la celda en "por confirmar".
2. **Conceptos accidentales en el salario integral.** El Art. 122 manda calcular
   prestaciones sobre "el último salario devengado"; si eso incluye las horas
   extra efectivamente devengadas es criterio contable, no lectura literal.
   Consultar antes de implementar `salario integral`.
3. **IVSS.** Falta la Ley del Seguro Social y su Reglamento: el patronal varía
   9/10/11% según riesgo y la cotización es semanal (4,33 semanas/mes), no
   mensual plana como la calcula hoy ContaFlow.

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
