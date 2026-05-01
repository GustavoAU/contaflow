# ContaFlow — Skills Discovered
_Patrones reutilizables descubiertos en desarrollo. El agente los lee según el decision-tree, no completo._
_Última actualización: 2026-04-30_

**Formato de cada entrada:**
- `Fase` → dónde se descubrió
- `Verificado` → última vez que se confirmó que funciona con el stack actual
- `Stack` → versión de Prisma/Next/Zod vigente cuando se validó

> ⚠️ Si `Verificado` tiene más de 3 meses o cambió una dependencia mayor → re-verificar antes de copiar.

---

## Tipo A — Query Patterns (DB)

### A1 — Invoice con tax lines + retention links (sin N+1)
**Fase:** 35H | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1

```typescript
prisma.invoice.findUnique({
  where: { id: invoiceId, companyId }, // guard tenant + IDOR en una sola query
  include: {
    taxLines: { where: { deletedAt: null } },
    relatedRetention: { select: { voucherNumber: true, status: true } },
    transaction: { select: { id: true, createdAt: true } },
  },
});
```

**Reutilizado en:** `getInvoiceForAudit`, `generateInvoiceBookPDF`
**Nota:** El guard `companyId` en `where` evita una segunda query de verificación IDOR.

---

### A2 — Posición fiscal agregada (IVA / IGTF / ISLR) en paralelo
**Fase:** 26 | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1

```typescript
const [ivaDebito, ivaCredito, igtfBase] = await Promise.all([
  prisma.$queryRaw<[{ total: Decimal }]>`
    SELECT COALESCE(SUM(tl."ivaAmount"), 0) as total
    FROM "InvoiceTaxLine" tl
    JOIN "Invoice" i ON i.id = tl."invoiceId"
    WHERE i."companyId" = ${companyId}
      AND i."invoiceType" = 'SALE'
      AND i."periodId" = ${periodId}
      AND tl."deletedAt" IS NULL
  `,
  // ... query PURCHASE similar
  // ... query IGTF
]);
```

**Reutilizado en:** KPI Dashboard, AI context builder, widget fiscal
**Nota:** `Promise.all` reduce latencia de 3 queries secuenciales a 1 round-trip.

---

### A3 — Soft delete safe — nunca DELETE en entidades fiscales
**Fase:** 13 | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1

```typescript
// ❌ PROHIBIDO
await prisma.invoice.delete({ where: { id } });

// ✅ OBLIGATORIO
await prisma.invoice.update({
  where: { id, companyId }, // guard tenant siempre
  data: {
    deletedAt: new Date(),
    status: 'VOIDED',
  },
});
```

---

## Tipo B — Validation / Security Patterns

### B1 — Serializable + P2002 en correlativos
**Fase:** 12A | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1

```typescript
try {
  const result = await prisma.$transaction(
    async (tx) => {
      const controlNumber = await getNextControlNumber(tx, companyId, invoiceType);
      const invoice = await tx.invoice.create({
        data: { controlNumber, companyId, /* ... */ },
      });
      return invoice;
    },
    { isolationLevel: 'Serializable' }
  );
  return { data: result };
} catch (e) {
  if (
    isPrismaError(e, 'P2002') &&
    (e.meta?.target as string[])?.includes('controlNumber')
  ) {
    return { error: 'Error transitorio — intenta de nuevo. El documento no fue creado.' };
  }
  throw e;
}
```

**Aplica a:** `createInvoiceAction`, `createRetentionAction`, cualquier acción con correlativo
**Nunca** capturar P2002 genérico — siempre verificar `meta.target` para el campo específico.

---

### B2 — IDOR guard completo en Server Action
**Fase:** 14 | **Verificado:** 2026-04-30 | **Stack:** Clerk + Prisma 7.4.1

