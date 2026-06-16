# ContaFlow — Agent Guide
## 🚀 INICIO DE SESIÓN — Leer primero

1. `.claude/memory/decision-tree.md` → identifica tu árbol antes de escribir código
2. `contaflow-context-v3.md` → solo el bloque **Estado Activo** (primeras ~60 líneas)
3. Según el árbol → leer skills relevantes en `.claude/memory/skills-discovered.md`

No leer nada más hasta que el árbol lo indique.

**Knowledge base adicional:**
- `.claude/ontologia/ontologia-v8-indice.md` — catálogo de cuentas, matrices, reglas VEN-NIF
- `.claude/ontologia/quick-reference.md` — tabla rápida copy-paste
- `.claude/adr/` — todas las decisiones de arquitectura
- `DECISIONS.md` — decisiones de dependencias y configuración (exceljs, Neon pool, advisory locks)

---

## ⚡ Quick Reference — Decisiones frecuentes

| Pregunta | Respuesta |
|---|---|
| ¿`number` para dinero? | **NUNCA** → `Decimal.js` siempre |
| ¿Dónde va el IGTF? | `PaymentRecord` en `recordPaymentAction` (Sección 32). Regla: `currency !== VES && isSpecialContributor` |
| ¿Cuándo usar `Serializable`? | Correlativos, cierre de período, INPC. Dudas → `Read Committed + @@unique` |
| ¿Cómo ajustar período cerrado? | ADR-015 → asiento en mes ACTUAL con FK al período original |
| ¿Dónde van IP/UserAgent en auditoría? | `AuditLog.ipAddress` + `AuditLog.userAgent` (R-6) |
| ¿SENIAT caído al emitir factura? | `SeniatSubmission` queda `PENDING` → QStash reintenta con backoff |
| ¿Cold start Neon congela UI? | `disabled={isPending}` + `aria-busy` en botones fiscales. Ver `DECISIONS.md` |
| ¿P2002 en correlativo al reintentar? | `isPrismaError(e, "P2002") && meta.target.includes("controlNumber")` → "Error transitorio — intenta de nuevo." |
| ¿`prisma migrate dev`? | **ROTO** → usar workflow manual (ver Prisma / DB) |
| ¿Errores Prisma al cliente? | Nunca raw. `P2002` → "Ya existe…" \| `P2003` → "Datos de referencia inválidos" |
| ¿Zod 4 mensajes? | `{ error: "msg" }` — **NO** `{ errorMap: ... }` |
| ¿`useTransition` vs `useActionState`? | `useTransition` para forms con Zod tipado (nuestro caso). `useActionState` solo para forms simples sin Zod |
| ¿`useReverification` destructuring? | **NO array** → `const fn = useReverification(action)` (no `const [fn] = ...`) — @clerk/shared@4.12.2 |
| ¿Sesiones con actividad (IP/device)? | `useUser().user.getSessions()` → `SessionWithActivitiesResource[]` (latestActivity + revoke). NO useSessionList |
| ¿Step-up config centralizado? | `src/lib/step-up.ts` — STEP_UP_CONFIG + reverificationError + StepUpError |
| ¿Tests con step-up actions? | Agregar `has: () => true` al mock de auth() + `if ('clerk_error' in result) throw` antes de `expect(result.success)` |

---

## 🚨 Zonas de Peligro — Modo Paranoico

Cuando toques estos módulos, máxima atención. Un error aquí tiene impacto fiscal o legal directo.

### Z-1: Correlativos de documentos fiscales
**Archivos:** `ControlNumberSequence`, `RetentionSequence`, `getNextControlNumber`, `getNextVoucherNumber`
- `Serializable` obligatorio — sin excepción
- Un correlativo duplicado es una infracción SENIAT
- Capturar P2002 en `@@unique([companyId, invoiceType])` con mensaje de negocio
- Ver `DECISIONS.md → Advisory locks` antes de proponer cambios de isolation level

### Z-2: Cálculo de impuestos (IVA / ISLR / IGTF)
**Archivos:** `InvoiceTaxLine`, `FiscalCalculator`, `DeclaracionIVAService`, `recordPaymentAction`
- `Decimal.js` absoluto — `number * 0.16` es un bug garantizado
- IGTF solo si `currency !== VES` AND `isSpecialContributor` — Fix A5 (auditoría 2026-06). Ver `IGTFService.applies`
- Alícuotas IVA hardcoded en enums: 16% / 8% / 31% (16+15) / 0%
- `luxuryGroupId` linkea `IVA_ADICIONAL` ↔ `IVA_GENERAL` — no romper esta relación

