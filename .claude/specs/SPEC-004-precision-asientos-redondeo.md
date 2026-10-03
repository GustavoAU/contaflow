---
id: SPEC-004
titulo: Los asientos se redondean al céntimo (2 decimales) ANTES de verificar el cuadre
estado: EN_CURSO   # aprobada 2026-10-03 con la regla del céntimo (opción A); va ANTES que SPEC-001
fecha: 2026-10-03
rama: fix/spec-004-precision-asientos
arbol: "[11]"
zonas: [Z-2]
adrs: ["ADR nuevo: precisión de asientos GL"]
---

# Los asientos se redondean al céntimo (2 decimales) ANTES de verificar el cuadre

## 1. Problema
Un asiento puede quedar guardado **descuadrado por 0,0001 Bs.** aunque la verificación de partida doble (`assertBalancedGLEntries`, N4) dijo que cuadraba.

Causa raíz, verificada con datos reales de producción el 2026-10-03 (asiento `NOM-2026-08-16-83jgfm`, nómina en USD de la empresa demo):
1. Los servicios calculan los montos con `Decimal.js` en precisión alta (~20 dígitos).
2. Cuando el origen es USD, multiplican cada monto por la tasa BCV (aquí 779,9522, con 6 decimales).
3. `assertBalancedGLEntries` suma esos valores **sin redondear** y pasa (Σ = 0 a 20 dígitos).
4. Postgres guarda cada línea en `JournalEntry.amount Decimal(19,4)` y **redondea cada línea por separado**. La suma de los valores guardados ya no es 0 (aquí −0,0001 en un asiento de 11 líneas).

Es una **clase de bug**: hay 38 call-sites de `assertBalancedGLEntries` en ~20 servicios, y cualquier generador que multiplique por una tasa o prorratee puede tener el mismo defecto. Hoy solo se manifiesta en nómina en USD porque las nóminas en VES ya están en 4 decimales.

## 2. Base legal / contable
- Partida doble: el libro mayor debe cuadrar (VEN-NIF; COT Art. 23 / PA-121: libros íntegros y verificables).
- Los montos se registran en Bs. (contadora, 2026-10-02). **Contadora, 2026-10-03 (vía Gustavo):** "decimales se utilizan solo dos; si son cuatro, se redondean a dos"; los libros deben cuadrar en cero; cuando algo no cuadra "lo arreglamos, vemos por qué" y la diferencia se lleva a donde corresponde (diferencial por un cliente que no pagó en un cuadre de caja, descuento al cajero, o se ajusta una salida/pago a lo que realmente salió). Es decir: las diferencias reales se **investigan y se registran de forma explícita**, no se esconden. La regla de redondeo para absorber el residuo es una decisión contable: **PREGUNTA PARA CONTADOR** (sección 11, PA-2).

## 3. Alcance
**Incluye:**
- Una función central única que redondea cada línea de un asiento al **céntimo (2 decimales)**, la unidad contable según la contadora, y **absorbe el residuo** de redondeo en la línea de mayor monto, de modo que lo que se verifica es exactamente lo que se guarda.
- Que `assertBalancedGLEntries` verifique sobre los montos ya redondeados.
- Aplicarla en los 38 call-sites (agrupados por servicio, ver sección 7).
- Tests de integración con tasa de cambio real (varias líneas, tasas con 6 decimales) para cada generador que multiplique por tasa.
- Corrección del asiento existente de la empresa demo (solo si SPEC-001 decide `T = 0`).
- ADR que documente la regla.

**No incluye (explícito):**
- El trigger de la base de datos (SPEC-001).
- Cambiar el tipo de la columna `JournalEntry.amount` (`Decimal(19,4)` se mantiene; los asientos nuevos simplemente llevan ceros en el 3.º y 4.º decimal).
- Recalcular o reescribir asientos históricos de otras empresas (la auditoría solo encontró 1).
- Cambiar tasas, alícuotas ni lógica fiscal.

