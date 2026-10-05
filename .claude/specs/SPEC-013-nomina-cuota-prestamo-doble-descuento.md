---
id: SPEC-013
titulo: La cuota de préstamo a empleado no se resta dos veces en el asiento de nómina
estado: APROBADA   # aprobada por el usuario 2026-10-04 ("Aprobado" y "Confirmo" a P-1). Falta solo P-3: autorización para el ajuste en producción, que se pide al llegar a ese paso
fecha: 2026-10-04
rama: fix/nomina-prestamo-doble-descuento
arbol: "[9]"
zonas: []
adrs: [ADR-005, ADR-015, ADR-058]
---

# La cuota de préstamo a empleado no se resta dos veces en el asiento de nómina

## 1. Problema
Cuando un empleado tiene una cuota de préstamo, el asiento de causación de la nómina registra **menos gasto de sueldos y menos Nómina por pagar de lo real**, exactamente por el monto de la cuota. El asiento cuadra, por eso nada lo detecta. El libro queda distinto del recibo: el recibo dice que al empleado se le pagan 860 y el libro tiene 760 por pagar.

Causa raíz, verificada en el código (2026-10-04): `PayrollRunService.approve` (`src/modules/payroll/services/PayrollRunService.ts`, línea 1339) calcula

```ts
const salaryExpense = new Decimal(run.totalEarnings.toString()).minus(loanTotal);
```

pero `totalEarnings` es la suma de las líneas `EARNING` (`PayrollCalculatorService.ts:575`), y la cuota (`PRESTAMO_EMP`) es una línea `DEDUCTION`: nunca estuvo dentro de `totalEarnings`. Al restarla del gasto y luego otra vez al calcular `payableCredit` (línea 1352, que resta `configuredDeductions`, que ya incluye `loanTotal`), la cuota se descuenta dos veces. El comentario del código ("totalEarnings — solo componentes salariales, sin cuotas de préstamo") describe un `totalEarnings` que no es el real. Viene del commit `f8bfa4c7` (2026-05-16, integración contable de préstamos).

## 2. Base legal / contable
Ninguna norma específica. Es el principio de partida doble aplicado a la nómina (VEN-NIF):
- El gasto de sueldos se reconoce por el **sueldo bruto devengado**.
- La cuota del préstamo no es un gasto: es la **recuperación de una cuenta por cobrar** (Préstamos a empleados).
- La deuda con el empleado (Nómina por pagar) es el **neto del recibo**: bruto − retenciones − cuota.

Respuesta de la contadora (2026-10-04, al ejercicio con bruto 1.000, IVSS 40 y cuota 100, cuyo primer asiento era Gasto 1.000 / IVSS 40 / Préstamos 100 / Nómina por pagar 860): **"Cómo dice el ejercicio"**. Gustavo aclaró que esa fue su respuesta a ese texto. La lectura natural es que confirma el primer asiento. Más tarde dijo no entender otra formulación más llana de la pregunta; eso no contradice la respuesta, pero tampoco la refuerza. Por eso esta spec no descansa solo en ella: coinciden tres evidencias independientes (su respuesta, la contabilidad básica y que el neto del recibo no coincide con Nómina por pagar en el propio sistema).

## 3. Alcance
**Incluye:**
- Corregir el cálculo del gasto de sueldos en el asiento de causación: gasto = `totalEarnings` completo.
- Corregir los comentarios del código que describen un `totalEarnings` que no existe.
- Rechazar la aprobación de una nómina con cuotas de préstamo cuando falta la cuenta de préstamos al personal en la configuración (RN-8, P-1 opción A).
- Corregir el test que hoy da por bueno el error (`PayrollRunService.test.ts`, caso USD con préstamo, cerca de la línea 1595) y añadir los tests de la sección 9.
- Corregir con un asiento de ajuste el asiento ya aprobado de la nómina demo `cmtfuqio100019klw9983jgfm` (empresa demo de Gustavo), **solo con autorización explícita** (ver P-3).

**No incluye (explícito):**
- Cambiar el cálculo del recibo (`totalNet`, `totalDeductions`): ya es correcto.
- Cambiar `planLoanInstallments` ni los saldos del préstamo (`EmployeeLoan`).
- Préstamos en USD que guardan `totalAmount = 0`, y que `EmployeeLoanService.approve` apruebe un préstamo sin asiento de desembolso cuando faltan las cuentas (`canJournalize` falso). Es otro problema; va en spec aparte (ver R-3).
- Liquidaciones, vacaciones y utilidades: se barrieron y no manejan cuotas de préstamo.
- Cambios de UI.

