# ContaFlow — Guía de Agente

## Stack

Next.js 16 App Router | Prisma 7.4.1 + @prisma/adapter-pg (pooled) | Neon | Clerk | Zod 4 | Vitest 4 | Decimal.js | @upstash/ratelimit | @sentry/nextjs

## Prisma / DB

- `src/lib/prisma.ts`: singleton adapter-pg con `DATABASE_URL` (pooled)
- Migraciones: `DATABASE_URL_DIRECT` en `prisma.config.ts`
- Después de todo `prisma generate` → SIEMPRE reiniciar `npm run dev`

## Estructura de módulos

```
src/modules/[nombre]/{schemas,services,actions,components,__tests__}/
```

## Reglas contables INVIOLABLES

- NUNCA `float` para dinero → usar `Decimal.js` siempre
- NUNCA `DELETE` en asientos contables → siempre `VOID` (estado)
- `$transaction` obligatorio en TODA mutación financiera
- `Serializable` obligatorio en: `getNextControlNumber`, `getNextVoucherNumber`, cierre de período
- `onDelete: Restrict` en TODAS las tablas contables — nunca `Cascade`
- `AuditLog` dentro del mismo `$transaction` que la mutación principal

## Zod 4

- Usar `{ error: "msg" }` — NO `{ errorMap: ... }`

## Rate Limiting

- `src/lib/ratelimit.ts`: `limiters.fiscal` (30/min) + `limiters.ocr` (10/min) via Upstash sliding window
- Si `UPSTASH_REDIS_REST_URL` no está definida → no-op (permite todo) — nunca bloquea en dev/test
- Si Redis falla en runtime → catch silencioso, permite el request
- Mock en tests: `vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), limiters: { fiscal: {}, ocr: {} } }))`
- Aplicado en: `createInvoiceAction`, `createRetentionAction`, `createIGTFAction`, `createAccountAction`, `extractInvoiceAction` (OCR)

## Vitest 4

- Environment global: `node`
- Componentes React: `// @vitest-environment jsdom` en PRIMERA línea del test
- `environmentMatchGlobs` NO EXISTE en Vitest 4 — prohibido usarlo
- Mock pattern: `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`
- `vi.hoisted()` para variables antes de `vi.mock()`
- Siempre mockear en tests de Actions: `next/cache`, `@clerk/nextjs/server`
- Mock de `$transaction` interactivo: `vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({ modelo: prisma.modelo, auditLog: prisma.auditLog })) as never)`

## Fiscal VEN-NIF

- IVA: General 16% | Reducido 8% | Adicional Lujo 15% (total 31%) | Exento/Exonerado 0%
- `luxuryGroupId` vincula `IVA_ADICIONAL` ↔ `IVA_GENERAL` en `InvoiceTaxLine`
- IGTF 3%: aplica si `currency !== VES` OR (`isSpecialContributor` AND `currency === VES`)
- Retenciones IVA: 75%/100%. Solo si `isSpecialContributor`
- Retenciones ISLR Decreto 1808: tasas variables por tipo de pago
- RIF regex: `/^[JVEGCP]-\d{8}-?\d?$/i`

## Errores Prisma

- `P2002` → "Ya existe..." | `P2003` → "Datos de referencia inválidos"
- Nunca exponer errores crudos de Prisma al cliente

## Estado actual

- Fase 12A ✅ mergeada
- Fase 12B en progreso (`feat/invoice-books-v2`)
  - ✅ 18.1 ControlNumberSequence + Serializable SSI (InvoiceSequenceService)
  - ✅ 18.3 Cascade TaxCategory + AlertDialog (InvoiceForm)
  - ✅ 18.6 Validación RIF /^[JVEGCP]-\d{8}-?\d?$/i (bug fix prefijo C-)
  - ✅ 18.2 PDF librería — @react-pdf/renderer v4, InvoiceBookPDFService + RetentionVoucherPDFService
  - ⏳ 18.4 Link retention↔invoice — ARCH pendiente (schema change)
  - ✅ 18.5 Voucher PDF individual por factura — InvoiceVoucherPDFService, botón PDF por fila en InvoiceBook
- 18.3 cascade taxCategory UI → ✅ completado
- 18.6 validación RIF Zod → ✅ completado (bug fiscal corregido: regex 
  ahora acepta C- comunal y dígito verificador opcional)

## Principios — reglas operacionales

- DDD: cada módulo = bounded context. TransactionService nunca importa de
  InvoiceService. Comunicación via Server Action o domain event.
- DRY: tasas ISLR en un solo const. Lógica de cálculo fiscal en
  FiscalCalculator, no duplicada en cada service.
- SOLID-S: validateDoubleEntry() separado de persistTransaction().
  Una función = una responsabilidad.
- SOLID-O: nueva alícuota IVA = nuevo enum entry + config. Sin tocar
  servicios existentes.
- YAGNI: no implementar Colombia/DIAN hasta que exista contrato firmado
  en contaflow-contract.md.
- KISS: si cabe en una línea Zod, no crear clase validator.

## Forms — patrón de estado async

- **`useTransition`** → patrón estándar para forms con Zod + objetos tipados (nuestro caso). No deprecado en React 19.
- **`useActionState`** → solo para forms simples sin validación compleja (1-2 campos, sin Zod). Diseñado para `<form action={fn}>` + FormData, incompatible con nuestro stack tipado.

## Convenciones

- Archivos/carpetas en inglés
- Contenido UI en español