## 4. Reglas de negocio
- RN-1: Todo asiento persistido tiene `SUM(amount) = 0` exacto con los montos tal como quedan guardados, y cada `amount` de un asiento nuevo es un múltiplo de 0,01 (2 decimales).
- RN-2: Cada línea se redondea a **2 decimales** con `ROUND_HALF_UP` (mitad hacia arriba, el modo habitual en contabilidad); el redondeo ocurre antes de verificar y antes de persistir. Decidido por el usuario el 2026-10-03, según la contadora: "decimales se utilizan solo dos; si son cuatro, se redondean a dos".
- RN-3: El residuo de redondeo (|residuo| ≤ N × 0,005 para N líneas; en la práctica unos pocos céntimos) se absorbe en la línea de MAYOR valor absoluto del asiento (si hay empate, la primera en orden). **Es visible en los reportes por ser de céntimos y eso es aceptado (opción A).** El residuo y la línea donde se absorbió se devuelven al llamador y se dejan en el payload del `AuditLog` del asiento (R-6), para que sea trazable. Si el residuo supera el máximo permitido para N líneas, es un error de cálculo y se lanza.
- RN-4: Un monto que ya está en 2 decimales no cambia. Un monto con más decimales (p. ej. cálculos que hoy se guardan a 4) **pasa a redondearse a 2**: es un cambio de comportamiento deliberado y es la regla de la contadora; los asientos históricos NO se reescriben.
- RN-5: Anular un asiento (VOID) niega los montos ya guardados, así que hereda el cuadre exacto del original.

## 5. Asientos contables
No crea asientos nuevos; cambia cómo se cuantizan los existentes. Caso de prueba de referencia (nómina USD, tasa 779,9522, 11 líneas): el asiento resultante debe sumar exactamente 0 y cada línea ser múltiplo de 0,01.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
- Nueva función en `src/lib/gl-assertions.ts` (o un módulo hermano): `quantizeGLEntries(entries, { scale: 2, mode: ROUND_HALF_UP })` → `{ entries, residual, absorbedIndex }`, con `SUM(amount) = 0` exacto.
- `assertBalancedGLEntries` pasa a verificar los montos cuantizados.
- Call-sites por servicio (inventario del 2026-10-03): `TransactionService`, `CajaCajaDepositService`, `CajaCajaReimbursementService`, `CajaCajaService`, `ExchangeDifferentialService`, `FiscalYearCloseService`, `FixedAssetDepreciationService`, `FixedAssetService`, `IncomeDistributionService`, `INPCService`, `InventoryAccountingService`, `PaymentGLService`, `BenefitAccrualService`, `BenefitAdvanceService`, `EmployeeLoanService`, `PayrollRunService`, `ProfitSharingService`, `TerminationService`, `VacationService`, `retention.actions`, `RetentionService`.
- Roles / limiter / AuditLog: sin cambios (no hay actions nuevas).
- Período CLOSED: sin cambios.

## 8. UI
Sin cambios.

## 9. Criterios de aceptación
- [ ] CA-1: Nómina en USD con tasa de 6 decimales y 11 líneas produce un asiento con `SUM(amount) = 0` exacto leído de la base de datos real (test de integración).
- [ ] CA-2: Cada servicio del inventario de la sección 7 que multiplique por tasa tiene un test de integración equivalente.
- [ ] CA-3: Un asiento cuyos montos ya están en 2 decimales no cambia (test de regresión); uno con 4 decimales se redondea a 2 y sigue sumando 0.
- [ ] CA-4: Un residuo mayor al máximo permitido por N líneas lanza error en vez de absorberse.
- [ ] CA-5: `vitest run` y el job `integration` del CI siguen en verde.
- [ ] CA-6: El asiento `NOM-2026-08-16-83jgfm` queda con Σ = 0 mediante un asiento de ajuste (nunca DELETE, ADR-005), si SPEC-001 decide `T = 0`.

