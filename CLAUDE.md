# ContaFlow — Agent Guide

## Knowledge Base (leer antes de implementar)

- **`.claude/PROMPT_V8.md`** — Reglas inviolables R-1 a R-5, checklist pre-merge
- **`.claude/ontologia/ontologia-v8-indice.md`** — Fuente de verdad contable V8 (catálogo cuentas, matrices, reglas)
- **`.claude/ontologia/quick-reference.md`** — Tabla rápida cuentas, validaciones copy-paste, reglas de oro
- **`.claude/adr/ADR-015-BORRADOR-eventos-extemporaneos.md`** — Ajustes extemporáneos / retroactivos (pendiente aprobación)
- **`.claude/design/caja-chica-spec.md`** — Especificación Módulo Caja Chica (Fase 35D)

### Regla de lectura obligatoria

**ANTES de implementar cualquier tarea que involucre:** nueva cuenta contable, nuevo asiento o tipo de asiento, nuevo módulo fiscal, nueva fase de nómina, schema Prisma con impacto contable, o lógica de cálculo de impuestos/retenciones/prestaciones — debes leer primero:
1. `.claude/PROMPT_V8.md`
2. `.claude/ontologia/quick-reference.md`

No es necesario leerlos para: bugs de UI, exportaciones Excel/PDF, fixes de tipado TypeScript, tests, migraciones de campos no-contables, ni mejoras de UX puras.

## Stack

Next.js 16 App Router | Prisma 7.4.1 + @prisma/adapter-pg (pooled) | Neon | Clerk | Zod 4 | Vitest 4 | Decimal.js | @upstash/ratelimit | @sentry/nextjs

## Prisma / DB

- `src/lib/prisma.ts`: singleton adapter-pg with `DATABASE_URL` (pooled)
- Migrations: `DATABASE_URL_DIRECT` in `prisma.config.ts`
- After every `prisma generate` → ALWAYS restart `npm run dev`
- **`prisma migrate dev` (sin `--create-only`) ESTÁ ROTO** — el shadow DB falla al replicar `20260331_fase17_bank_reconciliation` porque esa migración carece de timestamp numérico y se aplica en un orden incorrecto en el shadow efímero. **Workflow obligatorio para migraciones:**
  1. Crear carpeta `prisma/migrations/YYYYMMDD_nombre/migration.sql` manualmente
  2. `npx prisma db execute --file prisma/migrations/YYYYMMDD_nombre/migration.sql`
  3. `npx prisma migrate resolve --applied YYYYMMDD_nombre`
  4. `npx prisma generate`

## Module structure

```
src/modules/[name]/{schemas,services,actions,components,__tests__}/
```

## Accounting rules — INVIOLABLE

- NEVER `float` for money → always use `Decimal.js`
- NEVER `DELETE` on accounting asientos → always `VOID` (status change)
- `$transaction` mandatory in EVERY financial mutation
- `Serializable` mandatory for: `getNextControlNumber`, `getNextVoucherNumber`, período closing
- `onDelete: Restrict` on ALL contable tables — never `Cascade`
- `AuditLog` inside the same `$transaction` as the main mutation

## Zod 4

- Use `{ error: "msg" }` — NOT `{ errorMap: ... }`

## Rate Limiting

- `src/lib/ratelimit.ts`: `limiters.fiscal` (30/min) + `limiters.ocr` (10/min) via Upstash sliding window
- If `UPSTASH_REDIS_REST_URL` is not defined → no-op (allows all) — never blocks in dev/test
- If Redis fails at runtime → silent catch, request is allowed
- Mock in tests: `vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), limiters: { fiscal: {}, ocr: {} } }))`
- Applied to: `createInvoiceAction`, `createRetentionAction`, `createIGTFAction`, `createAccountAction`, `extractInvoiceAction` (OCR), `fetchBcvRateAction`

## Vitest 4

- Global environment: `node`
- React components: `// @vitest-environment jsdom` on the FIRST line of the test file
- `environmentMatchGlobs` DOES NOT EXIST in Vitest 4 — forbidden
- Mock pattern: `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`
- `vi.hoisted()` for variables before `vi.mock()`
- Always mock in Action tests: `next/cache`, `@clerk/nextjs/server`
- Interactive `$transaction` mock: `vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({ modelo: prisma.modelo, auditLog: prisma.auditLog })) as never)`

## Fiscal VEN-NIF