### Z-3: Cierre de períodos contables
**Archivos:** `AccountingPeriod`, `FiscalYearClose`, `PeriodSnapshot`
- Período `CLOSED` → ERROR 403 inmediato en cualquier mutación
- Excepción única: ADR-015
- `FiscalYearClose` e `INPCService` permanecen en `Serializable` siempre

### Z-4: Transmisión al SENIAT
**Archivos:** `SeniatReportingService`, `/api/webhooks/seniat-report`, `SeniatSubmission`
- Verificar idempotencia `status IN [SENT, ACKNOWLEDGED]` antes de procesar
- Comentar explícitamente: `// Idempotencia PA-121: descarta reintentos duplicados de QStash`
- Validar firma QStash antes de procesar cualquier payload
- `SeniatSubmission` en mismo `$transaction` que la factura/NC/ND (R-6)

### Z-5: Certificados digitales (Fase 35I)
**Archivos:** `CompanyCertificate`, `CertificateService`, `DocumentSigningService`
- `encryptedP12` nunca en ningún SELECT al cliente — `select` explícito siempre
- `buf.fill(0)` post-descifrado en `DocumentSigningService` — nunca omitir
- `CERT_ENCRYPTION_SECRET` nunca en logs ni respuestas

---

## Reglas Inviolables

### R-1: Separación de Libros
**Nunca mezcles Libro Diario con Libro Mayor.**
- Libro Diario = `Transaction` (operación original)
- Libro Mayor = `JournalEntry` (líneas débito/crédito)
- `Transaction` sin `JournalEntry` → documenta en ADR.

### R-2: Blindaje Fiscal
**Todo reporte fiscal:**
- Contenido → Object Storage (S3/R2/Vercel Blob), NO a la BD
- Solo metadatos + `contentHash` (SHA256) en BD
- Background job genera el reporte, no Server Action
- Sin hash en producción = roto.

### R-3: Bloqueo de Períodos Cerrados
**Período `CLOSED` → ERROR 403 inmediato.** Excepción única: ADR-015.

### R-4: Crítica Honesta
Si el código viola la Ontología → señalarlo. Si hay gap → ADR nuevo. No callar problemas.

### R-5: Cero Flotantes (CRÍTICO)
**NUNCA `number` para dinero. SIEMPRE `Decimal.js`.**
```typescript
// ❌ PROHIBIDO
const iva: number = base * 0.16;
// ✅ OBLIGATORIO
const iva = base.multipliedBy(new Decimal('0.16'));
```

### R-6: Trazabilidad de Red (PA 121 — CRÍTICO)
**Toda mutación financiera o fiscal DEBE:**
- Capturar `ipAddress` + `userAgent` en `AuditLog`
- Crear `SeniatSubmission` en el mismo `$transaction` para facturas/NC/ND
- IP: `req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip')`

### R-7: Versión Certificada SENIAT
**NUNCA modificar `CERTIFIED_VERSION` en `src/lib/version.ts` sin:**
1. Nueva solicitud de homologación ante el SENIAT (PA 121, Art. 9)
2. Autorización recibida del SENIAT
3. Expediente actualizado

Cambiar este valor sin el proceso es una infracción a la PA 121.

---

## Checklist Pre-Merge

