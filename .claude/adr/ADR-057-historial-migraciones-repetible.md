# ADR-057 — El historial de migraciones debe poder repetirse desde cero

- **Estado:** Aceptado (2026-10-03)
- **Contexto:** SPEC-002 (job de integración contra Neon en CI)

## Contexto
Las migraciones de producción se aplican con el flujo manual de `CLAUDE.md` (`db execute` +
`migrate resolve --applied`), porque `migrate dev` está roto. Con ese flujo nadie necesitaba
que `prisma/migrations/` se pudiera **repetir desde una base vacía**. El job de integración
del CI lo exige: cada corrida clona un branch vacío de Neon (`contaflow-ci`) y aplica las
migraciones con `prisma migrate deploy`.

La primera corrida real (2026-10-03) reveló que de 164 migraciones, **2 no se podían repetir**
(medido reproduciendo todo el historial en una rama desechable, sin parar en el primer fallo):

| Migración | Fallo | Causa |
|---|---|---|
| `20260507_item72_legal_thresholds` | `42710 type "LegalThresholdType" already exists` | Duplicado exacto de `20260428_legal_threshold` (mismo enum, tabla, índices y FK; solo cambiaba el espaciado) |
| `20260511_contra_asset` | `55P04 unsafe use of new value "CONTRA_ASSET"` | `ALTER TYPE ... ADD VALUE` y un `UPDATE` que usa el valor nuevo en el mismo archivo; Prisma ejecuta cada archivo como una transacción y Postgres no permite usar un valor de enum añadido en la misma |

## Decisión
1. `20260507_item72_legal_thresholds` queda como no-op (`SELECT 1;`) con un comentario que explica por qué. Su efecto ya lo produce `20260428_legal_threshold`.
2. El `UPDATE` de `20260511_contra_asset` se mueve a una migración nueva, `20260511_contra_asset_backfill`, que corre en su propia transacción (ordena justo después por nombre). Es idempotente: en producción no encuentra filas con `type = 'ASSET'`.
3. **Regla nueva:** el job `integration` del CI aplica TODAS las migraciones desde cero en cada PR. Una migración que no se pueda repetir rompe el CI en el PR que la introduce. Un `ADD VALUE` de enum y cualquier uso de ese valor van siempre en migraciones separadas.

## Consecuencias
- **Checksums:** se modifican 2 migraciones ya aplicadas en producción, así que su checksum en `_prisma_migrations` deja de coincidir con el archivo. El flujo manual no lo verifica (`resolve --applied` recalcula al insertar y `migrate dev` ya está roto). No cambia el esquema resultante de producción.
- **Migración nueva pendiente en producción:** `20260511_contra_asset_backfill`. Su `UPDATE` es idempotente; basta aplicarla con el flujo manual (`db execute` + `resolve --applied`). **No se aplicó a ninguna base de producción como parte de este cambio.**
- **Verificación:** las 165 migraciones se aplicaron desde una base vacía sin errores (0 fallidas); el esquema resultante tiene 94 tablas, igual que los 94 modelos de `schema.prisma`, y el rol `authenticated` se crea por la propia migración `20260406110000`.

## Alternativas descartadas
- Manejar las 2 excepciones solo en el CI con `migrate resolve`: deja el historial sin poder repetirse y el CI arrastra casos especiales.

## Addendum 2026-10-08 — «repetible» no implicaba «equivalente a producción» (SPEC-022)

- **Estado:** Aceptado (2026-10-08). Complementa la decisión original sin cambiarla. La migración correctiva la aplica el usuario en producción con el flujo manual de `CLAUDE.md`; allí es un no-op para los tres objetos de abajo.
- **Contexto:** [SPEC-022](../specs/SPEC-022-reconciliar-deriva-schema-migraciones.md), que resuelve la deriva que el gate `prisma migrate diff` de [SPEC-014](../specs/SPEC-014-ci-gates-que-bloquean.md) dejó a la vista en su primera corrida real.

