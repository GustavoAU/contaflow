---
id: SPEC-001
titulo: Cuadre de partida doble garantizado en la base de datos
estado: APROBADA   # reaprobada 2026-10-03 (T = 0). NO implementar hasta que SPEC-004 esté HECHA y la auditoría dé cero
fecha: 2026-10-01
rama: feat/spec-001-cuadre-bd
arbol: "[7]"
zonas: [Z-3]
adrs: [ADR-005, ADR-007, ADR-044, "ADR nuevo: cuadre en BD"]
---

# Cuadre de partida doble garantizado en la base de datos

## 1. Problema
Hoy la regla "débitos = créditos" solo se valida en la aplicación (`TransactionService` / `validateDoubleEntry`). Cualquier escritura que no pase por ese servicio puede dejar un asiento descuadrado sin que nada lo detenga: un script de `prisma/` (`fix-*.ts`, `seed-*.ts`), un `$executeRaw`, una migración de datos, un módulo nuevo que arme líneas por su cuenta o un agente que se salte el servicio.

La existencia de `prisma/diagnose-balance.ts` y `prisma/fix-payroll-balance.ts` sugiere que esto ya ocurrió al menos una vez. Para la invariante más importante de una app contable, la base de datos debe ser la última línea de defensa.

## 2. Base legal / contable
- Principio de partida doble (VEN-NIF / marco conceptual): todo asiento registra débitos y créditos por igual importe.
- COT Art. 23 y PA-121: los libros deben ser íntegros y verificables. Un Libro Mayor descuadrado es un hallazgo de fiscalización.

## 3. Alcance
**Incluye:**
- Auditoría previa de los datos existentes: listar todo asiento descuadrado en la base actual, por empresa.
- Constraint trigger `DEFERRABLE INITIALLY DEFERRED` que valida, al hacer COMMIT, que cada asiento afectado cuadre.
- Mensaje de error mapeado a un mensaje de negocio en la capa de actions.
- Tests de integración contra una base real (el trigger no se puede probar con mocks).
- ADR que documente la decisión.

**No incluye (explícito):**
- Corregir asientos descuadrados existentes. Si la auditoría encuentra alguno, se reporta y el usuario decide cómo corregirlo (con asiento de ajuste, nunca DELETE, por ADR-005).
- Cambiar la validación aplicativa: `validateDoubleEntry` se mantiene, porque da mejores mensajes y falla antes.
- Validaciones de cuadre por moneda original (descartado por la contadora, ver P-2).

## 4. Reglas de negocio
`JournalEntry` guarda UN solo `amount Decimal(19,4)` firmado (débito > 0, crédito < 0); no hay columnas de débito/crédito ni de moneda. El cuadre de un asiento es `SUM(amount) = 0` por `transactionId`.

- RN-1: Al confirmar una transacción de base de datos, todo asiento cuyas líneas se insertaron, modificaron o borraron en ella cumple `ABS(SUM(amount)) <= T`, con `T` = **tolerancia** parametrizada en la función. **`T = 0` (EXACTO), decidido el 2026-10-03 por la contadora (PA-1).** Por eso la SPEC-004 es PRERREQUISITO: el trigger no se activa hasta que los generadores de asientos redondeen a 4 decimales y la auditoría dé cero.
- RN-2: La validación es diferida: un servicio puede insertar líneas una por una dentro del mismo `$transaction` sin fallar en los estados intermedios.
- RN-3: Un asiento anulado (VOID, ADR-005) sigue sujeto a RN-1: anular no puede descuadrar.
- RN-4: Si RN-1 falla, la transacción completa hace rollback y el usuario recibe un mensaje de negocio, nunca el error crudo de Postgres.
- RN-5: El trigger solo revisa los asientos tocados en la transacción, nunca la tabla completa (rendimiento).

## 5. Asientos contables
No crea asientos. Valida los de todos los módulos.

## 6. Modelo de datos
Sin cambios de columnas. Solo una migración con:
- Función PL/pgSQL que, para la transacción (`NEW."transactionId"` / `OLD."transactionId"`), compara `ABS(SUM(amount))` contra `T` y lanza `RAISE EXCEPTION` con un `ERRCODE` propio (por ejemplo, `'CF001'`) y el id del asiento.
- `CREATE CONSTRAINT TRIGGER … AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`.

**Confirmado en `prisma/schema.prisma` (2026-10-03):**
- Cabecera `Transaction`, líneas `JournalEntry` (FK `transactionId`, `onDelete: Restrict`).
- Monto: un solo `amount Decimal(19,4)` firmado. Sin moneda por línea: todo está en Bs. (cierra P-2).
- Una transacción sin líneas no dispara el trigger (no hay fila de `JournalEntry` que lo active). Hoy hay 0 así en producción.