```
SCOPE Y WORKING TREE (verificar PRIMERO — si falla, no continuar)
[ ] git status → solo archivos del task actual (sin M ni ?? ajenos)
[ ] npx tsc --noEmit → exit 0
[ ] npx vitest run → 0 failures
[ ] Todos los archivos nuevos están commiteados (no hay ?? en git status)

INVARIANTES
[ ] R-1: ¿Separación Transaction / JournalEntry respetada?
[ ] R-2: ¿Reportes fiscales a Object Storage con contentHash?
[ ] R-3: ¿Períodos CLOSED bloqueados (403)?
[ ] R-5: ¿CERO number nativo en variables de dinero?
[ ] R-6: ¿ipAddress/userAgent en AuditLog? ¿SeniatSubmission en mismo $transaction?
[ ] R-7: ¿CERTIFIED_VERSION sin modificar (o proceso SENIAT cumplido)?

CALIDAD
[ ] tsc --noEmit = 0 errores
[ ] npx vitest run = 0 fallos
[ ] AuditLog en mismo $transaction que la mutación principal
[ ] ADR nuevo si hay decisión arquitectónica no documentada

ZONAS DE PELIGRO (solo si aplica al cambio)
[ ] Z-1: ¿Correlativos con Serializable + P2002 capturado con mensaje de negocio?
[ ] Z-2: ¿Cálculo de impuestos con Decimal.js + alícuotas correctas?
[ ] Z-3: ¿Cierre de período con Serializable?
[ ] Z-4: ¿Idempotencia en webhook SENIAT comentada explícitamente?
[ ] Z-5: ¿encryptedP12 excluido de SELECTs? ¿buf.fill(0) post-descifrado?

UX / ROBUSTEZ
[ ] ¿Botones fiscales con disabled={isPending} + aria-busy? (guard doble-submit)
[ ] ¿Footer del dashboard muestra CERTIFIED_VERSION_LABEL?
```

---

## Stack

```
Next.js 16 App Router | Prisma 7.4.1 + @prisma/adapter-neon (WebSocket) | Neon serverless
Clerk | Zod 4 | Vitest 4 | Decimal.js | @upstash/ratelimit | @sentry/nextjs
```

## Prisma / DB

- `src/lib/prisma.ts`: singleton `PrismaNeon` (WebSocket) con `@neondatabase/serverless` y `DATABASE_URL` (pooled)
- Migrations: `DATABASE_URL_DIRECT` en `prisma.config.ts`
- Después de `prisma generate` → SIEMPRE reiniciar `npm run dev`
- **`prisma migrate dev` ESTÁ ROTO** → workflow obligatorio:
  1. Crear `prisma/migrations/YYYYMMDD_nombre/migration.sql` manualmente
  2. `npx prisma db execute --file prisma/migrations/YYYYMMDD_nombre/migration.sql`
  3. `npx prisma migrate resolve --applied YYYYMMDD_nombre`
  4. `npx prisma generate`

## Module structure

```
src/modules/[name]/{schemas,services,actions,components,__tests__}/
```

## Accounting rules — resumen

- NEVER `float` → `Decimal.js`
- NEVER `DELETE` en asientos → `VOID`
- `$transaction` obligatorio en toda mutación financiera
- `Serializable` para: correlativos, cierre de período, INPC
- `onDelete: Restrict` en todas las tablas contables
- `AuditLog` dentro del mismo `$transaction`

## Fiscal VEN-NIF

- IVA: General 16% | Reducido 8% | Adicional Lujo 15% (total 31%) | Exento 0%
- `luxuryGroupId` linkea `IVA_ADICIONAL` ↔ `IVA_GENERAL` en `InvoiceTaxLine`
- IGTF 3%: si `currency !== VES` OR (`isSpecialContributor` AND `currency === VES`)
- Retenciones IVA: 75%/100% — solo si `isSpecialContributor`
- Retenciones ISLR Decreto 1808: tasas variables por tipo de pago
- RIF regex: `/^[JVEGCP]-\d{8}-?\d?$/i`

## Rate Limiting

- `limiters.fiscal` (30/min) + `limiters.ocr` (10/min) — Upstash sliding window
- Sin `UPSTASH_REDIS_REST_URL` → no-op. Redis falla en runtime → silencioso, permite
- Mock: `vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), limiters: { fiscal: {}, ocr: {} } }))`

## Vitest 4

- Environment global: `node`
- React components: `// @vitest-environment jsdom` en la PRIMERA línea
- `environmentMatchGlobs` NO EXISTE en Vitest 4 — prohibido
- Mock: `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`
- `vi.hoisted()` para variables antes de `vi.mock()`
- Mockear en Action tests: `next/cache`, `@clerk/nextjs/server`
- `$transaction` mock: `vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({ modelo: prisma.modelo, auditLog: prisma.auditLog })) as never)`

---

## Phase gate — OBLIGATORIO antes de cada transición de fase

0. Activar `security-agent` para auditar superficie de ataque del módulo nuevo.
1. `npx tsc --noEmit` → exit 0.
2. `npx vitest run` → 0 failures.
3. `git status` → working tree limpio (sin `M` ni `??` ajenos al task).
4. Si falla cualquiera: parar, corregir, re-ejecutar, reportar antes de mencionar siguiente fase.

