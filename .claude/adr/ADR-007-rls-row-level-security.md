# ADR-007 — Row Level Security: SET LOCAL + Role `authenticated` + Neon

- **Status**: DECIDED ✅
- **Date**: 2026-04-06
- **Author**: arch-agent
- **Criticality**: SECURITY — defense-in-depth para aislamiento multi-tenant
- **Prerequisite**: Fase 17 completada (BankTransaction debe estar bajo RLS también)
- **Implementar en**: Fase 13D (entre Fase 17 y Fase 19)

---

## Context

ContaFlow usa Neon PostgreSQL con PrismaPg y connection pooling (PgBouncer en transaction mode).
El aislamiento multi-tenant actual descansa únicamente en:
1. ADR-004: `companyId` obligatorio en todos los queries
2. `company-isolation.test.ts`: test arquitectónico que bloquea CI ante violaciones
3. Clerk auth → CompanyMember lookup en cada Server Action

**No existe segunda línea de defensa a nivel de base de datos.** Un solo bug que omita
`companyId` en un `findFirst` es suficiente para exponer datos de otro tenant.

### Por qué SET LOCAL es compatible con el pooler de Neon

El bloqueo original fue diagnosticado como "SET LOCAL incompatible con pooler". La investigación
(2026-04-05) corrigió este diagnóstico:

| Tipo de SET | Persistencia | Compatible con PgBouncer transaction mode |
|---|---|---|
| `SET SESSION` / `SET` | Toda la sesión | ❌ NO — persiste en la conexión devuelta al pool, contamina el siguiente tenant |
| `SET LOCAL` | Solo la transacción activa | ✅ SI — limpiado automáticamente en COMMIT/ROLLBACK |

**`SET LOCAL` dentro de `$transaction` es compatible con el pooler de Neon.**
**`SET` (session-level) está bloqueado permanentemente para este patrón.**

### Opciones evaluadas

**Opción A — SET LOCAL + RLS policies en Postgres** ✅ ELEGIDA
Defense-in-depth real. Cualquier query sin companyId correcto es rechazado por la BD.

**Opción B — Prisma Client Extension que inyecta companyId automáticamente**
No es RLS real — un `$queryRaw` lo bypasea. Descartada para producción.

**Opción C — Neon Data API con JWT en Authorization header**
Solo aplica para apps cliente→BD directas. No aplica a ContaFlow (Next.js es el backend).

---

## Decision

Implementar RLS en PostgreSQL con el patrón **SET LOCAL por transacción** usando la función
canónica `withCompanyContext` como único punto de entrada autorizado.

### Función canónica — `src/lib/prisma-rls.ts`

```typescript
// CONTRATO — no reimplementar inline en los Services ni Actions
// fn recibe tx explícitamente para evitar bugs de closure con tx externo
export async function withCompanyContext<T>(
  companyId: string,
  tx: PrismaTransactionClient,
  fn: (tx: PrismaTransactionClient) => Promise<T>
): Promise<T> {
  // set_config(key, value, is_local=true) es equivalente a SET LOCAL — per-transaction
  await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
  return fn(tx);
}
```

**Notas del contrato:**
- `is_local = true` es el tercer argumento de `set_config` — equivale a `SET LOCAL`. **No usar `false`.**
- La función solo puede invocarse dentro de un `$transaction` activo. Fuera de transacción, `SET LOCAL` no tiene efecto (no hay transacción que la contenga).
- `fn` recibe `tx` explícitamente — evita el bug de closure donde `fn` usa el `prisma` global en lugar del `tx` de la transacción.

### Patrón de uso canónico en Server Actions

```typescript
// ✅ Correcto
await prisma.$transaction(async (tx) => {
  return withCompanyContext(companyId, tx, async (tx) => {
    const invoice = await tx.invoice.create({ data: { ... } });
    await tx.auditLog.create({ data: { ... } });
    return invoice;
  });
});

// ❌ BLOQUEADO — SET fuera de transacción, sin efecto
await prisma.$executeRaw`SET "app.current_company_id" = ${companyId}`;
await prisma.invoice.findMany({ where: { companyId } });

// ❌ BLOQUEADO — session-level, incompatible con pooler
await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, false)`;
```

### RLS Policies SQL

```sql
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "Invoice"
  USING (("companyId")::text = current_setting('app.current_company_id', true));
