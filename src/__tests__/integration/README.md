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

El job `integration` de `.github/workflows/ci.yml` corre solo en pull requests hacia `main` (no en forks). Crea un branch de Neon hijo **solo-esquema** del default, llamado `ci-<run>-<intento>`, aplica `prisma migrate deploy`, corre `pnpm test:integration` y borra el branch siempre (`if: always()`). Ningún dato de clientes llega al CI.

- Requiere los secretos de repositorio `NEON_API_KEY` y `NEON_PROJECT_ID`; sin ellos el job se omite sin fallar.
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