**Nunca cargar errores TS, tests fallidos, o working tree sucio entre fases.**

### security-agent — triggers OBLIGATORIOS

- Nueva Server Action o modificación de existente
- Nuevo modelo Prisma o campo con datos sensibles
- Nueva ruta de API o endpoint
- Cambio en autenticación, autorización o roles
- Nuevo campo de entrada del usuario → DB
- Cambio en `companyId` guards o aislamiento multi-tenant

**No requiere:** exportaciones client-side, fixes TS, UI visual, docs, tests.

---

## Git workflow

- Nueva fase → `git checkout -b feat/fase-XX-description` antes de código
- Merge a `main` solo: phase gate GREEN + confirmación del usuario
- Docs pueden ir directo a `main`
- Nunca feature code directo a `main`

### Regla de aislamiento de scope — OBLIGATORIA

**Antes de todo commit o merge, sin excepción:**

```
1. git status   → solo deben aparecer los archivos del task actual
2. npx tsc --noEmit → exit 0
3. npx vitest run   → 0 failures
4. git diff HEAD    → revisar que no hay cambios en archivos fuera del scope
```

**Prohibido:**
- Modificar archivos fuera del scope del task actual (ej: si el task es invoices, no tocar prisma.ts, error.tsx, vendor.actions.ts, etc.)
- Dejar cambios sin commitear en el working tree al terminar un task
- Crear archivos nuevos y no commitearlos (archivos `??` en `git status`)
- Hacer merge si `git status` muestra modificaciones ajenas al task

**Si un archivo fuera del scope "necesita" cambio:** abrir un task separado, en branch separada, con su propio tsc+vitest verde antes de mergear. Nunca agrupar en el mismo commit.

---

## Principles

- **DDD**: bounded contexts. `TransactionService` nunca importa de `InvoiceService`.
- **DRY**: tasas ISLR en una sola const. Lógica fiscal en `FiscalCalculator`.
- **SOLID-S**: `validateDoubleEntry()` separado de `persistTransaction()`.
- **SOLID-O**: nueva alícuota = nuevo enum entry. Sin tocar servicios existentes.
- **YAGNI**: no implementar Colombia/DIAN hasta contrato firmado en `contaflow-contract.md`.
- **KISS**: si cabe en una línea Zod, no crear clase validadora.

---

## Current status

- Phase 12A ✅ | 12B ✅ | 13C ✅ | 14 ✅ | 14B ✅ | 15 ✅ | 16 ✅ | 17 ✅ | 17B ✅
- Fase 13D ✅ | 18 ✅ | 14C ✅ | 19A ✅ | 19B ✅ | 19 ✅ | 19C ✅ | 14D ✅ | 12C ✅
- Fase OCR-v2 ✅ | 20 ✅ | 21 ✅ | 22 ✅ | 23B ✅ | 28A/B/C ✅ | 28D ✅ | 28E/F ✅
- Fase 31 ✅ | 28G ✅ | 33 ✅ | 32 ✅ | 23C Residual ✅ | 28H ✅ | 28 ✅
- Fase NOM-A ✅ | NOM-B ✅ | NOM-C ✅ | NOM-D ✅ | NOM-E ✅
- Fase 35A ✅ | 26B ✅ | 26 ✅ | 26B Parte 2 ✅ | Mejora #22 ✅ | 35E ✅
- Security hardening ✅ | Bloque A refactor ✅
- **Fase 35H** ✅ merged (PA-121: AuditLog IP/UA + rol SENIAT + SeniatSubmission + QStash + ADR-019 — 1531 tests)
- **Fase 35I** ✅ merged (Firma Digital Híbrida — CertificateService + DocumentSigningService + ADR-020 — 1562 tests)
- **Fase 35F** ✅ merged (UoM múltiples — ADR-018 — 1628 tests)
- **Fase 35G** ✅ merged (Lot/Serial Tracking — InventoryLot/Serial/LotAllocation + UI modal ACCOUNTING + ADR-021 — 1673 tests)
- **Fase 36C** ✅ merged (Distribución de Pagos A/P — PaymentBatch + ADR-022 — 1727 tests)
- **Fase 37A** ✅ merged (InvoiceLine + IvaLineRate + CompanySettings + StockControlLevel + InvoiceLineService — ADR-024 D-1/D-2)
- **Fase 37B** ✅ merged (Expense + ExpenseCategory + ExpenseService + ExpenseActions + seed onboarding — ADR-024 D-3)
- **Fase 37C** ✅ merged (convertOrderToInvoice propaga OrderItems → InvoiceLines — ADR-024 D-1/D-2 — 1806 tests)
- **Fase permisos-granulares** ✅ merged (RolePermission + APP_MODULES + PermissionsMatrix UI + nav grant-aware + ADR-025 — 1819 tests)
- **Sprint UX Grupo 3** ✅ (código + grupos en Clientes/Proveedores — ADR-028 — código libre, sin auto-gen)
- **Sprint UX Fixes** ✅ (InvoiceBook: MoneyBadge en Ret./IGTF/TOTALES sticky; Transactions: formatAmount Débito)

