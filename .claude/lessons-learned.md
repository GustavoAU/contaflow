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

## LL-009 — verifyMembership Boolean Anti-Pattern (Phase 17 / 2026-04-06) ✅ RESOLVED

- **Phase detected**: 17 — security audit 2026-04-06
- **Context**: `bank-reconciliation/actions/banking.actions.ts` — `verifyMembership` helper
- **Error**: A helper that returns `boolean` from a `companyMember` query permanently blocks ADR-006 D-1 enforcement because the `role` field is never surfaced. Any action using a boolean membership check can never verify whether the caller has ADMIN vs ACCOUNTANT vs VIEWER.
- **Fix applied**: Return `companyMember | null` from membership lookup; check `.role` at the action level per the ADR-006 D-1 matrix.
- **Golden rule**: Never write a `verifyMembership(): boolean` helper. The canonical pattern is `findUnique({ where: { userId_companyId }, select: { role: true } })` returning the member object or null. The action checks `member.role` against the required level.
- **Regression test**: Action tests with VIEWER-role stub must return `{ success: false, error: 'No autorizado para esta operación' }` for every mutating action.

---

## LL-010 — Service Methods Without $transaction Wrapping Are Auditable Surface (Phase 17 / 2026-04-06) ✅ RESOLVED

- **Phase detected**: 17 — security audit 2026-04-06
- **Context**: `BankStatementService.ts` — `addTransaction`, `matchTransaction`, `unmatchTransaction`
- **Error**: Service layer methods that mutate financial records without accepting a `tx` parameter or wrapping in `$transaction` violate CLAUDE.md even if no action currently calls them. Public surface = auditable surface. If a future action calls these methods directly, mutations occur without atomicity and without AuditLog.
- **Fix applied**: Either (a) accept a `Prisma.TransactionClient` parameter and require callers to wrap, or (b) route all action calls through a higher-level service (e.g. `BankingService`) that already provides transaction wrapping. Mark internal methods explicitly.
- **Golden rule**: Every public method on a service class that writes to the DB must either (a) accept a `tx: Prisma.TransactionClient` and delegate the transaction to the caller, or (b) wrap its own `prisma.$transaction` internally. A method that calls `prisma.model.create/update/delete` directly without either pattern is a violation of the `$transaction` mandatory rule.
- **Regression test**: Integration test asserting that a failed downstream write after `addTransaction` rolls back the bankTransaction record.

---

## LL-008 — Restart `npm run dev` After `prisma generate`

- **Phase detected**: multiple phases
- **Context**: any schema change + `prisma generate`
- **Error**: Next.js caches the Prisma module in development. Without restarting, the client uses the previous version of the schema and throws `Cannot read properties of undefined` on new models/fields.
- **Golden rule**: Mandatory flow always: `prisma migrate dev` → `prisma generate` → restart `npm run dev`. No shortcut exists.

---

## LL-011 — Read-Only Server Actions Also Need Auth (Security Audit 2026-05-18)

- **Phase detected**: full security audit 2026-05-18
- **Context**: `account.actions.ts` — `getAccountsAction`, `getNextAccountCodeAction`; `period.actions.ts` — `getActivePeriodAction`, `getPeriodsAction`
- **Error**: Read-only Server Actions that query domain tables (accounts, periods) were written without `auth()` + `companyMember` checks because they "only read data." Next.js Server Actions are callable via direct POST to the action endpoint — middleware does NOT protect Server Action invocations that bypass the page render flow.
- **Impact**: CRITICAL — any unauthenticated caller who knows a `companyId` can read the full chart of accounts or period history of any company.
- **Fix required**: EVERY `"use server"` function that queries company-scoped data must start with `auth()` + `companyMember` check, regardless of whether it's a mutation or a read. The middleware only protects page navigation — it does not protect direct Server Action POST calls.
- **Golden rule**: There is no such thing as a "safe read-only action" that skips auth. ALL `"use server"` exports that accept `companyId` as a parameter must call `auth()` and verify `companyMember` before any DB query. The test for this: "would this endpoint leak data if called from curl with no cookies?" If yes, it needs auth.
- **Regression test**: For every action in `account.actions.ts` and `period.actions.ts`, test that a call with a mocked empty Clerk session returns `{ success: false, error: "No autorizado" }`.

---

## LL-012 — Sentry Tunnel Must Pin DSN to Application DSN (Security Audit 2026-05-18)

- **Phase detected**: full security audit 2026-05-18
- **Context**: `src/app/monitoring/route.ts` — Sentry tunnel handler
- **Error**: The tunnel extracts the DSN from the user-supplied request body and relays to it. An attacker can send any Sentry DSN and the server will relay the payload to an arbitrary Sentry project, turning the app into an open relay.
- **Fix required**: Pin the allowed DSN: `const ALLOWED_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN; if (sentryDsn !== ALLOWED_DSN) return 400`. Add `checkRateLimit` on the tunnel route.
- **Golden rule**: Sentry tunnel routes must validate that the envelope DSN matches the application's own DSN before forwarding. Never relay to arbitrary Sentry endpoints.

---

## LL-013 — GL Configuration Changes Require AuditLog (Security Audit 2026-05-18)

- **Phase detected**: full security audit 2026-05-18
- **Context**: `src/modules/settings/actions/gl-config.actions.ts` — `saveGLConfigAction`
- **Error**: `companySettings.upsert` (GL account mapping) runs without `$transaction` and without `AuditLog.create`. Changing which GL accounts receive invoice postings leaves no audit trail.
- **Fix required**: Wrap in `prisma.$transaction`, capture `oldValue` (previous settings), create `AuditLog` with `action: "UPDATE_GL_CONFIG"`, include `ipAddress`/`userAgent` per R-6.
- **Golden rule**: Any mutation to `CompanySettings` is a fiscal configuration change — it must be wrapped in `$transaction` with `AuditLog` exactly like a `closeFiscalYearAction`. Configuration changes are as auditable as data changes.

---

## LL-014 — P2002 sin `meta.target` con Prisma 7.8 + adaptador Neon (2026-10-01)

- **Phase detected**: importación de plan de cuentas — detectado contra producción (ADR-056)
- **Context**: `src/lib/prisma-errors.ts` y ~13 call-sites que distinguen qué `@@unique` falló (correlativos, retenciones, idempotencia de pagos, PayrollRun, inventario)
- **Error**: dos fallas encadenadas. (1) Una regla vieja comparaba contra `controlNumber`, columna que no está en ningún índice único → rama muerta: el usuario recibía "ya existe una factura con ese número" en lugar de "error transitorio". (2) Desde Prisma 7.8.0 con `@prisma/adapter-neon`, `meta.target` no existe (`meta` llega `{}`); las columnas viven en `meta.driverAdapterError.cause.constraint.fields`, con o sin comillas literales. Todos los call-sites devolvían `false` en silencio.
- **Fix applied**: `p2002TargetIncludes` cubre ambas formas.
- **Golden rule**: nunca leer `meta.target` a mano; siempre `p2002TargetIncludes(e, "<columna del CONSTRAINT>")`. La columna es la del `@@unique`, no la del documento. Al subir Prisma de minor, re-verificar la forma del error P2002 contra la base real.
- **Regression test**: `src/lib/__tests__/prisma-errors.test.ts`
