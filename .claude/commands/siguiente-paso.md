# siguiente-paso.md — Diagnóstico del estado actual

## Paso 1: Verificar integridad

Run in order and report EXIT codes:

```bash
echo "=== GIT STATUS ==="
git status --short

echo "=== TYPE CHECK ==="
npx tsc --noEmit
echo "TSC_EXIT: $?"

echo "=== TESTS ==="
npx vitest run
echo "VITEST_EXIT: $?"

echo "=== MIGRATIONS PENDING ==="
ls -la prisma/migrations/ | tail -10

echo "=== OPEN ADR ITEMS ==="
grep -rn "PENDING\|TODO\|BLOCKED" .claude/adr/ | grep -v "✅\|DECIDED"

echo "=== UNRESOLVED CONTRACT ITEMS ==="
grep -n "PENDIENTE" contaflow-contract.md | head -5
```

**Halt immediately if:**
- `TSC_EXIT: 1` → fix TS errors before proceeding
- `VITEST_EXIT: 1` → fix failing tests before proceeding
- Migraciones pendientes sin aplicar en Neon

---

## Paso 2: Categorizar estado

Report:

| Métrica | Estado |
|---|---|
| Tests | GREEN / FAILING [N] |
| TS Errors | 0 / [N] |
| Open findings | [N] CRITICAL / [N] HIGH / [N] MEDIUM |
| Unresolved contract items | [N] |
| Unfinished phase | [yes/no] — which one |

---

## Paso 3: Análisis

Based on the data above, determine:

**Priority 1 — Blocking issues (cannot start new phase)**
- Any TS error → fix immediately
- Any RED test → fix immediately
- CRITICAL security finding unresolved → fix immediately

**Priority 2 — Technical debt**
- Open ADR items in lessons-learned.md without regression test
- Migrations in Neon not yet applied
- UI without corresponding service implementation

**Priority 3 — Next phase**
- If no blocking issues: check roadmap (contaflow-context-v3.md)
- Propose concrete plan with agent assignments

---

## Paso 4: Spawn agents (if needed)

- **Blocking TS/test errors** → appropriate agent (ledger-agent, fiscal-agent, etc.)
- **Schema/RLS/ADR questions** → arch-agent
- **Security findings** → security-agent
- **Feature planning** → orchestrator-agent

**Wait for user confirmation before executing any agent.**