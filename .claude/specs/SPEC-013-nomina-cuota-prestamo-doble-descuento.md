---
id: SPEC-013
titulo: La cuota de préstamo a empleado no se resta dos veces en el asiento de nómina
estado: HECHA   # código, tests y ajuste de datos en producción hechos (2026-10-05); pendiente de merge (requiere confirmación del usuario)
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
- RN-8: Una nómina con cuotas de préstamo NO se aprueba si falta la cuenta de préstamos al personal en la configuración de nómina (`loanReceivableAccountId`). Se rechaza antes de crear el asiento y de tocar saldos (dentro del `$transaction`, el rechazo revierte también la marca de aprobación), con el mensaje "Configure la cuenta de préstamos al personal (Préstamos a Empleados) en la configuración de nómina antes de aprobar una nómina con cuotas de préstamo." La nómina sigue sin aprobar, sin asiento y sin tocar saldos (P-1, opción A).

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
- [x] CA-1: Dado bruto 1.000, IVSS 40 y cuota de préstamo 100 con cuentas configuradas, cuando se aprueba la nómina, entonces el asiento es Gasto 1.000 / IVSS 40 / Préstamos 100 / Nómina por pagar 860 y Σ = 0. **Test CA-1 (1.000 / 40 / 100 / 860, exactamente 4 líneas, Σ = 0).**
- [x] CA-2: En el caso USD existente (1.043,32 de sueldo, cuota 143,71), el gasto es 1.043,32 × tasa y Nómina por pagar es el neto del recibo × tasa (833,73 × tasa), a 2 decimales; el test actual (gasto 899,61) se corrige. **Caso USD de ADR-058 corregido: gasto 1.043,32 × tasa, Nómina por pagar 833,73 × tasa (el residuo se recalculó con Decimal.js).**
- [x] CA-3 (invariante): para varias combinaciones (con y sin cuota, con y sin cuentas de retenciones), el crédito a Nómina por pagar es igual al `totalNet` convertido MÁS las retenciones que no tienen cuenta propia (esas quedan dentro de Nómina por pagar, RN-4). **`it.each` de 7 combinaciones × VES/USD (14 casos) contra valores calculados aparte del recibo. La redacción de la spec se corrigió: Nómina por pagar = neto + retenciones sin cuenta propia.**
- [x] CA-4: Sin cuotas de préstamo el asiento es idéntico al actual (regresión). **Tests CA-4 (sin cuota, FAOV sin cuenta propia → 1.000 / −40 / −960) y todos los tests previos de aprobación.**
- [x] CA-5: Σ de las líneas es exactamente 0 y cada línea es múltiplo de 0,01; la línea de Préstamos a empleados no absorbe el residuo. **Tests CA-5 (dos casos USD con residuo +0,02 y −0,01). Límite conocido: quitar `noAbsorb` de la línea de préstamos no hace fallar ningún test porque el gasto, que es ≥ la cuota, siempre absorbe el residuo; lo que queda fijado es que la cuota termina en `round(cuota × tasa, 2)`.**
- [x] CA-6: Los saldos de `EmployeeLoan` y la línea `PRESTAMO_EMP` del recibo no cambian. **Tres tests sobre `employeeLoan.update` (VES activo, última cuota → PAID, préstamo USD).**
- [x] CA-7: Dada una nómina con cuota de préstamo y sin `loanReceivableAccountId` configurada, cuando se aprueba, entonces se rechaza con el mensaje de RN-8; no se crea asiento, no cambian los saldos de `EmployeeLoan` y la nómina sigue sin aprobar. Sin cuotas de préstamo, la falta de esa cuenta no bloquea nada. **Tests CA-7 (VES y USD: rechazo con el mensaje exacto, sin asiento, sin saldos, sin auditoría; sin cuota o con cuota en 0 no bloquea).**
- [x] CA-8: Tras el ajuste en producción (solo con autorización), el asiento de la nómina demo más el ajuste da Gasto = `totalEarnings` × tasa y Nómina por pagar = `totalNet` × tasa, ambos a 2 decimales, y no hay asientos descuadrados en la base. **Aplicado el 2026-10-05 con autorización del usuario: asiento `AJU-NOM-2026-08-16-83jgfm` (id `cgldatafix83jgfm000001`, tipo AJUSTE, Dr Sueldos y Salarios / Cr Nómina por Pagar por Bs. 194.988,05, correlativo `2026-08-000003`) y AuditLog `GL_DATA_FIX`. Verificado después: gasto de sueldos 6.463.050,5068 (esperado 6.463.050,5067; la diferencia de 0,0001 viene del ajuste previo del 2026-10-04), Nómina por pagar 6.195.963,6754 (= neto × tasa, exacto), 0 asientos descuadrados en toda la base.**
- [x] CA-tenant: un usuario de otra empresa no puede aprobar la nómina (los tests actuales de aislamiento siguen en verde). **El proceso se busca con `{ id, companyId }` (sin cambios; tests previos en verde).**
- [x] CA-período: con período CLOSED la aprobación devuelve error de negocio (el test actual sigue en verde). **Test previo "RECHAZA si el periodo contable esta cerrado (R-3)" en verde.**

