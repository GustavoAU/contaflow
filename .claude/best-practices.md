# ContaFlow — Best Practices de Ingeniería

> Consolidated engineering standards. Agents must read the relevant section before implementing.
> If a practice contradicts an ADR → the ADR takes precedence.

---

## 1. Security

### 1.1 Authentication and authorization (mandatory order in every Server Action)

```typescript
// FIXED order — never invert
export async function miAction(input: unknown) {
  // 1. Auth
  const { userId } = await auth();
  if (!userId) return { success: false, error: 'No autorizado' };

  // 2. Rate limiting
  const { allowed } = await checkRateLimit(limiters.fiscal, userId);
  if (!allowed) return { success: false, error: 'Límite de solicitudes excedido' };

  // 3. Parse and validation
  const parsed = MiSchema.safeParse(input);
  if (!parsed.success) return { success: false, errors: parsed.error };

  // 4. Verify membership
  const member = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId: parsed.data.companyId } }
  });
  if (!member) return { success: false, error: 'Empresa no encontrada' };

  // 5. Business logic
  ...
}
```

### 1.2 Multi-tenant queries (see ADR-004)

- `findMany` / `findFirst` → ALWAYS include `companyId` in `where`
- `findUnique` by PK → OK without companyId
- Business uniqueness → `{ companyId, field }`, never `{ field }` alone

### 1.3 Prisma errors — never expose raw errors to the client

```typescript
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return { success: false, error: 'Ya existe un registro con esos datos' };
    if (error.code === 'P2003') return { success: false, error: 'Datos de referencia inválidos' };
  }
  // Log via Sentry, generic response to client
  return { success: false, error: 'Error interno del servidor' };
}
```

---

## 2. Database

### 2.1 Transactions

| Operation | Isolation level | Reason |
|---|---|---|
| Número correlativo (control, voucher) | `Serializable` | Race condition → fiscal duplicate |
| Período / fiscal year closing | `Serializable` | State that cannot overlap |
| Any multi-table mutation | `Read Committed` (default) | Sufficient for ACID without correlativos |
| Read-only queries | No transaction | Not applicable |

### 2.2 Indexes — when to create them

Create an index on:
- FKs used frequently in `WHERE` (`companyId`, `periodId`, `invoiceId`)
- Short text search fields (`invoiceNumber`, `controlNumber`)
- Filter fields in listings (`status`, `invoiceType`, `deletedAt`)
- Ordering fields in cursor-based pagination (`createdAt`, `date`)

Do not create an index on:
- Simple boolean fields without high selectivity
- Fields that rarely appear in WHERE

### 2.3 Pagination — cursor-based mandatory for listings (Phase 13C)

```typescript
// ✅ Cursor-based — O(log n), scalable
prisma.invoice.findMany({
  where: { companyId, deletedAt: null },
  take: 50,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { createdAt: 'desc' },
})

// ❌ Offset — O(n), collapses with 500+ records
prisma.invoice.findMany({ skip: page * 50, take: 50 })
```

---

## 3. Cálculos Fiscales VEN-NIF

### 3.1 IVA calculation order (Providencia 0071)

```
base_imponible × 0.16 = iva_general
base_imponible × 0.15 = iva_adicional_lujo  (if applicable)
iva_general + iva_adicional_lujo = total_iva
base_imponible + total_iva = total_factura
```

**NEVER**: `(base + iva_general) × 0.15` — the adicional goes on the SAME base, not on the subtotal with IVA.

### 3.2 IGTF — complete truth table

| currency | isSpecialContributor | applies IGTF |
|---|---|---|
| USD / EUR / other | false | ✅ YES |
| USD / EUR / other | true | ✅ YES |
| VES | false | ❌ NO |
| VES | true | ✅ YES |

### 3.3 Retenciones ISLR — Decreto 1808 (current rates)

| Concepto | Rate |
|---|---|
| Servicios persona jurídica | 2% |
| Servicios persona natural | 3% |
| Honorarios profesionales | 5% |
| Arrendamiento | 5% |
| Fletes | 1% |
| Publicidad y propaganda | 3% |