```typescript
export async function myFiscalAction(input: z.infer<typeof mySchema>) {
  // 1. Auth
  const { userId } = await auth();
  if (!userId) return { error: 'Unauthorized' };

  // 2. Validar input
  const parsed = mySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // 3. IDOR guard — companyId verificado contra userId
  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTANT)) {
    return { error: 'Forbidden' };
  }

  // 4. Rate limit
  await checkRateLimit(userId, limiters.fiscal);

  // 5. Lógica de negocio — AHORA es seguro usar parsed.data.companyId
  return await prisma.$transaction(async (tx) => {
    // ... mutation
    await tx.auditLog.create({ data: { /* ... */ } });
  });
}
```

**Regla:** `companyId` en queries SIEMPRE viene del `member` verificado, nunca directo del input.

---

### B3 — Captura de IP/UserAgent para AuditLog (R-6)
**Fase:** 35H | **Verificado:** 2026-04-30 | **Stack:** Next.js 16

```typescript
// En Server Action — desde headers de la request
import { headers } from 'next/headers';

const headersList = await headers();
const ipAddress =
  headersList.get('x-forwarded-for') ??
  headersList.get('x-real-ip') ??
  'unknown';
const userAgent = headersList.get('user-agent') ?? 'unknown';

// Dentro del $transaction:
await tx.auditLog.create({
  data: {
    companyId,
    userId,
    action: 'CREATE_INVOICE',
    entityId: invoice.id,
    entityType: 'Invoice',
    ipAddress,
    userAgent,
    newValue: JSON.stringify(invoice),
  },
});
```

---

## Tipo C — Fiscal Logic Patterns

### C1 — Alícuotas IVA canónicas con Decimal.js
**Fase:** 14 | **Verificado:** 2026-04-30 | **Stack:** Decimal.js

```typescript
// src/lib/fiscal/tax-rates.ts — fuente única de verdad
export const ALICUOTAS_IVA = {
  IVA_GENERAL:   new Decimal('0.16'),
  IVA_REDUCIDO:  new Decimal('0.08'),
  IVA_ADICIONAL: new Decimal('0.15'), // lujo — se SUMA a GENERAL → total 31%
  EXENTO:        new Decimal('0'),
} as const;

// Uso correcto:
const ivaAmount = taxBase.multipliedBy(ALICUOTAS_IVA[taxLineType]);

// ❌ PROHIBIDO en cualquier contexto de dinero:
// const iva = base * 0.16;
// const iva: number = ...;
```

---

### C2 — Condición IGTF correcta
**Fase:** 14C | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1

```typescript
// Regla completa (PA-121 + Decreto IGTF):
function shouldApplyIGTF(
  currency: string,
  isSpecialContributor: boolean
): boolean {
  // IGTF aplica si:
  // (a) Pago en divisas/crypto/Zelle (cualquier contribuyente)
  // (b) Contribuyente especial pagando en VES
  return currency !== 'VES' || isSpecialContributor;
}

const IGTF_RATE = new Decimal('0.03');

const igtfAmount = shouldApplyIGTF(currency, company.isSpecialContributor)
  ? paymentAmount.multipliedBy(IGTF_RATE)
  : new Decimal('0');
```

---

### C3 — Retenciones IVA — solo contribuyentes especiales
**Fase:** 18 | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1

```typescript
// Porcentajes de retención IVA (solo si isSpecialContributor)
export const RETENTION_IVA_RATES = {
  PARTIAL: new Decimal('0.75'), // 75%
  TOTAL:   new Decimal('1.00'), // 100%
} as const;

// Guard obligatorio antes de calcular retención:
if (!company.isSpecialContributor) {
  throw new Error('Retención IVA solo aplica a contribuyentes especiales');
}
```

---

## Tipo D — Integration Patterns

### D1 — SeniatSubmission en mismo $transaction que la factura
**Fase:** 35H | **Verificado:** 2026-04-30 | **Stack:** Prisma 7.4.1 + QStash

```typescript
await prisma.$transaction(async (tx) => {
  const invoice = await tx.invoice.create({ data: { /* ... */ } });

  // SeniatSubmission en el MISMO $transaction — atomicidad garantizada
  await tx.seniatSubmission.create({
    data: {
      invoiceId: invoice.id,
      companyId,
      status: 'PENDING', // QStash reintenta si SENIAT está caído
      payload: JSON.stringify(buildSeniatPayload(invoice)),
    },
  });

  await tx.auditLog.create({ data: { /* ... */ } });

  return invoice;
});
```

