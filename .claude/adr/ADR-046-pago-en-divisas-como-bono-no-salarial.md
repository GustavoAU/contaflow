# ADR-046 — Pago en divisas: cómo lo representa ContaFlow

- **Estado:** Aceptado
- **Fecha:** 2026-08-30
- **Rama:** `feat/nomina-asignaciones-recurrentes`
- **Extiende:** [ADR-045](ADR-045-base-de-calculo-nomina.md) (naturaleza salarial y base de cálculo)

---

## Contexto

Hasta hoy ContaFlow asumía que el sueldo de un trabajador es **un solo importe en
una sola moneda**, y que todo él es salario. `SalaryHistory` tiene `amount` +
`currency`, y `PayrollCalculatorService` construye la base de cotizaciones sobre
él.

Eso no es lo que hacen las empresas venezolanas. La práctica corriente es:

- El **salario** se pacta y se paga en **bolívares** — normalmente cerca del
  mínimo. Es la base de las cotizaciones y lo que se declara ante IVSS, BANAVIH
  e INCES, que además reciben los pagos en bolívares.
- El **resto de la remuneración** se entrega en **dólares**, como
  **bonificación de carácter no salarial**.

Registrar un sueldo de "USD 2.500" trata los 2.500 enteros como salario. Y como
**FAOV e INCES patronal no tienen tope** (LRPVH Art. 33.1 y Ley INCES Art. 49),
eso son cifras reales: sobre un sueldo de USD 2.500 salen $84,38 de FAOV más
$50,00 de INCES patronal, **$134,38 por trabajador**, calculados sobre una base
que el usuario no considera salario. IVSS y RPE dan casi igual porque sí están
topados a 5 salarios mínimos.

La maquinaria para distinguirlo **ya existía y era correcta**: el enum
`SalaryNature` y el filtro de `PayrollCalculatorService`, que suma en la base sólo
las líneas EARNING cuyo concepto es `SALARIO_NORMAL`. Lo que faltaba era poder
**expresar el arreglo**:

- `SalaryHistory` guarda un importe y una moneda: no admite "Bs. X de salario +
  USD Y de bono".
- `ManualConceptSchema` no tenía campo de moneda.
- **Ninguna pantalla enviaba `manualConcepts`.** El único llamador de
  `createPayrollRunAction` es `PayrollRunForm`, y no los pasa. La funcionalidad
  estaba completa en schema, calculador y servicio, y **muerta** de cara al
  usuario — la misma clase de defecto que `employeeIds` (corregido el mismo día).
  De paso, eso significaba que **la retención de ISLR tampoco podía introducirse**,
  porque su vía de entrada documentada era ésa.
- Aunque hubiera pantalla, un concepto manual hay que recapturarlo **cada
  quincena, trabajador por trabajador**. Un bono mensual es un acuerdo
  permanente, no un apunte suelto.

---

## Decisión

**Todo el proceso de nómina se liquida en UNA moneda; los importes pactados en
otra se convierten a la tasa BCV del período y se guarda el original.**

Y se añade el modelo que faltaba para expresar lo permanente:

### 1. `EmployeeRecurringConcept` — asignaciones fijas por trabajador

Vincula un trabajador con un `PayrollConcept`, un importe, una **moneda** y una
**vigencia** (`effectiveFrom` / `effectiveTo` nullable). Se aplica sola en cada
proceso mientras esté vigente.

La vigencia se evalúa **al inicio del período**, la misma regla que el sueldo (ver
`utils/salary-vigencia.ts`): un bono que arranca el día 20 no se cobra en la
quincena que empezó el 16. Esa regla se unificó el mismo día tras un defecto en
que pantalla y cálculo la aplicaban distinto.

La **naturaleza salarial NO vive en la asignación**: la gobierna el
`PayrollConcept` referenciado (ADR-045 D-1). Así un mismo bono no puede ser
salarial para un trabajador y no salarial para otro — que es exactamente la
incoherencia que una fiscalización busca.

Las asignaciones se inyectan por la **misma vía** que `manualConcepts` hacia el
calculador. Duplicar la lógica de "incidencia salarial → entra en la base"
garantizaba que las dos ramas divergieran con el tiempo.

### 2. Concepto de sistema `BONO_DIVISAS`

