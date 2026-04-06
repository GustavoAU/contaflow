Read in order:
.claude/CLAUDE.md
.claude/lessons-learned.md
.claude/agents/orchestrator-agent.md
.claude/agents/arch-agent.md
.claude/agents/ledger-agent.md
.claude/agents/fiscal-agent.md
.claude/agents/test-agent.md
.claude/agents/ui-agent.md
.claude/agents/security-agent.md
.claude/adr/ADR-001-serializable-correlativos.md
.claude/adr/ADR-002-decimal-money.md
.claude/adr/ADR-003-ondelete-restrict.md
.claude/adr/ADR-004-multitenant-companyid.md
.claude/adr/ADR-005-inmutabilidad-void.md
.claude/adr/ADR-006-security-controls.md
.claude/adr/ADR-007.md
contaflow-context-v3.md
contaflow-contract.md

Then run: git status --short && npx vitest run --reporter=verbose 2>&1 | tail -5

Then analyze and report WITHOUT waiting to be asked:

## Current status

- Which phase is active?
- Which items are ✅ and which are ⏳?
- CI: green or broken? (check lint errors known in InvoiceForm.tsx + JournalEntryForm.tsx)

## Missing UI

- Are there services/actions implemented without a UI component?
- List each one with the responsible agent

## Critical technical debt

- Are there findings in lessons-learned.md pending a fix?
- Have the 3 CRITICALs from ADR-004 been corrected?
- Any incorrectly used useTransition to fix?

## Recommended next step

- What to do first and why?
- ARCH, IMPL, or UI only?
- Urgent debt to resolve before continuing?

## Production risks

- Anything without sufficient test coverage?
- Pending TODO(audit) items?
- Lessons-learned findings without regression test?

Propose the concrete plan and wait for confirmation before executing.