-- Repetir para todas las tablas de dominio (ver §Tables)
```

- `current_setting('app.current_company_id', true)` — segundo parámetro `true` = `missing_ok`: devuelve NULL si el setting no está seteado, en lugar de lanzar error.
- Si `app.current_company_id` es NULL → la policy `USING` evalúa a NULL → fila excluida → 0 rows devueltos. **Fail-closed.**

### Roles de base de datos

| Role | Descripción | BYPASSRLS |
|---|---|---|
| `neondb_owner` | Migraciones, seeds, admin | ✅ Sí — bypass intencional para migraciones |
| `authenticated` | PrismaClient en producción | ❌ No — sujeto a RLS |

- `DATABASE_URL` (app en producción): usar role `authenticated` — RLS activo
- `DATABASE_URL_DIRECT` (migraciones vía Prisma): usar role `neondb_owner` — sin cambios

---

## Tables que requieren RLS

### Tablas de dominio — RLS obligatorio

| Tabla | Razón |
|---|---|
| `Invoice` | Facturas fiscales — dato primario del tenant |
| `Transaction` | Asientos contables doble entrada |
| `Account` | Plan de cuentas del tenant |
| `Retencion` | Comprobantes de retención IVA/ISLR |
| `IGTFTransaction` | IGTF por transacción en moneda extranjera |
| `AccountingPeriod` | Períodos contables del tenant |
| `PeriodSnapshot` | Snapshots de balances por período |
| `FiscalYearClose` | Cierres de ejercicio fiscal |
| `ControlNumberSequence` | Secuencias de número de control |
| `RetentionSequence` | Secuencias de comprobante de retención |
| `PaymentRecord` | Registros de pago multi-medio |
| `BankAccount` | Cuentas bancarias del tenant |
| `BankStatement` | Estados de cuenta bancarios |
| `BankTransaction` | Transacciones individuales del estado de cuenta |

**BankTransaction es prerequisito para activar RLS**: Fase 17 debe estar completada antes de ejecutar la migración de RLS.

### Tablas excluidas de RLS

| Tabla | Razón de exclusión |
|---|---|
| `Company` | Lookup por PK al inicio de cada request — acceso por id único |
| `CompanyMember` | Lookup de membresía — siempre filtrado por `userId` + `companyId` en query |
| `AuditLog` | Append-only, acceso solo por administrador, filtrado por `companyId` en query |
| `ExchangeRate` | Datos globales, no pertenecen a un tenant |
| `User` | Gestionado por Clerk — fuera del dominio contable |

---

## Migration Plan

**Nombre de migración sugerido**: `20260406_fase13d_rls_company_isolation`

### Paso 1 — Crear role `authenticated`

```sql
-- Verificar primero si el role ya existe en Neon
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

-- Otorgar permisos DML a las tablas de dominio
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
```

### Paso 2 — Habilitar RLS y crear policies

```sql
-- Repetir para cada tabla de la lista de dominio
ALTER TABLE "Invoice"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Retencion"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IGTFTransaction"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingPeriod"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PeriodSnapshot"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalYearClose"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlNumberSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionSequence"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatement"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankTransaction"       ENABLE ROW LEVEL SECURITY;