- IVA: General 16% | Reducido 8% | Adicional Lujo 15% (total 31%) | Exento/Exonerado 0%
- `luxuryGroupId` links `IVA_ADICIONAL` ↔ `IVA_GENERAL` in `InvoiceTaxLine`
- IGTF 3%: applies if `currency !== VES` OR (`isSpecialContributor` AND `currency === VES`)
- Retenciones IVA: 75%/100%. Only if `isSpecialContributor`
- Retenciones ISLR Decreto 1808: variable rates per payment type
- RIF regex: `/^[JVEGCP]-\d{8}-?\d?$/i`

## Prisma errors

- `P2002` → "Ya existe..." | `P2003` → "Datos de referencia inválidos"
- Never expose raw Prisma errors to the client

## Current status

- Phase 12A ✅ merged
- Phase 12B ✅ merged (invoice books, PDFs, RIF fix)
- Fase 13C ✅ merged (security B1, pagination B2, PeriodSnapshot B3-B4, report-cache B5, query monitoring B6)
- Fase 14 ✅ merged (multimoneda: Currency enum, ExchangeRate, BCV rates)
- Fase 14B ✅ merged (PaymentRecord — pagos con múltiples medios)
- Fase 15 ✅ merged (FiscalYearClose — cierre de año fiscal)
- Fase 16 ✅ merged (Receivable/Payable portfolio — cuentas por cobrar/pagar)
- Fase 17 ✅ merged (Conciliación Bancaria — hardening + ReconciliationService + 3-way match UI)
- Fase 17B ✅ merged (BankReconciliationService + CsvImporter)
- Fase 13D ✅ merged (RLS Row Level Security — commit 0ada843)
- Fase 18 ✅ merged (Analytics Dashboard — 5 gráficos recharts — commit b468af2)
- Fase 14C ✅ merged (BCV auto-fetch — BcvFetchService + fetchBcvRateAction + UI button — commit ee04693)
- Fase 19A ✅ merged (Security Hardening ADR-006 D-1/D-2/D-3 — 8 CRITICALs + amount ceilings + role checks — commit f0c8d5a)
- Fase 19B ✅ merged (Security Residual — 4 HIGH findings: createInvoice/createPayment/upsertExchangeRate/getRetentions + regression tests — commit cb2d324)
- Fase 19 ✅ merged (Declaración Mensual IVA — Forma 30 SENIAT: DeclaracionIVAService + generarForma30Action + Forma30View + 23 tests)
- Fase 19C ✅ merged (Forma 30 PDF export — Forma30PDFService + exportForma30PDFAction + 17 tests + Navbar IVA/fiscal-close links)
- Fase 14D ✅ merged (Validación RIF SENIAT — validateRifAction + RifInput + limiters.rif + Redis cache 24h + 13 tests)
- Fase 12C ✅ merged (Asistente ISLR — islr-suggestions.ts 60+ keywords Decreto 1808 + badge sugerencia en RetentionForm + 23 tests)
- Fase OCR-v2 ✅ merged (Migración schema VEN-NIF + Gemini Vision directo + pre-fill InvoiceForm + /invoices/upload + 14 tests)
- Fase 20 ✅ merged (XML SENIAT descargable + QR code en PDF comprobante + botón XML en InvoiceBook — 30 tests)
- Fase 21 ✅ merged (Activos Fijos y Depreciación VEN-NIF 16 — 3 métodos + asiento automático — 35 tests)
- Fase 22 ✅ merged (Ajuste por Inflación INPC VEN-NIF 3 — INPCRate + InflationAdjustment + preview + Serializable — 32 tests)
- Fase 23B ✅ merged (Auto-conciliación bancaria — Gemini Vision PDF + scoring 3 fuentes + guard período vacío + 30 tests)
- Fases 28A/B/C ✅ merged (Expansión roles + Nav dinámico + Role guards en 13 actions)
- Fase 28D ✅ merged (Módulo Inventario — CPP + Serializable SSI + 2 servicios + 68 tests)
- Fases 28E/F ✅ merged (UI Inventario 5 componentes + UX Hardening sonner/spinners)
- Fase 31 ✅ merged (AuditLog UI — companyId en schema + 44 auditLog.create() + AuditLogTable)
- Fase 28G ✅ merged (Inventario UI completado — getItemMovements() + ItemMovementHistory)
- Fase 33 ✅ merged (Notificaciones in-app — NotificationService + NotificationBell)
- Fase 32 ✅ merged (KPIs Ejecutivos — KpiDashboardService + ExecutiveKpiPanel)
- Fase 23C Residual ✅ merged (NC/ND UI — RelatedInvoicePicker + CreditDebitNotesPanel)
- Fase 28H ✅ merged (Reportes Inventario — InventoryReportService + InventoryReportsView + minimumStock + LOW_STOCK alert)
- Fase 28 ✅ merged (Módulo Compras y Ventas — QuotationService + OrderService + UI + 45 tests — 1001 total)
- Fase NOM-A ✅ merged (Wizard Configuración Nómina — PayrollConfig + 6 enums + 28 tests — 1029 total)
- Fase NOM-B ✅ merged (Empleados y Conceptos — Employee + SalaryHistory + PayrollConcept + 4 enums + 69 tests — 1098 total)
- Fase NOM-C ✅ merged (Motor Cálculo — PayrollRun + PayrollRunLine + PayrollCalculatorService + 58 tests — 1156 total)
- Fase NOM-D ✅ merged (Prestaciones Sociales, Vacaciones, Utilidades, Liquidación Final LOTTT — 77 tests — 1233 total)
- Fase NOM-E ✅ merged (Reportes Legales: IVSS Forma 14-02 + Banavih + INCES + ARC/ISLR Tarifa 1 — 45 tests — 1278 total)
- Fase 35A ✅ merged (Vendor + Customer: CRUD soft-delete + 12 actions + IDOR guards + 54 tests — 1332 total)
- Fase 26B ✅ merged (IA Tareas Pendientes — PendingTasksService + Gemini summary + PendingTasksWidget — 22 tests — 1354 total)
- Fase 26 ✅ merged (Asistente Contable IA — AIContextBuilderService 14 queries + sendMessageAction + AIAssistantChat + Gemini Vision — 22 tests — 1376 total)
- Fase 26B Parte 2 ✅ merged (FiscalAnomalyDetectorService — detector retrospectivo: asientos descuadrados + retenciones sin factura + CxC +90d + saldo anormal — 15 tests — 1391 total)
- Mejora #22 ✅ merged (Forma 30: crédito fiscal período anterior — SeccionE extendida + guard negativo + UI input E1 + 7 tests — 1443 total)
- Fase 35E ✅ merged (Glosa analítica JournalEntry — `description String?` + 10 servicios + Libro Mayor fallback — ADR-016 — 1443 total)