- **Auditoría SENIAT Inventario** ✅ merged (R-01/02/03/04/05/06/09/10/12 + H-03 — ItemType + contrapartida + períodos + link asiento — 1944 tests)
- **GAP-02/03/06 + RF-01/02/05/06** ✅ merged (órdenes vencidas + GL split retención IVA 2205/2110 + firma CPC demo + ENTRADA inventario compras + enteramiento retenciones + fecha TESA-007 + cuentas corrección monetaria — 1949 tests)
- **OM-05/06/08** ✅ merged (período CLOSED bloquea facturas + alerta RETENCIONES_POR_ENTERAR dashboard + FK inventoryItemId en QuotationItem/OrderItem con validación cross-tenant — 1959 tests)
- **OM-01 + OM-04** ✅ merged (inventario perpetuo auto-COGS: SALIDA Dr COGS/Cr Inventario CPP + ENTRADA reutiliza GL factura; AuditLog PDF firmado A4 landscape + SHA-256 R-2 + degradación graceful sin cert — 1967 tests)
- **PC-03 + PC-05** ✅ merged (INVENTARIO_SIN_CUENTAS_GL: alerta dashboard ítems físicos sin cuenta GL; PC-05 ya cubierto por PERIODO_ABIERTO_VIEJO — 1970 tests)
- **P-1 (ADR-025)** ✅ merged (hasModuleAccess — grants granulares en invoice/transaction/fiscal-close/payroll/retention actions — 1983 tests)
- **P-6** ✅ merged (SubmitButton + aria-busy en 13 formularios alto riesgo — sin tests nuevos)
- **Q2-3** ✅ merged (2FA step-up: cierre ejercicio + eliminar miembro + datos SENIAT + archivar empresa — STEP_UP_CONFIG centralizado en step-up.ts — useReverification sin array destructuring)
- **Q2-4** ✅ merged (ActiveSessionsPanel: user.getSessions() → SessionWithActivitiesResource → revoke() — en settings page)
- **P-7** ✅ merged (GET /api/health — db + redis + qstash, ruta pública, force-dynamic)
- **P-4** ✅ merged (Sentry.startSpan en 5 operaciones críticas: correlativo, GL posting, cierre ejercicio, apropiación, nómina, SENIAT transmit)
- **P-8** ✅ merged (RUNBOOK.md — PITR Neon, PDF recovery, checklist mensual, RTO<4h / RPO<1h)
- **P-3** ✅ merged (ThemeProvider + ThemeToggle — dark mode cicla light/dark/system — localStorage cf-theme + prefers-color-scheme)
- **Q1-3** ✅ merged (useFormDraft hook — sessionStorage autosave 30s + AlertDialog restore en InvoiceForm)
- **Q1-4** ✅ merged (ExportService portabilidad — employees/payrollRuns/inventoryItems/expenses + allHistory flag)

**Sprint Cegid** ✅ (4 features contra Cegid):
- **Modo Gerencial** ✅ (OWNER/ADMIN toggle sidebar simplificado — cookie cf-view-mode — ViewModeToggle — buildGerenteNav)
- **SENIAT badge** ✅ (seniatStatus en InvoiceBookRow — badge PENDING/SENT/FAILED en Libro de Ventas)
- **Portal Empleado** ✅ (ya existía — /employee/[token] — JWT — EmployeePortalTokenButton — employee-portal-jwt.ts)
- **Portal Cliente** ✅ (CxC pendiente + historial pagos — /client-portal/[token] — ClientPortalTokenButton — 8 tests)
- **WCAG AA** ✅ (focus-visible:ring en sidebar/topbar/ViewModeToggle — contraste "Pronto" text-zinc-400→text-zinc-600)

