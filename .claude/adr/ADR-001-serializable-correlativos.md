# ADR-001 — Isolation Level Serializable para Números Correlativos

- **Status**: DECIDED ✅
- **Date**: 2026-03-29
- **Author**: arch-agent
- **Applies to**: `getNextControlNumber`, `getNextVoucherNumber`, accounting período closing

## Context

ContaFlow generates unique sequential numbers per company: invoice control numbers (`00-XXXXXXXX`, Providencia 0071 SENIAT Art. 14) and retención vouchers (`CR-XXXXXXXX`, Decreto 1808). Under concurrency on Neon serverless, a `SELECT MAX() + 1` produces race conditions: two simultaneous requests can read the same MAX and generate duplicate numbers — fiscally illegal.

## Decision

**`prisma.$transaction({ isolationLevel: 'Serializable' })` + atomic UPDATE on the sequence row.**

```typescript
// Canonical pattern — do NOT deviate
await prisma.$transaction(async (tx) => {
  await tx.controlNumberSequence.update({
    where: { companyId_invoiceType: { companyId, invoiceType } },
    data: { lastNumber: { increment: 1 } },
  });
  const seq = await tx.controlNumberSequence.findUnique({ ... });
  return formatControlNumber(seq.lastNumber);
}, { isolationLevel: 'Serializable' });
```

## Rejected alternatives

| Alternative | Reason for rejection |
|---|---|
| `SELECT MAX() + 1` | O(n) table scan, gaps under concurrency, duplicates possible |
| Session advisory locks | Do not survive PgBouncer in `transaction` mode (Neon serverless) → deadlocks |
| `uuid` as correlativo | Illegal: Providencia 0071 requires sequential autonumeric format |
| `READ COMMITTED` + upsert | Insufficient: two TXs can read the same `lastNumber` before either commits |

## Consequences

- **Positive**: mathematical uniqueness guarantee without application-level locks
- **Positive**: O(1) — UPDATE on indexed row, not a table scan
- **Negative**: Serializable has ~15-20% overhead vs Read Committed — acceptable for a point-in-time creation operation
- **Operational rule**: any function that generates a número correlativo MUST use this pattern. If an agent proposes `SELECT MAX()` → arch-agent blocks it.

## Owner files

- `src/modules/invoices/services/InvoiceSequenceService.ts` — `getNextControlNumber`
- `src/modules/retentions/services/RetentionService.ts` — `getNextVoucherNumber`
- `src/modules/periods/services/PeriodService.ts` — período closing
