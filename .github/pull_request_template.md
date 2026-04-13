## Descripcion

[Describe el cambio: que hiciste y por que]

## Tipo de cambio

- [ ] Bug fix (no-breaking)
- [ ] Feature nueva (no-breaking)
- [ ] Refactor (no-breaking)
- [ ] Documentacion
- [ ] Schema change / migracion Prisma (BREAKING — requiere revision extra)

---

## Checklist pre-merge (OBLIGATORIO)

### Tests & Type Safety

- [ ] `npm run lint` — sin errores
- [ ] `npx tsc --noEmit` — sin errores TypeScript
- [ ] `npx vitest run` — todos los tests GREEN
- [ ] Escribi tests para toda nueva logica
- [ ] Coverage >= thresholds de vitest.config.ts

### Auditorias ADR (CI ejecuta automatico — revisa localmente primero)

- [ ] ADR-001: Si hay numero correlativo — usa `$transaction({ isolationLevel: 'Serializable' })`
- [ ] ADR-002: Dinero — siempre `Decimal.js`, nunca `Number` o `float`
- [ ] ADR-003: Contabilidad — `onDelete: Restrict`, nunca `Cascade`
- [ ] ADR-004: Queries — `companyId` en todo `findMany`/`findFirst` de tablas de dominio
- [ ] ADR-005: Cambios en asientos — siempre VOID, nunca DELETE
- [ ] ADR-006:
  - [ ] Acciones destructivas — verifican `companyMember.role` con `canAccess()`
  - [ ] Campos de monto — tienen `.max(MAX_INVOICE_AMOUNT)` en Zod
  - [ ] Tasas fiscales — NUNCA vienen del cliente, siempre del sistema
  - [ ] AuditLog — append-only (no update/delete)
  - [ ] Acciones financieras — tienen `checkRateLimit(limiters.fiscal)`
  - [ ] Orden: `auth()` → `checkRateLimit` → `safeParse` → `canAccess()` → logica
- [ ] ADR-007: Si toque tabla con `companyId` — esta en RLS y use `withCompanyContext`

### Schema & Migraciones (si aplica)

- [ ] Modifique `prisma/schema.prisma` — cree migracion: `npx prisma migrate dev --name <desc>`
- [ ] Execute `npx prisma generate` y commite cambios en `prisma/client`
- [ ] Nuevas FK tienen `onDelete: Restrict`
- [ ] Nuevos campos monetarios son `Decimal @db.Decimal(19,4)`
- [ ] Entidades contables tienen `deletedAt DateTime?` (soft delete)

### Seguridad

- [ ] Sin `console.log` con datos sensibles (RIF, montos, tokens)
- [ ] Sin `dangerouslySetInnerHTML` (XSS risk)
- [ ] AuditLog creado en la misma `$transaction` que la mutacion
- [ ] Lookup de `itemId`/`invoiceId`: `findFirstOrThrow({ where: { id, companyId } })` — nunca solo `findUnique({ where: { id } })`

### UI/UX (si hay componentes)

- [ ] Datos numericos (montos) — minimo 14px + `font-variant-numeric: tabular-nums`
- [ ] Campos fiscales read-only — no editables (tasa IVA, numero de control, etc.)
- [ ] Acciones destructivas — AlertDialog antes de ejecutar
- [ ] Loading states — skeleton para listas, spinner para acciones
- [ ] Errores — validacion inline + mensaje claro en espanol

### Documentacion (si aplica)

- [ ] Actualice `contaflow-context-v3.md` con la fase completada
- [ ] Cree/actualice ADR si hay nueva decision arquitectonica
- [ ] Actualice CLAUDE.md si cambio el stack o convenciones

---

## Debug (rellenar si GitHub Actions falla)

**Job que fallo:**

**Error exacto de los logs:**
```
[pega aqui]
```

**Resultado local:**
```bash
# comando que ejecutaste
```

---

## Referencias

- Debugging: `.github/CI_DEBUG_GUIDE.md`
- Secrets setup: `.github/SECRETS_SETUP.md`
- Decisions: `.claude/adr/`
- Patterns: `.claude/lessons-learned.md`
