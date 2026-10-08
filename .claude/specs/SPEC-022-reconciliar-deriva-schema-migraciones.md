---
id: SPEC-022
titulo: Reconciliar la deriva entre schema.prisma y las migraciones (y que una base reconstruida sea igual a producción)
estado: HECHA   # aprobada por Gustavo el 2026-10-08 (B.1: onUpdate: NoAction en el schema); mergeada a main el 2026-10-08 (PR #78, 9e06e509); falta aplicarla a produccion (CA-9, la hace el dueno)
fecha: 2026-10-08
rama: fix/spec-022-deriva-schema-migraciones
arbol: "[7]"
zonas: [Z-2]
adrs: [ADR-003, ADR-057]
---

# Reconciliar la deriva entre `schema.prisma` y las migraciones

## 1. Problema
El gate `prisma migrate diff` de SPEC-014 mostró en su primera corrida real que una base **reconstruida desde las 170 migraciones** no coincide con `schema.prisma`: 27 sentencias de diferencia, hoy congeladas en `scripts/ci/migrate-diff-baseline.sql`. Mientras exista esa línea base, el gate no puede exigir un diff vacío.

La investigación de cada diferencia (sección 3) separa dos clases de problema:

1. **Deriva cosmética o de intención** (la mayoría): metadatos, defaults, nombres de índice, un `NOT NULL` más estricto en la BD que en el schema. Ninguna cambia el comportamiento de la app hoy.
2. **Divergencia entre una base reconstruida y producción**, causada por el **orden** de las migraciones: `Prisma` las aplica en orden lexicográfico del nombre, y en producción se aplicaron a mano en orden cronológico. Cuando dos migraciones del mismo día se estorban, el resultado difiere. Hay dos casos reales, y **uno es invisible para el gate** porque es un índice parcial:
   - `Employee.workShift` y el tipo `WorkShiftType` sobreviven en una base nueva (`20260829_drop_duplicate_workshift` ordena antes que `20260829_overtime_entry_art183`, que los crea).
   - El índice único parcial `PayrollRun_companyId_period_active_key` sobrevive en una base nueva (`20260830_payrollrun_currency_segment`, que lo elimina, ordena antes que `20260830_payrollrun_period_partial_unique`, que lo crea). Ese índice impide un segundo proceso de nómina del mismo período, justo el caso de dos monedas que `currency_segment` quería habilitar: **una base reconstruida (CI, un entorno nuevo, una recuperación desde migraciones) rechazaría esa nómina legítima**. Verificado en producción el 2026-10-08: allí ninguno de los dos objetos existe, porque se aplicó en orden cronológico (ver la verificación A en la sección 11).

Corrección a lo dicho al cerrar SPEC-014: las 4 claves foráneas con diferencia **no** tienen una regla de borrado distinta. Las migraciones las crearon con `ON DELETE RESTRICT`, igual que el schema; lo único que difiere es `ON UPDATE` (la BD usa el valor por defecto, `NO ACTION`; el schema, sin `onUpdate`, implica `CASCADE`). ADR-003 regula solo `onDelete`.

## 2. Base legal / contable
Ninguna — decisión de ingeniería. Indirecta: el estado de la nómina por período y la retención de IVA de los cobros (`PaymentRecord.ivaRetentionAmount`, Prov. 0049) dependen de que la BD se comporte igual en todos los entornos.

## 3. Alcance
**Incluye:**

