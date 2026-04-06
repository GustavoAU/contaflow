# ContaFlow — Agent Guide

## Stack

Next.js 16 App Router | Prisma 7.4.1 + @prisma/adapter-pg (pooled) | Neon | Clerk | Zod 4 | Vitest 4 | Decimal.js | @upstash/ratelimit | @sentry/nextjs

## Prisma / DB

- `src/lib/prisma.ts`: singleton adapter-pg with `DATABASE_URL` (pooled)
- Migrations: `DATABASE_URL_DIRECT` in `prisma.config.ts`
- After every `prisma generate` → ALWAYS restart `npm run dev`

## Module structure

```
src/modules/[name]/{schemas,services,actions,components,__tests__}/
```

## Accounting rules — INVIOLABLE

- NEVER `float` for money → always use `Decimal.js`
- NEVER `DELETE` on accounting asientos → always `VOID` (status change)
- `$transaction` mandatory in EVERY financial mutation
- `Serializable` mandatory for: `getNextControlNumber`, `getNextVoucherNumber`, período closing
- `onDelete: Restrict` on ALL contable tables — never `Cascade`
- `AuditLog` inside the same `$transaction` as the main mutation

## Zod 4

- Use `{ error: "msg" }` — NOT `{ errorMap: ... }`

## Rate Limiting

- `src/lib/ratelimit.ts`: `limiters.fiscal` (30/min) + `limiters.ocr` (10/min) via Upstash sliding window
- If `UPSTASH_REDIS_REST_URL` is not defined → no-op (allows all) — never blocks in dev/test
- If Redis fails at runtime → silent catch, request is allowed
- Mock in tests: `vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), limiters: { fiscal: {}, ocr: {} } }))`
- Applied to: `createInvoiceAction`, `createRetentionAction`, `createIGTFAction`, `createAccountAction`, `extractInvoiceAction` (OCR)

## Vitest 4

- Global environment: `node`
- React components: `// @vitest-environment jsdom` on the FIRST line of the test file
- `environmentMatchGlobs` DOES NOT EXIST in Vitest 4 — forbidden
- Mock pattern: `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`
- `vi.hoisted()` for variables before `vi.mock()`
- Always mock in Action tests: `next/cache`, `@clerk/nextjs/server`
- Interactive `$transaction` mock: `vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({ modelo: prisma.modelo, auditLog: prisma.auditLog })) as never)`

## Fiscal VEN-NIF

- IVA: General 16% | Reducido 8% | Adicional Lujo 15% (total 31%) | Exento/Exonerado 0%
- `luxuryGroupId` links `IVA_ADICIONAL` ↔ `IVA_GENERAL` in `InvoiceTaxLine`
- IGTF 3%: applies if `currency !== VES` OR (`isSpecialContributor` AND `currency === VES`)
- Retenciones IVA: 75%/100%. Only if `isSpecialContributor`
- Retenciones ISLR Decreto 1808: variable rates per payment type
- RIF regex: `/^[JVEGCP]-\d{8}-?\d?$/i`

## Prisma errors

- `P2002` → "Ya existe..." | `P2003` → "Datos de referencia inválidos"
- Never expose raw Prisma errors to the client

## Current status

- Phase 12A ✅ merged
- Phase 12B ✅ merged (invoice books, PDFs, RIF fix)
- Fase 13C ✅ merged (security B1, pagination B2, PeriodSnapshot B3-B4, report-cache B5, query monitoring B6)
- Fase 14 ✅ merged (multimoneda: Currency enum, ExchangeRate, BCV rates)
- Fase 14B ✅ merged (PaymentRecord — pagos con múltiples medios)
- Fase 15 ✅ merged (FiscalYearClose — cierre de año fiscal)
- Fase 16 ✅ merged (Receivable/Payable portfolio — cuentas por cobrar/pagar)
- Fase 17 ⏳ in progress — Conciliación Bancaria (scaffolding merged, ReconciliationService + UI pendientes)
- Fase 13D ⏳ planned — RLS Row Level Security (after Fase 17, see ADR-007)

**422 tests GREEN** | **CI passing** (0 lint errors as of 2026-04-05)

## Principles — operational rules

- DDD: each module = bounded context. TransactionService never imports from
  InvoiceService. Communication via Server Action or domain event.
- DRY: ISLR rates in a single const. Fiscal calculation logic in
  FiscalCalculator, not duplicated in each service.
- SOLID-S: validateDoubleEntry() separate from persistTransaction().
  One function = one responsibility.
- SOLID-O: new IVA alícuota = new enum entry + config. No touching
  existing services.
- YAGNI: do not implement Phase 28 (Compras/Ventas) or
  Phase 29 (Colombia/DIAN) until a signed contract
  exists in contaflow-contract.md.
- KISS: if it fits in one Zod line, do not create a validator class.

## Forms — async state pattern

- **`useTransition`** → standard pattern for forms with Zod + typed objects (our case). Not deprecated in React 19.
- **`useActionState`** → only for simple forms without complex validation (1-2 fields, no Zod). Designed for `<form action={fn}>` + FormData, incompatible with our typed stack.

## Conventions

- Files/folders in English
- UI content in Spanish
