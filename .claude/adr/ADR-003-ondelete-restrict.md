# ADR-003 — onDelete: Restrict en Todas las Tablas Contables

- **Status**: DECIDED ✅
- **Date**: 2026-03-01 (foundational)
- **Author**: arch-agent
- **Applies to**: JournalEntry, Transaction, Invoice, Retencion, IGTFTransaction, PaymentRecord, InvoicePayment, BankAccount, BankStatement, BankTransaction, FiscalYearClose, ReceivableService

## Context

A registered accounting asiento has legal validity (VEN-NIF, Venezuelan Código de Comercio). Cascade-deleting a supplier or a company that has associated invoices destroys the audit trail and may constitute manipulation of accounting books — a criminal offense. PostgreSQL with `onDelete: Cascade` would execute this silently.

## Decision

**`onDelete: Restrict` on ALL relations of contable tables. No exceptions.**

```prisma
// ✅ ALWAYS like this on contable tables:
model Invoice {
  company   Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
  period    AccountingPeriod @relation(fields: [periodId], references: [id], onDelete: Restrict)
}

// ❌ NEVER on contable tables:
model Invoice {
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
}
```

## Operational consequence: Soft Delete mandatory

Because `Restrict` prevents deleting parent entities that have children, logical deletion is the only valid path:

```prisma
// Mandatory soft delete pattern on fiscal entities:
model Invoice {
  deletedAt DateTime?   // null = active, DateTime = logically deleted
}
```

Listing queries ALWAYS filter `deletedAt: null`:
```typescript
prisma.invoice.findMany({ where: { companyId, deletedAt: null } })
```

## arch-agent checklist before approving any schema

```
[ ] Do all relations on the new table have onDelete: Restrict?
[ ] If the entity can be "deleted" → does it have a deletedAt DateTime? field?
[ ] Do listing queries already include deletedAt: null in where?
[ ] Is onDelete: Cascade ABSENT from all relations on the table?
```

## Tables where Cascade IS acceptable (non-contable)

| Table | Relation | Justification |
|---|---|---|
| `CompanyMember` | → `Company` | Membership record, not an accounting record. If the company is deleted (soft delete first), members have no meaning. |
| `Session` (Clerk) | → `User` | Managed by Clerk, outside the accounting domain. |

**Note**: these exceptions are exhaustive. Any new table requires an explicit decision in a new ADR.