---

### D2 — Idempotencia en webhook SENIAT (QStash)
**Fase:** 35H | **Verificado:** 2026-04-30 | **Stack:** @upstash/qstash

```typescript
export async function POST(req: Request) {
  // Verificar firma QStash SIEMPRE — antes de procesar
  const isValid = await verifyQStashSignature(req);
  if (!isValid) return new Response('Unauthorized', { status: 401 });

  const { submissionId } = await req.json();

  const submission = await prisma.seniatSubmission.findUnique({
    where: { id: submissionId },
  });

  // Idempotencia PA-121: descarta reintentos duplicados de QStash
  if (!submission || ['SENT', 'ACKNOWLEDGED'].includes(submission.status)) {
    return new Response('Already processed', { status: 200 });
  }

  // ... procesar
}
```

---

## Tipo E — UX / Robustness Patterns

### E1 — Export con exceljs (dinámico, SSR-safe)
**Fase:** 26B | **Verificado:** 2026-04-30 | **Stack:** exceljs (reemplazó xlsx en 2026-04-27)

```typescript
// Import dinámico obligatorio — exceljs no funciona en SSR con import estático
import type ExcelJS from 'exceljs';

export async function generateExcelReport(data: ReportData): Promise<Buffer> {
  const ExcelJSModule = await import('exceljs');
  const wb = new ExcelJSModule.default.Workbook();
  const ws = wb.addWorksheet('Reporte');

  ws.columns = [
    { header: 'Fecha', key: 'date', width: 15 },
    { header: 'Monto', key: 'amount', width: 20 },
  ];

  data.rows.forEach((row) => ws.addRow(row));

  const buffer = await wb.xlsx.writeBuffer();
  // Fix de tipo — Buffer de exceljs difiere del Node.js moderno
  return buffer as unknown as Parameters<typeof wb.xlsx.load>[0];
}
```

**Nota:** Webpack fallbacks en `next.config.ts` ya configurados (ver DECISIONS.md).

---

### E2 — Botón fiscal con guard doble-submit
**Fase:** Múltiples | **Verificado:** 2026-04-30 | **Stack:** Next.js 16 + React

```typescript
const [isPending, startTransition] = useTransition();

const handleSubmit = () => {
  startTransition(async () => {
    const result = await createInvoiceAction(formData);
    if (result.error) toast.error(result.error);
    else router.push(`/invoices/${result.data.id}`);
  });
};

// JSX:
<button
  onClick={handleSubmit}
  disabled={isPending}
  aria-busy={isPending}
  aria-label={isPending ? 'Procesando factura...' : 'Emitir Factura'}
  className="..."
>
  {isPending ? <Spinner className="h-4 w-4" /> : 'Emitir Factura'}
</button>
```

**Regla:** `useTransition` para forms con Zod tipado. `useActionState` solo para forms simples sin Zod.

---

## Tipo F — Test Patterns (Vitest 4)

### F1 — Mock de $transaction con auditLog
**Fase:** Múltiples | **Verificado:** 2026-04-30 | **Stack:** Vitest 4 + Prisma 7.4.1

```typescript
vi.mocked(prisma.$transaction).mockImplementation(
  ((fn: (tx: unknown) => unknown) =>
    fn({
      invoice: prisma.invoice,
      auditLog: prisma.auditLog,
      seniatSubmission: prisma.seniatSubmission,
    })) as never
);
```

---

### F2 — Mock de rate limit + Clerk en Action tests
**Fase:** Múltiples | **Verificado:** 2026-04-30 | **Stack:** Vitest 4

```typescript
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'user_test_123' }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));
```

---

_Añadir nuevas skills al final de la sección correspondiente. Máximo 5 min por entrada._
_Si el archivo supera 500 líneas, fragmentar en `skills-fiscales.md` + `skills-ui.md`._
