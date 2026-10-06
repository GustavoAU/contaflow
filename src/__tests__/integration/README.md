# Integration Tests — ContaFlow

## Qué va aquí (ADR-010 D-2)

Tests que dependen del comportamiento real de PostgreSQL y NO pueden ser reemplazados por mocks. Casos obligatorios:

- **`getNextControlNumber`** — Serializable + SELECT FOR UPDATE: dos llamadas concurrentes nunca pueden retornar el mismo número. Un mock no puede detectar race conditions.
- **`runInflationAdjustmentAction`** — guards encadenados FiscalYearClose + Serializable.
- **`BankReconciliationService`** — 3-way match con transacciones reales.

## Cómo correrlos

> **ADVERTENCIA**: NUNCA correr contra la DB de producción (`DATABASE_URL`). Usa siempre una DB de test aislada.

```bash
# Con una DB de test dedicada
DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/contaflow_test \
  npx vitest run --config vitest.integration.config.ts

# Si DATABASE_URL_TEST no está definida, todos los tests se omiten automáticamente (skipIf)
```

## En CI (SPEC-002)

El job `integration` de `.github/workflows/ci.yml` corre solo en pull requests hacia `main` (no en forks). Trabaja en un proyecto de Neon **dedicado** (`contaflow-ci`, baseline `main` vacío; nunca el de producción): crea un branch hijo del default llamado `ci-<run>-<intento>`, aplica `prisma migrate deploy` desde cero, corre `pnpm test:integration` y borra el branch siempre (`if: always()`). Ningún dato de clientes ni credencial de producción está al alcance del CI. No se usa `schema-only`: Neon lo rechaza (412) en proyectos con el rol heredado `authenticated`.

- Requiere los secretos `NEON_API_KEY` (de alcance de proyecto) y `NEON_PROJECT_ID` en el **environment `neon-ci`** (revisores requeridos); sin ellos el job se omite sin fallar.
- No ejecutar nada contra el branch `main` de `contaflow-ci`: es el baseline vacío del que se clona.
- La lógica de crear/borrar está en `scripts/ci-neon-branch.mjs`; las guardas (solo `ci-*`, nunca default/primary/protegido, nunca otro proyecto) en `scripts/lib/neon-ci-guards.mjs`, con tests en `scripts/__tests__/`.
- El branch nace con `expires_at` (3 h) como red de seguridad si el borrado nunca llega a correr.
- Los tests usan `adapter-pg`; producción usa el adaptador de Neon. Un P2002 puede llegar con otra forma según el driver (LL-014): un test que dependa de esa forma debe tenerlo en cuenta.

## Convenciones

- Cada describe block lleva el tag `@integration` en su nombre.
- Cada archivo hace cleanup de sus datos en `afterAll` (no dejar datos sucios).
- No usar `DATABASE_URL` (producción/dev) — solo `DATABASE_URL_TEST`.
- Los tests de integración están excluidos del `npx vitest run` por defecto (ver `vitest.config.ts`).

## Estado actual

| Test | Estado |
|------|--------|
| `control-number-sequence.test.ts` | Estructura lista — requiere `DATABASE_URL_TEST` |
| `gl-quantize-balance.test.ts` | Corre en el job `integration` (SPEC-004); desde SPEC-001 el caso (i-a) comprueba que el trigger rechaza el asiento sin cuantizar |
| `gl-balance-trigger.test.ts` | Corre en el job `integration` (SPEC-001 / ADR-060): CA-2..CA-6 del trigger de cuadre y la forma real del error de Prisma |
