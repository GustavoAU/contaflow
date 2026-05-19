# Security Findings — Bloque C Audit
**Date:** 2026-05-18
**Auditor:** security-agent
**Scope:** 39 action files across 20 modules (all previously unaudited)
**Prior passes:** hardening-fase1, Bloque A, Bloque B

---

## HIGH Findings

### HIGH-001 — Raw `role !== "ADMIN"` blocks OWNER in `setInflationBaseAction` and `runInflationAdjustmentAction`
- **File**: `src/modules/inflation/actions/inpc.actions.ts` lines 156, 233
- **Vector**: AUTHORIZATION
- **Description**: Both actions use `member.role !== "ADMIN"` instead of `canAccess(member.role, ROLES.ADMIN_ONLY)`, blocking OWNER from inflation operations.
- **Remediation**: Replace with `!canAccess(member.role, ROLES.ADMIN_ONLY)` in both actions.

### HIGH-002 — Raw `role !== "OWNER"` in `createCheckoutAction` (intentional but raw)
- **File**: `src/modules/billing/actions/billing.actions.ts` line 37
- **Vector**: AUTHORIZATION
- **Description**: Uses raw string comparison `member.role !== "OWNER"` — intentionally OWNER-only but pattern is inconsistent and fragile.
- **Remediation**: Add `// ADR-025: intencionalmente solo OWNER puede gestionar la suscripción` comment documenting the intentional single-role restriction.

### HIGH-003 — `getIGTFAction` has no `auth()` or `companyMember` guard
- **File**: `src/modules/igtf/actions/igtf.actions.ts`
- **Vector**: AUTHORIZATION
- **Description**: Any caller with a valid `companyId` can read all IGTF fiscal transactions without a Clerk session.
- **Remediation**: Add `auth()` + `companyMember` + `ROLES.ACCOUNTING` guard before the DB query.

### HIGH-004 — Missing rate limit on `setInflationBaseAction` and `previewInflationAdjustmentAction`
- **File**: `src/modules/inflation/actions/inpc.actions.ts`
- **Vector**: RATE_LIMIT
- **Description**: Both actions execute expensive DB operations with no `checkRateLimit`.
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)` to both.

### HIGH-005 — `saveAccountantConfigAction` missing rate limit
- **File**: `src/modules/settings/actions/accountant-config.actions.ts`
- **Vector**: RATE_LIMIT
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)`.

### HIGH-006 — `getKpiDashboardAction` missing rate limit on expensive aggregation
- **File**: `src/modules/analytics/actions/kpi-dashboard.actions.ts`
- **Vector**: RATE_LIMIT
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)`.

### HIGH-007 — `listAuditLogsAction` and `getAuditEntityNamesAction` missing rate limit
- **File**: `src/modules/audit/actions/audit.actions.ts`
- **Vector**: RATE_LIMIT
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)` to both.

---

## MEDIUM Findings

### MEDIUM-001 — `getINPCRatesAction` no role check
- **File**: `src/modules/inflation/actions/inpc.actions.ts`
- **Vector**: AUTHORIZATION
- **Remediation**: Add `canAccess(member.role, ROLES.ACCOUNTING)` check.

### MEDIUM-002 — `previewInflationAdjustmentAction` no role check
- **File**: `src/modules/inflation/actions/inpc.actions.ts`
- **Vector**: AUTHORIZATION
- **Remediation**: Add `canAccess(member.role, ROLES.ACCOUNTING)` check.

### MEDIUM-003 — 4 banking read actions check membership but not role
- **File**: `src/modules/bank-reconciliation/actions/banking.actions.ts`
- **Vector**: AUTHORIZATION
- **Description**: `getReconciliationSummaryAction`, `getUnreconciledTransactionsAction`, `searchJournalEntriesAction`, `searchPaymentRecordsAction` — VIEWER can read bank payment details.
- **Remediation**: Add `canAccess(role, ROLES.ACCOUNTING)` to each.

### MEDIUM-004 — `exportForma30PDFAction` uses `limiters.fiscal` instead of `limiters.export`
- **File**: `src/modules/iva-declaration/actions/exportForma30PDF.action.ts`
- **Vector**: RATE_LIMIT
- **Remediation**: Replace `limiters.fiscal` with `limiters.export`.

### MEDIUM-005 — `getNotificationsAction` missing rate limit
- **File**: `src/modules/notifications/actions/notifications.actions.ts`
- **Vector**: RATE_LIMIT
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)`.

### MEDIUM-006 — `console.error` with raw error object in `export.actions.ts`
- **File**: `src/modules/export/actions/export.actions.ts`
- **Vector**: SECRETS
- **Remediation**: Replace raw `console.error(..., error)` with `error.message` only.

---

## LOW Findings

### LOW-001 — Double `auth()` in `legal-threshold.actions.ts`
- **File**: `src/modules/payroll/actions/legal-threshold.actions.ts`
- **Vector**: CODE_QUALITY
- **Remediation**: Refactor to call `auth()` once; pass userId to guardAdmin.

### LOW-002 — 5 order/quotation create/clone actions missing rate limit
- **File**: `src/modules/orders/actions/quotation.actions.ts`, `src/modules/orders/actions/order.actions.ts`
- **Vector**: RATE_LIMIT
- **Remediation**: Add `checkRateLimit(userId, limiters.fiscal)` to create/submit/clone actions.

---

## Summary

| Severity | Count |
|---|---|
| HIGH | 7 |
| MEDIUM | 6 |
| LOW | 2 |
| INFO | 1 |
| **Total** | **16** |