**Auditoría GL pagos (Riesgo-6 + Riesgo-9)** ✅ merged (TransactionType COBRO/PAGO + IVA Ret x Cobrar GL + ivaRetentionReceivableAccountId — 2049 tests)

**Q3-1 Gestión Documental** ✅ merged (vista unificada facturas+retenciones + PDF on-demand + JWT share links 7d + /api/doc/[token] público + AuditLog DOC_SHARED + nav "Documentos" — 2063 tests)

**Q3-2 CRM básico** ✅ merged (ContactCategory LEAD/REGULAR/VIP + notas + ContactNote historial interacciones + CLIENTES_INACTIVOS dashboard — 2086 tests)

**Q3-3 Presupuestos y Proyecciones** ✅ merged (Budget+BudgetLine+BudgetStatus + BudgetService compareWithActual + CashFlowProjectionService 4 buckets + budget.actions + BudgetList/Detail/CashFlowWidget + /budgets page + WalletCardsIcon nav — 2110 tests)

**Q3-4 Mobile-First** ✅ merged (sidebar w-14 sm:w-58 + dashboard responsive 390px grid cols-2 + ManagerApprovalInbox + PendingTasksWidget min-h-[52px] WCAG 2.5.8 tap targets — 2110 tests)

**Q3-5 Arquitectura Multi-País** ✅ merged (tax-config.ts FiscalConfig/TaxRates/CountryCode + fiscal-provider.ts VenezuelaFiscalProvider + FiscalProviderFactory + fiscal-validators re-exports + Company.country migration — 2137 tests)

**Q3-6 Keyboard Navigation** ✅ merged (useGlobalShortcuts hook + isTypingTarget document.activeElement + N→nueva factura + Ctrl+S→submit form + InvoiceForm aria-busy+aria-keyshortcuts + TopbarInner pill button — 2153 tests)

**Q2-1 AI Asistente como feature central** ✅ merged (/ai-assistant/page.tsx enriquecida: header+badges+banner crítico+capability chips+chat full-height; FloatingAIAssistant: pulse animate-ping en crítico + callout primera visita localStorage cf-ai-tip-shown — 2153 tests)

**Q2-5 Daltonismo badges stock** ✅ merged (WCAG 1.4.1: XCircleIcon+CheckCircle2Icon en InventoryReportsView Estado col + KPI Bajo stock; XCircleIcon+CheckCircle2Icon en InventoryValuation KPI Stock agotado — 2153 tests)

**Sprint Activos Fijos — Auditoría N1-N6** ✅ merged (2026-05-28):
- **N1** Art. 66 LIVA — reintegro IVA crédito fiscal en baja anticipada (<36 meses): `DisposeAssetModal` calcula `costo×16%×(36-meses)/36`, GL Dr Gasto IVA / Cr IVA CF, checkbox opt-out
- **N2** Moneda de adquisición + tasa BCV histórica: `acquisitionCurrency` + `bcvRateAtAcquisition` en schema + badge azul en tabla + serialización page.tsx
- **N3** Historial persistente reajustes INPC: `FixedAssetINPCRestatement` @@unique([assetId,year,month]) + `getFixedAssetINPCHistoryAction` + modal por activo
- **N4** Integración Compras → Activos Fijos: `getExpensesForAssetImportAction` (últimos 50 CONFIRMED + vendor.rif) + sección "Importar desde Gasto" en `FixedAssetForm` pre-llena 6 campos
- **N5** Advertencia salto de período: `minGapPeriod` useMemo detecta brecha → alerta ámbar en panel depreciación
- **N6** Factor INPC columna visible: columna "Factor INPC" con badge emerald ×factor en tabla activos
- FA-5 F3: advertencia deductibilidad SENIAT (Art. 76 LISLR) si faltan facturaNumber+providerRif — 2191 tests

**Fase 39** ✅ merged (DigitalInvoiceProvider PA-102 — ADR-031): interfaz neutral `DigitalInvoiceProvider` + `DigitalInvoiceFactory` + HKADigitalInvoiceProvider STUB (mapeo estimado, pendiente docs oficiales HKA) + MockDigitalInvoiceProvider + NullDigitalInvoiceProvider — 2191 tests