**1461 tests GREEN** | **0 TS errors** | **CI passing** (2026-04-27)

## Roadmap — pre-lanzamiento (ADR-012)

Secuencia confirmada: **NOM-C → NOM-D → NOM-E → Fase 35A simplificada → LAUNCH**

- **NOM-C** — Motor de cálculo nómina (quincenal/mensual, IVSS/INCES/Banavih, horas extra LOTTT, recibo PDF, asiento contable, guard doble-proceso)
- **NOM-D** — Prestaciones sociales (garantía trimestral + intereses BCV), vacaciones, utilidades, Liquidación Final
- **NOM-E** — Reportes legales: Forma 14-02 IVSS + INCES + Banavih + ARC/ISLR empleados
- **Fase 35A simplificada** — Entidad `Vendor` / `Customer` con FK nullable en `Invoice` (sin P2P workflow)
- **Fases 35B/35C/36A/36B** — DIFERIDAS a post-lanzamiento (P2P y O2C completos — ver ADR-012)

## Git workflow — MANDATORY

- Every new phase or feature → `git checkout -b feat/fase-XX-description` before writing any code
- Commit incrementally on the branch; push with `git push -u origin <branch>`
- Merge to `main` only when: phase gate passes (tsc + vitest GREEN) AND user confirms
- Doc-only fixes (contaflow-context-v3.md, CLAUDE.md) may go directly on `main`
- Never commit feature code directly to `main`

## Phase gate — MANDATORY before every phase transition

**Before proposing or starting any new phase, the agent MUST:**
0. Activate `security-agent` to audit the attack surface of the new module (new Server Actions, new endpoints, new Prisma models, auth changes).
1. Run `npx tsc --noEmit` — output must be `exit: 0` (zero errors).
2. Run `npx vitest run` — all tests must pass (0 failures).
3. If any check fails: stop, fix every error, rerun all checks, then report results to the user BEFORE mentioning the next phase.

**Never carry TS errors or failing tests across a phase boundary.** Technical debt discovered mid-session must be fixed in the same session. If pre-existing errors are found during `/siguiente-paso`, list them explicitly and fix them before the phase analysis output.

### security-agent — cuándo es OBLIGATORIO (no saltarse nunca)

