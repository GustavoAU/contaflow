# Security Findings — Bloque B Audit
**Date:** 2026-05-18  
**Auditor:** security-agent  
**Scope:** 20 action files across 14 modules  
**Prior passes:** Bloque A + hardening-fase1 (all CRITICAL/HIGH/MEDIUM/LOW from those passes already fixed)

---

## Finding HIGH-01 — Raw Role Comparison Blocks OWNER in `disposeFixedAssetAction`

- **File**: `src/modules/fixed-assets/actions/fixed-asset.actions.ts` line 136
- **Vector**: AUTHORIZATION
- **Description**: `disposeFixedAssetAction` checks `member.role !== "ADMIN"` using a raw string comparison instead of `canAccess(member.role, ROLES.ADMIN_ONLY)`. Because `ROLES.ADMIN_ONLY = ["OWNER", "ADMIN"]`, a user with role `OWNER` will be rejected — the inverse of the intended access policy. Every other destructive action in the codebase uses `canAccess`; this is the only survivor of the pattern that was fixed in Bloque A.
- **Impact**: Company OWNER is locked out of disposing their own fixed assets. A determined attacker who obtains ADMIN credentials can dispose assets; an OWNER cannot. The inconsistency also silently breaks any future role renaming.
- **Remediation** (assign to ledger-agent, `fixed-asset.actions.ts` line 136):
  ```typescript
  // Before
  if (member.role !== "ADMIN") return { success: false, error: "Solo administradores pueden dar de baja activos" };
  // After
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "Solo administradores pueden dar de baja activos" };
  ```
- **Test required**: test-agent — add a test where `role = "OWNER"` calls `disposeFixedAssetAction` and asserts `success: true`. Add a test where `role = "ACCOUNTANT"` asserts rejection.

---

## Finding HIGH-02 — Raw Role Comparison Blocks OWNER in `updatePaymentTermsAction`

- **File**: `src/modules/receivables/actions/receivable.actions.ts` line 261
- **Vector**: AUTHORIZATION
- **Description**: `updatePaymentTermsAction` checks `member.role !== "ADMIN"` instead of `canAccess(member.role, ROLES.ADMIN_ONLY)`. The intent (comment at line 239: "Solo ADMIN puede cambiar la configuración de plazos") is also inconsistent with the OWNER role, who is implicitly a superset of ADMIN. Using a raw string comparison means that if the role value ever changes casing or a new admin-equivalent role is added, this check silently fails open or closed.
- **Impact**: OWNER cannot update payment terms for their own company. An ACCOUNTANT or ADMINISTRATIVE user correctly gets rejected. Functionally broken for the OWNER user.
- **Remediation** (assign to ledger-agent, `receivable.actions.ts` line 261):
  ```typescript
  // Before
  if (member.role !== "ADMIN") return { ... };
  // After
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { ... };
  ```
- **Test required**: test-agent — OWNER calling `updatePaymentTermsAction` must return `success: true`.

---

## Finding HIGH-03 — Missing Rate Limit on `disposeFixedAssetAction`

- **File**: `src/modules/fixed-assets/actions/fixed-asset.actions.ts` lines 123–148
- **Vector**: RATE_LIMIT
- **Description**: `disposeFixedAssetAction` performs a destructive fiscal write (asset disposal with journal entries via `FixedAssetService.dispose`) inside a `$transaction` but does not call `checkRateLimit`. Every other write action in this file (`createFixedAssetAction`, `postMonthlyDepreciationAction`, `catchUpAssetDepreciationAction`, `catchUpAllAssetsDepreciationAction`) has a rate limit. The disposal action was missed.
- **Impact**: A compromised ADMIN account can issue rapid disposal calls across all company assets, generating a flood of irreversible journal entries without any rate-based circuit breaker. Each disposal call also hits the DB under `Serializable` isolation, amplifying pressure.
- **Remediation** (assign to ledger-agent, add after the auth/member check, before the transaction):
  ```typescript
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };
  ```
- **Test required**: test-agent — mock `checkRateLimit` to return `{ allowed: false }` and assert the action returns the rate-limit error without calling the service.

---

