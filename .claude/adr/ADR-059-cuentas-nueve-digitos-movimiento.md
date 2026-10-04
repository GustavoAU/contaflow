# ADR-059 — Solo las cuentas de 9 dígitos reciben movimiento; el nombre no es único

**Estado:** Aceptado (decisión del dueño + contadora, 2026-10-04)
**Relacionados:** ADR-053 (isPostable), ADR-056 (revertido en su parte de nombre único), `src/lib/account-code.ts`

## Contexto

Feedback de la contadora de la tester Alpha (captura de `1.1.01 — CAJAS` seleccionable en un asiento):

> "Las cuentas contables que tengan menos de nueve dígitos, esas no las podemos seleccionar. Incluyendo la que dice caja, la que dice capital […]. Deben aparecer como títulos y subtítulos, pero no como cuentas seleccionables."

Los títulos y subtítulos comparten nombre en mayúsculas (`UTILIDADES ACUMULADAS` en `3.2.01` y `3.2.01.01`) y no son cuentas repetidas: **lo único que no se repite es el código**.

## Verificado en producción (2026-10-04, solo lectura)

- Las dos empresas con el plan de la contadora ya tenían los títulos con `isPostable=false` (0 cuentas de < 9 dígitos de movimiento). El bug era de **pantalla**: ningún selector filtraba `isPostable`; el gate (ADR-053) solo rechazaba al guardar el asiento.
- Dos cuentas de 9 dígitos (`1.1.06.01.001/002`) estaban como título por la columna G/M del archivo.
- Dos empresas demo usan códigos de 4 dígitos (`1105`) y todo es de movimiento.
- ADR-056 había descartado "9 dígitos" porque cuentas de 9 dígitos fallaron por nombre duplicado; esos fallos eran duplicados reales de nombre entre cuentas de movimiento, que ahora tampoco bloquean.

## Decisión

1. **Regla única** (`isPostableCode`): ≥ 9 dígitos (sin contar separadores) ⇒ movimiento; menos ⇒ título/subtítulo.
2. **Importador**: `isPostable` sale del código; la columna G/M se ignora. El servidor lo recalcula en `importAccounts` (no confía en lo que mande el cliente).
3. **Alta/edición manual**: `createAccountAction` fija `isPostable` por el código (con aviso si queda como título; el aviso de "fuera de rango" ahora compara el PRIMER dígito, no un rango numérico de 4 dígitos). `updateAccountAction` recalcula `isPostable` **solo si el código cruza el umbral de 9 dígitos respecto al valor previo** — el formulario reenvía siempre `code`, así que "vino un code" no significa "cambió" (hallazgo H-1 de la auditoría: sin esto, editar el nombre de una cuenta heredada de 4 dígitos la degradaba a título en silencio). Pasar a título una cuenta con asientos se bloquea (conteo dentro del `$transaction`) y el cambio de `isPostable` queda en el AuditLog.
4. **Selectores**: `getAccountsAction(companyId, { onlyPostable: true })` y `isPostable: true` en las consultas de cuentas de los formularios (asientos, caja chica, activos fijos, inventario, conciliación, presupuestos, inflación, nómina, retenciones, ajustes GL). El plan de cuentas y los reportes siguen mostrando todo.
5. **Nombre no único**: se elimina el índice `Account_companyId_name_postable_key` y el pre-check de nombre; se elimina el flujo "renombrar y reintentar" del importador (ya no puede ocurrir). Revierte ADR-056 §Decisión.
6. **Migración** `20261004_account_name_unique_removed`: `DROP INDEX` + promoción a movimiento de cuentas ≥ 9 dígitos marcadas como título. No degrada cuentas existentes.

## Consecuencias / límites

- Las dos empresas demo con plan de 4 dígitos se migraron el 2026-10-05 (migración `20261005_demo_accounts_nine_digits`, esquema `1105 → 1.1.05.01.001`, con AuditLog) y los seeds (`prisma/seed*.ts`, `scripts/fix-demo-company.ts`) generan ya códigos de 9 dígitos. Ese mismo día se les creó la jerarquía completa de títulos (migración `20261005_demo_account_titles`: 169 títulos de 4 niveles, cada cuenta de movimiento con su padre de 6 dígitos; los seeds usan `prisma/seed-account-titles.ts`). Cualquier otra empresa con códigos de 4 dígitos no se migra automáticamente; sus cuentas nuevas con < 9 dígitos serán títulos.
- Dos cuentas de movimiento pueden tener el mismo nombre: la diferenciación en los selectores es por código (se muestra `código — nombre`).

## Pendiente (no bloqueante, decisión del dueño)

- `getNextAccountCodeAction` sigue proponiendo códigos de 4 dígitos (rangos 1000-1999…): una cuenta creada a mano con el código sugerido nace como título. Proponer el siguiente código de 9 dígitos requiere elegir el padre — diseño aparte.
- `Pre.` (`isBudgetable`) no tiene consumidores y `budgets/page.tsx` ahora ofrece solo cuentas de movimiento: confirmar con la contadora que se presupuesta en cuentas de 9 dígitos.
- `saveGLConfigAction` / `setFiscalConfigAction` no validan `isPostable` al elegir cuentas de configuración (el gate de asientos es el respaldo).
- Migración: aplicar y luego `npm run verify:drift`; antes, comprobar que ninguna cuenta de ≥ 9 dígitos marcada como título sea prefijo de otra (quedaría padre y movimiento a la vez).
