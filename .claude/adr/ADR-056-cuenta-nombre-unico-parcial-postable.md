# ADR-056 — Unicidad de nombre de cuenta, solo entre cuentas de movimiento

**Estado:** Revertido por ADR-059 (2026-10-04: el nombre deja de ser único; el hallazgo de `p2002TargetIncludes` sigue vigente)
**Fecha:** 2026-10-01
**Relacionados:** ADR-053 (isPostable/G-M), ADR-035 (precedente de índice único parcial), CLAUDE.md → "DROP CONSTRAINT vs DROP INDEX", `scripts/verify-schema-drift.mjs`

## Contexto

`Account` declaraba `@@unique([companyId, name])` — ningún nombre de cuenta se podía repetir dentro de una empresa, sin excepción. Esto se escribió antes de que existiera el concepto de cuenta de "título" (ADR-053, `isPostable`).

Un tester Alpha subió su plan de cuentas real (239 filas) y 28 quedaron en "error al importar" sin explicación — el catch de `ImportService.importAccounts` capturaba cualquier error de Postgres con el mismo mensaje genérico.

### Diagnóstico (verificado, no inferido)

Se revisó el `AuditLog` real de la importación (`entityName: "Account", action: "IMPORT"`) y se cruzó contra las 210 cuentas que sí quedaron creadas en la tabla. Patrón confirmado en al menos 6 pares directos:

| Título ya creado | Nivel que falló |
|---|---|
| `1.1.03` "ANTICIPOS Y AVANCES" | `1.1.03.01` (mismo nombre) |
| `1.1.04` "OTRAS CUENTAS POR COBRAR" | `1.1.04.01` |
| `1.1.05` "INVENTARIO DE MERCANCIAS" | `1.1.05.01` |
| `2.1.02` "OTRAS CUENTAS POR PAGAR" | `2.1.02.01` |
| `3.1` "CAPITAL SOCIAL" | `3.1.01` |
| `3.2.01` "UTILIDADES ACUMULADAS" | `3.2.01.01` |

En un plan de cuentas real, un nivel de título intermedio frecuentemente repite el nombre de su padre inmediato (o de otra rama) antes de llegar al nivel de detalle real. Ninguna de estas cuentas es `isPostable: true` — nunca reciben un `JournalEntry`. El código de la aplicación ya distinguía este caso (`isPostable`, ADR-053); solo el constraint de BD no lo sabía.

Se descartó la hipótesis alternativa ("exige 9 dígitos") contrastándola contra los propios datos: varios de los 28 códigos que fallaron SÍ tenían 9 dígitos (p.ej. `3.3.01.01.001`), y varios códigos cortos que NO fallaron también tenían menos de 9 (p.ej. `1.1` "CIRCULANTE"). El conteo de dígitos no correlaciona con el resultado; el nombre repetido sí, en el 100% de los casos verificables contra la BD real.

## Decisión

Reemplazar el `@@unique([companyId, name])` incondicional por un **índice único PARCIAL**: `WHERE "isPostable" = true`. Mismo patrón que ADR-035 (Caja Chica, PayrollRun).

```sql
DROP INDEX IF EXISTS "Account_companyId_name_key";

CREATE UNIQUE INDEX "Account_companyId_name_postable_key"
  ON "Account" ("companyId", "name")
  WHERE "isPostable" = true;
```

`Account_companyId_name_key` se había creado como `CREATE UNIQUE INDEX` (verificado contra `pg_indexes`/`pg_constraint` en producción — 0 filas con `contype='u'` para `Account`), así que `DROP INDEX` es correcto; un `DROP CONSTRAINT IF EXISTS` sobre esto habría sido un no-op silencioso (precedente ya documentado en CLAUDE.md).

**Verificación previa obligatoria (hecha, 0 filas):**

```sql
SELECT "companyId", name, COUNT(*)
FROM "Account"
WHERE "isPostable" = true
GROUP BY "companyId", name
HAVING COUNT(*) > 1;
```

Cero colisiones existentes entre cuentas de movimiento en toda la base — el índice parcial es seguro de crear sin saneamiento previo.

### Cambios de código

