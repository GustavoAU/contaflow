# ADR-004 — Aislamiento Multi-Tenant: companyId Obligatorio en Queries

- **Status**: DECIDED ✅ (post-audit 13C-B1, 2026-04-01)
- **Author**: arch-agent
- **Criticality**: SECURITY — information-disclosure vulnerability between tenants

## Context

Audit 13C-B1 detected 3 CRITICAL findings where `findFirst`/`findMany` omitted `companyId` in the `where` clause. This enables cross-tenant information-disclosure: a user from company A can infer data from company B via idempotencyKey or account code.

All 3 findings were fixed and verified in code (2026-04-04). The architectural test `company-isolation.test.ts` passes with 0 undocumented violations.

## Decision

**Every `findMany`, `findFirst`, `aggregate`, `count` query on domain tables MUST include `companyId` in the `where` clause.**

```typescript
// ✅ CORRECT
prisma.invoice.findMany({
  where: { companyId, deletedAt: null }
})

// ❌ INCORRECT — cross-tenant leak
prisma.invoice.findMany({
  where: { idempotencyKey }  // without companyId → any company
})
```

## Documented exceptions (allowlist)

| Operation | File | Justification |
|---|---|---|
| `findUnique({ where: { id } })` | any | PK CUID is globally unique — no leak possible |
| `findMany({ where: { bankAccountId } })` | BankStatementService | `bankAccountId` already verified against `companyId` by the caller |
| `findUnique({ where: { id: statementId } })` | BankStatementService | Caller verifies membership before delegating |
| No Prisma queries | GeminiOCRService, IGTFService, InvoiceSequenceService | Pure calculation services — no DB access |

## Resolved findings (fixed 2026-04-04)

| Finding | File | Line | Fix applied |
|---|---|---|---|
| CRITICAL-1 ✅ | `account.actions.ts` | ~190 | `findFirst({ where: { code, companyId: before.companyId, NOT: { id } } })` |
| CRITICAL-2 ✅ | `retention.actions.ts` | ~70 | `findFirst({ where: { idempotencyKey, companyId: data.companyId } })` |
| CRITICAL-3 ✅ | `retention.actions.ts` | ~164 | `findFirst({ where: { idempotencyKey: input.idempotencyKey, companyId: input.companyId } })` |

## Pre-flight check for agents

Before writing any read query:
1. Is it `findUnique` by PK? → OK without companyId
2. Is it `findMany`/`findFirst`/`aggregate`? → `companyId` MANDATORY
3. Does the companyId come from the authenticated user (Clerk) or from an already-verified object? → use the verified one

## Architectural test

`src/__tests__/architecture/company-isolation.test.ts` — fails automatically if a new file appears with `findMany` missing `companyId` that is not registered in the allowlist.