**ALERTA 12 + A8/10/11 fixes** ✅ merged: duplicar factura (sessionStorage DUPLICATE_SESSION_KEY) + RIF autocomplete debounced (searchContactsByRifAction, badge PROV/CLI) + importación masiva CSV (InvoiceBatchImportDialog 3 pasos + importInvoiceBatchAction Decimal.js R-5) + A8 GL account validation física + ALERTA10 stockWarnings propagation + ALERTA11 CPP banner + IVA retenciones enteradas-only — 2236 tests

**ALERTA 13/14/15/16** ✅ merged: GeminiOCRService detecta RIF y N° Control con formato inválido post-extracción → `_fieldRisks` severity="critical"; InvoiceUploader muestra badge rojo por campo + checkbox obligatorio de verificación antes de usar datos; banner ámbar en InvoiceForm cuando OCR cargó con riesgos críticos; aviso de privacidad Gemini dismissable (localStorage cf-ocr-privacy-ack, COT Art. 126) — 2263 tests

**ALERTA 17/18/19/20** ✅ merged: findInvoiceByNumberAction retorna isVendorSpecialContributor (ALERTA 17) + hasLinkedRetention (ALERTA 19); RetentionForm alerta CE Prov.0049 + badge "Ya tiene retención" + guía 75%/100% (ALERTA 18); createRetentionAction valida invoiceDate dentro de período OPEN + getActivePeriodAction; RetentionForm muestra período activo + borde ámbar si fecha fuera (ALERTA 20) — 2273 tests

**ALERTA 18/20 fixes** ✅ merged: createRetentionAction valida taxBase vs InvoiceTaxLine.base (error si excede en >1 Bs, tolerancia redondeo, permite si factura no está en BD); RetentionForm INCES auto-activación vía INCES_AUTO_CODES (SERVICIOS/CONSTRUCCION/HONORARIOS/COMISIONES) + badge "Auto" + nota Ley INCES Art. 14 — 2276 tests

**Auditoría Forense H-1→H-15** ✅ merged (2026-06-01): H-9/H-12/H-14/H-8/H-6/H-7/H-13/H-15 — RetentionReconciliation + IGTF GL + N°Control único + comprobante IVA + COGS convert-order — 2329 tests

**Auditoría Nómina Partes IV/V/VI** ✅ merged (2026-06-02): campos Forma 14-02 IVSS (C-06/C-07: ivssNumber/payrollWorkerType/maritalStatus/dependents) + probation countdown F-06 + ApproveDialog U-02 + AuditLog payloads enriquecidos (retroactive, salario integral, Gaceta) + 9 cuentas GL en PayrollWizard Step 3 (expenseAccountId/payableAccountId/IVSS/FAOV/INCES/patronales) — 2329 tests

**Auditoría Nómina Parte VII — Automatizaciones** ✅ merged (2026-06-02): 4 alertas en PendingTasksWidget (NOM_SALARIO_MINIMO_VENCIDO / NOM_PRESTACIONES_POR_ACUMULAR / NOM_INTERESES_BCV_PENDIENTES / NOM_PRUEBA_POR_VENCER) + AccrueQuarterForm badge acumulado/pendiente + BcvRateForm indicador meses faltantes — 2336 tests

**Sprint Softnetcorp F4/F5/F7/F8/F9/F10** ✅ merged (2026-06-05): SEMANAL en PayrollFrequency + VacationRequest model (PENDING/APPROVED/REJECTED/CANCELLED) + balance LOTTT Art.190 acumulado + flujo aprobación manager + EmployeeHistoricalImportDialog (días vacaciones + prestaciones) + payslip email fire-and-forget post-aprobación + ManagerApprovalInbox vacaciones pendientes + /payroll/vacation-requests page — 2359 tests

**Fase P** ✅ merged (2026-06-15): ScopeProfile enum (SOLO/EMPRESA/DESPACHO) + Company.scopeProfile nullable + NewCompanyForm selector de perfil + updateScopeProfileAction + /activate-modules page + nav progressive disclosure (Nómina/Inventario locked en SOLO) + banner onboarding si scopeProfile==null (ADR-033) — 2782 tests

**Tanda A landing** ✅ merged (top-banner urgencia + precio tachado plan anual + CTAs intermedios + ROI anchor)