`EARNING`, `affectsSalaryIntegral: false`, `salaryNature: NO_SALARIAL`.

Se siembra **para que el contador pueda expresarlo, no porque el sistema afirme
que es correcto** (ver Riesgo abajo). Vive en el catálogo de la empresa, donde
puede reclasificarse.

### 3. Trazabilidad de la conversión (ADR-045 D-3)

`PayrollRunLine` gana `originalAmount`, `originalCurrency` y
`exchangeRateApplied`, que se llenan **sólo cuando hubo conversión**. Sin esto,
una línea de "Bs. 1.949.875" no dice de dónde salió y la tasa de aquel día ya no
está: en una fiscalización el cálculo es irreconstruible.

La tasa es **la misma** que usan los topes legales (H-4) y el asiento contable,
para que las tres cifras del proceso no salgan de tasas distintas.

Sin tasa BCV, un importe en otra moneda **bloquea el proceso**. No se cuela un
número aproximado ni se omite la línea.

---

## Alternativas descartadas

**Sueldo compuesto (`SalaryHistory` con componentes en dos monedas).** Modela la
realidad literal, pero obliga a que el recibo y el asiento sean bimonetarios y
rompe la regla de una moneda por proceso (C-01), que existe porque un total que
suma bolívares y dólares no es de ninguna de las dos. Además la conversión no se
evita: el asiento contable se registra en bolívares igual, así que sólo se mueve
más abajo y con menos trazabilidad.

**Dejar el sueldo íntegro en USD.** Es lo conservador —cotiza de más, nunca de
menos— y es el comportamiento anterior. Se descarta porque no representa lo que
el usuario hace, y porque cobrar FAOV e INCES sobre una base que el contador no
considera salario no es "prudente": es incorrecto en la otra dirección.

---

## Riesgo legal — explícito

**LOTTT Art. 104** define salario como *toda remuneración, provecho o ventaja*
que corresponda al trabajador por la prestación de su servicio. **El Art. 105 es
una lista CERRADA** de lo que no es salario. Un pago en divisas **regular y
permanente** clasificado como no salarial es legalmente discutible, por muy
extendida que esté la práctica y por mucho que los decretos de bono de guerra
económica hayan legitimado parte de ella.

Por eso el sistema **habilita la clasificación pero no la impone**:

- El concepto se siembra como uno más del catálogo, reclasificable.
- El formulario **advierte en ámbar** cuando el concepto elegido tiene incidencia
  salarial, diciendo que ese monto entrará en la base de IVSS, FAOV e INCES.
- El `AuditLog` guarda la `salaryNature` **con la que se asignó**, para que
  reclasificar el concepto mañana no reescriba el criterio de ayer.

La decisión es del contador. ContaFlow la registra, la hace reconstruible y no la
toma en silencio.

---

## Consecuencias

**Positivas**
- El arreglo real de las empresas venezolanas se puede expresar por primera vez.
- Los `manualConcepts` dejan de ser la única vía y de estar muertos: lo
  permanente se captura una vez.
- La conversión queda auditable importe a importe.
- El modelo generaliza a cesta ticket, bono de transporte y descuentos fijos.

**Negativas / Trade-offs**
- Un modelo más que mantener, con su RLS y su vigencia.
- La base de cotizaciones pasa a depender de cómo el contador clasifique los
  conceptos: un error de clasificación ahora tiene consecuencia fiscal directa.
  Mitigado con la advertencia del formulario y la traza en `AuditLog`.
- Sigue faltando pantalla para los `manualConcepts` de un proceso concreto (el
  caso ad-hoc, incluida la retención de ISLR). **Queda abierto.**

---

## Referencias

- LOTTT (G.O. 6.076 Extr., 2012) Arts. 104 y 105.
- LRPVH (G.O. 6.805 Extr., 01-05-2024) Art. 33.1 — FAOV sobre salario integral, sin tope.
- Ley INCES (Decreto 1.414) Art. 49 — 2% patronal sin tope, desde cinco trabajadores.
- [ADR-045](ADR-045-base-de-calculo-nomina.md) — D-1 (naturaleza en el concepto), D-3 (moneda en la línea), D-4 (manuales en la base).
- `20260830_employee_recurring_concept` — migración con RLS (ADR-007 A1-bis).
