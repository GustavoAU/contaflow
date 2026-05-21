# Security Audit Report — ContaFlow
**Date:** 2026-05-18
**Auditor:** security-agent
**Scope:** Full codebase audit (src/modules/) — Steps 1–12 of audit_playbook
**Test count at audit time:** 1819 GREEN

---

## CRITICAL Findings

### Finding CRITICAL-1 — getAccountsAction: No Authentication on Account List

- **File**: `src/modules/accounting/actions/account.actions.ts` lines 59–71
- **Vector**: AUTHORIZATION / TENANT_ISOLATION
- **Description**: `getAccountsAction(companyId: string)` calls `prisma.account.findMany({ where: { companyId } })` with zero authentication. No `auth()` call, no companyMember check. Any caller who can POST to the Server Action endpoint with a known `companyId` CUID receives the full chart of accounts.
- **Impact**: Cross-tenant read — a competitor, former employee, or unauthorized user who learns a `companyId` (from URL or brute-force) can enumerate the entire chart of accounts of any company in the system. Chart of accounts reveals business structure, legal reserves, and tax strategy.
- **Remediation**: Add `auth()` + `companyMember` check with `ROLES.ALL` before the `findMany`. Pattern: same as `getDashboardMetricsAction`. Assign to **ledger-agent**.
- **Test required**: Unit test: calling `getAccountsAction` with no Clerk session must return `{ success: false, error: "No autorizado" }`. Assign to **test-agent**.
- **References**: ADR-004, ADR-006, LL-009

---

### Finding CRITICAL-2 — getNextAccountCodeAction: No Authentication on Account Code Discovery

- **File**: `src/modules/accounting/actions/account.actions.ts` lines 284–318
- **Vector**: AUTHORIZATION / TENANT_ISOLATION
- **Description**: `getNextAccountCodeAction(type, companyId)` calls `prisma.account.findMany({ where: { companyId } })` with no auth check. Returns the next available account code after scanning all existing account codes for the company.
- **Impact**: Same surface as CRITICAL-1 — no auth means any caller can enumerate account code density by type for any company. Additionally leaks the range and occupancy of the chart of accounts.
- **Remediation**: Add `auth()` + `companyMember` check with `ROLES.ACCOUNTING` before the query. Assign to **ledger-agent**.
- **Test required**: Same pattern as CRITICAL-1 test. Assign to **test-agent**.
- **References**: ADR-004, ADR-006

---

## HIGH Findings

### Finding HIGH-1 — getActivePeriodAction / getPeriodsAction: No Authentication

- **File**: `src/modules/accounting/actions/period.actions.ts` lines 31–51
- **Vector**: AUTHORIZATION
- **Description**: `getActivePeriodAction(companyId)` and `getPeriodsAction(companyId)` have no `auth()` call, no `companyMember` check. They call `PeriodService.getActivePeriod/getPeriods(companyId)` directly. The functions are `"use server"` — they are callable via direct POST to the Server Action endpoint.
- **Impact**: Any unauthenticated caller who knows a `companyId` can discover the current open accounting period (year/month) and the full history of periods (including which are CLOSED). This leaks fiscal year information and enables targeted backdated entry attempts.
- **Remediation**: Add `auth()` + `companyMember.findFirst({ where: { companyId, userId }, select: { role: true } })` with `ROLES.ALL`. Assign to **ledger-agent**.
- **Test required**: Test that an unauthenticated call returns `{ success: false, error: "No autorizado" }`. Assign to **test-agent**.
- **References**: ADR-004, ADR-006

---

### Finding HIGH-2 — Sentry Tunnel: No Origin Validation, Arbitrary DSN Relay

- **File**: `src/app/monitoring/route.ts` lines 9–54
- **Vector**: RATE_LIMIT / BUSINESS_LOGIC_ABUSE
- **Description**: The `/monitoring` POST handler:
  1. Extracts the Sentry DSN **from the user-supplied request body** (line 24). An attacker can send any Sentry DSN — not just this app's — and the server will relay the payload to that project's Sentry endpoint. This turns the application into an open relay for any Sentry organization.
  2. No `Host` or `Origin` header validation — any cross-origin request can reach this handler (it is explicitly listed as a public route in `middleware.ts`).
  3. No rate limiting on the endpoint itself (only a 1 MB body limit exists).
