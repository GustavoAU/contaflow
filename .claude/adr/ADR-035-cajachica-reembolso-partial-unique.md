# ADR-035 — Índice único parcial para reembolsos de Caja Chica

**Estado:** Aceptado
**Fecha:** 2026-06-21
**Autor:** Gustavo / ContaFlow
**Rama:** `feat/cajachica-reembolso-unique`

---

## Contexto

El modelo `CajaCajaReimbursement` (tabla `caja_caja_reimbursements`) representa el reembolso mensual del fondo fijo de caja chica (Fase 35D). Un reembolso agrupa los `CajaCajaMovement` aprobados del mes y genera el asiento contable que los lleva al Libro Mayor.

El esquema actual declara:

```prisma
status  CajaCajaReimbursementStatus @default(DRAFT)  // DRAFT | POSTED | VOIDED
@@unique([companyId, cajaCajaId, monthYear])
```

En la base de datos ese `@@unique` se materializó en la migración original (`20260512_fase35d_cajachica`) como el índice **`caja_caja_reimbursements_companyId_cajaCajaId_month`** — UNIQUE **incondicional** sobre `(companyId, cajaCajaId, monthYear)`, es decir, incluye también las filas con `status = VOIDED`.

### El bug (detectado por security-agent en el gate de CC-01)

- `CajaCajaReimbursementService.createReimbursement` permite recrear el reembolso de un mes si el anterior quedó anulado (filtro app-level `status: { not: "VOIDED" }`).
- `voidReimbursement` anula el borrador y **libera los movimientos** (`reimbursementId = null`) para que puedan reembolsarse de nuevo.
- Pero el índice único incondicional cuenta las filas `VOIDED` → al recrear el reembolso del mismo mes salta `P2002`.
- Resultado: los movimientos liberados quedan **sin poder reembolsarse nunca** → no llegan al Libro Mayor. Esto es una **regresión del propio bug CC-01** que esta rama venía a resolver.

### Intención de negocio (ya decidida por el usuario)

La unicidad debe aplicar **solo a reembolsos vigentes**. Un mes (`companyId + cajaCajaId + monthYear`) puede tener:

- **N** reembolsos con `status = VOIDED` (historial de intentos anulados, nunca se borran — invariante "NEVER DELETE en asientos").
- **A lo sumo 1** reembolso vigente (`DRAFT` o `POSTED`).

---

## Decisión

Reemplazar el índice único total por un **índice único PARCIAL** en PostgreSQL que excluye las filas anuladas. Prisma DSL no soporta `WHERE` declarativo en `@@unique`, así que el constraint vive en la migración SQL y el schema lo documenta.

### SQL de la migración (manual — `prisma migrate dev` está ROTO en este proyecto)

```sql
-- 1. Eliminar el índice único incondicional original
DROP INDEX IF EXISTS "caja_caja_reimbursements_companyId_cajaCajaId_month";

-- 2. Crear el índice único parcial: unicidad solo entre reembolsos NO anulados
CREATE UNIQUE INDEX "caja_caja_reimbursements_companyId_cajaCajaId_month_active"
  ON "caja_caja_reimbursements" ("companyId", "cajaCajaId", "monthYear")
  WHERE status <> 'VOIDED';
```

### Cambio de schema Prisma

Eliminar la línea `@@unique([companyId, cajaCajaId, monthYear])` (Prisma ya no puede representar el constraint, porque es parcial) y dejar un comentario que apunte a la migración:

```prisma
model CajaCajaReimbursement {
  // ...campos sin cambios...

  movements CajaCajaMovement[]

  @@unique([companyId, reimbursementNumber])
  // Unicidad de reembolso vigente por mes: índice único PARCIAL en BD
  //   WHERE status <> 'VOIDED'  → permite N reembolsos VOIDED + 1 vigente por mes.
  //   Prisma no soporta WHERE en @@unique → vive en la migración
  //   20260621_cajachica_reembolso_partial_unique. Ver ADR-035.
  //   El service usa findFirst (no findUnique) para el check, así que no se
  //   pierde ningún input de Prisma al quitar el @@unique.
  @@index([companyId, cajaCajaId])
  @@map("caja_caja_reimbursements")
}
```

No se requiere cambio de lógica en el service: el filtro app-level `status: { not: "VOIDED" }` ya es correcto. El índice parcial es el **backstop de concurrencia** ante un race entre dos `createReimbursement` simultáneos del mismo mes (el segundo recibe `P2002`, que el service debe traducir a mensaje de negocio, no exponer crudo — ver `CLAUDE.md` Errores Prisma al cliente).

---

## Validación técnica

### ¿El SQL es correcto y seguro?

**Sí, con un matiz de estilo.**

1. **Cast del literal enum:** NO es necesario. PostgreSQL coerce el literal de texto `'VOIDED'` al tipo del enum de la columna en el predicado `status <> 'VOIDED'`. El precedente en este mismo repo lo confirma: `20260611_invoice_purchase_partial_unique` usa `WHERE type = 'SALE'` sin cast y funciona en producción. El cast explícito `'VOIDED'::"CajaCajaReimbursementStatus"` del enfoque original es **válido y más explícito**, pero redundante. Cualquiera de las dos formas es correcta; se prefiere la sin-cast por consistencia con la migración A3.

