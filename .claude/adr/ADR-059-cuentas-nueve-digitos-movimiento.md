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

## SPEC-008 (2026-10-05): sugerencia de 9 dígitos y título padre obligatorio

Decisiones del dueño/contadora: la estructura `A.B.CC.DD.EEE` (1/1/2/2/3) es igual en todos los planes y **no se permite
crear una cuenta de movimiento sin título padre**.

- `getNextAccountCodeAction(type, companyId, parentId)` propone `PADRE.EEE` (primer EEE libre de 001 a 999; las cuentas
  eliminadas cuentan como ocupadas por el `@@unique([companyId, code])`). Los rangos numéricos de 4 dígitos
  desaparecieron.
- El padre obligatorio se valida **en el servidor**, no solo en el formulario: `createAccountAction`, `updateAccountAction`
  (solo si el código cambia y el nuevo es de movimiento) e `ImportService.importAccounts` (padre en la base o como título
  en el mismo archivo; `missing_parent` por fila sin abortar el lote). Reglas puras en `utils/parent-title.ts`.
- La regla **no es retroactiva** (RN-12): una cuenta existente sin título padre sigue siendo editable.
- Formulario "Nueva cuenta": selector "Cuenta padre (título)"; sin padre solo se pueden crear títulos.
- Auditoría de seguridad: GO (0 críticos/altos). Corregidos en la misma rama: `updateAccountAction` sin limiter (M-1),
  desbloqueo de la UI si la sugerencia falla por red (L-1) y topes de longitud en el importador (L-2).

## SPEC-012 (2026-10-05): selector de cuenta buscable que muestra los títulos

A petición de la contadora, el campo de cuenta de los formularios pasa de una lista a un **buscador por código o nombre**
(`AccountCombobox`, `src/lib/account-search.ts`). Los selectores **vuelven a recibir los títulos** que ADR-059 había
filtrado en las consultas, pero como **encabezados grises no elegibles**: `selectable` sale solo de `isPostable`, y el
gate de asientos (ADR-053) sigue siendo el respaldo. Entrega A (asientos manuales) hecha; la Entrega B migra el resto de
formularios. Auditoría de seguridad: GO.

## SPEC-012 Entrega B1 (2026-10-06): selector buscable en retenciones, bancos, presupuestos, inflación y caja chica

Las páginas y acciones de B1 vuelven a entregar los títulos (sin `isPostable: true` en la consulta, con `companyId`,
`deletedAt: null` y su filtro de tipo) y los formularios usan `AccountCombobox`; una cuenta guardada que dejó de ser elegible
se revalida al enviar (`isSelectableAccountId`). **Regla de reparto:** una página y todos los formularios que ella alimenta
migran en la misma entrega. Hueco conocido que B1 no cierra: los destinos de configuración no validan `isPostable` en el
servidor (L-1, ver Pendiente); el combobox es la única barrera de UI y el gate de asientos protege lo que genera asiento.

## Pendiente (no bloqueante)

- **Importador (M-2, R-6):** el AuditLog `IMPORT` guarda `ipAddress`/`userAgent` en null y los `create` no van en un
  `$transaction` con él; falta `captureNet` y registrar los códigos creados. Rama aparte (decisión de diseño de arch-agent).
- `deleteAccountAction`/`updateAccountAction` leen la cuenta por `{ id }` antes del guard: "Cuenta no encontrada" vs
  "acceso denegado" distingue un id existente de uno inexistente (L-4, poco explotable por ser CUID).
- Sugerencia: acotar el `findMany` de códigos ocupados por prefijo `${padre}.` (L-3, rendimiento) y prefetch de padres en
  el import.
- Cambiar solo el `type` de una cuenta de movimiento con el mismo código no revalida RN-3 contra su título (I-1).
- Mover `parent-title.ts` a `src/lib/` para no acoplar `import` con `accounting` (I-3).
- Borrar o renombrar un título con hijos los deja huérfanos (ya era así; fuera de alcance).
- `Pre.` (`isBudgetable`) no tiene consumidores y `budgets/page.tsx` ofrece solo cuentas de movimiento: ya confirmado
  por el dueño ("si, asi", 2026-10-04).
- `saveGLConfigAction` / `setFiscalConfigAction` no validan `isPostable` al elegir cuentas de configuración (el gate de
  asientos es el respaldo).
- (Auditoría de SPEC-012, fuera de esa spec) `TransactionService.createBalancedTransaction` valida que las cuentas sean
  de la empresa pero **no `isPostable`**: el único respaldo es el gate, que es fail-open ante un fallo de su consulta
  (LOW-1). Añadir `isPostable: true` al `where` del paso 3 como defensa en profundidad.
- (Hipótesis por lectura de código, SIN ejecutar) el mismo paso 3 compara `accounts.length !== accountIds.length` con
  `accountIds` sin deduplicar: un asiento con la misma cuenta en dos líneas daría «Cuentas no encontradas». Confirmar con un
  test `[A, A, B]` y, si es real, deduplicar antes de comparar.
- `transaction.schema.ts`: `entries` sin `.max()` (acotado hoy por rol y `limiters.fiscal`).
- (Auditoría de SPEC-012 B1) `BankAccountService.create`, `BudgetService.upsertLine`, `CajaCajaService.createCajaCaja` y
  `CajaCajaMovementService.createMovement` no validan `isPostable` (L-1): crear `assertAccountsPostable` en
  `src/lib/account-guard.ts` y cablearlo; en B2/B3 (nómina, cierre fiscal, ajustes contables, activos fijos) la misma clase sube a
  MEDIUM porque el fallo aparecería recién al correr la nómina o el cierre.
- (Auditoría de SPEC-012 B1) barrido de páginas sin guard propio (M-1): ver SPEC-012 §10, «Backlog de B1».