-- Policies (patrón idéntico por tabla)
CREATE POLICY company_isolation ON "Invoice"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "Transaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "Account"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "Retencion"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "IGTFTransaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "AccountingPeriod"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "PeriodSnapshot"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "FiscalYearClose"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "ControlNumberSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "RetentionSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "PaymentRecord"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "BankAccount"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "BankStatement"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "BankTransaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true));
```

### Rollback SQL

```sql
-- Si la migración falla o debe revertirse
DROP POLICY IF EXISTS company_isolation ON "Invoice";
DROP POLICY IF EXISTS company_isolation ON "Transaction";
DROP POLICY IF EXISTS company_isolation ON "Account";
DROP POLICY IF EXISTS company_isolation ON "Retencion";
DROP POLICY IF EXISTS company_isolation ON "IGTFTransaction";
DROP POLICY IF EXISTS company_isolation ON "AccountingPeriod";
DROP POLICY IF EXISTS company_isolation ON "PeriodSnapshot";
DROP POLICY IF EXISTS company_isolation ON "FiscalYearClose";
DROP POLICY IF EXISTS company_isolation ON "ControlNumberSequence";
DROP POLICY IF EXISTS company_isolation ON "RetentionSequence";
DROP POLICY IF EXISTS company_isolation ON "PaymentRecord";
DROP POLICY IF EXISTS company_isolation ON "BankAccount";
DROP POLICY IF EXISTS company_isolation ON "BankStatement";
DROP POLICY IF EXISTS company_isolation ON "BankTransaction";

ALTER TABLE "Invoice"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction"           DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Retencion"             DISABLE ROW LEVEL SECURITY;
ALTER TABLE "IGTFTransaction"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingPeriod"      DISABLE ROW LEVEL SECURITY;
ALTER TABLE "PeriodSnapshot"        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalYearClose"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlNumberSequence" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionSequence"     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord"         DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount"           DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatement"         DISABLE ROW LEVEL SECURITY;
ALTER TABLE "BankTransaction"       DISABLE ROW LEVEL SECURITY;
```

---

## Risk Analysis

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Server Action sin `withCompanyContext` → 0 rows silencioso | Media | Alto — bug silencioso difícil de detectar | Refactor obligatorio de ~15-20 actions antes de activar en prod. Test de humo obligatorio. |
| `JournalEntry` sin `companyId` directo en schema | Verificar antes de ejecutar | Alto | Si la FK es solo a `Transaction`, la policy requiere subconsulta o columna desnormalizada |
| Tests con mock de `$transaction` que no llama `withCompanyContext` → tests pasan, prod falla | Alta | Medio | Actualizar mocks para que verifiquen que `set_config` es invocado |
| `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en tabla con millones de rows | Bajo (Neon serverless) | Alto | Esta operación no reescribe la tabla en PostgreSQL — es un flag en el catálogo. Impacto mínimo. |
| Backfill de datos existentes requerido | No aplica | — | RLS no modifica datos — solo añade filtro en lectura/escritura |
| Role `authenticated` no existe en Neon | Posible en instancias nuevas | Medio | Migración incluye creación idempotente del role |

---

## Fail-Closed Guarantee

Escenario: `app.current_company_id` no está seteado (bug, query fuera de `withCompanyContext`, migración parcial).

1. `current_setting('app.current_company_id', true)` → devuelve NULL (missing_ok = true).
2. `"companyId"::text = NULL` → evalúa a NULL en SQL, no TRUE.
3. Policy `USING (...)` filtra la fila → 0 filas devueltas.
4. La aplicación no recibe error explosivo — recibe lista vacía.
5. El bug es detectable: el Service que espera datos y recibe 0 filas falla sus validaciones de negocio.

Este comportamiento es preferible al fail-open (devolver todas las filas de todos los tenants si no hay contexto).

---

## Implementation Checklist (para impl-agent / Fase 13D)

```
Prerequisito:
[ ] Fase 17 completada — BankTransaction en schema

Verificación de schema:
[ ] Confirmar que JournalEntry tiene companyId directo en prisma/schema.prisma
[ ] Si no: migración previa para añadir companyId a JournalEntry con backfill
[ ] Confirmar nombre exacto del DATABASE_URL role en Neon (para GRANT)

Implementación:
[ ] Crear src/lib/prisma-rls.ts con withCompanyContext (firma con tx explícito)
[ ] Tests unitarios de withCompanyContext: verifica que set_config se invoca con is_local=true
[ ] Ejecutar migración: 20260406_fase13d_rls_company_isolation en staging
[ ] Actualizar DATABASE_URL de staging para usar role authenticated
[ ] Smoke test en staging: query sin withCompanyContext → verificar 0 rows
[ ] Test de aislamiento: withCompanyContext(tenantA) no devuelve rows de tenantB
[ ] Refactorizar ~15-20 Server Actions para usar withCompanyContext
[ ] Actualizar mocks de tests afectados
[ ] 422+ tests GREEN en CI
[ ] Ejecutar migración en producción
[ ] Actualizar DATABASE_URL de producción para usar role authenticated
[ ] Monitor Sentry 24h post-deploy

Documentación:
[ ] Actualizar ADR-004 (companyId sigue siendo primera línea — RLS es segunda)
[ ] Marcar Fase 13D como completada en contaflow-context-v3.md
```