## 10. Plan de agentes
Lo completa `/implementar`. Dejar vacío al escribir la spec.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | test-agent | RED en `PayrollRunService.test.ts` (aprobación): corregir el caso USD con préstamo que codifica el error (gasto 899,61 → 1.043,32 × tasa; Nómina por pagar 690,02 → 833,73 × tasa); CA-1 (bruto 1.000, IVSS 40, cuota 100 → 1.000 / 40 / 100 / 860, Σ = 0); CA-3 invariante (Nómina por pagar = neto del recibo convertido, con y sin cuentas de retenciones); CA-4 regresión sin cuotas; CA-5 (Σ = 0 exacta, múltiplos de 0,01, la línea de préstamos no absorbe); CA-6 (saldos de `EmployeeLoan` y línea `PRESTAMO_EMP` sin cambios); CA-7 (cuota de préstamo y sin `loanReceivableAccountId` → se rechaza con el mensaje de RN-8 ANTES de escribir; sin cuota no bloquea). | Sí, RED por la razón correcta |
| 2 | ledger-agent | GREEN en `PayrollRunService.approve`: `salaryExpense` = `totalEarnings` (sin restar la cuota); rechazo previo a cualquier escritura si hay cuotas de préstamo y falta `loanReceivableAccountId` (RN-8); simplificar `configuredDeductions` (la cuota siempre va a la cuenta de préstamos); corregir los comentarios que describen un `totalEarnings` que no existe. Barrido de la clase de bug: grep de otros `.minus(loan` y de sitios que armen el neto. | GREEN |
| 3 | (yo) | Revisión del diff contra las zonas de peligro y gates: `tsc`, `vitest` completo en 4 shards, `lint`, `format:check`. `security-agent` no hace falta: no hay action, ruta, modelo ni input nuevo (solo cálculo interno y una validación previa). | n/a |
| 4 | (yo, SOLO con autorización explícita del usuario, P-3) | Ajuste en producción de la nómina demo `cmtfuqio100019klw9983jgfm`: asiento DIARIO Dr Sueldos y Salarios / Cr Nómina por Pagar por Bs. 194.988,05 + AuditLog `GL_DATA_FIX`, con consulta de solo lectura antes y después. Nunca editar ni borrar el asiento original (ADR-005). | n/a |

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
- **Rama:** `fix/nomina-prestamo-doble-descuento` (PR #64). Sin merge a `main`: requiere confirmación del usuario.
- **Commits:** `267261e5` plan, `f0ef9316` tests en RED (14), `af52bc23` corrección, `968a20e4` cierre parcial, más el de este cierre. El paso 2 del plan lo hice yo directamente (el cambio es de ~10 líneas) y lo verifiqué contra los 14 tests en rojo.
- **Tests:** antes 5906 → después 5931 (+25), 0 fallos; `tsc` 0 errores; `format:check` limpio; lint 0 errores. `security-agent` no hizo falta: no hay action, ruta, modelo ni input nuevo. CI del PR: todo en verde, incluido el job `integration` contra Neon.
- **Barrido de la clase de bug:** `grep` de `.minus(loan` y `.minus(loanTotal` fuera de tests: sin resultados. `TerminationService`, `VacationService` y `ProfitSharingService` no manejan cuotas de préstamo.
- **Ajuste en producción (CA-8):** hecho el 2026-10-05, con autorización explícita del usuario. Una transacción atómica por script (la conexión por el MCP de Neon no estaba disponible; se usó el driver serverless por HTTP 443), con comprobaciones previas de solo lectura (nómina APPROVED y sin cambios, asiento original suma 0, cuentas aptas y sin tercero obligatorio, período OPEN, sin ajuste previo) e idempotente (ids deterministas, `NOT EXISTS`). **Desviación frente a la redacción de §5:** el ajuste se fechó el 2026-08-31 y se asignó al período 2026-08 (OPEN), el mismo del asiento original, y no al mes actual: ADR-015 manda ajustar en el mes actual solo cuando el período original está CERRADO. Así los reportes de agosto quedan correctos. La fecha quedó guardada a las 04:00 UTC del 31 de agosto (el original está a las 00:00 UTC): misma fecha de negocio.
- **ADR:** ninguno nuevo (aplican ADR-005, ADR-015, ADR-058).
- **Lección aprendida:** pendiente (LL-019): el test de ADR-058 que cubría el caso USD con préstamo se escribió copiando el valor que producía el código (gasto 899,61) en vez de derivarlo del recibo, y blindó el error. Un valor esperado se calcula de una fuente independiente. Se añade tras el merge de la SPEC-007 para no colisionar con LL-018.
