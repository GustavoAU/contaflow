---
id: SPEC-004
titulo: Los asientos se redondean a 4 decimales ANTES de verificar el cuadre
estado: BORRADOR   # depende de la respuesta de la contadora (SPEC-001 PA-1); puede ser opcional
fecha: 2026-10-03
rama: fix/spec-004-precision-asientos
arbol: "[11]"
zonas: [Z-2]
adrs: ["ADR nuevo: precisión de asientos GL"]
---

# Los asientos se redondean a 4 decimales ANTES de verificar el cuadre

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
- Los montos se registran en Bs. (contadora, 2026-10-02). La regla de redondeo para absorber el residuo es una decisión contable: **PREGUNTA PARA CONTADOR** (sección 11, PA-2).

## 3. Alcance
**Incluye:**
- Una función central única que redondea cada línea de un asiento a la precisión de la columna (4 decimales) y **absorbe el residuo** de redondeo en una línea designada, de modo que lo que se verifica es exactamente lo que se guarda.
- Que `assertBalancedGLEntries` verifique sobre los montos ya redondeados.
- Aplicarla en los 38 call-sites (agrupados por servicio, ver sección 7).
- Tests de integración con tasa de cambio real (varias líneas, tasas con 6 decimales) para cada generador que multiplique por tasa.
- Corrección del asiento existente de la empresa demo (solo si SPEC-001 decide `T = 0`).
- ADR que documente la regla.

**No incluye (explícito):**
- El trigger de la base de datos (SPEC-001).
- Cambiar la precisión de la columna (`Decimal(19,4)`).
- Recalcular o reescribir asientos históricos de otras empresas (la auditoría solo encontró 1).
- Cambiar tasas, alícuotas ni lógica fiscal.

## 4. Reglas de negocio
- RN-1: Todo asiento persistido tiene `SUM(amount) = 0` exacto con los montos tal como quedan en `Decimal(19,4)`.
- RN-2: Cada línea se redondea a 4 decimales con una regla única y documentada (modo de redondeo a definir con la contadora, PA-2); el redondeo ocurre antes de verificar y antes de persistir.
- RN-3: El residuo de redondeo (|residuo| ≤ N × 0,00005 para N líneas) se absorbe en la línea designada por la función central. Si el residuo supera ese máximo, es un error de cálculo y se lanza, no se absorbe.
- RN-4: Los asientos sin conversión de moneda (montos ya en 4 decimales) quedan exactamente igual que hoy: la función es idempotente sobre valores ya redondeados.
- RN-5: Anular un asiento (VOID) niega los montos ya guardados, así que hereda el cuadre exacto del original.

## 5. Asientos contables
No crea asientos nuevos; cambia cómo se cuantizan los existentes. Caso de prueba de referencia (nómina USD, tasa 779,9522): el asiento resultante debe sumar exactamente 0 a 4 decimales.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
- Nueva función en `src/lib/gl-assertions.ts` (o un módulo hermano): `quantizeGLEntries(entries, { scale: 4, absorbInto })` → entradas redondeadas, con `SUM(amount) = 0` exacto.
- `assertBalancedGLEntries` pasa a verificar los montos cuantizados.
- Call-sites por servicio (inventario del 2026-10-03): `TransactionService`, `CajaCajaDepositService`, `CajaCajaReimbursementService`, `CajaCajaService`, `ExchangeDifferentialService`, `FiscalYearCloseService`, `FixedAssetDepreciationService`, `FixedAssetService`, `IncomeDistributionService`, `INPCService`, `InventoryAccountingService`, `PaymentGLService`, `BenefitAccrualService`, `BenefitAdvanceService`, `EmployeeLoanService`, `PayrollRunService`, `ProfitSharingService`, `TerminationService`, `VacationService`, `retention.actions`, `RetentionService`.
- Roles / limiter / AuditLog: sin cambios (no hay actions nuevas).
- Período CLOSED: sin cambios.

## 8. UI
Sin cambios.

## 9. Criterios de aceptación
- [ ] CA-1: Nómina en USD con tasa de 6 decimales y 11 líneas produce un asiento con `SUM(amount) = 0` exacto leído de la base de datos real (test de integración).
- [ ] CA-2: Cada servicio del inventario de la sección 7 que multiplique por tasa tiene un test de integración equivalente.
- [ ] CA-3: Un asiento ya en 4 decimales (nómina en VES, sin conversión) no cambia respecto a hoy (test de regresión).
- [ ] CA-4: Un residuo mayor al máximo permitido por N líneas lanza error en vez de absorberse.
- [ ] CA-5: `vitest run` y el job `integration` del CI siguen en verde.
- [ ] CA-6: El asiento `NOM-2026-08-16-83jgfm` queda con Σ = 0 mediante un asiento de ajuste (nunca DELETE, ADR-005), si SPEC-001 decide `T = 0`.

## 10. Plan de agentes
Lo completa `/implementar`. Dejar vacío al escribir la spec.

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **PA-1 (usuario / contadora):** ¿esta spec es obligatoria? Depende de SPEC-001 PA-1. Con `T = 0.01` es una mejora (el libro derivaría 0,0001 por nómina en USD pero la base no lo rechazaría); con `T = 0` es **prerrequisito**, o una nómina nueva en USD fallaría al aprobarse.
- **PA-2 (PREGUNTA PARA CONTADOR):** ¿en qué línea se absorbe el residuo de redondeo? Opciones: la de mayor monto (Nómina por Pagar en una nómina), o una cuenta propia "Diferencias de redondeo". Y el modo de redondeo (mitad hacia arriba, el habitual en contabilidad, o bancario).
- **R-1:** tocar 21 servicios de asientos es un cambio ancho en zona fiscal (Z-2). Hay que hacerlo por lotes con test de integración por generador, y el job `integration` ya existe para eso.
- **R-2:** `assertBalancedGLEntries` hoy tolera 0,01; si pasa a exacto sin arreglar antes los generadores, rompe flujos reales. El orden obligatorio es: función central + generadores primero, verificación exacta después.
- **R-3:** el asiento existente es de la empresa demo del usuario: sin riesgo operativo.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