A) **Verificación previa en producción (PAUSA, solo lectura, la hace el usuario).** Todo lo medido hasta aquí es sobre una base *reconstruida*, no sobre producción. Antes de decidir nada definitivo se corre contra producción:
   1. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` con la URL directa de producción (es de solo lectura); la salida se compara con la línea base. Las diferencias que aparezcan en producción y no en la base reconstruida (o al revés) se anotan en la sección 11 y cambian el plan.
   2. Tres consultas de solo lectura (sección 11) para lo que `migrate diff` no ve: el índice parcial `PayrollRun_companyId_period_active_key`, la columna `Employee.workShift` y el default de `EmployeeLoan.status`.

B) **Cambios solo de schema (la BD no se toca; producción no se toca).** El schema pasa a describir lo que la BD ya tiene, porque la BD es más estricta o más segura, o equivalente, y el código coincide:

| # | Hallazgo | BD (migraciones) | Schema hoy | Cambio en `schema.prisma` |
|---|---|---|---|---|
| 1 | 4 FKs: `CompanySettings.inventoryAccountId`, `CompanySettings.islrRetentionPayableAccountId`, `InventoryMovement.counterpartAccountId`, `Retencion.enteradoTransactionId` (8 sentencias) | `ON DELETE RESTRICT`, sin `ON UPDATE` (= `NO ACTION`) | sin `onUpdate` (= `CASCADE`) | `onUpdate: NoAction` en las 4 relaciones. Los ids son cuid inmutables: ningún efecto práctico; `NO ACTION` es la opción más estricta |
| 2 | Índice `CompanySettings_ivaRetentionReceivableAccountId_idx` | existe (`20260526_cobropago_ivaretention`) | no declarado | `@@index([ivaRetentionReceivableAccountId])` |
| 3 | `updatedAt` en 9 modelos: `AbsenceType`, `CustomerGroup`, `Employee`, `ManagedClient`, `PayrollConcept`, `PayrollRun`, `VacationRequest`, `VendorGroup`, `PlanChangeRequest` (`plan_change_requests`) | `NOT NULL DEFAULT CURRENT_TIMESTAMP` (migraciones escritas a mano; el resto de tablas no lo tiene) | `@updatedAt` | `@default(now()) @updatedAt`. Inofensivo y defensivo para SQL crudo (la siembra de SPEC-014 y los scripts operativos lo aprovechan) |
| 4 | `DocShareToken.expiresAt/revokedAt/createdAt` y `FiscalReport.generatedAt` (2 sentencias) | `TIMESTAMPTZ` | `DateTime` (`timestamp(3)`) | `@db.Timestamptz(6)` en las 4 columnas. Convertir el tipo reescribiría la tabla sin beneficio |
| 5 | `PaymentRecord.ivaRetentionAmount` | `DECIMAL(19,4) NOT NULL DEFAULT 0` (`20260526_cobropago_ivaretention`) | `Decimal?` con default 0 | `Decimal @default(0) @db.Decimal(19, 4)` (sin `?`). Ningún código escribe `null`; la BD es más estricta. **Cambia el tipo generado** (`Decimal | null` pasa a `Decimal`): `tsc` revisa a los consumidores |

C) **Una migración correctiva, idempotente y aditiva**, `YYYYMMDD_reconciliar_deriva_schema` (con fecha posterior a la última, hoy `20261005_trigger_cuadre_partida_doble`). Medido en producción (verificación A): los tres `DROP` de objetos huérfanos son no-ops allí; el resto hace cambios reales y pequeños (un índice en `Account`, 714 filas; un `DROP INDEX` en `BenefitAdvance`, 1 fila; el default de `EmployeeLoan.status`; dos renombres de índice):

```sql
-- 1. Índice que schema.prisma declara y ninguna migración creó (Account.isPostable, ADR-053).
CREATE INDEX IF NOT EXISTS "Account_companyId_isPostable_idx" ON "Account" ("companyId", "isPostable");

-- 2. Índice redundante: es prefijo de (companyId, employeeId) y de (companyId, status).
DROP INDEX IF EXISTS "BenefitAdvance_companyId_idx";

-- 3. El schema declara PENDING (flujo de aprobación); la BD tenía ACTIVE. El servicio y el seed
--    ya fijan el status explícito, así que esto solo protege a quien inserte sin status.
ALTER TABLE "EmployeeLoan" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- 4. Orden de migraciones (mismo día): en una base nueva estos objetos sobreviven.
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";
DROP TYPE IF EXISTS "WorkShiftType";
DROP INDEX IF EXISTS "PayrollRun_companyId_period_active_key";

-- 5. Nombres de índice alineados con los que calcula Prisma (solo metadatos).
ALTER INDEX IF EXISTS "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriodMont"
  RENAME TO "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriod_key";
ALTER INDEX IF EXISTS "caja_caja_reimbursements_reimbursementNumber_key"
  RENAME TO "caja_caja_reimbursements_companyId_reimbursementNumber_key";
