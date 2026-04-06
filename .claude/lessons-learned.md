# ContaFlow — Lessons Learned

> Real project errors. Format: [Phase] [Context] → [Error] → [Golden rule].
> Update here before reporting success to the orchestrator when a bug is detected in production or in an audit.

---

## LL-001 — Incomplete RIF Regex (Phase 12B / 18.6)

- **Phase detected**: 12B — pre-merge audit
- **Context**: RIF VEN-NIF validation regex in `invoice.schema.ts` and `retention.schema.ts`
- **Error**: `/^[JVEGP]-\d{8}-?\d?$/i` — missing `C` (Comunal) in the charset. Venezuelan comunal organizations with a `C-` RIF prefix could not register invoices.
- **Fix applied**: `VEN_RIF_REGEX = /^[JVEGCP]-\d{8}-?\d?$/i` in `src/lib/fiscal-validators.ts` as single source of truth
- **Golden rule**: The RIF regex lives in ONE place only (`fiscal-validators.ts`). Never duplicate it in schemas. Any change to the regex → update `fiscal-validators.ts` and the corresponding test.
- **Regression test**: `fiscal-validators.test.ts` — case `C-12345678` must pass, `C-12345678-9` also.

---

## LL-002 — Missing companyId in Idempotencia Queries (Phase 13C-B1) ✅ RESOLVED

- **Phase detected**: 13C-B1 — multi-tenant isolation audit 2026-04-01
- **Resolved**: 2026-04-04 — `retention.actions.ts` lines 70 and 164
- **Context**: `retention.actions.ts` — idempotencia fast-path and P2002 recovery path
- **Error**: `prisma.retencion.findFirst({ where: { idempotencyKey } })` without `companyId`. An attacker with a known `idempotencyKey` can confirm whether a retención exists in any company in the system (cross-tenant information-disclosure).
- **Fix applied**: `findFirst({ where: { idempotencyKey, companyId: data.companyId } })` — both fast-path (line 70) and recovery path (line 164)
- **Golden rule**: Idempotencia is always verified with `{ idempotencyKey, companyId }` — never by `idempotencyKey` alone. The key is globally unique by design (`@unique`), but the check must be scoped to the tenant to avoid revealing existence to other tenants.

---

## LL-003 — Missing companyId in Account Code Uniqueness (Phase 13C-B1) ✅ RESOLVED

- **Phase detected**: 13C-B1 — multi-tenant isolation audit 2026-04-01
- **Resolved**: 2026-04-04 — `account.actions.ts` line ~190
- **Context**: `account.actions.ts` `updateAccountAction` — unique code verification
- **Error**: `prisma.account.findFirst({ where: { code, NOT: { id } } })` — without `companyId`. Code `1.1.1.01` from company A blocks a legitimate update of that same code in company B.
- **Impact**: incorrect logic (not just information-disclosure) — legitimate operations are blocked.
- **Fix applied**: `findFirst({ where: { code, companyId: before.companyId, NOT: { id }, deletedAt: null } })`
- **Golden rule**: Uniqueness of business fields (account code, invoice number, etc.) is always `@@unique([companyId, field])` in the schema AND `findFirst({ where: { companyId, field } })` in code.

---

## LL-004 — `environmentMatchGlobs` Does Not Exist in Vitest 4

- **Phase detected**: initial test configuration
- **Context**: attempt to configure environments by glob in `vitest.config.ts`
- **Error**: `environmentMatchGlobs` was removed in Vitest 4. Using this option breaks configuration silently or with a cryptic error.
- **Fix**: `// @vitest-environment jsdom` on the FIRST line of each React component test file. The `vitest.config.ts` uses `environment: 'node'` globally.
- **Golden rule**: Never use `environmentMatchGlobs`. Always use the per-file directive.

---

## LL-005 — Advisory Locks Do Not Survive PgBouncer Transaction Mode (Neon)

- **Phase detected**: 12B — concurrency decision
- **Context**: proposal to use `pg_advisory_lock` to serialize correlativo generation
- **Error**: Neon serverless uses PgBouncer in `transaction` mode. Session-level advisory locks (`pg_advisory_lock`) do not survive the pool — each query may go to a different connection. Result: deadlocks under load or locks that are never released.
- **Fix**: `$transaction({ isolationLevel: 'Serializable' })` + atomic UPDATE (see ADR-001)
- **Golden rule**: On Neon serverless, never use session-level advisory locks. Always use transaction-level locking via Serializable SSI or explicit row-level locks inside `$transaction`.

---

## LL-006 — `||` vs `??` for Env Vars in CI/CD

- **Phase detected**: 13B — CI/CD infrastructure
- **Context**: `prisma.config.ts` — fallback for `DATABASE_URL_DIRECT`
- **Error**: GitHub Actions returns `""` (empty string) for secrets not configured in the environment. `??` only coalesces `null` and `undefined` — `""` passes through as a valid value and Prisma fails with a cryptic invalid URL error.
- **Fix**: use `||` for all env var fallbacks: `process.env.DATABASE_URL || "fallback"`
- **Golden rule**: For infrastructure configuration env vars, always use `||`, not `??`.

---

## LL-007 — Type-Safe Cast for @react-pdf/renderer Without `as any`

- **Phase detected**: 12B / 18.2 — PDF generation
- **Context**: `renderToBuffer()` from `@react-pdf/renderer` — the React PDF element type does not directly match the type expected by the function
- **Error**: using `element as any` passes TypeScript but hides real type errors in PDF component props.
- **Fix**: `element as Parameters<typeof renderToBuffer>[0]` — extracts the type of the function's first parameter at compile time. If the type changes in a future version, TypeScript will catch it.
- **Golden rule**: Never use `as any` to adapt library types. Use `Parameters<typeof fn>[N]`, `ReturnType<typeof fn>`, or `ConstructorParameters`.

---

## LL-008 — Restart `npm run dev` After `prisma generate`

- **Phase detected**: multiple phases
- **Context**: any schema change + `prisma generate`
- **Error**: Next.js caches the Prisma module in development. Without restarting, the client uses the previous version of the schema and throws `Cannot read properties of undefined` on new models/fields.
- **Golden rule**: Mandatory flow always: `prisma migrate dev` → `prisma generate` → restart `npm run dev`. No shortcut exists.