- **Impact**: 
  - Sentry quota flooding via arbitrary DSN relay (exhausts event ingestion for victim Sentry orgs).
  - This app's server bandwidth can be weaponized to flood any Sentry project.
  - No rate limit means the endpoint can be called thousands of times per minute.
- **Remediation**: Pin the allowed DSN to `process.env.NEXT_PUBLIC_SENTRY_DSN` server-side — reject any envelope whose `header.dsn` does not match. Add `checkRateLimit(ip, limiters.fiscal)` (or a dedicated tunnel limiter). Assign to **arch-agent**.
- **Test required**: Test that a request with a non-matching DSN returns 400. Test that >N requests in a window are rejected. Assign to **test-agent**.
- **References**: Audit playbook §STEP 9, CLAUDE.md middleware.ts notes

---

### Finding HIGH-3 — saveGLConfigAction / postUnbookedInvoicesAction: No Rate Limit on Fiscal Mutation

- **File**: `src/modules/settings/actions/gl-config.actions.ts` lines 96–216
- **Vector**: RATE_LIMIT
- **Description**: `saveGLConfigAction` writes to `companySettings` (GL account mapping) and `postUnbookedInvoicesAction` runs an unbounded loop posting all unbooked invoices to the GL. Neither action has `checkRateLimit`. `postUnbookedInvoicesAction` loads all unbooked invoices in a single `findMany` with no limit and posts each inside its own `$transaction` in a loop — O(N) transactions. An ADMIN calling this endpoint repeatedly hammers the Neon pool.
- **Impact**: DoS on the DB pool from repeated unbounded batch operations. A malicious ADMIN or a legitimate admin double-clicking the "causar facturas" button can flood the connection pool.
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)` to both actions. Add `take: 100` or cursor-based batching to the `findMany` in `postUnbookedInvoicesAction`. Assign to **ledger-agent** / **fiscal-agent**.
- **Test required**: Test that a second call within the rate-limit window is rejected. Assign to **test-agent**.
- **References**: CLAUDE.md §Rate Limiting, ADR-006

---

### Finding HIGH-4 — saveGLConfigAction: No AuditLog on GL Account Mapping Change

- **File**: `src/modules/settings/actions/gl-config.actions.ts` lines 96–128
- **Vector**: AUDIT_TRAIL_INTEGRITY_GUARD
- **Description**: `saveGLConfigAction` overwrites `CompanySettings` (AR/AP/sales/purchase/IVA/FX account IDs) with a plain `prisma.companySettings.upsert(...)` — no `$transaction`, no `AuditLog.create`. Changing GL account mappings can silently reroute all future invoice postings to wrong accounts with no trace.
- **Impact**: An ADMIN can change which GL accounts receive invoice postings and there will be no record of who changed what or when. This breaks PA-121 audit trail requirements for account configuration changes.
- **Remediation**: Wrap the upsert in `prisma.$transaction` and add `tx.auditLog.create` capturing `oldValue` (previous settings) and `newValue` (new settings), with `ipAddress`/`userAgent` per R-6. Assign to **ledger-agent**.
- **Test required**: Test that `saveGLConfigAction` creates an AuditLog entry with action `UPDATE_GL_CONFIG`. Assign to **test-agent**.
- **References**: CLAUDE.md R-6, ADR-019, Audit playbook §STEP 6

---

### Finding HIGH-5 — postUnbookedInvoicesAction: No AuditLog per Posted Invoice

- **File**: `src/modules/settings/actions/gl-config.actions.ts` lines 133–216
- **Vector**: AUDIT_TRAIL_INTEGRITY_GUARD
- **Description**: `postUnbookedInvoicesAction` loops over all unbooked invoices and calls `InvoiceGLPostingService.postInvoice(...)` inside a `$transaction`. It silently catches errors (`skipped++`) and does not create an `AuditLog` entry for each invoice that gets posted retroactively.
- **Impact**: Retroactive GL postings happen with no audit trail. Cannot reconstruct who triggered the mass-posting, which invoices were affected, or why some were skipped.
- **Remediation**: Add `tx.auditLog.create` inside each per-invoice `$transaction` with `action: "GL_POST_RETROACTIVE"`. Assign to **ledger-agent**.
- **Test required**: Test that after calling `postUnbookedInvoicesAction`, an AuditLog record exists for each posted invoice. Assign to **test-agent**.
- **References**: CLAUDE.md R-6, ADR-019

---

### Finding HIGH-6 — importAccountsAction: No Rate Limit on Bulk Account Import

- **File**: `src/modules/import/actions/import.actions.ts` lines 13–35
- **Vector**: RATE_LIMIT
- **Description**: `importAccountsAction` accepts an array `rows: ImportAccountRow[]` of arbitrary length and processes each row inside `ImportService.importAccounts`. No rate limiting, no array size cap validation in the action (the schema validation happens inside `ImportService`, if at all). An ADMIN can call this with millions of rows per minute.
- **Impact**: Neon pool exhaustion / timeout flood. Potential for DB lock contention if the service uses non-serializable isolation.
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)`. Add `if (rows.length > 1000) return { success: false, error: "Máximo 1000 filas por importación" }`. Assign to **arch-agent**.
- **Test required**: Test that more than 1000 rows returns a validation error. Assign to **test-agent**.
- **References**: CLAUDE.md §Rate Limiting

