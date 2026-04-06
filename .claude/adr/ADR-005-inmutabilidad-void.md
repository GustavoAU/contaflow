# ADR-005 — Inmutabilidad Contable: VOID, No DELETE

- **Status**: DECIDED ✅
- **Date**: 2026-03-01 (foundational)
- **Author**: arch-agent
- **Applies to**: Transaction, JournalEntry, Invoice, Retencion

## Context

The Venezuelan Código de Comercio (Art. 32-33) and VEN-NIF establish that accounting books are inviolable. A registered accounting asiento cannot be deleted — it can only be voided via a documented counter-entry. A database DELETE destroys the audit trail.

## Decision

**NEVER `prisma.journalEntry.delete()` or `prisma.transaction.delete()` in production code. Always VOID via status change.**

```typescript
// ✅ CORRECT — accounting cancellation
await tx.transaction.update({
  where: { id: transactionId },
  data: {
    status: 'VOIDED',
    voidedAt: new Date(),
    voidedBy: userId,
    voidReason: reason,
  }
});

// ❌ ILLEGAL in the accounting domain
await prisma.transaction.delete({ where: { id } });
```

## Implementation consequences

1. **Listing queries** MUST filter `status: { not: 'VOIDED' }` by default
2. **UI** must display VOIDED transactions with differentiated visual styling (strikethrough, grey color)
3. **Partida doble** of a VOIDED transaction: the original débitos and créditos still exist — the VOID creates a compensating asiento if necessary
4. **AuditLog** mandatory inside the same `$transaction` as the VOID

## ledger-agent checklist

```
[ ] Does the "cancel" operation use update with status VOIDED?
[ ] Does the AuditLog record oldValue (POSTED) and newValue (VOIDED)?
[ ] Does the listing query exclude VOIDED by default?
[ ] Is there a guard that prevents VOID of an already-VOIDED transaction?
[ ] Is a compensating asiento generated if the transaction already affected balances?
```