## 4. Reglas de negocio
- RN-1: El débito a Gasto de sueldos del asiento de causación es `totalEarnings` (convertido a Bs. en nóminas en USD), sin restarle la cuota de préstamo.
- RN-2: Con la cuenta "Préstamos a empleados" configurada, el crédito a esa cuenta es la suma de las cuotas `PRESTAMO_EMP` de la nómina (convertida a Bs.).
- RN-3: **Invariante:** con las cuentas de retenciones y de préstamos configuradas, el crédito a Nómina por pagar es igual al neto del recibo (`totalNet`, convertido a Bs.), a 2 decimales.
- RN-4: Si alguna retención no tiene cuenta propia configurada, su monto sigue quedando dentro de Nómina por pagar (comportamiento actual, no cambia).
- RN-5: El asiento sigue cuadrando exacto (Σ = 0) y cuantizado al céntimo (ADR-058). La línea de Préstamos a empleados sigue siendo `noAbsorb`: el residuo cae en gasto o en Nómina por pagar.
- RN-6: Sin cuotas de préstamo, el asiento es idéntico al de hoy (sin regresión).
- RN-7: Los saldos de `EmployeeLoan` y la línea del recibo `PRESTAMO_EMP` no cambian.
- RN-8: Una nómina con cuotas de préstamo NO se aprueba si falta la cuenta de préstamos al personal en la configuración de nómina (`loanReceivableAccountId`). Se rechaza ANTES de cualquier escritura, con el mensaje "Configure la cuenta de préstamos al personal (Préstamos a Empleados) en la configuración de nómina antes de aprobar una nómina con cuotas de préstamo." La nómina sigue sin aprobar, sin asiento y sin tocar saldos (P-1, opción A).

## 5. Asientos contables
**Caso A — ejercicio de la contadora** (bruto 1.000, IVSS 40, cuota 100; cuentas de IVSS y de préstamos configuradas):

| Cuenta | Débito | Crédito |
|---|---|---|
| Gasto de sueldos | 1.000 | |
| IVSS por pagar | | 40 |
| Préstamos a empleados | | 100 |
| Nómina por pagar | | 860 |
| **Total** | **1.000** | **1.000** |

Hoy el sistema genera 900 / 40 / 100 / 760.

**Caso B — nómina demo de producción** (ajuste de datos, `cmtfuqio100019klw9983jgfm`; asignaciones USD 8.286,47, cuota USD 250, tasa 779,9522): el asiento aprobado tiene Gasto y Nómina por pagar bajos por exactamente la cuota, Bs. 194.988,05 (250 × 779,9522). Asiento de ajuste, fechado en el mes actual (ADR-005 y ADR-015; nunca editar ni borrar el original):

| Cuenta | Débito | Crédito |
|---|---|---|
| Sueldos y Salarios (5.1.05.01.001) | 194.988,05 | |
| Nómina por Pagar (2.2.10.01.001) | | 194.988,05 |

Invariante: débitos = créditos en cada caso, calculado con `Decimal.js`.

## 6. Modelo de datos
Sin cambios de schema ni migración. La corrección de datos (Caso B) es una operación única, no una migración.

## 7. Contrato de servicio y actions
Sin cambios de firmas. `PayrollRunService.approve(companyId, userId, runId, …)` conserva su contrato; cambia solo el cálculo interno de `salaryExpense`.

- Roles, limiter y período CLOSED (R-3): sin cambios.
- AuditLog de la aprobación: sin cambios (mismo `$transaction`, IP/UA).
- **Corrección de datos (Caso B):** un asiento de ajuste de tipo DIARIO + `AuditLog` con acción `GL_DATA_FIX` en el mismo `$transaction` (la misma acción de auditoría que usó el ajuste de 0,0001 del 2026-10-04; aquel fue una edición de línea, este es un asiento nuevo por ADR-005). Antes y después se verifican las sumas con una consulta de solo lectura. Si el período del asiento original está cerrado, el ajuste va en el mes actual con referencia al original (ADR-015).

## 8. UI
Sin cambios.