### 3.4 RIF VEN-NIF — single source of truth

```typescript
// ALWAYS import from:
import { VEN_RIF_REGEX, validateVenezuelanRif } from '@/lib/fiscal-validators';

// Valid prefixes: J (Jurídica), V (Venezolano), E (Extranjero),
//                G (Gobierno), C (Comunal), P (Pasaporte)
// Format: X-XXXXXXXX or X-XXXXXXXX-D (optional check digit)
```

---

## 4. Testing

### 4.1 Canonical mock pattern — do not deviate

```typescript
// Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  }
}))

// Interactive $transaction (for services with internal logic)
vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
  fn({ ...prisma } as never)
)

// Serializable $transaction
vi.mocked(prisma.$transaction).mockImplementation(async (fn, _opts) =>
  fn({ ...prisma } as never)
)

// Auth
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'test-user-id' })
}))

// Rate limiting — ALWAYS in action tests
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} }
}))
```

### 4.2 Test naming

```typescript
// ✅ Readable spec-style
it('cuando el userId es null, retorna error de autenticación sin consultar DB')
it('cuando el companyId no pertenece al usuario, retorna 403')
it('cuando el idempotencyKey ya existe, retorna el registro existente sin crear duplicado')

// ❌ Useless names
it('test auth')
it('should work')
```

### 4.3 Numeric values in tests — expose float errors

```typescript
// Use values that detect IEEE 754 precision loss:
const BASE = '1333.33'  // not 1000.00
const IVA_RATE = '0.16'
// If result is '213.3328' → Decimal.js correct
// If result is '213.33280000001' → someone used native Number → bug
```

---

## 5. UI/UX — Standards for ui-agent

### 5.1 Numeric data

```css
/* ALWAYS on amount columns */
font-variant-numeric: tabular-nums;
min-font-size: 14px;
```

### 5.2 Forms — async state pattern

**`useTransition`** for forms with Zod + strict typing (our stack).
**`useActionState`** only for simple forms without Zod (1-2 fields, `<form action={fn}>`).

```typescript
// ✅ Correct pattern for complex forms with Zod
const [isPending, startTransition] = useTransition();

function handleSubmit(data: FormData) {
  startTransition(async () => {
    const result = await miServerAction(data);
    if (!result.success) setErrors(result.errors);
  });
}
```

### 5.3 Destructive or irreversible actions

Always use shadcn/ui `AlertDialog` before executing:
- Anulación de transacción (VOID)
- Cierre de período o ejercicio fiscal
- Change of `taxCategory` to EXENTA/EXONERADA/NO_SUJETA
- Cancellation of an applied payment

### 5.4 Fiscal read-only fields (not user-editable)

- Tasa de IVA (comes from the system based on category)
- Automatic número de control (`00-XXXXXXXX`)
- Número de comprobante de retención (`CR-XXXXXXXX`)
- Calculated tax totals

---

## 6. Module Architecture

### 6.1 Unidirectional dependencies (DDD)

```
components/ → actions/ → services/ → (prisma, Decimal.js, fiscal-validators)
                ↑ NO                    ↑ NO
```

- `services/` NEVER imports from `components/`, `app/`, or other modules (except `lib/`)
- `actions/` NEVER imports from `components/`
- `components/` NEVER imports from `@/lib/prisma` directly

### 6.2 Cross-module communication

```typescript
// ✅ Modules communicate via Server Action or shared type
// InvoiceService does NOT import RetentionService

// ✅ Shared types in src/types/ if cross-module
// ✅ Shared utility functions in src/lib/
```

### 6.3 AuditLog — always in the same $transaction

```typescript
await prisma.$transaction(async (tx) => {
  const result = await tx.invoice.update({ ... });

  // AuditLog inside the SAME $transaction — if the update fails, no orphan log
  await tx.auditLog.create({
    data: { userId, action: 'UPDATE', entityId: result.id, oldValue, newValue }
  });

  return result;
});
```
