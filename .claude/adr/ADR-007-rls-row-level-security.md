# ADR-007 — Row Level Security: SET LOCAL + Role `authenticated` + Neon pg_session_jwt

- **Status**: DECIDIDO ✅ (plan aprobado 2026-04-05 — implementación diferida a Fase 13D)
- **Author**: arch-agent + security-agent
- **Criticality**: SECURITY — defense-in-depth para aislamiento multi-tenant
- **Implementar en**: Fase 13D (entre Fase 17 y Fase 19)

---

## Contexto

ContaFlow usa Neon PostgreSQL con PrismaPg y connection pooling (PgBouncer en transaction mode).
El aislamiento multi-tenant actual descansa únicamente en:
1. ADR-004: `companyId` obligatorio en todos los queries
2. `company-isolation.test.ts`: test arquitectónico que bloquea CI ante violaciones
3. Clerk auth → CompanyMember lookup en cada Server Action

**No existe segunda línea de defensa a nivel de base de datos.** Un solo bug que omita
`companyId` en un `findFirst` es suficiente para exponer datos de otro tenant.

### Por qué no se implementó antes

El bloqueo original fue diagnosticado como "SET LOCAL incompatible con pooler". La investigación
(2026-04-05) corrigió este diagnóstico:

| Tipo de SET | Persistencia | Survives pool return? |
|-------------|-------------|----------------------|
| `SET SESSION` | Toda la sesión | ❌ Incompatible con PgBouncer transaction mode |
| `SET LOCAL`  | Solo la transacción actual | ✅ Compatible — la conexión vuelve al pool cuando termina la transacción |

**`SET LOCAL` dentro de `$transaction` es compatible con el pooler de Neon.**

### Opciones evaluadas

**Opción A — SET LOCAL + role authenticated + RLS policies en Postgres** ✅ ELEGIDA
Defense-in-depth real. Cualquier query sin companyId correcto es rechazado por la BD.

**Opción B — Prisma Client Extension que inyecta companyId automáticamente**
No es RLS real — un `$queryRaw` lo bypasea. Descartada para producción.

**Opción C — Neon Data API con JWT en Authorization header**
Solo aplica para apps cliente→BD directas. No aplica a ContaFlow (Next.js es el backend).

---

## Decisión

Implementar RLS en Postgres con el patrón **SET LOCAL por transacción**:

```typescript
// src/lib/prisma-rls.ts — wrapper para todas las transacciones con datos de tenant
export async function withCompanyContext<T>(
  companyId: string,
  tx: PrismaTransactionClient,
  fn: () => Promise<T>
): Promise<T> {
  await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
  // true = LOCAL (solo esta transacción — seguro con pooling)
  return fn();
}
```

```sql
-- RLS policies (una vez habilitadas en cada tabla de dominio)
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_tenant_isolation ON "Invoice"
  USING (("companyId")::text = current_setting('app.current_company_id', true));
-- Repetir para: Transaction, Account, Retencion, IGTFTransaction,
--              AccountingPeriod, PeriodSnapshot, FiscalYearClose, etc.
```

### Roles de base de datos

| Role | Descripción | BYPASSRLS |
|------|-------------|-----------|
| `neondb_owner` | Migraciones, seeds, admin | ✅ Sí (bypass intencional) |
| `authenticated` | App en producción — PrismaClient | ❌ No — sujeto a RLS |

**`DATABASE_URL`** (app): usa role `authenticated` — RLS activo
**`DATABASE_URL_DIRECT`** (migraciones): usa role `neondb_owner` — sin cambios

---

## Plan de implementación (Fase 13D)

### Paso 1 — Migración SQL
- Crear role `authenticated` con permisos de SELECT/INSERT/UPDATE/DELETE en tablas de dominio
- `ENABLE ROW LEVEL SECURITY` en todas las tablas de dominio
- `CREATE POLICY ... USING (companyId = current_setting('app.current_company_id', true))`
- Tablas de dominio: Invoice, Transaction, Account, Retencion, IGTFTransaction,
  AccountingPeriod, PeriodSnapshot, FiscalYearClose, ControlNumberSequence,
  RetentionSequence, CompanyMember, AuditLog, ExchangeRate, PaymentRecord,
  BankAccount, BankTransaction (cuando existan)
- Tablas excluidas de RLS: Company (accesible por id solo), User (Clerk manage)

### Paso 2 — `src/lib/prisma-rls.ts`
- `withCompanyContext(companyId, tx, fn)` — inyecta `SET LOCAL` + ejecuta fn
- Tests unitarios: verifica que `set_config` se llama con `true` (LOCAL)

### Paso 3 — Actualizar Server Actions
- Todas las actions con `$transaction` reemplazan el bloque interno por `withCompanyContext`
- Order canónico en actions: auth → rateLimit → safeParse → verifyCompany → withCompanyContext
- Estimar: ~15-20 actions afectadas

### Paso 4 — Actualizar ADR-004
- ADR-004 pasa de "única defensa" a "segunda capa" (redundante, pero mantenida)
- `company-isolation.test.ts` sigue activo como guard de CI

### Paso 5 — Tests de regresión
- Integration test: crear dos companies, intentar leer datos de company B desde contexto de company A
- Debe retornar 0 rows sin lanzar error (RLS silencia — no expone existencia)

---

## Notas de implementación

- `set_config(key, value, is_local)` — tercer parámetro `true` = LOCAL (per-transaction)
- La función `current_setting('app.current_company_id', true)` — segundo parámetro `true` = missing_ok (retorna NULL si no está seteado, no lanza error)
- Si `app.current_company_id` es NULL → la policy `USING` evalúa FALSE → 0 rows retornados (comportamiento correcto — fail-closed)
- Operaciones admin (migraciones) usan `neondb_owner` que tiene BYPASSRLS → no afectadas
- `$transaction Serializable` (ADR-001) sigue funcionando — `SET LOCAL` es compatible con cualquier isolation level

---

## Consecuencias

**Positivas:**
- Defense-in-depth real: un bug en la app layer no puede exponer datos de otro tenant
- Fail-closed: sin `set_config`, la query retorna vacío — no explota ni expone
- Compatible con PrismaPg pooled — no requiere conexión directa por request
- No rompe ADR-001 (Serializable), ADR-002 (Decimal), ADR-003 (Restrict)

**Negativas / Costos:**
- ~15-20 actions a refactorizar en Fase 13D
- Una migración SQL con múltiples `CREATE POLICY` — revisión cuidadosa necesaria
- Debugging más complejo: un query que retorna vacío puede ser RLS o `companyId` incorrecto

---

## Alternativas descartadas

- **Neon Authorize / Data API**: solo aplica para apps cliente→BD directas, no Next.js backend
- **Prisma Middleware**: no es defensa en BD, bypaseable con `$queryRaw`
- **`SET SESSION`**: incompatible con PgBouncer transaction mode

## Referencias
- [Neon RLS Docs](https://neon.com/docs/guides/row-level-security)
- [Neon Connection Pooling](https://neon.com/docs/connect/connection-pooling) — documenta que SET SESSION no persiste en transaction mode
- ADR-004: companyId obligatorio (capa de aplicación — primera línea de defensa)
- ADR-006: controles de seguridad generales