---

## MEDIUM Findings

### Finding MEDIUM-1 — CSP unsafe-inline on script-src (Production)

- **File**: `next.config.ts` line 26
- **Vector**: XSS
- **Description**: `script-src` includes `'unsafe-inline'` unconditionally (not just in development). The comment acknowledges this and defers a nonce strategy to post-launch. With `unsafe-inline`, any XSS injection in the page can execute arbitrary scripts even though other CSP directives are strong.
- **Impact**: If an XSS vector exists (e.g., in a dangerouslySetInnerHTML, a third-party script, or a future rendering bug), the CSP provides no protection because `unsafe-inline` is present.
- **Remediation**: Implement Next.js nonce-based CSP (Next.js 13.4+ supports `headers()` with a per-request nonce). Remove `unsafe-inline` from `script-src` in production. Assign to **arch-agent**.
- **Test required**: CSP header test that `unsafe-inline` is absent from `script-src` in production builds. Assign to **test-agent**.
- **References**: next.config.ts line 19–26, CLAUDE.md §middleware.ts post-launch notes

---

### Finding MEDIUM-2 — counterpartName / providerName: Missing .trim() and .max()

- **Files**: `src/modules/invoices/schemas/invoice.schema.ts` line 104; `src/modules/retentions/schemas/retention.schema.ts` line 100
- **Vector**: INPUT_SANITIZATION_AUDITOR
- **Description**: 
  - `counterpartName: z.string().min(1, ...)` — no `.trim()`, no `.max()`. Leading/trailing whitespace is stored as-is. An attacker can submit a 10 MB string as the counterpartName.
  - `providerName: z.string().min(1, ...)` — same issue.
  These fields appear in SENIAT fiscal books and PDF reports. Large inputs can cause memory pressure in PDF generation.
- **Impact**: Storage bloat; potential PDF generation DoS; potential SENIAT XML validation failure (SENIAT has field length limits in PA-121 schemas); SENIAT XML may reject submissions with excessively long names.
- **Remediation**: Add `.trim().max(200)` to `counterpartName` and `.trim().max(200)` to `providerName`. Assign to **ledger-agent** / **fiscal-agent**.
- **Test required**: Schema test that counterpartName/providerName over 200 chars fails validation. Assign to **test-agent**.
- **References**: Audit playbook §STEP 5, ADR-006

---

### Finding MEDIUM-3 — generateSIVITAction: No Rate Limit on SIVIT Export