## 10. Plan de agentes
Línea base (2026-10-03, main `a7b46ba9`): tsc 0 errores · vitest **5434 tests / 264 archivos**, 0 fallos. Plan armado por la sesión principal (orchestrator-agent no está disponible). Patrón verificado en el código: cada servicio arma `entries` → `assertBalancedGLEntries(entries)` → `tx.transaction.create({ entries: { create: entries } })`; el cambio por servicio es mecánico (cuantizar antes de verificar y de persistir).

**Invariante de orden (R-2 de la spec):** `assertBalancedGLEntries` conserva su tolerancia de 0,01 hasta que TODOS los call-sites cuantizan; solo entonces (paso 8) pasa a exacto. Así ningún flujo real se rompe a mitad del trabajo.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | fiscal-agent | Revisión de solo lectura de los 21 servicios (sección 7): cuáles calculan IVA/ISLR/IGTF/retenciones y si su redondeo legal ya es a 2 decimales. Reporta `BLOQUEANTE` si algún monto fiscal debe conservar 4 decimales (R-4a) | no |
| 2 | arch-agent | ADR-058 de precisión de asientos (R-4b): escala 2, `ROUND_HALF_UP`, absorción en la línea de mayor valor absoluto, residuo en el payload del AuditLog, y orden de la tolerancia | no |
| 3 | test-agent | Tests en RED: unitarios de `quantizeGLEntries`; test de arquitectura "todo servicio que llama `assertBalancedGLEntries` cuantiza antes" (RED con la lista de los 38 pendientes); test de integración nómina USD (tasa 779,9522, 11 líneas) para el CI | sí |
| 4 | ledger-agent | Implementar `quantizeGLEntries` en `src/lib/gl-assertions.ts` hasta GREEN en los unitarios | — |
| 5 | ledger-agent | Lote 1 — nómina: PayrollRunService, ProfitSharingService, TerminationService, VacationService, BenefitAccrualService, BenefitAdvanceService, EmployeeLoanService (+ residuo en AuditLog) | sí |
| 6 | ledger-agent | Lote 2 — pagos y fiscales: PaymentGLService (5 sitios), retention.actions, RetentionService, ExchangeDifferentialService, InventoryAccountingService (3), TransactionService (2) | sí |
| 7 | ledger-agent | Lote 3 — resto: CajaCajaService/Deposit/Reimbursement, FixedAssetService/Depreciation, INPCService, FiscalYearCloseService, IncomeDistributionService | sí |
| 8 | sesión principal | Flip: tolerancia por defecto de `assertBalancedGLEntries` de 0,01 a 0; el test de arquitectura del paso 3 pasa a GREEN | — |
| 9 | sesión principal | PR a `main`; aprobar `neon-ci`: el test de integración de nómina USD corre contra Postgres real | no |
| 10 | sesión principal | **Decisión al llegar:** corrección del asiento demo `NOM-2026-08-16-83jgfm` (Σ = −0,0001) con la regla de SPEC-001; la escritura en producción se hace solo con confirmación del usuario | no |
| 11 | sesión principal | Gates finales, `/revisar`, sección 12, LL-016. security-agent: no aplica (sin acciones, rutas ni modelos nuevos) salvo que cambie el contrato del AuditLog | no |