## Finding HIGH-04 — Missing Rate Limit on `cancelPaymentAction`

- **File**: `src/modules/receivables/actions/receivable.actions.ts` lines 183–213
- **Vector**: RATE_LIMIT
- **Description**: `cancelPaymentAction` is a destructive fiscal operation (voids a recorded payment, reverses CxC/CxP balances) gated to `ROLES.ADMIN_ONLY` but has no call to `checkRateLimit`. The sibling action `recordPaymentAction` in the same file does call `checkRateLimit(userId, limiters.fiscal)` at line 141.
- **Impact**: An ADMIN can submit rapid cancellation requests. Because `ReceivableService.cancelPayment` writes to the DB, this creates an abuse vector to flood the payment journal with void events.
- **Remediation** (assign to ledger-agent, add after the member role check at line 200):
  ```typescript
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };
  ```
- **Test required**: test-agent — mock `checkRateLimit` returning not-allowed, assert `cancelPaymentAction` rejects without touching `ReceivableService`.

---

## Finding HIGH-05 — Missing Rate Limit on `updatePaymentTermsAction`

- **File**: `src/modules/receivables/actions/receivable.actions.ts` lines 240–290
- **Vector**: RATE_LIMIT
- **Description**: `updatePaymentTermsAction` mutates `Company.paymentTermDays` and writes an `AuditLog` entry directly via `prisma.auditLog.create` outside a transaction. The action has no rate limit.
- **Impact**: ADMIN can spam this endpoint, generating a high volume of DB writes to the Company table and AuditLog. More critically, because the AuditLog write is outside the `prisma.company.update` transaction (see Finding MEDIUM-04 below), a flood of calls increases the window for partial writes.
- **Remediation** (assign to ledger-agent, add after the member role check at line 261):
  ```typescript
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };
  ```
- **Test required**: test-agent — assert action rejects when `checkRateLimit` returns not-allowed.

---

## Finding HIGH-06 — Missing Rate Limit on `exportPayrollBankTxtAction`

- **File**: `src/modules/payroll/actions/payroll-run.actions.ts` lines 197–213
- **Vector**: RATE_LIMIT
- **Description**: `exportPayrollBankTxtAction` generates a bank payment file (TXT) that contains employee salary data and bank account numbers. The action has auth and role checks but no `checkRateLimit`. All three sibling write actions (`createPayrollRunAction`, `approvePayrollRunAction`, `cancelPayrollRunAction`) call `checkRateLimit(userId, limiters.fiscal)`. The export action is a read but triggers `PayrollBankTxtService.generate`, which performs DB aggregations over PayrollRunLine records — this is an expensive aggregation action (comparable to `listPaymentsAction` which is rate-limited).
- **Impact**: A compromised ACCOUNTING account can issue rapid export requests, creating a DoS on the DB aggregation layer and extracting the full employee bank account dataset repeatedly.
- **Remediation** (assign to ledger-agent, add after the member role check, using `limiters.export` for file generation):
  ```typescript
  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: "Límite de exportación alcanzado. Intente en unos minutos." };
  ```
- **Test required**: test-agent — mock `checkRateLimit` returning not-allowed and assert rejection without calling `PayrollBankTxtService`.

---

## Finding MEDIUM-01 — Missing Tenant Isolation Check on `listExchangeRatesAction`

- **File**: `src/modules/exchange-rates/actions/exchange-rate.actions.ts` lines 81–94
- **Vector**: AUTHORIZATION
- **Description**: `listExchangeRatesAction` calls `auth()` and checks `userId` but does NOT verify `companyMember` membership before calling `ExchangeRateService.list(companyId, currency)`. Any authenticated Clerk user who knows a `companyId` can retrieve that company's full exchange rate history without being a member.
- **Impact**: Cross-tenant read — an attacker who obtains any valid `companyId` (e.g., from a URL they previously visited or from a leaked slug) can enumerate all historical BCV rates for that company, revealing operational patterns (e.g., when the company registered rates, what currencies it tracks).
- **Remediation** (assign to arch-agent, add before the service call):
  ```typescript
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };
  ```