2. **`DROP INDEX` seguro:** El índice `caja_caja_reimbursements_companyId_cajaCajaId_month` es un índice único secundario, **NO** es la PK (`id`) ni un índice del que dependa una FK. Ninguna FK referencia `(companyId, cajaCajaId, monthYear)`. Por tanto el DROP es seguro. Se usa `DROP INDEX IF EXISTS` para idempotencia de la migración manual.

3. **Concurrencia:** El `createReimbursement` corre en `$transaction`. Con `Read Committed` (default) dos transacciones simultáneas del mismo mes podrían pasar ambas el check `findFirst`; el índice único parcial garantiza que solo una persista — la segunda recibe `P2002`. No se requiere `Serializable` aquí: el reembolso **no** genera un número correlativo fiscal secuencial vulnerable a gaps (el `reimbursementNumber` ya tiene su propio `@@unique`), y el backstop del índice parcial cubre la doble-creación. Esto es coherente con `CLAUDE.md`: "Dudas → Read Committed + @@unique".

### Verificación previa OBLIGATORIA antes del `CREATE`

El `CREATE UNIQUE INDEX` **falla** si ya existen en producción dos filas no-VOIDED del mismo `(companyId, cajaCajaId, monthYear)`. Esto es posible porque el índice viejo era incondicional pero el service nunca debió permitirlo — aun así, hay que confirmarlo. Ejecutar ANTES de la migración:

```sql
SELECT "companyId", "cajaCajaId", "monthYear", COUNT(*) AS vigentes
FROM "caja_caja_reimbursements"
WHERE status <> 'VOIDED'
GROUP BY "companyId", "cajaCajaId", "monthYear"
HAVING COUNT(*) > 1;
```

- **0 filas** → seguro crear el índice.
- **≥1 fila** → resolver manualmente (anular los duplicados sobrantes con `voidReimbursement`, conservando el correcto) ANTES de crear el índice. No automatizar el saneamiento en la migración: requiere criterio contable sobre cuál reembolso es el válido.

### Plan de rollback

Si la migración falla a mitad: el `DROP` y el `CREATE` son dos sentencias; en migración manual conviene ejecutarlas como una sola transacción SQL (`BEGIN; ... COMMIT;`) para que un fallo en el `CREATE` no deje la tabla sin ninguna garantía de unicidad. Rollback = recrear el índice original incondicional:

```sql
CREATE UNIQUE INDEX "caja_caja_reimbursements_companyId_cajaCajaId_month"
  ON "caja_caja_reimbursements" ("companyId", "cajaCajaId", "monthYear");
```

(Solo posible si no se han creado entretanto reembolsos VOIDED + vigente del mismo mes; tras el fix eso será normal, así que el rollback real es "recrear el parcial".)

### Riesgo de drift con Prisma

Al quitar `@@unique` del schema y mantener el índice solo en BD, `prisma migrate diff` / `prisma db pull` detectarían el índice parcial como "no representado en el schema". En este proyecto `prisma migrate dev` está ROTO y se usan migraciones manuales + `prisma migrate resolve --applied`, por lo que **no hay autogeneración que revierta el índice**. El comentario en el schema documenta la fuente de verdad. Mismo patrón ya aceptado para los índices parciales de `Invoice` (Fix A3).

---

## Alternativas consideradas

1. **Índice único total (status quo).** Rechazada: es la causa del bug. Bloquea recrear el reembolso de un mes tras anular, dejando movimientos huérfanos sin llegar al Libro Mayor.

2. **Un reembolso por mes para siempre (sin permitir recrear).** Rechazada: contradice la intención de negocio. Anular un borrador con un error y no poder rehacerlo obliga a abrir un mes contable nuevo o a operaciones manuales fuera del sistema. Inaceptable para caja chica operativa.

3. **Índice único parcial `WHERE status <> 'VOIDED'` (elegida).** Permite N anulados + 1 vigente por mes. Mínimo cambio, sin tocar lógica del service, y alinea el constraint de BD con el filtro app-level ya existente.

4. **Excluir solo `DRAFT` y exigir unicidad de `POSTED`.** Rechazada: permitiría 1 `DRAFT` + 1 `POSTED` simultáneos del mismo mes, lo que duplicaría el asiento al postear. La unicidad debe abarcar todo lo no-anulado (`DRAFT` y `POSTED` juntos).

---

## Consecuencias

**Positivas:**
- Se cierra la regresión de CC-01: los movimientos liberados al anular un reembolso vuelven a ser reembolsables y llegan al Libro Mayor.
- El constraint de BD ahora coincide con la intención de negocio y con el filtro del service.
- Backstop de concurrencia real ante doble-submit / race de creación.

**Negativas / Trade-offs:**
- El constraint deja de ser visible en el schema Prisma como `@@unique` → depende de un comentario + la migración. Mitigado por precedente (Fix A3) y por el comentario explícito.
- `prisma db pull` reportaría el índice parcial como drift; aceptable dado el workflow de migraciones manuales del proyecto.
- El service DEBE capturar `P2002` sobre este índice y traducirlo a mensaje de negocio ("Ya existe un reembolso vigente para este mes") — no exponer el error crudo.

---

## Referencias

- `20260611_invoice_purchase_partial_unique` — precedente de índice único parcial sobre columna enum sin cast.
- `20260512_fase35d_cajachica` — migración original que creó el índice incondicional.
- CC-01 — auditoría Caja Chica 2026-06 (reembolso sin UI / movimientos sin llegar al Libro Mayor).
- `CLAUDE.md` — "¿Cuándo usar Serializable?" (correlativos sí; este caso no) + manejo de P2002.