- **File**: `src/modules/export/actions/sivit-export.actions.ts` lines 18–52
- **Vector**: RATE_LIMIT
- **Description**: `generateSIVITAction` processes up to 366 days of fiscal data and generates a ZIP archive returned as base64. No `checkRateLimit`. An ACCOUNTANT user can call this in a tight loop, triggering repeated full-table scans and in-memory ZIP generation.
- **Impact**: Server CPU spike and Neon pool exhaustion from repeated large scans.
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)`. Assign to **fiscal-agent**.
- **Test required**: Test rate limit rejection on second call within window. Assign to **test-agent**.
- **References**: CLAUDE.md §Rate Limiting

---

### Finding MEDIUM-4 — Sentry Tunnel: No Rate Limiting

- **File**: `src/app/monitoring/route.ts`
- **Vector**: RATE_LIMIT
- **Description**: Documented in HIGH-2. Separated here because the rate limit absence is a standalone medium issue even after the DSN pinning fix.
- **References**: See HIGH-2.

---

### Finding MEDIUM-5 — payment.schema.ts: Dead igtfAmount Client Field

- **File**: `src/modules/payments/schemas/payment.schema.ts` line 63
- **Vector**: INPUT_SANITIZATION_AUDITOR
- **Description**: `igtfAmount: z.string().optional()` exists in the schema but the action explicitly discards it and computes IGTF server-side. This dead field is misleading: a developer adding a new payment code path might use `d.igtfAmount` instead of `computedIgtf` by mistake, reintroducing the rate manipulation vulnerability.
- **Impact**: Not a current vulnerability, but a maintainability trap with HIGH risk if a future developer follows the schema instead of the action comment.
- **Remediation**: Remove `igtfAmount` from `CreatePaymentSchema`. Document in schema comment that IGTF is always computed server-side by `IGTFService`. Assign to **fiscal-agent**.
- **Test required**: Test that a payload with `igtfAmount` does not affect the persisted IGTF value. Assign to **test-agent**.
- **References**: CLAUDE.md Z-2

---

## LOW Findings

### Finding LOW-1 — downloadTemplateAction: No Authentication

- **File**: `src/modules/import/actions/import.actions.ts` lines 37–46
- **Vector**: AUTHORIZATION
- **Description**: `downloadTemplateAction()` generates and returns an Excel account import template. No `auth()` call. Since the template contains no company data (it's a static structure), there is no confidentiality risk. However, Server Actions without auth consume server resources for unauthenticated callers and appear as a publicly accessible endpoint.
- **Impact**: Minimal — template has no PII. Resource waste from anonymous callers.
- **Remediation**: Add `auth()` check. Return 401 if no session. Assign to **arch-agent**.
- **Test required**: Test unauthenticated call returns error. Assign to **test-agent**.
- **References**: ADR-006

---

### Finding LOW-2 — notes field in payment.schema.ts: No .max()

- **File**: `src/modules/payments/schemas/payment.schema.ts` line 65
- **Vector**: INPUT_SANITIZATION_AUDITOR
- **Description**: `notes: z.string().optional()` — no `.max()` constraint. Unlimited text can be stored in `PaymentRecord.notes`.
- **Impact**: Storage bloat; potential rendering issues in PDF reports.
- **Remediation**: Add `.max(500)` to `notes`. Assign to **fiscal-agent**.
- **Test required**: Schema test for notes > 500 chars. Assign to **test-agent**.
- **References**: Audit playbook §STEP 5

---

### Finding LOW-3 — payroll-reports.actions.ts: No Rate Limiting on PDF Report Generation

- **File**: `src/modules/payroll/actions/payroll-reports.actions.ts`
- **Vector**: RATE_LIMIT
- **Description**: PDF generation actions (IVSS, BANAVIR, INCES, ARC) have proper auth+role checks but no `checkRateLimit`. These generate PDF buffers server-side and are potentially expensive per call.
- **Impact**: CPU spike on rapid repeated calls from ACCOUNTANT users.
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)` to each action. Assign to **fiscal-agent**.
- **Test required**: Rate limit test. Assign to **test-agent**.
- **References**: CLAUDE.md §Rate Limiting

