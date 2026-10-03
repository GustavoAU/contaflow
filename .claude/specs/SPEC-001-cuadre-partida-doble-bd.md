---
id: SPEC-001
titulo: Cuadre de partida doble garantizado en la base de datos
estado: APROBADA
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
- RN-1: Al confirmar una transacción de base de datos, todo asiento cuyas líneas se insertaron, modificaron o borraron en ella cumple `SUM(débitos) = SUM(créditos)`, con comparación exacta en `NUMERIC` (sin tolerancia).
- RN-2: La validación es diferida: un servicio puede insertar líneas una por una dentro del mismo `$transaction` sin fallar en los estados intermedios.
- RN-3: Un asiento anulado (VOID, ADR-005) sigue sujeto a RN-1: anular no puede descuadrar.
- RN-4: Si RN-1 falla, la transacción completa hace rollback y el usuario recibe un mensaje de negocio, nunca el error crudo de Postgres.
- RN-5: El trigger solo revisa los asientos tocados en la transacción, nunca la tabla completa (rendimiento).

## 5. Asientos contables
No crea asientos. Valida los de todos los módulos.

## 6. Modelo de datos
Sin cambios de columnas. Solo una migración con:
- Función PL/pgSQL que, para el asiento (`NEW`/`OLD`), compara la suma de débitos contra la de créditos y lanza `RAISE EXCEPTION` con un `ERRCODE` propio (por ejemplo, `'CF001'`) y el id del asiento.
- `CREATE CONSTRAINT TRIGGER … AFTER INSERT OR UPDATE OR DELETE ON <tabla de líneas> DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`.

**Antes de escribir el SQL, arch-agent debe confirmar en `prisma/schema.prisma`:**
- Cómo se llaman la tabla de cabecera y la de líneas. Según R-1, la cabecera es `Transaction` y las líneas `JournalEntry`, pero hay que verificarlo.
- Cómo se representan los montos: columnas `debit`/`credit` separadas, o `amount` + lado.
- En qué moneda se exige el cuadre: el monto en VES, el original, o ambos (ver P-2).
- Si hay líneas con monto cero o nulo y cómo deben contarse.

Migración: `YYYYMMDD_trigger_cuadre_partida_doble`, con el workflow manual de `CLAUDE.md`. El SQL debe ser idempotente (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`).

## 7. Contrato de servicio y actions
- `src/lib/prisma-errors.ts`: nueva función `isUnbalancedEntryError(e)` que detecta el `ERRCODE` del trigger. Debe considerar la forma del error con el adaptador Neon (ver LL-014: la información puede venir dentro de `driverAdapterError`).
- `toActionError` / `mapPrismaError`: mapear ese error a "El asiento no cuadra: débitos y créditos deben ser iguales. No se guardó ningún cambio."
- Sin actions nuevas.

## 8. UI
Sin cambios. El mensaje llega por el canal de errores existente.

## 9. Criterios de aceptación
- [ ] CA-1: La consulta de auditoría lista los asientos descuadrados existentes (puede ser cero) y se entrega al usuario **antes** de aplicar el trigger.
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
- **P-1 (RESUELTA 2026-10-02):** se corre primero la auditoría de solo lectura (CA-1). Si hay asientos descuadrados, el usuario decide cómo corregirlos antes de activar el trigger; no se activa sin ese resultado. Un asiento viejo descuadrado no se podrá anular ni editar hasta corregirlo.
- **P-2 (RESUELTA 2026-10-02, contadora):** "La moneda establecida para la contabilidad en Venezuela es en Bs., y las divisas, cuando se relacionan, se relacionan en Bs. a la tasa del día." Decisión: el cuadre se exige **solo sobre el monto en Bs.**, igualdad exacta; la moneda original no entra. Obligatorio para arch-agent antes del SQL: confirmar en `prisma/schema.prisma` que cada línea guarda su monto en Bs. ya redondeado. Si el Bs. se calcula en lectura y no se persiste, la igualdad exacta no es viable y hay que volver al usuario.
- **R-1:** importaciones masivas y scripts de seed que hoy insertan líneas fuera del servicio podrían empezar a fallar. Es el comportamiento deseado, pero hay que correr los seeds en un branch de Neon antes de producción.
- **R-2:** los tests unitarios con Prisma mockeado no ven el trigger. CA-2 a CA-5 requieren tests de integración (ver SPEC-002 para correrlos en CI).
- **R-3:** aplicar primero en un branch de Neon, nunca directo en producción.

## 12. Cierre
- Commits:
- Tests: antes N → después N
- ADR creado o actualizado:
- Lección aprendida (LL-XXX):