```

   Ningún `DROP` toca datos: `workShift` solo contenía el `DEFAULT`, y `workSchedule` (el campo que sí se usa) no se toca. `CREATE INDEX` sin `CONCURRENTLY` porque la migración corre en una transacción; la tabla `Account` tiene 714 filas (medido en la verificación A) y el bloqueo de escrituras dura un instante. El archivo empieza con `SET lock_timeout = '5s'`: si otra transacción tiene bloqueada una de las tablas, falla en voz alta en lugar de hacer cola detrás de ella; reintentar es seguro. Conviene aplicarla en una hora tranquila.

D) **Vaciar la línea base y endurecer el gate.** Con la deriva resuelta: se borra `scripts/ci/migrate-diff-baseline.sql`, el paso de `ci.yml` pasa a exigir que `prisma migrate diff --exit-code` salga con **0**, y `ci-workflow-invariants.test.ts` deja de exigir la línea base (y exige, en su lugar, que el paso use `--exit-code` y no compare contra ningún archivo).

E) **Guarda del orden de migraciones (la clase de bug).** Test de arquitectura `migration-order.test.ts` que recorre `prisma/migrations` en orden lexicográfico y falla si un `DROP … IF EXISTS` de una columna, tipo, tabla, índice o constraint ordena **antes** de una migración que crea ese mismo objeto **sin** que otra migración posterior lo vuelva a eliminar. El barrido de esta spec lo ejecutó sobre las 170 migraciones: 33 `DROP … IF EXISTS`, 940 creaciones, **3 casos** (los 3 objetos de la sección C.4). Con la migración correctiva (que los elimina al final) el test queda en verde sin lista de excepciones; un caso nuevo lo hace fallar. El análisis es de texto: no ve `DO $$ … $$`.

F) **Nota en ADR-057** (addendum): "repetible desde cero" no implicaba "equivalente a producción". Tras esta spec lo son, y el gate más el test del punto E lo mantienen.

**No incluye (explícito):**
- Cambiar datos. Ninguna reconciliación afloja una restricción ni reescribe filas.
- Pasar `ON UPDATE` a `CASCADE` en la BD (el schema sigue a la BD).
- Aplicar la migración a producción: la aplica el usuario con el flujo manual de `CLAUDE.md` (`db execute` + `migrate resolve --applied`). El job de SPEC-015 lo hará después.
- Un diff de catálogo completo entre una base nueva y producción (índices parciales, triggers, CHECK, políticas RLS: nada de eso lo ve `migrate diff`). Queda propuesto como SPEC-023 (sección 11).

## 4. Reglas de negocio
- RN-1: Ninguna reconciliación cambia datos ni afloja una restricción.
- RN-2: Si la BD es más estricta o equivalente y el código coincide, **el schema sigue a la BD** (sin tocar producción).
- RN-3: Si el schema expresa una intención que la BD no tiene y agregarla es aditivo, **la BD sigue al schema** mediante una migración idempotente (`IF [NOT] EXISTS`).
- RN-4: La migración es compatible con el código desplegado anterior (expand/contract): ninguna columna que el código lea se elimina.
- RN-5: Una base reconstruida desde las migraciones es equivalente a producción en todo lo que `migrate diff` ve **y** en los tres objetos de la sección C.4.
- RN-6: Dos migraciones no pueden depender de un orden que su nombre no garantice (lo vigila el test del punto E).
- RN-7: Tras la spec, `prisma migrate diff --exit-code` sobre una base reconstruida sale con 0 y no existe línea base.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Cambios de `schema.prisma` (punto B, sin migración) y una migración correctiva (punto C). Sin tablas nuevas, así que no hay RLS que añadir (ADR-007 A1-bis). Tras editar el schema: `prisma format`, `prisma generate`, `pnpm verify:schema-format`.

## 7. Contrato de servicio y actions
No aplica; ningún servicio cambia de firma. Archivos:
- `prisma/schema.prisma`, `prisma/migrations/YYYYMMDD_reconciliar_deriva_schema/migration.sql`
- consumidores de `PaymentRecord.ivaRetentionAmount` si `tsc` los marca (se corrigen en esta spec, sin cambio de comportamiento)
- `scripts/ci/migrate-diff-baseline.sql` (se borra), `.github/workflows/ci.yml`, `src/__tests__/architecture/ci-workflow-invariants.test.ts`
- `src/__tests__/architecture/migration-order.test.ts` (nuevo) y un test de integración para los criterios CA-2, CA-3 y CA-4
- `.claude/adr/ADR-057-historial-migraciones-repetible.md` (addendum)

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [x] CA-1: En el job `integration`, `prisma migrate diff --exit-code` sale con 0 y `scripts/ci/migrate-diff-baseline.sql` ya no existe. Evidencia: PR #78, corrida 37859698842: el paso de `migrate diff` imprime `OK: la BD migrada coincide con schema.prisma` (exit 0) y `scripts/ci/migrate-diff-baseline.sql` ya no existe.
- [x] CA-2: Test de integración: sobre una base reconstruida, `Employee` no tiene la columna `workShift`, no existe el tipo `WorkShiftType` ni el índice `PayrollRun_companyId_period_active_key`; existe `Account_companyId_isPostable_idx`; no existe `BenefitAdvance_companyId_idx`. Evidencia: `migration-reconciliation.test.ts` (18 tests; los 5 archivos de integracion en verde en el CI). En una base reconstruida de verdad (rama temporal del sandbox) fallaban 13 de 15 sin la migracion y pasan los 15 con ella.
- [x] CA-3: Test de integración: se pueden crear **dos** procesos de nómina vigentes del mismo período y empresa con `currencySegment` distinto (VES y USD), y el segundo con el mismo segmento es rechazado. Evidencia: sin la migracion, el segundo proceso (USD) fallaba con `P2002`; con ella se crean ambos y el segundo del mismo segmento se rechaza (en la base temporal y en el CI).
- [x] CA-4: La migración correctiva aplicada una segunda vez sobre la misma base no falla (idempotencia). Evidencia: el test aplica el SQL de la migracion dos veces seguidas y vuelve a comprobar el catalogo (en la base temporal y en el CI).
- [x] CA-5: `EmployeeLoan` insertado por SQL sin `status` queda `PENDING`; el servicio y el seed siguen fijando el suyo. Evidencia: comprobado como default de la columna (`information_schema.columns.column_default` contiene `PENDING`), no insertando un prestamo por SQL: es equivalente y no obliga a sembrar empresa y empleado. El servicio y el seed ya fijan el `status` explicito.
- [x] CA-6: `migration-order.test.ts` pasa sobre el repo y falla con un fixture que pone un `DROP … IF EXISTS` antes de la migración que crea el objeto. Evidencia: `migration-order.test.ts`, 104 tests y 1 `todo`; falla con fixtures de `DROP … IF EXISTS` antes de la creacion y pasa sobre el repo (33 drops, 3 casos, los 3 neutralizados por la migracion correctiva).
- [x] CA-7: `tsc`, `vitest`, `pnpm verify:drift`, `pnpm verify:enum-drift` y `pnpm verify:schema-format` en verde tras el cambio de tipo de `ivaRetentionAmount`. Evidencia: suite completa en 6 shards, 7480 tests y 2 `todo`, 0 fallos; el CI del PR (corrida 37859698842) paso entero, con `tsc`, `lint:ci`, formato, `prisma format --check` y los 4 `verify:*`.
- [x] CA-8: `ci-workflow-invariants.test.ts` en verde con el paso de `migrate diff` sin línea base. Evidencia: `ci-workflow-invariants.test.ts` (22 tests): exige `--exit-code`, prohibe volver a referenciar una linea base y comprueba que el archivo no exista, con mutaciones.
- [ ] CA-9 (la hace el usuario, PAUSA): tras aplicar la migración a producción, `migrate diff` contra producción (solo lectura) sale vacío. **PENDIENTE:** comandos exactos en la seccion 12.

## 10. Plan de agentes

Línea base (2026-10-08, `main` 723b240a): `tsc --noEmit` exit 0 · 7375 tests y 1 `todo` según el CI de `main` (corridas verdes en `d952e4fb` y `1cc68081`; desde entonces `main` solo recibió documentación). La suite completa se corre en 6 shards al cerrar. Plan armado por la sesión principal (`orchestrator-agent` no está disponible como subagente).

| Paso | Agente | Subtarea | TDD |
|---|---|---|---|
| 1 | test-agent | Tests en RED: `migration-order.test.ts` (detector con fixtures; los 3 casos reales sin neutralizar lo ponen en rojo) y `migration-reconciliation.test.ts` de integración (CA-2: catálogo; CA-3: dos nóminas del mismo período con distinto segmento; CA-4: idempotencia; CA-5 como default de la columna) | sí |
| 2 | sesión principal | **Primer push solo con los tests.** El job `integration` debe fallar en «Tests de integración» por la razón correcta: es la evidencia, en una base reconstruida de verdad, de que el bug existe. **PAUSA — requiere al usuario:** aprobar `neon-ci` | no |
| 3 | sesión principal | GREEN: cambios de `schema.prisma` (B) con verificación sin BD (`migrate diff` de schema a schema debe invertir las sentencias de la línea base); migración correctiva (C); ripple de `ivaRetentionAmount` hasta `tsc` en 0 | — |
| 4 | sesión principal | D: borrar la línea base, exigir `--exit-code` = 0 en `ci.yml` y actualizar `ci-workflow-invariants.test.ts` | — |
| 5 | arch-agent | F: addendum de ADR-057 («repetible» no implicaba «equivalente a producción») | no |
| 6 | security-agent | Revisar el diff: migración y su idempotencia, cambio de tipo de `PaymentRecord.ivaRetentionAmount` (Z-2), cambios de `ci.yml` y del test de invariantes | no |
| 7 | sesión principal | Gates (`tsc`, `lint:ci`, `format:check`, `prisma format --check`, suite en shards); segundo push y **PAUSA** `neon-ci`: `migrate diff --exit-code` debe salir con 0 (CA-1); dejar al usuario el SQL y los comandos para producción (CA-9, solo él los aplica); sección 12 | no |

## 11. Riesgos y preguntas abiertas
- **PAUSA — requiere al usuario:**
  1. ~~La verificación A~~ — **HECHA el 2026-10-08** (resultados abajo). Ya no bloquea la aprobación.
  2. Aplicar la migración a producción con el flujo manual y registrarla (`migrate resolve --applied`). Ningún agente toca producción.
  3. Confirmar la decisión del punto B.1: `onUpdate: NoAction` en el schema (recomendado: cero cambios en la BD) frente a una migración que pase esas 4 FKs a `ON UPDATE CASCADE`.

  Consultas de solo lectura para la verificación A.2:
  ```sql
  -- (a) ¿Existe el índice parcial que en una base nueva sobrevive?
  SELECT indexname FROM pg_indexes WHERE tablename = 'PayrollRun' AND indexname = 'PayrollRun_companyId_period_active_key';
  -- (b) ¿Existe la columna huérfana?
  SELECT column_name FROM information_schema.columns WHERE table_name = 'Employee' AND column_name = 'workShift';
  -- (c) Default actual de EmployeeLoan.status y tamaño de las tablas donde se crea un índice o se elimina otro
  SELECT column_default FROM information_schema.columns WHERE table_name = 'EmployeeLoan' AND column_name = 'status';
  SELECT (SELECT count(*) FROM "Account") AS cuentas, (SELECT count(*) FROM "BenefitAdvance") AS adelantos;
  ```
  Resultado esperado en producción: (a) 0 filas, (b) 0 filas, (c) default distinto de `PENDING`. Cualquier otro resultado es un hallazgo nuevo.
- R-1 (RESUELTO): producción difiere de la base reconstruida **solo** en `Employee.workShift` y `WorkShiftType`, que no tiene (verificación A). El plan no cambia.
- R-2: `PaymentRecord.ivaRetentionAmount` deja de ser opcional en los tipos generados. Es un cambio de tipo en una zona fiscal (Z-2) sin cambio de comportamiento; `security-agent`/`fiscal-agent` revisan que ningún camino dependa de `null`.
- R-3: `@db.Timestamptz(6)` en `DocShareToken` y `FiscalReport` no cambia la BD; si el adaptador de Neon serializara las fechas distinto para ese tipo, no existe ningún test de integración de documentos que lo cubra (corrección de la revisión de seguridad). El riesgo residual es mínimo: la expiración del enlace la fija el JWT (`document.actions.ts`) y la ruta solo comprueba `revokedAt !== null`. Se comprueba con una prueba manual de compartir y revocar un documento tras el despliegue.
- R-4: Queda fuera de alcance lo que `migrate diff` no ve (índices parciales, exclusiones, triggers, CHECK, políticas RLS). **Propuesta SPEC-023:** una instantánea normalizada del catálogo de Postgres (`pg_indexes`, `pg_constraint`, `pg_trigger`, políticas, defaults) versionada y comparada en CI contra una base reconstruida, y ejecutable de solo lectura contra producción. Habría detectado el caso de `PayrollRun` sin depender de que alguien recuerde mirarlo.
- R-5: `verify:drift` excluye los índices parciales a propósito (cabecera de `scripts/verify-schema-drift.mjs`); por eso el caso de `PayrollRun` pasó todos los gates hasta ahora.
- R-6: límites conocidos de `migration-order.test.ts` (análisis de texto), además de `DO $$ … $$`: identificadores con esquema (`"public"."X"`), `RENAME TO` como forma de crear un objeto y `CONSTRAINT` en línea dentro de `CREATE TABLE`. El centinela (al menos 33 `DROP … IF EXISTS` y los 3 casos conocidos) evita que el detector quede ciego, pero no cubre esas formas.
- R-7 (revisión de seguridad, cerrado): `migration-reconciliation.test.ts` siembra filas y ejecuta DDL real (CA-4), así que no debe correr contra una base que no sea el branch efímero. Guarda: al inicio de `beforeAll` y antes de escribir, aborta si existe alguna empresa cuyo id no empiece por `ci-rls-probe-`, `integration-` o `spec022-` (una base real tiene ids cuid). Tiene sus propios tests sin base de datos. Los otros tests de integración tienen una guarda más débil: queda como seguimiento.
- R-8: no existe `.github/CODEOWNERS`; un PR puede editar el workflow y su test de invariantes a la vez. El control real es el environment `neon-ci` (revisor humano). Seguimiento opcional.

**Verificación A — resultados en producción (2026-10-08, hecha por el usuario, solo lectura; rama `production` `br-rough-sound-ai9i4g7p`, endpoint directo `ep-summer-fog-ai2n0tde`):**
- **`prisma migrate diff` contra producción**, comparado con la línea base: idéntico salvo dos bloques, `Employee.workShift` y `WorkShiftType`, que producción **no** tiene. Las otras 25 sentencias de deriva existen igual en producción: el plan de la spec se aplica a producción y no solo a bases nuevas.
- **Consultas SQL:** (a) el índice parcial `PayrollRun_companyId_period_active_key` no existe en producción (0); (b) la columna `Employee.workShift` no existe (0); (c) el default de `EmployeeLoan.status` es `'ACTIVE'::"LoanStatus"` (la migración lo cambia a `PENDING`); (d) `Account` tiene 714 filas y (e) `BenefitAdvance` 1; (g) los índices de `PayrollRun` son `idempotencyKey_key`, `periodStart_idx`, `status_idx`, `no_overlap_active` (la restricción de exclusión), `pkey` y `transactionId_key`. No existe ningún índice único parcial por período: `20260830_payrollrun_exclusion_solape` sustituyó al de segmento por la restricción de exclusión.
- **Orden de aplicación en producción (consulta h):** `overtime_entry_art183` (2026-08-29 22:06) **antes** que `drop_duplicate_workshift` (23:35), y `period_partial_unique` (2026-08-30 13:20) **antes** que `currency_segment` (17:09). Es el orden cronológico, el contrario del alfabético que usa una base nueva: queda probado que la divergencia entre una base reconstruida y producción es real y que producción está en el estado bueno.
- **Historial de migraciones:** producción tiene 175 filas en `_prisma_migrations` y el repo 170 directorios. No hay ninguna migración solo en producción ni solo en el repo: los 170 nombres coinciden. Las 5 filas sobrantes son intentos fallidos ya revertidos (`finished_at` vacío y `rolled_back_at` con valor) de 4 migraciones de abril de 2026: `20260331200000_fase17_bank_reconciliation` (2 intentos), `20260412_feat_23c_nc_nd_self_relation`, `20260413_feat_28d_inventory` y `20260413_feat_30_export_job` (1 cada una), cada una con su fila exitosa. Es el rastro normal de `migrate resolve --rolled-back`; no es divergencia.
- Corrección a una expectativa de la propia spec: la fila `g` esperaba `…_period_segment_active_key`; ese índice también lo elimina `exclusion_solape`. No cambia ninguna conclusión.
**Verificación fase 1 (2026-10-08, contra `origin/main` d952e4fb):**
- Confirmado leyendo las migraciones: las 4 FKs se crearon con `ON DELETE RESTRICT` (`20260521_inventory_account_gl`, `20260521_inventory_movement_enhancements`, `20260609_retention_gl_posting`); `Account_companyId_isPostable_idx` está en el schema (línea 410) y ninguna migración lo crea; `BenefitAdvance_companyId_idx` (`20260422_nom_d_advance_bcv_ratetype_additional_days`) es prefijo de los otros dos índices del modelo; las 9 tablas con `updatedAt DEFAULT` salen de migraciones escritas a mano (32 tablas generadas por Prisma no lo tienen); `DocShareToken` y `FiscalReport` se crearon con `TIMESTAMPTZ` (`20260612_*`); `PaymentRecord.ivaRetentionAmount` es `NOT NULL DEFAULT 0` (`20260526_cobropago_ivaretention`) y ningún código escribe `null`; `EmployeeLoan.status` se creó `DEFAULT 'ACTIVE'` (`20260516_employee_loan`) y el servicio y el seed fijan el status explícito; el índice único de `caja_caja_reimbursements` cubre las mismas columnas que el schema (solo difiere el nombre) y el de `FixedAssetINPCRestatement` tiene el nombre truncado a 63 caracteres.
- Confirmado por barrido (`DROP … IF EXISTS` que ordena antes de una creación posterior): 3 casos sobre 170 migraciones (`Employee.workShift`, `WorkShiftType`, `PayrollRun_companyId_period_active_key`).
- No comprobado: el efecto de `@db.Timestamptz(6)` en el adaptador de Neon (lo dirá CI); `DO $$ … $$` en el barrido de texto; los índices parciales, triggers, CHECK y políticas RLS de producción frente a una base reconstruida (fuera del alcance de `migrate diff`: es la SPEC-023 propuesta).

## 12. Cierre

- **PR:** #78, mergeado a `main` el 2026-10-08 (`9e06e509`). CI del PR (corrida 37859698842) en verde. La verificación previa de solo lectura en producción la hizo el dueño (sección 11).
- **Commits:** `156736fb` (spec en curso y línea base), `d4f6cfb9` (tests: detector de orden y test de integración), `56e39bbf` (schema y migración correctiva), `f33e2704` (CI: `migrate diff` exige diff vacío y se borra la línea base), `ffc2debf` (guarda de base de datos del test de integración), `4b75217d` (`lock_timeout`), `e04d9490` (addendum de ADR-057 y seguimientos de seguridad).
- **Tests:** 7375 y 1 `todo` → 7480 y 2 `todo` (+105, de los cuales 104 son de `migration-order.test.ts`). Suite completa en 6 shards, 0 fallos. `migration-reconciliation.test.ts` (18 tests, 3 de ellos de la guarda, que no usan base de datos) corre en el job `integration`, que en esa corrida ejecutó 5 archivos de integración en verde.
- **ADR:** addendum de ADR-057 («repetible» no implicaba «equivalente a producción»). Sin ADR nuevo.
- **Lección aprendida:** LL-026.
- **Decisiones que cambiaron el plan:**
  1. Las 4 claves foráneas difieren solo en `ON UPDATE`, no en `ON DELETE`. Corregido también en SPEC-014.
  2. Hubo 3 casos de orden de migraciones, no 2. El tercero (el índice parcial de `PayrollRun`) es invisible para `migrate diff` y para `verify:drift`.
  3. La migración no es «casi todo no-op» en producción: solo lo son los 3 `DROP`. Los demás pasos sí cambian algo.
  4. El paso 2 del plan (un primer push solo con tests para ver el rojo en el CI) **no se hizo**: el job `integration` corrió una sola vez, con la corrección incluida. El rojo se midió en una base reconstruida de verdad, una rama temporal del sandbox de CI usada por el driver serverless (puerto 443, porque la VPN bloquea el 5432): 13 de 15 tests fallaban sin la migración, por la razón correcta (el segundo proceso de nómina en USD fallaba con `P2002`), y pasaban los 15 con ella, incluida la idempotencia.
  5. CA-5 se comprueba como default de la columna, no insertando un préstamo por SQL.
  6. La revisión de seguridad añadió la guarda del test de integración (R-7), el `lock_timeout` y la corrección de R-3.
- **Deuda registrada, no resuelta aquí:**
  - **SPEC-023 (propuesta):** instantánea normalizada del catálogo de Postgres comparada en CI contra una base reconstruida (R-4). Habría detectado el caso de `PayrollRun` sin depender de que alguien lo mirara.
  - La guarda de base de datos de los otros 3 tests de integración es más débil que la de este (R-7).
  - `.github/CODEOWNERS` (R-8).
  - Límites de `migration-order.test.ts` (R-6): `DO $$ … $$`, identificadores con esquema, `RENAME TO` como forma de crear y `CONSTRAINT` en línea.
  - Prueba manual de compartir y revocar un documento tras el despliegue (R-3).
- **CA-9 pendiente (la hace el dueño; ningún agente toca producción).** Lo que hay que saber antes:
  - El aplicador `scripts/apply-migration-http.mjs` lee `DATABASE_URL` (la URL **pooled**) de `.env.local`, junto al propio script. Funciona con la VPN encendida porque usa HTTPS (443).
  - La migración tiene 9 pasos (`SET lock_timeout` y 8 sentencias). Por HTTP cada paso viaja por separado, así que el `lock_timeout` no actúa; conviene una hora tranquila. Los pasos son instantáneos (`Account` 714 filas, `BenefitAdvance` 1) y es idempotente: si se repite, avisa «ya estaba aplicada».
  - Salida esperada: `✓ [1/9] … ✓ [9/9]`, `✓ Registrada en _prisma_migrations (9 pasos)`.

  Paso 1: aplicar (PowerShell, VPN encendida), desde este worktree actualizado a `main`:

  ```powershell
  cd D:\Documents\Projects\React\modern-cg1\.claude\worktrees\chore-spec-014-ci-gates
  git fetch origin
  git switch --detach origin/main
  git log --oneline -1                      # debe ser 9e06e509 o posterior
  Copy-Item D:\Documents\Projects\React\modern-cg1\.env.local .\.env.local      # copia TEMPORAL, .env* está en .gitignore
  $l = Select-String -Path .\.env.local -Pattern '^DATABASE_URL=' | Select-Object -First 1
  ([uri](($l.Line -replace '^DATABASE_URL=','').Trim().Trim('"').Trim("'"))).Host   # debe empezar por ep-summer-fog-ai2n0tde
  node scripts\apply-migration-http.mjs 20261008_reconciliar_deriva_schema
  ```

  Paso 2: comprobar en el editor SQL de Neon (rama `production`). Esperado: a = 0, b = 0, c contiene `PENDING`, d = 1, e = 0, f lista los dos nombres nuevos, g = 0 y h muestra la migración registrada. Las filas a–g se validaron contra una base reconstruida; la h no.

  ```sql
  SELECT 'a_indice_PayrollRun_period_active_key' AS chequeo, count(*)::text AS valor FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'PayrollRun_companyId_period_active_key'
  UNION ALL SELECT 'b_columna_Employee_workShift', count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Employee' AND column_name = 'workShift'
  UNION ALL SELECT 'c_default_EmployeeLoan_status', coalesce(column_default::text, '(sin default)') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'EmployeeLoan' AND column_name = 'status'
  UNION ALL SELECT 'd_indice_Account_isPostable', count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Account_companyId_isPostable_idx'
  UNION ALL SELECT 'e_indice_BenefitAdvance_companyId_idx', count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'BenefitAdvance_companyId_idx'
  UNION ALL SELECT 'f_indices_renombrados', coalesce(string_agg(indexname, ', ' ORDER BY indexname), '(ninguno)') FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriod_key', 'caja_caja_reimbursements_companyId_reimbursementNumber_key')
  UNION ALL SELECT 'g_tipo_WorkShiftType', count(*)::text FROM pg_type WHERE typname = 'WorkShiftType'
  UNION ALL SELECT 'h_migracion_registrada', migration_name || ' @ ' || to_char(finished_at, 'YYYY-MM-DD HH24:MI') FROM _prisma_migrations WHERE migration_name = '20261008_reconciliar_deriva_schema'
  ORDER BY 1;
  ```

  Paso 3: cierre de CA-9. `migrate diff` contra producción debe salir **vacío**. Necesita la VPN apagada un momento (bloquea el puerto 5432) y se lanza desde la misma carpeta:

  ```powershell
  $l = Select-String -Path .\.env.local -Pattern '^DATABASE_URL_DIRECT=' | Select-Object -First 1
  $env:DATABASE_URL_DIRECT = ($l.Line -replace '^DATABASE_URL_DIRECT=','').Trim().Trim('"').Trim("'")
  $env:DATABASE_URL = ""
  "Host: " + ([uri]$env:DATABASE_URL_DIRECT).Host          # ep-summer-fog-ai2n0tde... (sin -pooler)
  & .\node_modules\.bin\prisma.cmd migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --script
  "exit: $LASTEXITCODE"                                    # 0 = vacío = CA-9 cumplido; 2 = quedan diferencias (pégalas)
  Remove-Item Env:DATABASE_URL_DIRECT
  ```

  Paso 4 (opcional, solo lectura): `node scripts\verify-schema-drift.mjs`, `node scripts\verify-enum-drift.mjs` y `node scripts\verify-rls.mjs` desde la misma carpeta; si alguno falla con `P1001`, es la VPN y el puerto 5432. Al terminar, `Remove-Item .\.env.local`.

  Cuando el paso 3 dé `exit: 0`, se marca CA-9 con la fecha.
