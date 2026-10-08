---
id: SPEC-022
titulo: Reconciliar la deriva entre schema.prisma y las migraciones (y que una base reconstruida sea igual a producción)
estado: BORRADOR
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
   - El índice único parcial `PayrollRun_companyId_period_active_key` sobrevive en una base nueva (`20260830_payrollrun_currency_segment`, que lo elimina, ordena antes que `20260830_payrollrun_period_partial_unique`, que lo crea). Ese índice impide un segundo proceso de nómina del mismo período, justo el caso de dos monedas que `currency_segment` quería habilitar: **una base reconstruida (CI, un entorno nuevo, una recuperación desde migraciones) rechazaría esa nómina legítima**.

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

C) **Una migración correctiva, idempotente y aditiva**, `YYYYMMDD_reconciliar_deriva_schema` (con fecha posterior a la última, hoy `20261005_trigger_cuadre_partida_doble`). En producción casi todo es un no-op por los `IF [NOT] EXISTS`:

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

   Ningún `DROP` toca datos: `workShift` solo contenía el `DEFAULT`, y `workSchedule` (el campo que sí se usa) no se toca. `CREATE INDEX` sin `CONCURRENTLY` porque la migración corre en una transacción; la tabla `Account` es pequeña y el bloqueo de escrituras dura un instante (se mide el tamaño en la verificación A).

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
- [ ] CA-1: En el job `integration`, `prisma migrate diff --exit-code` sale con 0 y `scripts/ci/migrate-diff-baseline.sql` ya no existe.
- [ ] CA-2: Test de integración: sobre una base reconstruida, `Employee` no tiene la columna `workShift`, no existe el tipo `WorkShiftType` ni el índice `PayrollRun_companyId_period_active_key`; existe `Account_companyId_isPostable_idx`; no existe `BenefitAdvance_companyId_idx`.
- [ ] CA-3: Test de integración: se pueden crear **dos** procesos de nómina vigentes del mismo período y empresa con `currencySegment` distinto (VES y USD), y el segundo con el mismo segmento es rechazado.
- [ ] CA-4: La migración correctiva aplicada una segunda vez sobre la misma base no falla (idempotencia).
- [ ] CA-5: `EmployeeLoan` insertado por SQL sin `status` queda `PENDING`; el servicio y el seed siguen fijando el suyo.
- [ ] CA-6: `migration-order.test.ts` pasa sobre el repo y falla con un fixture que pone un `DROP … IF EXISTS` antes de la migración que crea el objeto.
- [ ] CA-7: `tsc`, `vitest`, `pnpm verify:drift`, `pnpm verify:enum-drift` y `pnpm verify:schema-format` en verde tras el cambio de tipo de `ivaRetentionAmount`.
- [ ] CA-8: `ci-workflow-invariants.test.ts` en verde con el paso de `migrate diff` sin línea base.
- [ ] CA-9 (la hace el usuario, PAUSA): tras aplicar la migración a producción, `migrate diff` contra producción (solo lectura) sale vacío.

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- **PAUSA — requiere al usuario:**
  1. La verificación A: `migrate diff` contra producción y las tres consultas siguientes, con el resultado pegado aquí.
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
- R-1: Si producción difiere de la base reconstruida en algo más (se aplicó a mano), el plan se reevalúa; esa es la razón de la verificación A.
- R-2: `PaymentRecord.ivaRetentionAmount` deja de ser opcional en los tipos generados. Es un cambio de tipo en una zona fiscal (Z-2) sin cambio de comportamiento; `security-agent`/`fiscal-agent` revisan que ningún camino dependa de `null`.
- R-3: `@db.Timestamptz(6)` en `DocShareToken` y `FiscalReport` no cambia la BD; si el adaptador de Neon serializara las fechas distinto para ese tipo, lo verían los tests de integración existentes de documentos (se comprueba en CI).
- R-4: Queda fuera de alcance lo que `migrate diff` no ve (índices parciales, exclusiones, triggers, CHECK, políticas RLS). **Propuesta SPEC-023:** una instantánea normalizada del catálogo de Postgres (`pg_indexes`, `pg_constraint`, `pg_trigger`, políticas, defaults) versionada y comparada en CI contra una base reconstruida, y ejecutable de solo lectura contra producción. Habría detectado el caso de `PayrollRun` sin depender de que alguien recuerde mirarlo.
- R-5: `verify:drift` excluye los índices parciales a propósito (cabecera de `scripts/verify-schema-drift.mjs`); por eso el caso de `PayrollRun` pasó todos los gates hasta ahora.

**Verificación fase 1 (2026-10-08, contra `origin/main` d952e4fb):**
- Confirmado leyendo las migraciones: las 4 FKs se crearon con `ON DELETE RESTRICT` (`20260521_inventory_account_gl`, `20260521_inventory_movement_enhancements`, `20260609_retention_gl_posting`); `Account_companyId_isPostable_idx` está en el schema (línea 410) y ninguna migración lo crea; `BenefitAdvance_companyId_idx` (`20260422_nom_d_advance_bcv_ratetype_additional_days`) es prefijo de los otros dos índices del modelo; las 9 tablas con `updatedAt DEFAULT` salen de migraciones escritas a mano (32 tablas generadas por Prisma no lo tienen); `DocShareToken` y `FiscalReport` se crearon con `TIMESTAMPTZ` (`20260612_*`); `PaymentRecord.ivaRetentionAmount` es `NOT NULL DEFAULT 0` (`20260526_cobropago_ivaretention`) y ningún código escribe `null`; `EmployeeLoan.status` se creó `DEFAULT 'ACTIVE'` (`20260516_employee_loan`) y el servicio y el seed fijan el status explícito; el índice único de `caja_caja_reimbursements` cubre las mismas columnas que el schema (solo difiere el nombre) y el de `FixedAssetINPCRestatement` tiene el nombre truncado a 63 caracteres.
- Confirmado por barrido (`DROP … IF EXISTS` que ordena antes de una creación posterior): 3 casos sobre 170 migraciones (`Employee.workShift`, `WorkShiftType`, `PayrollRun_companyId_period_active_key`).
- No comprobado: el estado real de producción (las 3 consultas y el `migrate diff` de la verificación A); el efecto de `@db.Timestamptz(6)` en el adaptador de Neon (lo dirá CI); `DO $$ … $$` en el barrido de texto.

## 12. Cierre