- `prisma/schema.prisma`: se quita `@@unique([companyId, name])` (Prisma no soporta `WHERE` en `@@unique`), queda comentario apuntando a esta migración + `@@index([companyId, isPostable])` para la query del check.
- `account.actions.ts` (`createAccountAction`): el pre-check de nombre duplicado pasa de `findUnique({ companyId_name })` (el índice compuesto ya no existe) a `findFirst({ where: { companyId, name, isPostable: true } })`. Toda cuenta creada por este formulario es postable por defecto (no tiene columna G/M), así que el check sigue bloqueando duplicados reales.
- `ImportService.importAccounts`: el catch por fila ahora distingue con `p2002TargetIncludes(e, "name")` / `"code"` para dar un mensaje de negocio en vez de "error al importar" genérico — útil para cuando el P2002 SÍ es un duplicado real entre dos cuentas de movimiento.

## Alternativas consideradas

1. **Quitar la unicidad de nombre por completo.** Rechazada: perdería la protección real contra dos cuentas de movimiento con el mismo nombre, que sí es útil (confusión al elegir cuenta en un asiento).
2. **Validar solo en la aplicación, sin índice en BD.** Rechazada: sin backstop de BD, una carrera entre dos `createAccountAction`/`importAccounts` simultáneos podría crear el duplicado real que el check pretende evitar — mismo razonamiento que ADR-035.

## Consecuencias

- Un plan de cuentas real con niveles de título que repiten nombre (patrón confirmado, no hipotético) ahora importa completo.
- `prisma db pull`/`migrate diff` reportarían el índice parcial como no representado en el schema — aceptable, mismo trade-off ya aceptado en ADR-035; el workflow de migraciones de este proyecto es manual.
- `scripts/verify-schema-drift.mjs` ya excluye índices parciales (`indpred IS NULL`) — no hace falta tocarlo.

## Hallazgo colateral: `p2002TargetIncludes` estaba roto en TODO el proyecto

Al probar este fix contra producción (`Book 1.xlsx` real, empresa "Empresa los Pollos"), 6 filas con duplicado real de nombre entre cuentas de movimiento (p.ej. "Diferencial Cambiario" reusado en Ingresos Extraordinarios, Compras y Otros Egresos — tres cuentas de movimiento distintas, mismo nombre, genuinamente ambiguo) seguían mostrando "error al importar" genérico en vez del mensaje de negocio nuevo.

Diagnóstico en vivo (script `tsx` directo contra Neon, con limpieza posterior — 0 filas residuales verificadas): con **Prisma 7.8.0 + `@prisma/adapter-neon`**, `error.meta.target` **ya no existe** — `meta` llega `{}`. Las columnas del constraint viven anidadas en `error.meta.driverAdapterError.cause.constraint.fields`, cada una con o sin comillas literales (`'"companyId"'` vs `'name'`) según si Postgres necesitó citar el identificador.

`p2002TargetIncludes` (fuente única en `src/lib/prisma-errors.ts`) solo sabía leer `meta.target` — devolvía `false` para **cualquier** columna, en los **~13 módulos** que lo usan: `ImportService`, retenciones, facturas/notas, pagos (idempotencia), `IncomeDistributionService`, `ExpenseService`, `PayrollRun`, inventario (UoM + operaciones). Ninguno de los tests existentes lo detectó porque todos mockean `meta: { target }` directo (la forma vieja) — nunca la forma real que Prisma 7.8.0 produce.

**Corregido en la fuente única**: `p2002TargetIncludes` ahora prueba primero `meta.driverAdapterError.cause.constraint.fields` (despojando comillas) y cae a `meta.target` como compatibilidad hacia atrás. 4 tests nuevos reproduciendo la forma real medida en producción; los 28 tests existentes (forma vieja) siguen en verde sin cambios — confirma que la función ahora cubre ambas formas.

Se verificó también `isExclusionViolation` (mismo archivo, usada solo por `PayrollRun_no_overlap_active`) con el mismo método de diagnóstico en vivo: **no está afectada** — una violación de restricción EXCLUDE no pasa por `PrismaClientKnownRequestError`/`meta` en absoluto, llega como `DriverAdapterError` crudo con el nombre del constraint directo en `.message`, que es justo lo que esa función ya inspecciona.

**Impacto real de la ventana rota** (antes de este fix): cualquier P2002 en correlativos (Z-1), retenciones, idempotencia de pagos, etc. caía silenciosamente a la rama *menos específica* de cada catch (mensaje genérico o lógica de reintento que nunca se disparaba), en vez de distinguir la columna real del constraint. No se cuantificó cuánto tiempo llevaba así (depende de cuándo se actualizó Prisma a 7.8.0) ni si causó algún síntoma ya reportado por la tester sin diagnosticar — queda como posible explicación retroactiva de mensajes de error genéricos vistos antes de hoy.
