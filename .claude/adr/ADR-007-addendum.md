# ADR-007 Addendum — Prerrequisitos completos del rol `authenticated` (RLS)

> Estado: Aceptado · 2026-06-28
> Consolida el "Fix A1" (y sucesivos) que hasta ahora vivían solo en comentarios
> de migración. Complementa a [ADR-007](ADR-007.md), que describe la versión
> original de Fase 13D (sin `SET LOCAL ROLE`).

## Contexto

La versión original de Fase 13D (ADR-007) implementaba RLS con policies `USING`
pero `withCompanyContext` **no** cambiaba de rol. Como `neondb_owner` tiene
`BYPASSRLS`, las policies se ignoraban. El **Fix A1** (migración
`20260611_rls_force_with_check`) corrigió esto haciendo que `withCompanyContext`
ejecute `SET LOCAL ROLE authenticated` (rol sin `BYPASSRLS`) + `FORCE ROW LEVEL
SECURITY` + `WITH CHECK`.

El problema: el rol `authenticated` debe tener un conjunto **completo** de
privilegios para que las queries funcionen tras el `SET ROLE`. Ese conjunto
estaba disperso en comentarios de dos migraciones y **le faltaba una pieza**
(`USAGE ON SCHEMA public`), lo que causó el bug **HA-01** (auditoría módulo
Pagos): `permission denied for schema public` al registrar un pago / crear una
cuenta — en realidad en cualquier call-site de `withCompanyContext`.

## Decisión — Checklist de provisioning del rol `authenticated`

Al aprovisionar una base de datos nueva (p.ej. una branch de Neon), el rol
`authenticated` DEBE quedar con TODOS estos privilegios. El paso 3 es
prerrequisito de los pasos 4-6 (sin `USAGE` de schema, los grants de tabla son
inertes y toda query falla con "permission denied for schema public"):

```
1. CREATE ROLE authenticated NOLOGIN;
2. GRANT authenticated TO neondb_owner;                 -- habilita SET LOCAL ROLE
3. GRANT USAGE ON SCHEMA public TO authenticated;       -- ← faltaba (HA-01)
4. GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
5. GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
6. ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
```

Origen de cada paso:
- Pasos 1, 4, 5 → `20260406110000_fase13d_rls_company_isolation`
- Pasos 2, 6 (+ re-grant de 4/5) → `20260611_rls_force_with_check`
- Paso 3 → `20260628_rls_grant_schema_usage` (este addendum)

## Notas

- **NO** conceder `CREATE ON SCHEMA public` a `authenticated`: `USAGE` solo permite
  resolver nombres; `CREATE` permitiría crear objetos (superficie innecesaria).
- `EXECUTE` sobre `set_config`/`current_setting` no se concede: viven en
  `pg_catalog` y `PUBLIC` ya los puede ejecutar.
- Las policies con subconsulta cross-tabla (`JournalEntry`→`Transaction`,
  `BankStatement`→`BankAccount`) se evalúan bajo el rol efectivo `authenticated`;
  funcionan con `USAGE` de schema + el `SELECT` de tabla ya concedido. No
  requieren `SECURITY DEFINER`.
- `GRANT USAGE ON SCHEMA` es permanente y cubre tablas futuras (el `USAGE` es del
  objeto schema, no de su contenido). El DML por tabla sí depende de
  `ALTER DEFAULT PRIVILEGES`.

## Smoke-test obligatorio tras aplicar la migración

1. `createPaymentAction` end-to-end (PaymentRecord — el bug original de HA-01).
2. Una query sobre `BankStatement` y otra sobre `JournalEntry` bajo
   `withCompanyContext` (policies con subquery cross-tabla).
3. Aislamiento: query con `companyId` ajeno → 0 filas (RLS sigue activa).

## Fase A1-bis — cobertura completa (2026-07-06)

La migración `20260706_rls_a1bis` cerró el gap de "tablas restantes" listado al final
de `20260611_rls_force_with_check`: **51 tablas más** bajo ENABLE+FORCE+policy
(`company_isolation` con USING+WITH CHECK). Diseño verificado tabla por tabla
(mapa Explore 2026-07-06):

- **Ninguna tabla pendiente era global** — todas tenant-scoped (INPCRate y
  PublicHoliday incluidas: tienen `companyId` propio).
- **Casos especiales:** `Company` → policy self-id (`id = contexto`);
  `ManagedClient` → `despachoCompanyId`; 10 tablas sin `companyId` propio →
  policy con subquery al padre (patrón JournalEntry): InvoiceTaxLine→Invoice,
  OrderItem→Order, QuotationItem→Quotation, PaymentBatchLine→PaymentBatch,
  InventoryMovementLot/Serial→InventoryMovement, IncomeDistributionLine/Audit→
  IncomeDistribution, SubscriptionPayment/PlanChangeRequest→Subscription.
- **Grupo de riesgo** (consultadas bajo `authenticated` HOY vía withCompanyContext):
  Company, CompanySettings, ExchangeRate, INPCRate, InflationAdjustment,
  FixedAssetINPCRestatement, InvoiceTaxLine — el contexto siempre coincide con el
  companyId de esas queries (verificado en call-sites); smoke funcional PASS
  (contexto propio ve filas; contexto ajeno → 0, fail-closed).
- Grants: sin cambios — cubiertos por 20260611 (blanket + default privileges) y
  20260628 (USAGE de schema).

Con esto TODAS las tablas de negocio del schema tienen RLS. Tablas nuevas: incluir
ENABLE+FORCE+policy en su migración de creación (checklist pre-merge).

## Rollback (emergencia)

```sql
REVOKE USAGE ON SCHEMA public FROM authenticated;  -- vuelve al estado roto
```
