---
id: SPEC-006
titulo: Salario diario y alícuotas de prestaciones se guardan con todos sus decimales
estado: APROBADA   # regla dada por el usuario/contadora 2026-10-04; la APLICACIÓN de la migración en producción requiere confirmación aparte
fecha: 2026-10-04
rama: feat/spec-006-alicuotas-precision
arbol: "[7]"
zonas: []
adrs: [ADR-058, ADR-057]
---

# Salario diario y alícuotas de prestaciones se guardan con todos sus decimales

## 1. Problema
La contadora (2026-10-04, vía el usuario): "las alícuotas de prestaciones, tanto de vacaciones como de utilidades, se deben dejar con **todos los decimales que da**; ejemplo 0,12353 tal cual".

Verificado en el código (2026-10-04):
- El **cálculo** ya usa la precisión completa de `Decimal.js` (`dailyNormalWage`, `profitDaysAliquot`, `vacationBonusDaysAliquot`, `integralDailyWage`); solo el monto final (`accrualAmount`) se redondea a 2 decimales (ADR-058). El dinero acumulado no cambia.
- El **snapshot guardado** sí se recorta a 4 decimales: columnas `Decimal(19,4)` y `toFixed(4)` explícito al guardar. El ejemplo de la contadora, 0,12353, se guardaría como 0,1235.
- `TerminationService` redondea `profitSharingBaseSalary` a 4 decimales para el snapshot (el cálculo del monto usa `avgSalary` completo).

## 2. Base legal / contable
Regla contable de la contadora (arriba). Las alícuotas y el salario diario son **factores** de cálculo, no montos de asiento: el ADR-058 ya los excluía del redondeo a 2 decimales.

## 3. Alcance
**Incluye:**
- Ampliar a `Decimal(19,8)` las 7 columnas de snapshot: `BenefitAccrualLine` (`dailyNormalWage`, `profitDaysAliquot`, `vacationBonusDaysAliquot`, `integralDailyWage`), `VacationRecord.dailyNormalWage`, `ProfitSharingRecord.baseSalarySnapshot`, `Termination.profitSharingBaseSalary`.
- Guardar esos valores con 8 decimales (`toFixed(8)`) en lugar de 4, y dejar de redondear a 4 el promedio en `TerminationService`.
- Tests que fijen que 0,12353 se conserva.

**No incluye (explícito):**
- Redondear a 2 decimales el salario diario ni las alícuotas (la regla es la contraria).
- Cambiar los montos de documento (prestaciones, vacaciones, bono, utilidades), que siguen a 2 decimales (ADR-058).
- Recalcular snapshots históricos: los ya guardados a 4 decimales se quedan; la columna ampliada no los altera.
- Cambiar el tipo de otros campos `Decimal(19,4)`.

## 4. Reglas de negocio
- RN-1: El salario diario normal, las alícuotas de utilidades y bono vacacional y el salario integral diario se guardan con hasta 8 decimales, sin redondear a 4.
- RN-2: Un valor como 0,12353 se lee de la base de datos como 0,12353 (no 0,1235).
- RN-3: Los montos de documento y de asiento siguen a 2 decimales (ADR-058); esta spec no los toca.
- RN-4: Ampliar la columna no modifica ningún valor ya guardado.

## 5. Asientos contables
No aplica (no cambia ningún asiento).

## 6. Modelo de datos
- Migración `20261004_alicuotas_salario_diario_decimal8`: `ALTER COLUMN ... TYPE DECIMAL(19,8)` en las 7 columnas. Ampliar la escala de un `NUMERIC` conserva los valores existentes; es repetible desde cero (ADR-057) y el job `integration` la aplica.
- `schema.prisma`: `@db.Decimal(19, 8)` en las 7 columnas; `npm run verify:schema-format` en verde.
- RLS: sin tablas nuevas; no aplica.

## 7. Contrato de servicio y actions
Sin firmas nuevas. Cambios internos de precisión en `BenefitAccrualService`, `VacationService`, `ProfitSharingService` y `TerminationService`. Sin actions nuevas, sin cambios de roles, limiter ni AuditLog.

## 8. UI
Sin cambios. (Los componentes que muestren estos valores redondean para mostrar; no se tocan.)

## 9. Criterios de aceptación
- [ ] CA-1: Un test unitario por servicio comprueba que el valor pasado a Prisma conserva más de 4 decimales (p. ej. 0,12353…).
- [ ] CA-2: Un test de integración contra Postgres real (`alicuotas-precision.test.ts`) comprueba que las 7 columnas son `NUMERIC(19,8)` tras aplicar las migraciones desde cero y que 0,12353 sobrevive en ese tipo (con el tipo viejo `NUMERIC(19,4)` se perdía el 5.º decimal).
- [ ] CA-3: El job `integration` aplica las 166 migraciones desde cero con la nueva.
- [ ] CA-4: Ningún monto de documento ni de asiento cambia (la suite de nómina sigue en verde con los mismos montos a 2 decimales).
- [ ] CA-tenant / CA-período: no aplican (sin mutaciones nuevas).

## 10. Plan de agentes
Sesión principal (cambio mecánico y acotado: 1 migración, 7 columnas, ~15 líneas). security-agent: no aplica (sin acciones, rutas ni modelos nuevos).

## 11. Riesgos y preguntas abiertas
- **R-1:** la migración altera el tipo de 7 columnas en producción; con tablas pequeñas es instantáneo, pero **aplicarla en producción requiere confirmación del usuario** (flujo manual `db execute` + `resolve --applied`, o vía MCP como las anteriores).
- **R-2:** código y esquema deben desplegarse juntos: si el código guarda 8 decimales y la columna sigue en 4, Postgres redondea al guardar (sin error). Orden seguro: migración primero, código después.
- **PA-1 (contadora, abierta):** pregunta de nómina todavía sin respuesta (ver memoria: cuota de préstamo restada dos veces en `PayrollRunService`). No es parte de esta spec.

## 12. Cierre
Lo completa `/implementar`.
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