El `security-agent` no es solo para fases nuevas. Es obligatorio ante CUALQUIERA de estos triggers, aunque sea un cambio pequeño mid-session:

- Nueva Server Action o modificación de una existente
- Nuevo modelo Prisma o campo nuevo en modelo existente con datos sensibles (montos, RIF, credenciales)
- Nueva ruta de API o endpoint
- Cambio en lógica de autenticación, autorización o roles
- Nuevo campo de entrada del usuario (formulario, schema Zod) que llegue a la base de datos
- Cualquier cambio que toque `companyId` guards o aislamiento multi-tenant

**No requiere security-agent:** exportaciones Excel/PDF client-side, fixes de tipado TS, cambios de UI puramente visual, actualización de documentación, tests.

## Principles — operational rules

- DDD: each module = bounded context. TransactionService never imports from
  InvoiceService. Communication via Server Action or domain event.
- DRY: ISLR rates in a single const. Fiscal calculation logic in
  FiscalCalculator, not duplicated in each service.
- SOLID-S: validateDoubleEntry() separate from persistTransaction().
  One function = one responsibility.
- SOLID-O: new IVA alícuota = new enum entry + config. No touching
  existing services.
- YAGNI: do not implement Phase 28 (Compras/Ventas) or
  Phase 29 (Colombia/DIAN) until a signed contract
  exists in contaflow-contract.md.
- KISS: if it fits in one Zod line, do not create a validator class.

## Forms — async state pattern

- **`useTransition`** → standard pattern for forms with Zod + typed objects (our case). Not deprecated in React 19.
- **`useActionState`** → only for simple forms without complex validation (1-2 fields, no Zod). Designed for `<form action={fn}>` + FormData, incompatible with our typed stack.

## Conventions

- Files/folders in English
- UI content in Spanish

## Dependencias — decisiones

Documentado para evitar re-investigar en sesiones futuras.

### `next` — upgrade 16.1.6 → 16.2.4 (2026-04-27)
Ejecutado. Resuelve 5 CVEs HIGH: CSRF bypass en Server Actions (null origin), HTTP request smuggling, DoS en Server Components, y DoS por image cache/buffer ilimitado. Bump de patch dentro de v16 — sin breaking changes.

### `xlsx` → `exceljs` (2026-04-27)
Eliminado completamente. Los CVEs de xlsx (Prototype Pollution + ReDoS, GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9) afectan **parsing** de archivos maliciosos — riesgo real en `ImportService` y `AccountsImporter`. Migración cubre 7 archivos: ImportService.ts, ImportService.test.ts, AccountsImporter.tsx, JournalExportButton.tsx, LedgerExportButton.tsx, InvoiceBook.tsx, PayrollRunDetail.tsx. Para exceljs en client components con Next.js: webpack fallback `{ fs: false, path: false, child_process: false, net: false, tls: false }` en next.config.ts, más `import type ExcelJS from "exceljs"` para los tipos, e `import("exceljs")` dinámico en runtime. El tipo `Buffer` de exceljs difiere del de Node.js moderno — usar `buffer as unknown as Parameters<typeof wb.xlsx.load>[0]` para castear sin perder seguridad. Nota: exceljs introduce `uuid` moderate (uso interno, bajo riesgo — no exponemos el parámetro `buf`).

### `@hono/node-server` moderate — ignorado intencionalmente
Está dentro de `@prisma/dev`, herramienta exclusivamente de desarrollo (Prisma Studio). El fix requeriría bajar Prisma de 7.4.1 a 6.x — breaking change inaceptable. El middleware bypass de serveStatic no afecta producción.

---

## Dinámica de trabajo — AI Software Factory

Estas reglas aplican en CADA sesión, sin excepción:

1. **Memoria activa**: Cuando se descubre un patrón nuevo, una regla de negocio implícita o una decisión arquitectónica tomada en el camino, se documenta de inmediato — en `CLAUDE.md`, un ADR nuevo, o `quick-reference.md`. No se deja solo en el chat.

2. **Contexto primero**: Al inicio de cada sesión importante, leer `CLAUDE.md` y los archivos relevantes antes de proponer cualquier implementación. Es una obligación, no una sugerencia.

3. **Feedback loop con tests**: Cada fase termina con `tsc` y `vitest` en verde. Si algo falla, se analiza, se corrige, y si revela una regla nueva, se documenta antes de continuar.

4. **Proponer mejoras al conocimiento base**: Si `CLAUDE.md` está desactualizado, falta una regla o hay algo ambiguo, señalarlo proactivamente. No esperar a que el usuario lo note.