**Tanda C landing** ✅ merged (BotRecomendador wizard inline — 3 tarjetas SOLO/EMPRESA/DESPACHO + panel animado + cookie cf-pending-profile 30min → /sign-up?profile=X + pre-fill NewCompanyForm — ADR-033 — 2782 tests)

**Fase Despacho (ADR-034)** ✅ merged (2026-06-15): ManagedClient + DespachoTier enum + Subscription.despachoTier + DespachoService (canAddManagedClient/addManagedClient/archiveManagedClient/listManagedClients/upgradeDespachoTier) + guards R-6/ADR-004/VEN_RIF_REGEX + DespachoRifList/AddRifModal/DespachoTierCard/DespachoOnboardingBanner + /despacho/rifs page + nav progressive disclosure scopeProfile=DESPACHO — 2803 tests.

**Fase Despacho — flujo de pago** ✅ merged (2026-06-15): /despacho/upgrade page + DespachoUpgradeFlow + upgradeDespachoTierAction (OWNER only) + upgradeDespachoTier refactor (upsert Subscription "todo incluido" + AuditLog R-6 + successUrl/cancelUrl) + handleIPN aplica despachoTier desde metadata al confirmar pago. Auditoría seguridad ADR-034 §6.3: GO — 2805 tests.

**Precios definitivos lanzamiento** ✅ merged (2026-06-15): plan base + Despacho STARTER $119 (5 RIFs) · PRO $249 (25 RIFs) · UNLIMITED $359 (∞ RIFs) — Despacho incluye empresa propia. Sincronizados en BillingService, DespachoService.DESPACHO_TIER_PRICES_USD_CENTS, landing, sign-up, /upgrade page.

**Precio plan base POR PERFIL** ✅ merged (2026-06-16): el precio del plan base depende del `scopeProfile` (Individual y Empresa al mismo precio no tenía sentido). Individual (SOLO): $69 mensual / $59 anual, sin Early. Empresa (EMPRESA/null): $79 mensual / $65 anual / Early Adopter $59 año 1. `BillingService.getPlanPriceCents(scopeProfile, plan)` + `pricingProfileFor()` (SOLO→Individual; resto→Empresa, nunca cobra de menos) reemplazan `PLAN_PRICES_CENTS`. `createCheckout` lee `company.scopeProfile`; EARLY_ADOPTER lanza si SOLO. /upgrade page perfil-aware — 2807 tests.

**Landing launch-ready** ✅ merged (2026-06-15): Despacho activo en BotRecomendador/activate-modules/NewCompanyForm (quitado "Próximamente"/"Pronto") + footer/nav/mobile-nav auth-aware (SignOutLink con Clerk SignOutButton — "Ir al panel"+"Cerrar sesión" si hay sesión).

**2807 tests GREEN** | **0 TS errors** | **CI passing** (2026-06-16)

> Pendiente landing (no bloqueante): rediseño visual del Hero — el usuario lo quiere "más tecnológico/avanzado" (referencia: quickbooks.intuit.com). Actualmente plano. Tanda de diseño dedicada.

### middleware.ts

- Públicas: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/monitoring(.*)`, `/api/webhook/(.*)`
- Todo lo demás: `auth.protect()` → redirige a sign-in
- Post-lanzamiento: nonce CSP para eliminar `unsafe-inline`

## Roadmap — pre-lanzamiento (ADR-012)

**Backlog pre-lanzamiento COMPLETO** (2026-06-15).
Pendientes antes de LAUNCH:
1. `/despacho/upgrade` page — falta (DespachoTierCard ya linkea a ella; NOWPayments flow reutiliza ADR-032)
2. Fijar precios reales tier Despacho (reemplazar TODO en `DespachoService.DESPACHO_TIER_PRICES_USD_CENTS`)
3. Tanda B landing (testimonios) — DIFERIDA a post-Alpha (no hay testimonios reales aún)
4. Tanda D (checkout embebido) — DIFERIDA (spike post-Alpha)
5. **LAUNCH** 🚀

Fases 35B/35C/36A/36B diferidas a post-lanzamiento.

---

## Dinámica de trabajo

1. **Documentar en el momento**: patrón nuevo o decisión → `CLAUDE.md` / ADR / `quick-reference.md`. No en el chat.
2. **Contexto primero**: leer `CLAUDE.md` y archivos relevantes antes de proponer implementación.
3. **Feedback loop**: cada fase termina con `tsc` + `vitest` en verde. Nueva regla descubierta → documentar antes de continuar.