- **Test required**: test-agent — assert that an authenticated user not in `companyMember` for the given `companyId` gets an error response.
- **References**: ADR-004 (multi-tenant companyId guard)

---

## Finding MEDIUM-02 — Missing Tenant Isolation Check on `getLatestRatesWithDeltaAction`

- **File**: `src/modules/exchange-rates/actions/exchange-rate.actions.ts` lines 224–255
- **Vector**: AUTHORIZATION
- **Description**: `getLatestRatesWithDeltaAction` calls `auth()` and checks `userId` but does NOT verify `companyMember` membership before executing two `prisma.exchangeRate.findMany` queries scoped only by `companyId`. Same structural gap as `listExchangeRatesAction`.
- **Impact**: Same cross-tenant read as MEDIUM-01. Both actions are likely called together on the dashboard; fixing one without the other leaves the gap exploitable.
- **Remediation** (assign to arch-agent, add before the inner `rateWithDelta` calls):
  ```typescript
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  ```
- **Test required**: test-agent — non-member authenticated user gets error from `getLatestRatesWithDeltaAction`.
- **References**: ADR-004

---

## Finding MEDIUM-03 — Missing Tenant Isolation Check on `getLatestRateAction`

- **File**: `src/modules/exchange-rates/actions/exchange-rate.actions.ts` lines 258–278
- **Vector**: AUTHORIZATION
- **Description**: `getLatestRateAction` calls `auth()` and checks `userId`, runs `GetRateSchema.safeParse`, but does NOT verify `companyMember` membership before calling `ExchangeRateService.getLatestRate(companyId, currency)`. Third consecutive un-guarded read in this file.
- **Impact**: Cross-tenant read — same class of issue as MEDIUM-01 and MEDIUM-02. All three read actions in `exchange-rate.actions.ts` are missing the companyMember guard while the two write actions (`upsertExchangeRateAction`, `fetchBcvRateAction`, `fetchBcvEurRateAction`) correctly have it.
- **Remediation** (assign to arch-agent): add `companyMember.findFirst` check before `ExchangeRateService.getLatestRate`. Consider extracting a shared `guardReader(companyId, userId)` helper for all read paths in this file, consistent with how the write paths share a pattern.
- **Test required**: test-agent — non-member authenticated user gets error from `getLatestRateAction`.
- **References**: ADR-004

---

## Finding MEDIUM-04 — AuditLog Written Outside Transaction in `updatePaymentTermsAction`

- **File**: `src/modules/receivables/actions/receivable.actions.ts` lines 265–283
- **Vector**: AUDIT_TRAIL
- **Description**: `updatePaymentTermsAction` calls `prisma.company.update` (line 265) and then `prisma.auditLog.create` (line 271) as two separate, sequential database operations — not wrapped in a `$transaction`. If the process crashes or the DB connection drops between the two calls, the company setting is updated but no audit record exists, violating R-6 and the AUDIT_TRAIL_INTEGRITY_GUARD invariant.
- **Impact**: Silent audit gap. A company's payment terms can be changed without a trace in the audit log, breaking the immutable audit trail required by PA 121.
- **Remediation** (assign to ledger-agent): wrap both operations in `prisma.$transaction`:
  ```typescript
  const company = await prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({
      where: { id: parsed.data.companyId },
      data: { paymentTermDays: parsed.data.paymentTermDays },
      select: { paymentTermDays: true },
    });
    await tx.auditLog.create({
      data: {
        companyId: parsed.data.companyId,
        entityId: parsed.data.companyId,
        entityName: "Company",
        action: "UPDATE",
        userId,
        ipAddress,
        userAgent,
        newValue: { paymentTermDays: parsed.data.paymentTermDays },
      },
    });
    return updated;
  });
  ```
- **Test required**: test-agent — mock `prisma.auditLog.create` to throw and assert the company update is rolled back (both succeed or both fail).
- **References**: R-6, AUDIT_TRAIL_INTEGRITY_GUARD

---

## Finding MEDIUM-05 — Missing Role Check on Expense Write Actions (`createExpenseAction`, `confirmExpenseAction`, `voidExpenseAction`)