---

## INFO Findings

### Finding INFO-1 — Dependency Vulnerabilities (MODERATE only, no HIGH/CRITICAL)

- **Tool**: pnpm audit
- **Findings**: 3 MODERATE CVEs — all in devDependencies or transitive build deps:
  1. `@hono/node-server < 1.19.13` — path traversal in `serveStatic`. Via `@prisma/dev` (dev-only, not deployed).
  2. `postcss < 8.5.10` — XSS via unescaped `</style>`. Via `next > postcss` (build-time, not at runtime).
  3. `brace-expansion >= 5.0.0 < 5.0.6` — DoS via large numeric range. Via `@sentry/nextjs` toolchain.
- **Impact**: None of these affect runtime behavior of the deployed application. All paths are through build tooling.
- **Remediation**: Monitor for upstream fixes in `next` and `@sentry/nextjs`. No action required before launch.
- **References**: DECISIONS.md §Dependencias

---

### Finding INFO-2 — getTransactionsByPeriodAction: No companyMember Role Check

- **File**: `src/modules/accounting/actions/transaction.actions.ts` lines 188–226
- **Vector**: AUTHORIZATION
- **Description**: `getTransactionsByPeriodAction` verifies period belongs to company (`findFirst({ where: { id: periodId, companyId } })`) but does not check `companyMember.role`. Any authenticated member (including VIEWER) can read period transactions.
- **Impact**: VIEWER role can read all transactions in any period — intended per `ROLES.ALL` pattern elsewhere, but not explicitly documented as intentional for this action.
- **Remediation**: Either explicitly add `ROLES.ALL` check (to document intent) or add `ROLES.ACCOUNTING` if VIEWER should be excluded from transaction detail. Assign to **ledger-agent**.
- **Test required**: Test VIEWER can/cannot call this action. Assign to **test-agent**.
- **References**: ADR-006, auth-helpers.ts ROLES.ALL

---

## Summary

**3 CRITICAL / 6 HIGH / 5 MEDIUM / 3 LOW / 2 INFO**

| ID | Severity | Title | Agent |
|---|---|---|---|
| CRITICAL-1 | CRITICAL | getAccountsAction: No auth | ledger-agent |
| CRITICAL-2 | CRITICAL | getNextAccountCodeAction: No auth | ledger-agent |
| HIGH-1 | HIGH | getActivePeriodAction / getPeriodsAction: No auth | ledger-agent |
| HIGH-2 | HIGH | Sentry tunnel: arbitrary DSN relay + no rate limit | arch-agent |
| HIGH-3 | HIGH | saveGLConfigAction / postUnbookedInvoicesAction: No rate limit | ledger-agent |
| HIGH-4 | HIGH | saveGLConfigAction: No AuditLog | ledger-agent |
| HIGH-5 | HIGH | postUnbookedInvoicesAction: No AuditLog per invoice | ledger-agent |
| HIGH-6 | HIGH | importAccountsAction: No rate limit + no row cap | arch-agent |
| MEDIUM-1 | MEDIUM | CSP unsafe-inline in production script-src | arch-agent |
| MEDIUM-2 | MEDIUM | counterpartName / providerName: no .trim() .max() | ledger-agent / fiscal-agent |
| MEDIUM-3 | MEDIUM | generateSIVITAction: No rate limit | fiscal-agent |
| MEDIUM-4 | MEDIUM | Sentry tunnel rate limit (see HIGH-2) | arch-agent |
| MEDIUM-5 | MEDIUM | Dead igtfAmount field in payment schema | fiscal-agent |
| LOW-1 | LOW | downloadTemplateAction: No auth | arch-agent |
| LOW-2 | LOW | notes field: no .max() in payment schema | fiscal-agent |
| LOW-3 | LOW | payroll PDF actions: No rate limit | fiscal-agent |
| INFO-1 | INFO | 3 MODERATE npm CVEs (build-time only) | — |
| INFO-2 | INFO | getTransactionsByPeriodAction: No role check documented | ledger-agent |
