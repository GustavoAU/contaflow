# ADR-002 — Decimal.js para Todo Cálculo Monetario

- **Status**: DECIDED ✅
- **Date**: 2026-03-01 (foundational)
- **Author**: arch-agent
- **Applies to**: all modules — InvoiceService, RetentionService, IGTFService, PaymentService, ReceivableService, BankingService

## Context

JavaScript `Number` uses IEEE 754 double-precision: `0.1 + 0.2 === 0.30000000000000004`. In an accounting system, this produces centavo-level differences in IVA, ISLR, and IGTF — a tax offense in Venezuela (Código Orgánico Tributario, error en declaración). Prisma maps `@db.Decimal` fields to `Prisma.Decimal` (distinct from `Decimal.js`) — explicit conversion is required.

## Decision

**`Decimal.js` for all arithmetic on money. Never `Number`, never `parseFloat`, never `Math.*` on amounts.**

```typescript
// ✅ CORRECT
import Decimal from 'decimal.js';
const iva = new Decimal(baseAmount).mul('0.16');  // 16.00 exact

// ❌ INCORRECT — produces precision errors
const iva = baseAmount * 0.16;
const iva = parseFloat(baseAmount) * 0.16;
```

### Prisma ↔ Decimal.js conversion

```typescript
// Prisma returns Prisma.Decimal — convert before operating:
const base = new Decimal(invoice.baseAmount.toString());

// When saving back to Prisma — Prisma.Decimal accepts string:
await tx.invoice.update({ data: { totalAmount: total.toString() } });
```

### Prisma schema — mandatory types

```prisma
// ✅ For amounts with centavos
amount    Decimal @db.Decimal(19, 4)

// ✅ For percentages with 2 decimals
rate      Decimal @db.Decimal(5, 2)

// ❌ FORBIDDEN for money
amount    Float
amount    Int   // only if stored as integer centavos — must be explicitly documented
```

## Rejected alternatives

| Alternative | Reason for rejection |
|---|---|
| Native `Number` | IEEE 754 → precision errors in fiscal calculations |
| `Int` (centavos) | Requires manual conversion throughout the UI — error-prone at scale |
| `Big.js` | Decimal.js is a superset with more features — no reason to switch |

## Mandatory test cases (for test-agent)

```typescript
// These values MUST pass without precision errors:
expect(new Decimal('100.10').mul('0.16').toString()).toBe('16.016')  // IVA on irregular amount
expect(new Decimal('1333.33').mul('0.03').toString()).toBe('39.9999') // IGTF boundary
expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3')        // classic JS float case
```

## Owner files

Every function that calculates amounts in `src/modules/**/services/`.