- **File**: `src/modules/expenses/actions/expense.actions.ts` lines 50–128
- **Vector**: AUTHORIZATION
- **Description**: The `assertMember` helper (line 40) only verifies that the user is a member of the company (`companyMember.findFirst`) but does not check `member.role`. All three write actions (`createExpenseAction`, `confirmExpenseAction`, `voidExpenseAction`) use this helper, meaning a VIEWER role can create, confirm, and void expenses. The schema guard for the `ivaAmount` field accepts a client-supplied amount (see expense.schema.ts line 62) — because IVA is a fiscal amount, this is additionally noted as a companion concern.
- **Impact**: A VIEWER (read-only role) can create and void expense records including associated journal entries. This violates the ROLES.WRITERS minimum for any financial write, as documented in the authorization model (ADR-025). `voidExpenseAction` in particular generates a reversal journal entry, which should be restricted to at minimum ACCOUNTANT.
- **Remediation** (assign to ledger-agent):
  1. In `assertMember`, add role validation and return the role so callers can enforce it:
     ```typescript
     async function assertMember(companyId: string, userId: string, allowed = ROLES.WRITERS) {
       const member = await prisma.companyMember.findFirst({
         where: { companyId, userId },
         select: { role: true },
       });
       if (!member) throw new Error("No perteneces a esta empresa");
       if (!canAccess(member.role, allowed)) throw new Error("No autorizado");
       return member;
     }
     ```
  2. Call `assertMember(companyId, ctx.userId, ROLES.WRITERS)` in `createExpenseAction` and `confirmExpenseAction`.
  3. Call `assertMember(companyId, ctx.userId, ROLES.ACCOUNTING)` in `voidExpenseAction` (anulación should be ACCOUNTANT+).
- **Test required**: test-agent — VIEWER calling `createExpenseAction` must return `{ success: false, error: "No autorizado" }`. Same for `voidExpenseAction`.
- **References**: ADR-025 (granular permissions)

---

## Finding MEDIUM-06 — Missing Rate Limit on `listExpensesAction`

- **File**: `src/modules/expenses/actions/expense.actions.ts` lines 131–151
- **Vector**: RATE_LIMIT
- **Description**: `listExpensesAction` reads paginated expense records with cursor-based pagination (`ListExpensesSchema` includes `cursor` and `limit`). It has no rate limit, while the write actions in the same file (`createExpenseAction`, `confirmExpenseAction`, `voidExpenseAction`, `createExpenseCategoryAction`) all call `checkRateLimit(ctx.userId, limiters.fiscal)`. A DB-aggregating read with pagination is exploitable as a DoS vector.
- **Impact**: Any authenticated member can hammer this endpoint to drive repeated DB pagination queries. At `limit: 50` per page and multiple concurrent requestors, this can saturate the Neon connection pool.
- **Remediation** (assign to ledger-agent, add in `listExpensesAction` after `getAuthContext()`):
  ```typescript
  const rl = await checkRateLimit(ctx.userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };
  ```
- **Test required**: test-agent — assert rate-limit rejection on `listExpensesAction`.

---

## Finding MEDIUM-07 — Missing Rate Limit on `listExpenseCategoriesAction`

- **File**: `src/modules/expenses/actions/expense.actions.ts` lines 181–195
- **Vector**: RATE_LIMIT
- **Description**: `listExpenseCategoriesAction` is an uncovered read action with no rate limiting. Although lighter than `listExpensesAction`, it runs `listExpenseCategories(companyId)` which is an unbounded `findMany` over categories.
- **Impact**: Low-impact DoS vector — an authenticated member can call this in a tight loop.
- **Remediation** (assign to ledger-agent): add `checkRateLimit(ctx.userId, limiters.fiscal)` after `getAuthContext()`.
- **Test required**: test-agent — assert rate-limit rejection.

---

## Finding MEDIUM-08 — `createExpenseAction` Accepts Client-Supplied `ivaAmount`

