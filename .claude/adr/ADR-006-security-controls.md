# ADR-006 — Controles de Seguridad: Autorización por Rol, Validación de Montos y Protección de AuditLog

- **Status**: DECIDED ✅
- **Date**: 2026-04-03
- **Author**: arch-agent + security-agent
- **Applies to**: todos los módulos — especialmente actions/, services/, y AuditLog

---

## Contexto

La auditoría de seguridad de Fase 13C-B1 detectó 3 hallazgos CRITICAL de aislamiento
multi-tenant (documentados en ADR-004 y LL-002/LL-003). Al avanzar hacia producción con
clientes reales, se requieren controles adicionales que ADR-001 al ADR-005 no cubren:

1. **Autorización por rol**: `companyMember` se verifica por existencia pero no por `role`
   en acciones destructivas (VOID, cierre de período, cierre de ejercicio fiscal).
2. **Validación de montos**: los schemas Zod no definen techo máximo en campos de monto,
   permitiendo entradas como `999999999999` sin rechazo.
3. **Tasas fiscales desde el cliente**: ningún ADR prohíbe explícitamente que un schema Zod
   acepte `ivaRate` o `taxRate` como campo editable desde el request body.
4. **Integridad del AuditLog**: no existe una regla documentada que prohíba
   `auditLog.update()` o `auditLog.delete()` en el código de producción.
5. **Cobertura de rate limiting**: solo 5 actions tienen rate limiting; acciones financieras
   nuevas deben incluirlo explícitamente.

---

## Decisiones

### D-1 — Autorización por rol en acciones destructivas

**Regla**: toda Server Action que ejecute una operación irreversible o de cierre DEBE
verificar `companyMember.role` además de la existencia de `companyMember`.

```typescript
// Operaciones que requieren role >= ACCOUNTANT:
// createInvoiceAction, createRetentionAction, createIGTFAction,
// createTransactionAction, recordPaymentAction

// Operaciones que requieren role === ADMIN:
// voidTransactionAction, closePeriodAction, fiscalYearCloseAction,
// updateCompanySettingsAction, deleteAccountAction (soft)

// Implementación canónica:
const member = await prisma.companyMember.findUnique({
  where: { userId_companyId: { userId, companyId } }
});
if (!member) return { success: false, error: 'Empresa no encontrada' };

// Para operaciones ADMIN-only:
if (member.role !== 'ADMIN') {
  return { success: false, error: 'No autorizado para esta operación' };
}
```

**Matriz de roles**:

| Operación | VIEWER | ACCOUNTANT | ADMIN |
|---|---|---|---|
| Ver reportes, listados | ✅ | ✅ | ✅ |
| Crear facturas, retenciones, asientos | ❌ | ✅ | ✅ |
| Registrar pagos CxC/CxP | ❌ | ✅ | ✅ |
| Anular (VOID) transacciones | ❌ | ❌ | ✅ |
| Cerrar período contable | ❌ | ❌ | ✅ |
| Cierre de ejercicio fiscal | ❌ | ❌ | ✅ |
| Configuración de empresa | ❌ | ❌ | ✅ |

---

### D-2 — Techo máximo de montos en schemas Zod

**Regla**: todo campo de monto monetario en un schema Zod de input DEBE tener `.min` y
`.max` explícitos.

```typescript
// Constante canónica — definir en src/lib/fiscal-validators.ts
export const MAX_INVOICE_AMOUNT = new Decimal('9999999999.9999'); // ~10 mil millones VES

// En schemas Zod — usar string (Decimal.js compatible):
baseAmount: z.string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Formato de monto inválido')
  .refine(v => new Decimal(v).greaterThan(0), 'El monto debe ser mayor a 0')
  .refine(v => new Decimal(v).lessThanOrEqualTo(MAX_INVOICE_AMOUNT), 'Monto excede el límite permitido'),
```

**Aplica a**: baseAmount, totalAmount, amountVes, amountOriginal, commissionAmount,
igtfAmount, pendingAmount — en todos los módulos.

---

### D-3 — Tasas fiscales NUNCA desde el cliente

**Regla**: ningún schema Zod de input (los que reciben datos del browser) puede incluir
campos `ivaRate`, `taxRate`, `igtfRate`, `islrRate` como campos editables.