---

## Consequences

**Positivas:**
- Defense-in-depth real: un bug en la capa de aplicación no puede exponer datos de otro tenant
- Fail-closed: sin `set_config`, la query retorna vacío — no explota, no expone
- Compatible con PrismaPg pooled — no requiere conexión directa por request
- Compatible con ADR-001 (Serializable): `SET LOCAL` funciona con cualquier isolation level
- No rompe ADR-002 (Decimal), ADR-003 (Restrict), ADR-004 (companyId en queries)

**Negativas / Costos:**
- ~15-20 actions a refactorizar en Fase 13D
- Una migración SQL con múltiples `CREATE POLICY` — revisión cuidadosa necesaria antes de ejecutar
- Debugging más complejo: un query que retorna vacío puede ser RLS o `companyId` incorrecto — se requiere logging de `app.current_company_id` en Sentry cuando se detecten resultados vacíos inesperados

---

## Rejected Alternatives

| Alternativa | Razón de rechazo |
|---|---|
| `SET` / `SET SESSION` (session-level) | Incompatible con PgBouncer transaction mode: el valor persiste en la conexión devuelta al pool y puede contaminar la siguiente transacción de otro tenant. **Bloqueado permanentemente.** |
| Role por tenant (`CREATE ROLE company_<uuid>`) | PgBouncer no permite cambio de rol entre transacciones. Requeriría conexión dedicada por tenant — antitético al modelo serverless de Neon. |
| Prisma Client Extension con companyId automático | No es RLS real — un `$queryRaw` lo bypasea. No es defense-in-depth. |
| Neon Data API con JWT | Solo aplica para apps cliente→BD directas. ContaFlow usa Next.js como backend exclusivo. |
| Solo ADR-004 (companyId en WHERE) | Defensa de capa única. Un bug en un Service expone datos de otro tenant. RLS es la segunda línea obligatoria para producción multi-tenant real. |

---

## Interaction with Existing ADRs

| ADR | Relación |
|---|---|
| ADR-001 (Serializable correlativos) | `withCompanyContext` es compatible con `isolationLevel: 'Serializable'` — `SET LOCAL` tiene el mismo scope dentro de cualquier isolation level. |
| ADR-003 (onDelete: Restrict) | Sin conflicto. RLS filtra en lectura/escritura, no afecta integridad referencial. |
| ADR-004 (companyId en findMany) | RLS no reemplaza ADR-004. Ambas capas coexisten: ADR-004 es la primera línea (aplicación), RLS es la segunda (motor de BD). Eliminar `companyId` de los `WHERE` después de activar RLS está **prohibido**. |
| ADR-006 (security depth) | RLS es la implementación concreta de la defense-in-depth descrita en ADR-006. Complementa, no reemplaza, las verificaciones de `companyMember.role`. |

---

## References

- [Neon RLS Docs](https://neon.com/docs/guides/row-level-security)
- [Neon Connection Pooling](https://neon.com/docs/connect/connection-pooling) — documenta que SET SESSION no persiste en transaction mode
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- ADR-004: companyId obligatorio en queries (primera línea de defensa)
- ADR-006: controles de seguridad generales

---

## Owner Files

- `src/lib/prisma-rls.ts` — función canónica `withCompanyContext`
- `prisma/migrations/20260406_fase13d_rls_company_isolation/migration.sql` — SQL de la migración
- `src/modules/**/actions/` — ~15-20 actions a refactorizar (inventario completo a determinar al iniciar Fase 13D)