Migración: `YYYYMMDD_trigger_cuadre_partida_doble`, con el workflow manual de `CLAUDE.md` (`migrate dev` está roto) y **repetible desde cero** (ADR-057): el job `integration` la aplica sobre una BD vacía. El SQL debe ser idempotente (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`).

## 7. Contrato de servicio y actions
- `src/lib/prisma-errors.ts`: nueva función `isUnbalancedEntryError(e)` que detecta el `ERRCODE` del trigger. Debe considerar la forma del error con el adaptador Neon (ver LL-014: la información puede venir dentro de `driverAdapterError`).
- `toActionError` / `mapPrismaError`: mapear ese error a "El asiento no cuadra: débitos y créditos deben ser iguales. No se guardó ningún cambio."
- Sin actions nuevas.

## 8. UI
Sin cambios. El mensaje llega por el canal de errores existente.

## 9. Criterios de aceptación
- [x] CA-1: La consulta de auditoría lista los asientos descuadrados existentes y se entrega al usuario **antes** de aplicar el trigger. Hecho 2026-10-03: 1 asiento con residuo 0,0001 de 117 (ver sección 11, P-1). Consulta: agrupar `SUM("JournalEntry".amount)` por `"Transaction".id` y clasificar `= 0`, `<= 0.01`, `> 0.01` y sin líneas.
- [ ] CA-2: Insertar un asiento cuadrado en varias sentencias dentro de un `$transaction` hace commit sin error.
- [ ] CA-3: Insertar un asiento descuadrado hace rollback completo; no queda ni la cabecera ni ninguna línea.
- [ ] CA-4: Modificar el monto de una línea existente de forma que descuadre falla al hacer commit.
- [ ] CA-5: Borrar una línea de un asiento cuadrado falla al hacer commit.
- [ ] CA-6: La action correspondiente devuelve el mensaje de negocio de la sección 7, no el error crudo.
- [ ] CA-7: La suite completa existente (`vitest run`) sigue en verde.
- [ ] CA-8: Los flujos que generan asientos automáticos (factura, pago, nómina, COGS, cierre de ejercicio, diferencial cambiario) pasan sus tests de integración con el trigger activo.

## 10. Plan de agentes

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|

## 11. Riesgos y preguntas abiertas
- **P-1 (RESUELTA 2026-10-03):** la auditoría de solo lectura de PRODUCCIÓN (proyecto `royal-voice-77113362`) dio: 117 asientos en 2 empresas, todos POSTED; **116 cuadran exactamente; 1 con residuo de 0,0001 Bs.** (`NOM-2026-08-16-83jgfm`, id `cmtkl766x0000sslwig0uyju5`, empresa demo "Tecnología y Suministros Andina, C.A." de Gustavo, período OPEN, causación de nómina en USD). 0 asientos con descuadre mayor a 0,01, 0 sin líneas, 0 anulados. Usuario: "corrígelos todos"; la empresa es su cuenta DEMO, sin riesgo. La corrección solo es necesaria si `T = 0`.
- **P-2 (RESUELTA 2026-10-02/03, contadora):** contabilidad en Bs., divisas a la tasa del día. Además `JournalEntry` no tiene moneda: todo ya está en Bs.
- **PA-1 (RESUELTA 2026-10-03, contadora vía Gustavo: "todo, todo, hasta en decimales" → `T = 0` EXACTO; implica SPEC-004 antes del trigger y corregir el asiento NOM-2026-08-16-83jgfm con un ajuste). Pregunta original:** ¿el cuadre del libro debe ser **exacto a 4 decimales** (`T = 0`) o basta **a nivel de céntimo** (`T = 0.01`)? Hoy la aplicación acepta hasta 0,01 y producción tiene 1 asiento con 0,0001. Las dos opciones y su costo: `T = 0` exige corregir antes el redondeo de TODOS los generadores de asientos (SPEC-004) y corregir el asiento existente con un ajuste; `T = 0.01` no rompe nada y deja la base alineada con la aplicación, pero permite que un asiento quede descuadrado hasta un céntimo y que el balance de comprobación derive 0,0001 por cada nómina en USD.
- **Hallazgo — causa raíz del residuo (verificada con datos):** los generadores calculan los montos en precisión alta de `Decimal.js` (~20 dígitos), multiplican por la tasa BCV cuando el origen es USD (aquí 779,9522 × 11 líneas) y `assertBalancedGLEntries` valida **sin redondear**; Postgres luego redondea cada línea por separado a 4 decimales al guardar. Hay 38 call-sites de `assertBalancedGLEntries` en ~20 servicios: es una clase de bug (ver SPEC-004).
- **R-1:** importaciones masivas y scripts de seed que hoy insertan líneas fuera del servicio podrían empezar a fallar. Es el comportamiento deseado, pero hay que correr los seeds contra un branch del CI antes de producción.
- **R-2:** los tests unitarios con Prisma mockeado no ven el trigger. Los casos CA-2 a CA-5 requieren tests de integración, que ya corren en CI (SPEC-002).
- **R-3:** aplicar primero en el branch efímero del CI. **La aplicación a producción está autorizada por el usuario (2026-10-03: "si se necesita aplicar, hazlo")**, pero solo después de que `T` esté decidida, el CI en verde y la auditoría de CA-1 en cero.

## 12. Cierre
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