## 11. Riesgos y preguntas abiertas
- **PA-1 (RESUELTA 2026-10-03):** la contadora pidió cuadre exacto "hasta en decimales" (SPEC-001 `T = 0`), así que esta spec es **OBLIGATORIA y va ANTES** del trigger. Pregunta original: ¿esta spec es obligatoria? Depende de SPEC-001 PA-1. Con `T = 0.01` es una mejora (el libro derivaría 0,0001 por nómina en USD pero la base no lo rechazaría); con `T = 0` es **prerrequisito**, o una nómina nueva en USD fallaría al aprobarse.
- **PA-2 (RESUELTA 2026-10-03, decisión del usuario sobre la recomendación):** el residuo se absorbe en la línea de mayor monto del mismo asiento (sin cuenta nueva por empresa) y se redondea mitad hacia arriba. Alternativa descartada: cuenta propia "Diferencias de redondeo" (obliga a configurarla en cada empresa y un servicio sin ella fallaría).
- **R-1:** tocar 21 servicios de asientos es un cambio ancho en zona fiscal (Z-2). Hay que hacerlo por lotes con test de integración por generador, y el job `integration` ya existe para eso.
- **R-2:** `assertBalancedGLEntries` hoy tolera 0,01; si pasa a exacto sin arreglar antes los generadores, rompe flujos reales. El orden obligatorio es: función central + generadores primero, verificación exacta después.
- **R-3:** el asiento existente es de la empresa demo del usuario: sin riesgo operativo.
- **R-4 (obligatorio antes de implementar):** pasar de 4 a 2 decimales cambia montos fiscales (Z-2). Antes del primer commit de código: (a) `fiscal-agent` revisa qué generadores tocan IVA/ISLR/IGTF/retenciones y si su redondeo legal ya es a 2 decimales; (b) `arch-agent` escribe el ADR de precisión de asientos. Si un servicio calcula impuestos a 4 decimales por ley o por reglamento, se detiene y se pregunta al usuario.

- **PA-3 (RESUELTA 2026-10-03, decisión del usuario: opción A):** unidad contable = céntimo (2 decimales); el residuo de redondeo se absorbe en la línea de mayor monto del mismo asiento, visible en reportes y trazable en el AuditLog. Razón del usuario: "la gente para pagar siempre utiliza 2 decimales, no 4". Descartada la cuenta propia "Diferencias de redondeo" (opción B). Se mantiene: los asientos históricos a 4 decimales no se tocan y el trigger exacto de SPEC-001 vale sobre lo guardado.
- **Flujos de diferencias reales (fuera de alcance, a revisar):** cierre de caja con faltante (descuento al cajero) y pagos emitidos por un monto distinto del esperado ya existen en el sistema (CajaCaja, PaymentGLService); con el trigger exacto deberán registrar la diferencia de forma explícita. Se revisarán al implementar SPEC-001.