- **File**: `src/modules/expenses/schemas/expense.schema.ts` lines 59–72; `src/modules/expenses/actions/expense.actions.ts` line 68
- **Vector**: AMOUNT_VALIDATION / BUSINESS_LOGIC_ABUSE
- **Description**: `CreateExpenseSchema` includes `ivaAmount` as an optional, client-submitted string field. The action passes this value directly to `createExpense(parsed.data, ...)` without recomputing IVA server-side from `amount` and a configured rate. A user can submit `hasIva: true, ivaAmount: "99999999"` on a `amount: "1"` expense to inflate the deductible IVA base recorded in the journal entry.
- **Impact**: An ADMINISTRATIVE user (who can now reach this action — see MEDIUM-05) could create expenses with inflated IVA amounts, manipulating the deductible tax base in the Libro Mayor. Impact grows if the IVA amount flows into a tax declaration report.
- **Remediation** (assign to fiscal-agent): compute `ivaAmount` server-side when `hasIva = true`:
  ```typescript
  const computedIva = parsed.data.hasIva
    ? new Decimal(parsed.data.amount).times(new Decimal("0.16")).toFixed(2)
    : undefined;
  // pass computedIva instead of parsed.data.ivaAmount
  ```
  Remove `ivaAmount` from the client-facing schema or keep it only as a display hint that is discarded on the server.
- **Test required**: test-agent — submit `ivaAmount: "99999"` on a `amount: "100"` expense and assert the persisted IVA is `16.00`, not `99999`.
- **References**: Z-2 (Zona de Peligro — Cálculo de impuestos), R-5

---

## Finding MEDIUM-09 — `previewDepreciationScheduleAction` Has No Tenant Isolation and No Member Check

- **File**: `src/modules/fixed-assets/actions/fixed-asset.actions.ts` lines 384–409
- **Vector**: AUTHORIZATION
- **Description**: `previewDepreciationScheduleAction` calls `auth()` and checks `userId` (line 392) but performs no `companyMember` lookup. The action is described as "sin BD — para vista previa" (no DB writes), so the risk is lower than a write action, but it accepts unbounded numeric inputs (`acquisitionCost`, `residualValue`, `usefulLifeMonths`, `totalUnits`) that feed `generateDepreciationSchedule` — a CPU-bound computation. There is no Zod schema validation of the input and no rate limit.
- **Impact**: Any authenticated Clerk user (even from a different tenant) can call this action with extreme values (e.g., `usefulLifeMonths: 1200`) to generate large schedules, consuming server CPU. With no rate limit, this is a compute-DoS vector.
- **Remediation** (assign to ledger-agent):
  1. Add a Zod schema validating input bounds (e.g., `usefulLifeMonths: z.number().int().min(1).max(600)`).
  2. Add `checkRateLimit(userId, limiters.fiscal)`.
  3. The function is a pure computation, so a `companyMember` check is not strictly required for isolation (no data is read), but rate limiting is mandatory.
- **Test required**: test-agent — assert rate-limit rejection and that out-of-bound `usefulLifeMonths` returns a validation error.

---

## Finding LOW-01 — `getFixedAssetsAction` Does Not Check Role

- **File**: `src/modules/fixed-assets/actions/fixed-asset.actions.ts` lines 153–170
- **Vector**: AUTHORIZATION
- **Description**: `getFixedAssetsAction` verifies `companyMember` existence (line 161) but does not check `member.role` — a VIEWER can list all fixed assets. There is an implicit assumption that membership alone is sufficient for reads. While VIEWER access to a fixed asset summary is not a data leak in most configurations, it is inconsistent with the minimum-access design in ADR-025.
- **Impact**: VIEWER sees the full fixed asset summary (names, costs, depreciation schedules). For a company with sensitive asset data this may be an overshare.
- **Remediation** (assign to ledger-agent): add `if (!canAccess(member.role, ROLES.ALL)) return { ... }` or at minimum document the intentional VIEWER access with an inline `// ADR-025: VIEWER read intentional` comment.
- **Test required**: test-agent — assert VIEWER can call `getFixedAssetsAction` and document this as accepted behavior, or assert rejection if the decision is to restrict it.

---

## Finding LOW-02 — `getDepreciationScheduleAction` Does Not Check Role