### Qué afirmaba ADR-057 y qué no garantizaba
ADR-057 demostró que el historial **se puede repetir desde cero**: aplicó las 165 migraciones a una base vacía sin errores y obtuvo 94 tablas, igual que los 94 modelos. Eso es «repetible». No garantizaba que la base reconstruida fuera **equivalente a producción**: «sin errores» y «mismo número de tablas» no ven una columna, un tipo o un índice de más.

### Causa (medida el 2026-10-08)
Prisma aplica las migraciones en orden **lexicográfico** del nombre del directorio; producción se aplicó a mano en orden **cronológico**. Verificado contra `_prisma_migrations` de producción: `20260829_overtime_entry_art183` (22:06) antes que `20260829_drop_duplicate_workshift` (23:35), y `20260830_payrollrun_period_partial_unique` (13:20) antes que `20260830_payrollrun_currency_segment` (17:09); el alfabético es el contrario. Un `DROP … IF EXISTS` que ordena antes de la migración que crea el objeto es un **no-op silencioso**, y el objeto sobrevive en la base reconstruida. Tres casos sobre 170 migraciones (33 `DROP … IF EXISTS`):
- Columna `Employee.workShift` y tipo `WorkShiftType` (creados por `overtime_entry_art183`, eliminados por `drop_duplicate_workshift`, que ordena antes).
- Índice único parcial `PayrollRun_companyId_period_active_key` (creado por `period_partial_unique`, eliminado por `currency_segment`, que ordena antes). En una base reconstruida impedía el segundo proceso de nómina del mismo período en otra moneda, justo lo que `currency_segment` quería habilitar. Es invisible para `prisma migrate diff` y `verify:drift`, que ignoran los índices parciales.

### Decisión
1. **Migración correctiva idempotente** `20261008_reconciliar_deriva_schema`: vuelve a eliminar los tres objetos (`IF EXISTS`) DESPUÉS de su última creación. No renombra ni edita las migraciones ya aplicadas.
2. **El gate `prisma migrate diff --exit-code` del CI exige un diff VACÍO**: se borra la línea base `scripts/ci/migrate-diff-baseline.sql` y `ci-workflow-invariants.test.ts` vigila que no vuelva.
3. **Test de arquitectura** `src/__tests__/architecture/migration-order.test.ts`: falla si un `DROP … IF EXISTS` (columna, tipo, tabla, índice o constraint) ordena antes de una creación posterior del mismo objeto sin que una migración posterior lo neutralice. Se prueba a sí mismo con fixtures y exige ver los 3 casos y al menos 33 drops en el repo real.

### Regla para migraciones futuras
- Dos migraciones del mismo día que dependan una de otra se nombran de modo que el **orden alfabético sea el de dependencia**.
- Un `DROP … IF EXISTS` de algo que otra migración crea va en una migración que ordene **después** de esa creación.
- **Nunca renombrar** una migración ya aplicada en producción: rompería la correspondencia nombre-fila de `_prisma_migrations` (hoy los 170 nombres coinciden) y sus checksums. La corrección va siempre hacia adelante, en una migración nueva.

### Alternativas descartadas
- Renombrar los directorios para que el alfabético sea el cronológico: ver la regla anterior; arregla el síntoma a costa de producción.
- Repetir el `DROP` también «antes»: no resuelve nada, el objeto se crea después y sobrevive.
- Aceptar la divergencia y dejar la línea base: el CI probaría contra una base distinta de producción y el índice de `PayrollRun` seguiría rechazando una nómina legítima en cualquier entorno nuevo.

### Límites conocidos
- El test es **de texto**: no ve `DO $$ … $$` ni SQL generado dinámicamente, y solo cubre columna, tipo, tabla, índice y constraint.
- Ni el test ni `migrate diff` comparan índices parciales, triggers, CHECK ni políticas RLS de producción frente a una base reconstruida. Queda **propuesta SPEC-023**: una instantánea normalizada del catálogo de Postgres (`pg_indexes`, `pg_constraint`, `pg_trigger`, políticas, defaults) versionada y comparada en CI, y ejecutable de solo lectura contra producción.
