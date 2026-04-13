# ContaFlow CI/CD — Debugging Rapido

Cuando un PR falla en CI, sigue este arbol de decision:

---

## Step 1: Que job fallo?

### Job: `test` (Lint + TypeScript + Tests + Coverage)

**ESLint failed**
- Ejecuta: `npx eslint src/ --fix`
- Commit los cambios y push

**Prettier check failed**
- Ejecuta: `npx prettier --write "src/**/*.{ts,tsx,json}"`
- Commit y push

**TypeScript type check failed**
- Lee el error en GitHub Actions logs
- Comun: tipos no alineados entre schema.prisma y cliente Prisma
- Solucion: `npx prisma generate` → `npx tsc --noEmit` (verifica localmente) → commit y push

**Tests failed (vitest)**
- Ejecuta localmente: `npx vitest run [test-file]`
- Si pasa local pero falla en CI: problema de env vars o mock setup
  - Verifica que DATABASE_URL este en ci.yml
  - Revisa que los secrets de Clerk/Groq esten creados en GitHub

**Coverage insuficiente**
- Ejecuta: `npm run coverage`
- Busca lineas sin cubrir en el output
- Escribe tests para esos paths

---

### Job: `architecture` (ADR audits)

**ADR-001: schema.prisma modificado sin migraciones**
```bash
npx prisma migrate dev --name <descripcion>
# commit prisma/migrations/ y push
```

**ADR-004: findMany/findFirst sin companyId**
```typescript
// ANTES (falla)
findMany({ where: { status: 'POSTED' } })

// DESPUES (correcto)
findMany({ where: { companyId, status: 'POSTED' } })

// Si es excepcion documentada:
findMany({ where: { ... } }) // ADR-004-EXCEPTION: <razon>
```

**ADR-006 D-4: auditLog.update o auditLog.delete encontrado**
- AuditLog NUNCA se actualiza ni borra
- Reemplaza `.update(...)` o `.delete(...)` con `.create(...)` (append-only)

**ADR-006 D-5: accion financiera sin rate limiting**
```typescript
// Agrega despues de auth() y antes de safeParse():
const rl = await checkRateLimit(userId, limiters.fiscal);
if (!rl.allowed) return { success: false, error: rl.error ?? 'Demasiadas solicitudes' };
```

**Prisma format failed**
```bash
npx prisma format
# commit y push
```

---

### Job: `security` (npm audit)

**npm audit found CRITICAL vulnerability**
- Ejecuta: `npm audit --fix`
- Si sigue fallando: el package no tiene fix disponible
  - Reporta como "conocida sin fix, bajo riesgo en contenedor CI"
  - O reemplaza por alternativa

---

## Step 2: Debugging local antes del push

```bash
# Simula el CI completo localmente:
npm run lint
npx prettier --check "src/**/*.{ts,tsx,json}"
npx tsc --noEmit
npx vitest run
npm run coverage

# ADR checks manuales:
grep -rn "findMany\|findFirst" src/modules --include="*.ts" | grep -v "companyId" | grep -v "test" | head -10
grep -rn "auditLog.update\|auditLog.delete" src/ --include="*.ts" | grep -v "test"
npm audit --audit-level=critical
```

---

## Step 3: Errores comunes y soluciones

| Mensaje en CI | Causa | Fix |
|---|---|---|
| `Cannot find module 'prisma'` | prisma.generate no corrio | `npx prisma generate` |
| `CLERK_SECRET_KEY is not set` | Secret no creado en GitHub | Crea en Settings → Secrets |
| `GROQ_API_KEY is not set` | Secret no creado | Idem |
| `coverage-summary.json no existe` | Coverage no se genero | `npx vitest run --coverage` |
| `findMany without companyId` | ADR-004 violation | Agrega `companyId` a where clause |
| `auditLog.update found` | ADR-006 D-4 violation | Reemplaza con `auditLog.create` |
| `P2014: Relation not found` | Schema desincronizado | `npx prisma generate` |

---

## Step 4: Re-run en GitHub sin nuevo commit

```bash
# Fuerza recheck:
git commit --amend --no-edit
git push origin <branch> --force-with-lease
```

O desde GitHub UI: Actions → workflow fallido → "Re-run failed jobs"

---

## Step 5: Tests locales sin secrets reales

Crea `.env.test.local` (gitignored):
```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dummy_not_real
CLERK_SECRET_KEY=sk_test_dummy_not_real
GROQ_API_KEY=gsk_dummy_not_real
```

Los secrets reales se inyectan automaticamente en GitHub Actions.

---

## Quien arregla que

| Problema | Responsable |
|---|---|
| Lint/format/TS errors | Developer que escribio el codigo |
| Test failures — logica | Developer |
| ADR-004 violation | ledger-agent o fiscal-agent (segun modulo) |
| ADR-006 violation | security-agent |
| npm audit critical | Dev + security-agent |
| Migraciones missing | arch-agent |
| No sabes quien | orchestrator-agent |