Las tasas siempre provienen de:
- Constantes del sistema (`IVA_GENERAL = 0.16`, `IGTF_RATE = 0.03`)
- Lookup en DB de configuración de empresa (solo escritura por ADMIN)
- Parámetros del Decreto/Providencia — inmutables por el usuario

```typescript
// ❌ PROHIBIDO en cualquier schema de input:
const CreateInvoiceSchema = z.object({
  ivaRate: z.number(),   // ← cross-tenant rate manipulation
  taxRate: z.string(),   // ← fiscal fraud vector
})

// ✅ CORRECTO — la tasa se calcula en el service, no se acepta del cliente:
const CreateInvoiceSchema = z.object({
  taxCategory: z.nativeEnum(TaxCategory),  // determina la tasa
  baseAmount: z.string(),                   // sobre la que el service calcula el IVA
})
```

---

### D-4 — AuditLog es append-only — prohibición explícita de update/delete

**Regla**: `prisma.auditLog.update()`, `prisma.auditLog.updateMany()`,
`prisma.auditLog.delete()`, `prisma.auditLog.deleteMany()` están PROHIBIDOS en todo el
código de producción. El AuditLog es append-only por diseño legal (VEN-NIF, Código de
Comercio Art. 32-33).

**Test arquitectónico** (añadir a `src/__tests__/architecture/`):

```typescript
// audit-log-integrity.test.ts
it('ningún archivo de producción contiene auditLog.update o auditLog.delete', async () => {
  const { execSync } = await import('child_process');
  const result = execSync(
    'grep -rn "auditLog.update\\|auditLog.delete" src/ --include="*.ts" ' +
    '| grep -v "__tests__\\|.test.ts\\|.spec.ts"',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  expect(result).toBe('');
});
```

---

### D-5 — Rate limiting obligatorio en toda Server Action que muta datos financieros

**Regla**: toda nueva Server Action que crea, modifica, o anula datos fiscales o contables
DEBE incluir rate limiting en el paso 2 del flujo estándar (después de auth, antes de
safeParse).

```typescript
// Limiter a usar por categoría:
// limiters.fiscal  → createInvoice, createRetention, createIGTF, createTransaction,
//                    recordPayment, cancelPayment, closePeriod, fiscalYearClose
// limiters.ocr     → extractInvoice (OCR)
// Sin rate limit   → listados de solo lectura (getInvoicesAction, etc.)
```

**Audit check** (ejecutar en security-agent antes de aprobar cualquier fase):

```bash
# Acciones de mutación sin rate limiting:
grep -rn "export async function.*Action" src/modules --include="*.actions.ts" -A 15 \
  | grep -B 10 "safeParse\|findUnique" | grep -v "checkRateLimit\|read\|get\|list\|find"
```

---

## Alternativas rechazadas

| Alternativa | Razón del rechazo |
|---|---|
| RLS a nivel de PostgreSQL | Incompatible con PgBouncer transaction mode en Neon (ver contaflow-context-v2.md §21) — requiere decisión arquitectónica separada |
| Middleware de Next.js para roles | No tiene acceso a DB → solo puede verificar Clerk claims. Un VIEWER con un JWT manipulado podría eludir el middleware. La verificación en la Server Action con DB lookup es más segura |
| `z.coerce.number()` para montos | Silencia errores de tipo — un string `"abc"` se convierte en `NaN` sin error. Usar `z.string().regex()` + Decimal.js es más seguro y compatible con nuestra arquitectura |
| HMAC en idempotencyKey | Overhead innecesario — la verificación `{ idempotencyKey, companyId }` ya aísla por tenant (LL-002) |

---

## Consecuencias

- **Positivo**: superficie de ataque de lógica de negocio reducida en las 5 áreas documentadas
- **Positivo**: matriz de roles explícita — los agentes pueden aplicarla sin ambigüedad
- **Negativo**: el check de `member.role` añade 1 DB query por action destructiva (~2ms en Neon)
  — aceptable vs el riesgo de autorización incorrecta
- **Acción requerida**: audit de todas las actions existentes para verificar D-1 (role check)
  y D-2 (amount ceiling) — asignar a security-agent antes de Fase 19

---

## Owner de verificación

- `security-agent` — auditoría inicial y regresiones por fase
- `arch-agent` — aprueba excepciones a D-1 a D-5 (requiere nuevo ADR)
- `test-agent` — implementa el test arquitectónico de D-4
- `ledger-agent` y `fiscal-agent` — aplican D-1, D-2, D-5 en cada nueva action