- **File**: `src/modules/fixed-assets/actions/fixed-asset.actions.ts` lines 180–216
- **Vector**: AUTHORIZATION
- **Description**: Same pattern as LOW-01. `getDepreciationScheduleAction` verifies membership but not role. A VIEWER can retrieve the full depreciation schedule (with cost, residual value, monthly amounts) for any asset of their company.
- **Impact**: Same as LOW-01 — data visibility beyond the intended minimum. The schedule includes historical amounts that reveal the acquisition cost of each asset.
- **Remediation**: same as LOW-01.
- **Test required**: same as LOW-01.

---

## Finding LOW-03 — `getReceivablesAction` and Related Aging Actions Do Not Check Role

- **File**: `src/modules/receivables/actions/receivable.actions.ts` lines 23–126
- **Vector**: AUTHORIZATION
- **Description**: `getReceivablesAction`, `getPayablesAction`, `getReceivablesPaginatedAction`, `getPayablesPaginatedAction`, and `getPaymentsByInvoiceAction` all verify companyMember existence but do not check `member.role`. A VIEWER can access the full A/R and A/P aging reports, including outstanding invoice amounts and counterpart names.
- **Impact**: VIEWER reads the full cash position of the company (who owes what, how overdue). This is appropriate for many deployments but should be documented as an intentional decision.
- **Remediation** (assign to ledger-agent): add `canAccess(member.role, ROLES.ALL)` checks (all roles permitted) with an inline comment `// ADR-025: aging visible to all roles`, or restrict to `ROLES.ACCOUNTING` if the business decision is to hide it from VIEWER/ADMINISTRATIVE.
- **Test required**: test-agent — document the intended access level and add a test asserting it.

---

## Finding LOW-04 — `getPaymentsByInvoiceAction` Missing Rate Limit

- **File**: `src/modules/receivables/actions/receivable.actions.ts` lines 216–236
- **Vector**: RATE_LIMIT
- **Description**: `getPaymentsByInvoiceAction` reads all payments for a given invoice. No rate limit. It is a targeted read (scoped to one invoice) so the DB cost per call is low, but there is no protection against tight-loop calls.
- **Impact**: Low DoS potential. An authenticated member can poll this endpoint aggressively.
- **Remediation**: add `checkRateLimit(userId, limiters.fiscal)` after auth.
- **Test required**: test-agent — assert rate-limit rejection.

---

## STEP 1 — CLEAR
All `findMany`/`findFirst`/`aggregate` queries in the audited files include `companyId` in the `where` clause. The three exchange-rate read actions flagged in MEDIUM-01/02/03 are missing a *companyMember* membership guard, not a missing `companyId` in the data query itself — the data query is correctly scoped. The two are distinct issues.

## STEP 6 — CLEAR
No `auditLog.update`, `auditLog.delete`, or `auditLog.deleteMany` found in any of the 20 audited files.

## STEP 7 — CLEAR (within audited scope)
No `console.log` / `console.error` / `console.warn` calls containing RIF, password, token, key, amount, rate, or Clerk identifiers found in the audited files.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 6 | HIGH-01 through HIGH-06 |
| MEDIUM | 9 | MEDIUM-01 through MEDIUM-09 |
| LOW | 4 | LOW-01 through LOW-04 |
| INFO | 0 | — |

**Total findings: 19**

### Assignment by Agent

| Agent | Findings |
|---|---|
| ledger-agent | HIGH-01, HIGH-02, HIGH-03, HIGH-04, HIGH-05, MEDIUM-04, MEDIUM-05, MEDIUM-06, MEDIUM-07, MEDIUM-09, LOW-01, LOW-02, LOW-03, LOW-04 |
| arch-agent | MEDIUM-01, MEDIUM-02, MEDIUM-03 (exchange-rate read isolation — consider shared guard helper) |
| fiscal-agent | MEDIUM-08 (server-side IVA computation) |
| test-agent | All 19 findings require regression tests as specified |

### Escalation to contaflow-contract.md
Per rules: every CRITICAL/HIGH finding requires an item in contaflow-contract.md. HIGH-01 through HIGH-06 should be opened as items and assigned to ledger-agent. Escalate to arch-agent for MEDIUM-01/02/03 as they represent a structural gap (three read actions in the same file all missing the same guard — a guard helper should be extracted per the DRY principle).