## 9. Criterios de aceptación
- [ ] CA-1: Dado bruto 1.000, IVSS 40 y cuota de préstamo 100 con cuentas configuradas, cuando se aprueba la nómina, entonces el asiento es Gasto 1.000 / IVSS 40 / Préstamos 100 / Nómina por pagar 860 y Σ = 0.
- [ ] CA-2: En el caso USD existente (1.043,32 de sueldo, cuota 143,71), el gasto es 1.043,32 × tasa y Nómina por pagar es el neto del recibo × tasa (833,73 × tasa), a 2 decimales; el test actual (gasto 899,61) se corrige.
- [ ] CA-3 (invariante): para varias combinaciones (con y sin cuota, con y sin cuentas de retenciones), el crédito a Nómina por pagar más las retenciones sin cuenta propia es igual al `totalNet` convertido.
- [ ] CA-4: Sin cuotas de préstamo el asiento es idéntico al actual (regresión).
- [ ] CA-5: Σ de las líneas es exactamente 0 y cada línea es múltiplo de 0,01; la línea de Préstamos a empleados no absorbe el residuo.
- [ ] CA-6: Los saldos de `EmployeeLoan` y la línea `PRESTAMO_EMP` del recibo no cambian.
- [ ] CA-7: Dada una nómina con cuota de préstamo y sin `loanReceivableAccountId` configurada, cuando se aprueba, entonces se rechaza con el mensaje de RN-8; no se crea asiento, no cambian los saldos de `EmployeeLoan` y la nómina sigue sin aprobar. Sin cuotas de préstamo, la falta de esa cuenta no bloquea nada.
- [ ] CA-8: Tras el ajuste en producción (solo con autorización), el asiento de la nómina demo más el ajuste da Gasto = `totalEarnings` × tasa y Nómina por pagar = `totalNet` × tasa, ambos a 2 decimales, y no hay asientos descuadrados en la base.
- [ ] CA-tenant: un usuario de otra empresa no puede aprobar la nómina (los tests actuales de aislamiento siguen en verde).
- [ ] CA-período: con período CLOSED la aprobación devuelve error de negocio (el test actual sigue en verde).

## 10. Plan de agentes
Lo completa `/implementar`. Dejar vacío al escribir la spec.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **P-1 (RESUELTA 2026-10-04, contadora + usuario):** la cuenta del plan de cuentas "Cuentas por cobrar empleados" (código que empieza por 1; la contadora confirmó que existe) recibe TODOS los préstamos al personal, sean en bolívares, en divisas, en mercancía o en comida según el rubro. Eligió la **opción A**: bloquear la aprobación si esa cuenta no está configurada, con el asiento correcto (gasto por el bruto, retenciones, crédito a esa cuenta por la cuota, y el resto a Nómina por pagar; la contadora lo describió como "el banco por el que salió el monto", que en ContaFlow es el pago de la nómina por pagar, un asiento aparte que no cambia). El usuario confirmó ("Confirmo"). Consecuencia: ya no existe el caso "cuota dentro de Nómina por pagar" y se simplifica el cálculo.
- **P-2 (RESUELTA 2026-10-04):** la contadora respondió "Cómo dice el ejercicio" al ejercicio (ver sección 2).
- **P-3 (AUTORIZACIÓN DEL USUARIO):** corregir el asiento de la nómina demo es una escritura en producción. No se hace sin la confirmación explícita de Gustavo, ni se mezcla con el merge del código. Es la empresa demo de Gustavo; no hay otros clientes.
- **R-1:** consulta de solo lectura en producción (2026-10-04): hay dos nóminas con cuota de préstamo, una CANCELLED sin asiento y una APPROVED (la demo). Antes de aplicar el ajuste hay que repetir la consulta por si apareció otra.
- **R-2:** el test existente de la línea ~1595 codifica el error (comentario "gasto de personal (1043.32 − préstamo 143.71)"). Hay que corregir el valor esperado y no solo "hacerlo pasar".
- **R-3 (fuera de alcance, aparte):** `EmployeeLoanService.approve` aprueba un préstamo sin asiento de desembolso cuando faltan `loanReceivableAccountId` o `disbursementBankAccountId` (`canJournalize`), y un préstamo en USD guarda `totalAmount = 0`. Ambos producen un libro que no refleja el préstamo. Relacionado con P-1.
- **R-4:** si las cuentas de Nómina por pagar o de Préstamos exigen tercero (ADR-054), el asiento de ajuste del Caso B puede exigirlo. Comprobarlo al implementar.
- **R-5:** la SPEC-001 (trigger de cuadre) no se ve afectada: el asiento corregido sigue cuadrando.
- **R-6 (menor, no bloquea):** la contadora llama a la cuenta "Cuentas por cobrar empleados" y la configuración de nómina la rotula "Préstamos a Empleados" (6 archivos de UI y `payroll-gl-accounts.ts`). Se deja el rótulo actual en esta spec; si se prefiere igualar el nombre, es un cambio de copy aparte. Los préstamos en mercancía o comida que menciona no existen en el modelo (`EmployeeLoan` es monetario): fuera de alcance.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