### Hallazgos del paso 1 (fiscal-agent, 2026-10-03; los 3 marcados ✔ fueron VERIFICADOS por la sesión principal)
Veredicto: **sin bloqueantes de base legal**. El redondeo fiscal ya es a 2 decimales en el origen en retenciones (`RetentionCalculator`), nómina (`PayrollCalculatorService`), `InvoiceTaxLine` e IGTF de pagos sueltos. Los montos de documentos con 4 decimales son: IGTF de lotes de pago, depreciación, prestaciones (acumulación y adelantos), liquidación, utilidades, vacaciones, costo de inventario, ajuste INPC y diferencial cambiario.
- **B1 ✔ Asientos de UNA línea:** `InventoryAccountingService` (ENTRADA "standalone", líneas 120-135 y 157/373) crea un asiento solo con Dr Inventario; el Cr "se genera" en el asiento de la factura. Σ ≠ 0 por diseño: `quantizeGLEntries` no debe intentar absorber ahí, y un trigger por asiento (SPEC-001) los rechazaría. **Pendiente de decisión del usuario para SPEC-001** (exigir contrapartida o generar una).
- **B2 Anulaciones, cierres y liquidaciones derivados de lo guardado** (TransactionService void, CajaCaja, PaymentGLService reverso, FiscalYearClose): deben usar **negación exacta (modo `exact`)**, sin cuantizar, o el espejo de un asiento histórico a 4 decimales deja centésimas.
- **B3 Absorción del residuo:** las líneas de obligaciones fiscales (IVA, retenciones por enterar, IGTF, IVSS/FAOV/INCES/RPE/pensiones) y las líneas con tercero (CxC/CxP) se marcan `noAbsorb`; el residuo cae en la mayor de las restantes; si no hay candidata, error.
- **B4 ✔ IGTF de lotes a 4 decimales** (`PaymentBatchService`, líneas ~237 y ~255): redondear a 2 en el origen, con la última línea cuadrando el total.
- **R-1 Documento a 4, asiento a 2:** el monto del DOCUMENTO se redondea a 2 en el origen (donde se calcula) y el asiento se arma con ese valor; así los auxiliares coinciden con el mayor y el residuo solo cubre multiplicaciones por tasa (nómina USD, diferencial).
- **R-2 Asiento manual:** Zod con `decimalPlaces ≤ 2` (como `zMoneyPositive`): rechazar en vez de redondear en silencio; descartar líneas de monto 0 tras cuantizar.
- **R-3 Diferencial en `PaymentGLService`:** redondear `invoiceAmountVes` a 2 ANTES de calcular `fxDiff`, para que el diferencial sea explícito y exacto.
- **R-4 ✔ `InvoiceGLPostingService`** crea asientos sin `assertBalancedGLEntries` y no está en la lista de la spec. Sus asientos cuadran por construcción, pero no cumplen RN-1 (múltiplos de 0,01) porque `Invoice.totalAmountVes` se guarda sin redondear en facturas con líneas. **Fuera de alcance de esta spec:** redondear el total de la factura toca la factura impresa y el libro de IVA (SENIAT) → candidato a SPEC-005, depende de la PC-3.
- **R-5 Modo de redondeo:** `ROUND_HALF_UP` de `Decimal.js` es "mitad alejándose de cero" (simétrico en Dr/Cr), no "mitad hacia arriba" literal. El ADR debe decirlo.
- **Hueco de funcionalidad (fuera de alcance):** NO existe flujo de faltante/sobrante de caja chica (`closeCajaCaja` manda el saldo GL a una cuenta de retorno sin cuenta de diferencia). Es lo que la contadora describe ("descuento al cajero"): candidato a spec propia.
- **Paso 8 (tolerancia a 0):** antes, revisar que ningún flujo (reembolso de caja, diferencial) dependiera de la holgura de 0,01: hoy cualquier diferencia hasta 0,01 pasa en silencio.
- **Comparaciones documento↔asiento:** ninguna usa igualdad exacta ni tolerancia menor a 0,01 (verificado por el agente en los consumidores de `journalEntry`); las tolerancias de conciliación son 0,01 a 1,00 Bs.
- Impacto estimado en tests: 5 a 15 (nómina y depreciación); la cifra real sale del test de arquitectura en RED (paso 3).

### Preguntas para la contadora (surgidas del paso 1; no bloquean el núcleo, sí lotes concretos)
- **PC-1 (RESUELTA 2026-10-03, contadora):** el IGTF se redondea a **2 decimales** y se calcula **por lote, sobre el total del cierre del día** (no por línea). Implementación: `total = round(totalLote × 3%, 2)`; el prorrateo por línea también a 2 decimales con la última línea cuadrando el total (ya es el patrón de `PaymentBatchService`, solo cambia la precisión de 4 a 2). Modo de redondeo: el mismo `ROUND_HALF_UP` del resto del sistema.
- **PC-2 (RESUELTA en lo principal, 2026-10-03, contadora):** en la **contabilidad** los aportes parafiscales (IVSS, FAOV, INCES, RPE, pensiones) van **por totales**; en la **nómina** se reflejan **trabajador por trabajador**. Es exactamente el diseño actual: cada trabajador ya está a 2 decimales (`PayrollCalculatorService`) y el asiento suma esos montos. Consecuencia: el total del asiento = Σ de los montos por trabajador a 2 decimales, y así la planilla y el mayor coinciden al céntimo en nóminas en VES; en USD el total en Bs. se cuantiza una sola vez. **SIGUE SIN RESPUESTA:** la fecha de vigencia del redondeo a 2 decimales en prestaciones ya acumuladas a 4 decimales (lote 1: BenefitAccrual/BenefitAdvance/Termination/Vacation/ProfitSharing).
- **PC-3 (RESUELTA 2026-10-03, contadora):** `Invoice.totalAmountVes` también se redondea a **2 decimales**. Queda DESBLOQUEADA la SPEC-005 (redondear el total de la factura con líneas y verificar el cuadre en `InvoiceGLPostingService`), que sigue fuera del alcance de la SPEC-004 por tocar la factura impresa y el libro de IVA.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
