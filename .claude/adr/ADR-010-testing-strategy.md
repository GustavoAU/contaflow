# ADR-010 — Testing Strategy: Tiers D-1 to D-4

- **Status**: DECIDED ✅ (2026-04-08)
- **Author**: arch-agent + orchestrator-agent
- **Criticality**: QUALITY — defines mandatory test coverage per phase

## Context

Through Fase 22, all tests were D-1 (unit tests with mocks). As the codebase grows toward production with real clients, three gaps appeared:

1. Unit tests with mocks can diverge silently from DB behavior (real schema, constraints, concurrency).
2. No standard for what constitutes "sufficient" negative test coverage per service.
3. No mechanism to run integration tests against a real DB without breaking the default `vitest run`.

This ADR formalizes four testing tiers and their mandatory application rules.

## Decision

### D-1 — Unit Tests (mocks)

**Scope:** Services, actions, schemas — all mocking Prisma with `vi.mock`.  
**Command:** `npx vitest run` (default, no config flag).  
**Location:** `src/modules/**/__tests__/*.test.ts`  
**Mandatory for:** Every new service method, every new action, every schema.  
**Mock pattern:**
```typescript
vi.mocked(prisma.model.method).mockResolvedValue([] as never)
vi.mocked(prisma.$transaction).mockImplementation(
  ((fn: (tx: unknown) => unknown) => fn({ model: prisma.model, auditLog: prisma.auditLog })) as never
)
```

### D-2 — Integration Tests (real DB)

**Scope:** Concurrency, serializable isolation, FK constraints — things mocks cannot verify.  
**Command:** `npx vitest run --config vitest.integration.config.ts`  
**Location:** `src/__tests__/integration/*.test.ts`  
**Required env:** `DATABASE_URL_TEST` — a non-production Neon branch.  
**Skip pattern:** `describe.skipIf(!process.env.DATABASE_URL_TEST)` — tests skip silently if env is absent.  
**Excluded from default run:** `vitest.config.ts` excludes `src/__tests__/integration/**`.  
**Mandatory for:** Any new serializable operation (correlativo, pendingAmount race), any new FK constraint.

First test: `src/__tests__/integration/control-number-sequence.test.ts` — verifies 5 concurrent `getNextControlNumber` calls return unique numbers.

### D-3 — E2E Tests (Playwright)

**Status:** DEFERRED — planned for Fase 27 (PWA) or later.  
**Not a blocker** for any current phase.

### D-4 — Coverage Minimum per Phase

**Rule:** Every new service must have ≥ 2–3 non-trivial negative test cases.  
**Non-trivial** = tests that would catch a real bug (cross-tenant, VOIDED state, concurrent write, role check) — not just "returns 400 on empty input."

**Examples of qualifying negative cases (from Fase 23C):**
- `createCreditNote` rejects if `relatedInvoiceId` belongs to different company (CRITICAL-1)
- `createDebitNote` rejects if `paymentStatus === "VOIDED"` even when `deletedAt` is null (HIGH-1)
- `createCreditNote` rejects if `nc.totalAmountVes > pendingAmount` (TOCTOU guard)

## CLAUDE.md Phase Gate Reference

Step 2 of the phase gate: `npx vitest run` — this runs D-1 only.  
D-2 is run manually when a new serializable operation is added or before a major release.  
D-4 is verified by the orchestrator as part of the COVERAGE AUDIT step (step 5 of FEATURE_FLOW).

## Related

- `vitest.config.ts` — excludes `src/__tests__/integration/**`
- `vitest.integration.config.ts` — integration-only config
- `src/__tests__/integration/README.md` — run instructions and DB warning
- ADR-011 — OCR Idempotencia (PENDIENTE/YAGNI — ver contaflow-contract.md)
