# ContaFlow — Contexto Completo del Proyecto

_Versión actualizada — Fase NOM-B completada. Última sincronización: 2026-04-15_
_v3.21: Fase NOM-B (Empleados, Conceptos, SalaryHistory — 5 modelos + 4 enums + 69 tests). 1098 tests GREEN._

## 1. Descripción del Producto

App contable web multiempresa llamada **ContaFlow**. Objetivo: competir en robustez, seguridad y cumplimiento legal con líderes como Gálac y CG1. Mercado objetivo: Venezuela y Latinoamérica (VEN-NIF). Escalabilidad futura hacia Colombia (DIAN). Repositorio: https://github.com/GustavoAU/modern-cg1

## 2. Roles del Asistente

1. **Arquitecto de Software** — decisiones de estructura y escalabilidad
2. **Desarrollador Senior** — código de calidad profesional
3. **Tutor Técnico** — explicar cada librería y decisión
4. **Consultor de Producto** — honestidad sobre lo vendible
5. **Experto Contable-Auditor** — rigor contable, inmutabilidad, partida doble, VEN-NIF
6. **Ingeniero de UI/UX Senior** — interfaces intuitivas, responsivas y accesibles. Foco en eficiencia del flujo del contador (minimizar clics y fatiga visual), legibilidad de datos numéricos (mínimo 14px), consistencia visual y prevención de errores a través del diseño
7. **Ingeniero de Seguridad y Oficial de Cumplimiento Legal/Fiscal VEN-NIF** — vigilar seguridad de datos sensibles (Clerk, Neon) y auditar profundamente la lógica fiscal (IVA por alícuotas, Retenciones IVA/ISLR, IGTF). Compliance legal absoluto. Corregir al usuario si da información fiscal incorrecta con fundamento legal

## 3. Prioridades No Negociables

1. **Optimización del Runtime**: índices eficientes, caché (Redis futuro), procesamiento asíncrono
2. **Pipeline CI/CD**: GitHub Actions — lint + vitest en cada push. NINGUNA fase se mergea sin tests
3. **Usabilidad y Diseño Profesional (UI/UX)**: legibilidad de datos numéricos, eficiencia en flujos, consistencia visual. Un mal diseño es un riesgo de producto
4. **Seguridad y Compliance Legal Riguroso**: auditoría continua de lógica fiscal y seguridad de datos. No se aprueba ninguna fase con dudas fiscales o riesgos de seguridad
5. **Escalabilidad**: arquitectura preparada para multipaís (Venezuela → Colombia → Latinoamérica)

## 4. Principios Técnicos

- DDD, SOLID-S, DRY, KISS, YAGNI
- Singleton (PrismaClient), Repository Pattern
- **NUNCA float para dinero** — siempre Decimal.js
- `prisma.$transaction` obligatorio en TODA mutación financiera — atomicidad ACID
- **Isolation level `Serializable` obligatorio** en operaciones que generan números correlativos (controlNumber, número de comprobante de retención) — previene race conditions
- Inmutabilidad total en asientos contables — nunca DELETE, siempre VOID
- Partida doble validada en múltiples capas
- `onDelete: Restrict` en JournalEntry y todas las tablas contables — nunca Cascade
- **AuditLog obligatorio** en toda mutation — quién, cuándo, qué cambió (oldValue/newValue). AuditLog debe ejecutarse dentro del mismo `$transaction` que la mutation principal
- `.safeParse()` obligatorio en todas las Server Actions
- Errores de Prisma mapeados a mensajes de negocio — nunca exponer errores crudos al frontend
- Archivos y carpetas: **inglés**. Contenido interno (UI, descripciones fiscales): español
- Autenticación verificada ANTES de cualquier lógica de negocio en Server Actions
- Rate limiting en Server Actions para prevenir abuso
- Input sanitization para prevenir XSS e inyección
- **Idempotencia en Actions de creación fiscal** — campo `idempotencyKey String? @unique` en Invoice, Retencion. La Action verifica existencia antes de crear
- **Soft delete en entidades con relevancia fiscal** — campo `deletedAt DateTime?` en Invoice, Retencion, IGTFTransaction, Account (Fase 13)

## 5. Stack Tecnológico

- **Frontend/Backend**: Next.js 16 (App Router), TypeScript, Tailwind CSS
- **Base de datos**: PostgreSQL (Neon serverless)
- **ORM**: Prisma 7.4.1
- **Auth**: Clerk
- **Validación**: Zod 4
- **Dinero**: Decimal.js
- **Tests**: Vitest 4
- **OCR**: Gemini Vision (GeminiOCRService — migrado en Fase 13C)
- **i18n**: next-intl (es/en)
- **CI/CD**: GitHub Actions
- **Monitoreo**: Sentry (`@sentry/nextjs` v10, DSN configurado)

## 6. Flujo Estándar Prisma

1. Modificar schema.prisma
2. `npx prisma migrate dev --name descripcion`
3. `npx prisma generate`
4. Ctrl+Shift+P → TypeScript: Restart TS Server
5. Reiniciar servidor `npm run dev` — SIEMPRE después de `prisma generate`

## 7. Schema Prisma — Estado Actual

```prisma
enum AccountType { ASSET LIABILITY EQUITY REVENUE EXPENSE }
enum CompanyStatus { ACTIVE ARCHIVED }
enum CompanyPlan { FREE PRO }
enum PeriodStatus { OPEN CLOSED }
enum UserRole { ADMIN ACCOUNTANT VIEWER }
enum TransactionStatus { POSTED VOIDED }
enum TransactionType { DIARIO APERTURA AJUSTE CIERRE }
enum RetentionType { IVA ISLR AMBAS }
enum RetentionStatus { PENDING ISSUED VOIDED }

enum InvoiceType {
  SALE
  PURCHASE
}

enum InvoiceDocType {
  FACTURA
  NOTA_DEBITO
  NOTA_CREDITO
  REPORTE_Z
  RESUMEN_VENTAS
  PLANILLA_IMPORTACION
  OTRO
}

enum TaxCategory {
  GRAVADA
  EXENTA
  EXONERADA
  NO_SUJETA
  IMPORTACION
}

enum TaxLineType {
  IVA_GENERAL
  IVA_REDUCIDO
  IVA_ADICIONAL
  EXENTO
}

model Company {
  id                     String               @id @default(cuid())
  name                   String
  rif                    String?              @unique
  address                String?
  status                 CompanyStatus        @default(ACTIVE)
  plan                   CompanyPlan          @default(FREE)
  isSpecialContributor   Boolean              @default(false)
  members                CompanyMember[]
  accounts               Account[]
  transactions           Transaction[]
  periods                AccountingPeriod[]
  retenciones            Retencion[]
  igtfTransactions       IGTFTransaction[]
  invoices               Invoice[]
  controlNumberSequences ControlNumberSequence[]
  retentionSequences     RetentionSequence[]   // ← añadido Fase 12B / 18.4
  createdAt              DateTime             @default(now())
  updatedAt              DateTime             @updatedAt
}

// Secuencia correlativa para números de control de facturas (00-XXXXXXXX)
model ControlNumberSequence {
  id          String      @id @default(cuid())
  companyId   String
  invoiceType InvoiceType
  lastNumber  Int         @default(0)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  company     Company     @relation(fields: [companyId], references: [id], onDelete: Restrict)
  @@unique([companyId, invoiceType])
  @@index([companyId])
}

// Secuencia correlativa para comprobantes de retención (CR-XXXXXXXX)
model RetentionSequence {
  id         String   @id @default(cuid())
  companyId  String   @unique
  company    Company  @relation(fields: [companyId], references: [id], onDelete: Restrict)
  lastNumber Int      @default(0)
  updatedAt  DateTime @updatedAt
}

model Retencion {
  // ... campos existentes ...
  voucherNumber    String?         // ← añadido Fase 12B / 18.4 — formato CR-XXXXXXXX
  invoiceId        String?
  invoice          Invoice?        @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  idempotencyKey   String          @unique
  deletedAt        DateTime?
  createdAt        DateTime        @default(now())
  createdBy        String
}

// ... resto del schema en prisma/schema.prisma del repositorio ...
```

_(Schema completo en prisma/schema.prisma del repositorio)_
**Migración aplicada**: `20260330021018_feat_18_4_retention_voucher_link`

## 8. Módulos Implementados

- `src/modules/accounts/` — Plan de Cuentas
- `src/modules/transactions/` — Asientos contables
- `src/modules/periods/` — Períodos contables
- `src/modules/retentions/` — Retenciones IVA/ISLR + Comprobantes de Retención PDF
- `src/modules/igtf/` — IGTF
- `src/modules/invoices/` — Libro de Compras y Ventas + PDF libro + PDF por factura individual
- `src/modules/reports/` — Estado de Resultados, Balance General
- `src/modules/import/` — Importación Plan de Cuentas (Excel/CSV)
- `src/modules/ocr/` — OCR híbrido
- `src/lib/fiscal-validators.ts` — VEN_RIF_REGEX canónico + validateVenezuelanRif()

## 9. Estructura de Módulo Estándar

```
src/modules/[nombre]/
  schemas/        ← Zod schemas
  services/       ← Lógica de negocio (sin dependencias Next.js)
  actions/        ← Server Actions (Next.js)
  components/     ← Componentes React del módulo
  __tests__/      ← Tests Vitest
```

## 10. Autenticación y Multiempresa

- Clerk para autenticación de usuarios
- `CompanyMember` como tabla pivote User ↔ Company con `UserRole`
- Verificación: `auth()` de Clerk → obtener `userId` → verificar membresía en `CompanyMember` → acceder a recursos de la empresa
- Cada Server Action verifica este flujo antes de cualquier lógica

## 11. Reglas de Tests

- Framework: **Vitest 4** — nunca Jest
- Para tests de servicios y actions: environment `node` (default en vitest.config.ts)
- Para tests de componentes React: `// @vitest-environment jsdom` en PRIMERA línea del archivo
- Mock Prisma: `vi.mocked(prisma.modelo.metodo).mockResolvedValue([] as never)`
- Variables antes de `vi.mock()`: usar `vi.hoisted()`
- Siempre mockear `next/cache`: `vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))`
- Siempre mockear Clerk en tests de Actions
- **REGLA FIJA**: ninguna fase se mergea sin todos los tests en verde

## 12. Rutas de la Aplicación

```
/ → Landing / Dashboard redirect
/dashboard → Dashboard principal
/company/new → Crear empresa
/company/[companyId]/dashboard → Dashboard empresa
/company/[companyId]/accounts → Plan de Cuentas
/company/[companyId]/transactions → Asientos Contables
/company/[companyId]/transactions/new → Nuevo Asiento
/company/[companyId]/periods → Períodos Contables
/company/[companyId]/retentions → Retenciones
/company/[companyId]/igtf → IGTF
/company/[companyId]/invoices → Libro de Compras y Ventas
/company/[companyId]/invoices/new → Nueva Factura
/company/[companyId]/reports/income-statement → Estado de Resultados
/company/[companyId]/reports/balance-sheet → Balance General
/company/[companyId]/invoices/upload → OCR Escanear Factura
/company/[companyId]/import → Índice importación
/company/[companyId]/import/accounts → Importar Plan de Cuentas
/company/[companyId]/settings → Configuración
/sign-in → Clerk SignIn
/sign-up → Clerk SignUp
```

## 13. OCR — Arquitectura Actual

- **Plan Free**: Tesseract.js (cliente) + Groq llama-3.1-8b-instant (servidor) → ~80% precisión
  - Datos no salen del stack propio — sin riesgo de privacidad
- **Plan Pro**: Gemini Vision directo — `GeminiOCRService.extractFromImage(base64, mimeType)`
  - Modelo: `gemini-2.5-flash-lite-preview` — imagen directa sin Tesseract
  - Tier gratuito (desarrollo): Google puede usar datos para entrenamiento
  - Tier pago (producción): datos privados, no se usan para entrenamiento
- `GEMINI_API_KEY` en `.env` — sin prefijo `NEXT_PUBLIC_` ni `VITE_` (corre en servidor)
- `GROQ_API_KEY` en `.env` — para Plan Free
- Rate limiter OCR: **12 req/min** (margen sobre límite gratuito Gemini de 15 RPM)
- Flujo nuevo Plan Pro: imagen → Gemini Vision (servidor) → JSON directo → `ExtractedInvoiceSchema`

### Deuda OCR-v2 (ver Fase OCR-v2 en roadmap)
- `ExtractedInvoiceSchema` sigue con campos en inglés (`supplierName`, `invoiceNumber`, etc.)
- Migración futura: renombrar a campos VEN-NIF + añadir `numeroControl`,
  `baseImponibleGeneral`, `ivaGeneral`, `ivaReducido`, `ivaAdicional` como Decimal
- Server Action OCR: actualizar para usar `extractFromImage(base64, mimeType)` en Plan Pro

## 14. Retenciones — Lógica Fiscal

- **IVA**: 75% estándar o 100% total del IVA facturado
- **ISLR Decreto 1808**: Servicios PJ 2%, Servicios PN 3%, Honorarios 5%, Arrendamiento 5%, Fletes 1%, Publicidad 3%
- `isSpecialContributor` en Company determina si retiene

## 15. IGTF — Lógica Fiscal

- Tasa: 3% sobre monto total
- Aplica cuando: pago en cualquier moneda extranjera (USD, EUR, u otra divisa) O empresa es Contribuyente Especial en VES
- NO aplica: VES sin Contribuyente Especial
- `IGTFService.applies(currency, isSpecialContributor)`

## 16. IVA — Alícuotas Vigentes Venezuela (Providencia 0071 SENIAT)

- **IVA General**: 16% sobre base imponible
- **IVA Reducido**: 8% (bienes de primera necesidad)
- **IVA Adicional (Lujo)**: 15% adicional → total 31% (16% General + 15% Adicional sobre misma base)
- El IVA Adicional se registra en el Libro como línea separada del IVA General
- Vinculación automática mediante `luxuryGroupId` en el componente `InvoiceForm`
- **EXENTO / EXONERADO**: 0% — se registra el monto base sin IVA
- Categorías EXENTA, EXONERADA, NO_SUJETA bloquean líneas con IVA > 0 (validación en submit)

## 17. Estado Actual — Branch main

**Branch activa**: `main`
**Tests**: 755/755 passing · **CI**: ✅ verde
**Último commit**: merge ADR-010 — testing tier + INPC guard + integration tests base

### Fases completadas (en orden cronológico)
- ✅ Fase 17: Conciliación Bancaria — hardening seguridad (commit `f110d93`)
- ✅ Fase 17B: BankReconciliationService + CsvImporter + ADR-008 schema 3-way match (commits `4f041f7` → `faf1972`)
- ✅ Fase 13D: RLS Row Level Security — withCompanyContext + 14 tablas (commit `0ada843`)
- ✅ Fase 18: Dashboard Analítico — 5 gráficos Recharts (commit `b468af2`)
- ✅ Fase 14C: Auto-fetch Tasa BCV — BcvFetchService + Cron diario + botón UI (commit `ee04693`)
- ✅ Fase 19A: Security Hardening ADR-006 — 8 CRITICALs + amount ceilings + role checks (commit `f0c8d5a`)
- ✅ Fase 19B: Security Residual — 4 HIGH findings corregidos + regression tests (commit `cb2d324`)
- ✅ Fase 19: Declaración Mensual IVA — Forma 30 SENIAT: DeclaracionIVAService + Forma30View + 23 tests
- ✅ Fase 19C: Forma 30 PDF export — Forma30PDFService + exportForma30PDFAction + 17 tests
- ✅ Fase 14D: Validación RIF SENIAT — validateRifAction + RifInput + limiters.rif + Redis cache 24h + 13 tests
- ✅ Fase 12C: Asistente ISLR — islr-suggestions.ts 60+ keywords Decreto 1808 + badge en RetentionForm + 23 tests
- ✅ Fase OCR-v2: Migración schema VEN-NIF + Gemini Vision directo + pre-fill InvoiceForm + /invoices/upload + 14 tests
- ✅ Fase 20: XML SENIAT descargable + QR code en PDF comprobante + botón XML en InvoiceBook + ADR-008 (commit `ae94c76`)
- ✅ Fase 21: Activos Fijos y Depreciación VEN-NIF 16 — 3 métodos + asiento automático — 35 tests (commit `4286496`)
- ✅ Fase 22: Ajuste por Inflación INPC VEN-NIF 3 — INPCRate + InflationAdjustment + Serializable — 32 tests (commit `2761770`)
- ✅ Fase 23B: Auto-conciliación bancaria — Gemini Vision PDF + scoring 3 fuentes + guard período vacío — 30 tests (commit `93fa23a`)
- ✅ ADR-010: Testing Strategy — phase gate step 0 security-agent + integration tier + INPC guard + ADR-011 OCR idempotencia
- ✅ Fase 23C: NC/ND Workflow — relatedInvoiceId + Serializable + 2 CRITICAL/3 HIGH resueltos — 24 tests (commit `258cafa`)

### 17.1 Deuda técnica resuelta

- ✅ Lint CI: InvoiceForm.tsx + JournalEntryForm.tsx — resueltos en `bf47b5f`
- ✅ Bugs Zelle: timeout + auto-cálculo VES + columna USD — resueltos en `5aa5a37`
- ✅ LL-010 regression test: `BankStatementService.test.ts` — 8 tests, addTransaction rollback atomicity
- ⏳ Sentry deprecation warning en `next.config.ts`: cambiar `disableLogger: true` por `webpack.treeshake.removeDebugLogging: true` (no urgente)

### 17.2 UI completada ✅

- `ReconciliationWorkbench.tsx` — 3 tabs implementados: INVOICE_PAYMENT / JOURNAL_ENTRY / PAYMENT_RECORD
- `matchBankTransactionAction` + `searchJournalEntriesAction` + `searchPaymentRecordsAction` — actions con tests (477 passing)

## 18. Fase 12B — ✅ COMPLETADA

**Branch mergeada a**: `main`

### 18.1 ✅ Número de Control Automático (Correlativo)

- `ControlNumberSequence` model — upsert atómico, formato `00-XXXXXXXX`
- `getNextControlNumber(tx, companyId, invoiceType)` — `$transaction Serializable` (SSI)
- Implementado en `InvoiceSequenceService.ts`

### 18.2 ✅ Exportación PDF — Librería @react-pdf/renderer v4.3.2

- `InvoiceBookPDFService.ts` — A3 landscape, Libro de Compras/Ventas completo
- `RetentionVoucherPDFService.ts` — A4 portrait, Comprobante de Retención
- Todos los servicios usan `React.createElement()` (sin JSX en `.ts`)
- Cast tipado: `element as Parameters<typeof renderToBuffer>[0]` — sin `any`

### 18.3 ✅ Efectos de Cascada en Categoría Fiscal

- `AlertDialog` confirmación al cambiar a EXENTA/EXONERADA/NO_SUJETA
- Reset automático de taxLines al confirmar
- `importFormNumber` obligatorio si `taxCategory === IMPORTACION`

### 18.4 ✅ Vinculación Retención ↔ Factura

**Schema añadido**:

- `voucherNumber String?` en `Retencion` — formato `CR-XXXXXXXX`
- Nuevo modelo `RetentionSequence` — secuencia correlativa por empresa
- Migración: `20260330021018_feat_18_4_retention_voucher_link`

**Implementado**:

- `getNextVoucherNumber(tx, companyId)` — `$transaction Serializable`, formato `CR-XXXXXXXX`
- `linkRetentionToInvoice()` — sincroniza `Invoice.ivaRetentionAmount/Voucher/Date` e `islrRetentionAmount` en el mismo `$transaction`
- `createRetentionAction` envuelto en `$transaction Serializable` — `voucherNumber` generado + `auditLog` dentro de la transacción (cumple regla CLAUDE.md)
- `findInvoiceByNumberAction()` — búsqueda por N° factura con `contains/insensitive`
- `RetentionForm.tsx` — reemplazado input UUID por búsqueda de factura + lista de resultados seleccionables
- Muestra `CR-XXXXXXXX` al guardar la retención

### 18.5 ✅ Comprobante PDF Individual por Factura

- `InvoiceVoucherPDFService.ts` — A4 portrait: encabezado empresa, contraparte, tabla de líneas fiscales, totales (Decimal.js), sección condicional retenciones/IGTF
- `InvoiceService.getById(invoiceId, companyId)` — con `include: { taxLines, company }`
- `exportInvoiceVoucherPDFAction()` — auth-gated, serializa campos Decimal
- `InvoiceBook.tsx` — botón "PDF" por fila (estado de carga individual por factura)

### 18.6 ✅ Validación RIF VEN-NIF

- `src/lib/fiscal-validators.ts` — fuente única: `VEN_RIF_REGEX = /^[JVEGCP]-\d{8}-?\d?$/i`
- `validateVenezuelanRif(rif)` — usada en `RetentionService.validateRif()`
- Aplicado en `invoice.schema.ts` y `retention.schema.ts` — sin duplicación
- Bug corregido en regex anterior (faltaba `C-` comunal, dígito verificador ahora opcional)

## 19. Roadmap Completo

- ✅ Fase 1: Autenticación + Routing
- ✅ Fase 2: Multiempresa
- ✅ Fase 3: Asientos contables
- ✅ Fase 4: Reportes (Libro Mayor + Balance de Comprobación)
- ✅ Fase 5: Período contable
- ✅ Fase 6: Dashboard + i18n + Onboarding + Gestión de empresas
- ✅ Fase 7: OCR híbrido (Tesseract + Groq)
- ✅ Fase 8: Importación de Plan de Cuentas (Excel/CSV)
- ✅ Fase 9: Estado de Resultados + Balance General
- ✅ CI/CD: GitHub Actions — reforzado con tsc, coverage v8 (thresholds realistas, excl. PDFServices), security audit job
- ✅ Fase 10: Contribuyentes Especiales + Retenciones IVA/ISLR
- ✅ Fase 11: IGTF — Impuesto a las Grandes Transacciones Financieras
- ✅ Fase 12A: Libro de Compras y Ventas — modelo dinámico InvoiceTaxLine, alícuotas VEN-NIF, exportación Excel
- ✅ Fase 12B: Ver sección 18 para desglose completo — completada 2026-03-30
- ✅ Fase 13: Hardening de Seguridad y Robustez — completada 2026-03-30
  - ✅ AuditLog activo en todas las mutations (dentro del mismo $transaction)
  - ✅ Validación Zod: formato RIF `/^[JVEGCP]-\d{8}-?\d?$/i`, códigos de cuenta `/^\d+([.\-]\d+)*$/`
  - ✅ Idempotencia en Actions de creación fiscal (`idempotencyKey` + fast-path + P2002 handler)
  - ✅ Soft delete en entidades fiscales (`deletedAt DateTime?` en Invoice, Account)
  - ✅ Decisión arquitectónica: `useTransition` es el patrón correcto para forms con Zod tipado (no `useActionState`)
- ✅ Fase 13B: Infraestructura de Producción — completada 2026-03-30
  - ✅ Rate limiting con Upstash Redis (`@upstash/ratelimit`): fiscal 30/min, OCR 10/min — `src/lib/ratelimit.ts`
  - ✅ Sentry (`@sentry/nextjs` v10): client/server/edge configs, `instrumentation.ts`, `withSentryConfig` en `next.config.ts`
  - ⏳ Row Level Security (RLS) en Neon — **planificado como Fase 13D** (SET LOCAL + role authenticated — ver ADR-007)
  - ⏳ Redis caché para reportes pesados (Upstash disponible — implementar en Fase 18 Dashboard)
- ✅ Fase 13C: Producción Real — Escalabilidad Crítica — completada 2026-04-05
   BLOQUE 1 ✅ Completado 2026-04-04 — Seguridad multi-tenant:
   - 3 CRITICOs ADR-004 detectados y resueltos (account.actions, retention.actions x2)
   - Test arquitectural `company-isolation.test.ts` implementado y en verde
   - `KNOWN_CRITICAL_FINDINGS = []` — bloquea CI automáticamente ante nuevas violaciones
   - Bomba 1 (PrismaClient singleton): ya resuelta — `src/lib/prisma.ts` usa PrismaPg + singleton
   - RLS: planificado como Fase 13D — ADR-007 aprobado (SET LOCAL compatible con pooler)

   BLOQUE 2 ✅ Completado 2026-04-05 — Paginación cursor-based:
   - `InvoiceService.getInvoiceBookPaginated` — cursor + limit (max 50) + nextCursor + total
   - `TransactionService.getTransactionsPaginated` + `listTransactions` — cursor + periodId opcional
   - `ReceivableService.getReceivablesPaginated` + `getPayablesPaginated` — ya tenían cursor, tests expandidos
   - Regla aplicada: ningún listado carga más de 50 registros sin paginar
   - 19 tests nuevos (397 total, todos en verde)
   - Cursor en BankTransaction: diferido a Fase 17 (el servicio no existe aún)

   BLOQUE 3 ✅ Completado 2026-04-05 — modelo PeriodSnapshot + migración:
   - Modelo `PeriodSnapshot` en schema Prisma: saldo precalculado por cuenta
     al cierre de cada período, en VES + moneda original
   - `@@unique([periodId, accountId])` — un snapshot por cuenta por período
   - `@@index([companyId, periodId])` — índice para queries de reportes
   - `onDelete: Restrict` en todas las relaciones (ADR-003)
   - Relaciones inversas añadidas en Company, AccountingPeriod, Account
   - Migración: `prisma/migrations/20260405_feat_13c_period_snapshot/migration.sql`
   - Nota: `ExchangeRate` (Fase 14) ya cubre tasas históricas — no se necesita
     un modelo separado ExchangeRateSnapshot
   - Evita el "efecto bola de nieve": 10,000 facturas USD
     no se reconvierten en cada carga de reporte

   BLOQUE 3b ✅ Completado 2026-04-05 — PeriodSnapshotService (Bomba 4 resuelta):
   - `PeriodSnapshotService.upsertSnapshot/upsertAllSnapshotsForPeriod/getSnapshot/invalidateSnapshots`
   - `PeriodService.closePeriod` integrado: genera snapshots dentro del mismo $transaction
   - Decimal.js para todos los cálculos de balance (ADR-002)
   - companyId en todas las queries (ADR-004)
   - 9 tests nuevos PeriodSnapshotService + 6 PeriodService = 407 total, todos GREEN
   - Fix sistémico: pool=vmForks en vitest.config.ts (Vitest 4 en Windows/Node 22)

   BLOQUE 4 ✅ Completado 2026-04-05 — Caché de reportes (13C-B5):
   - Cache en memoria (Map) para períodos CERRADOS — sin Redis (YAGNI para esta fase)
   - src/lib/report-cache.ts: makeCacheKey, getCached, setCached, invalidatePeriod, withPeriodCache
   - TTL: 5 minutos para períodos cerrados (inmutables → bajo riesgo de stale)
   - Períodos OPEN siempre en tiempo real — no cacheados
   - getTransactionsByPeriodAction integra cache automáticamente vía withPeriodCache
   - invalidatePeriodCache(companyId, periodId) exportado para uso al reabrir período
   - 15 tests nuevos GREEN (422 total)

   BLOQUE 5 ✅ Completado 2026-04-05 — Caché de reportes:
   - src/lib/report-cache.ts: Map en memoria, TTL 5 min, solo períodos CERRADOS
   - withPeriodCache: períodos OPEN siempre en tiempo real
   - getTransactionsByPeriodAction: nueva action con cache integrado
   - 15 tests nuevos (422 total, todos GREEN)
   - Operaciones asíncronas (PDFs, Excel, OCR pesado via QStash):
     diferido a Fase 13D o post-producción

   BLOQUE 6 ✅ Completado 2026-04-05 — Observabilidad (Prisma query monitoring):
   - Prisma query logging: queries >= 500ms → console.warn [SLOW_QUERY] + Sentry breadcrumb en producción
   - Solo loguea duración y primeros 120 chars del SQL — NUNCA params (RIF, montos — ADR-006)
   - NODE_ENV guard: listener inactivo en tests (422 total, todos GREEN)
   - Sentry: addBreadcrumb (no captureException) — no infla quota de errores
   - Métricas por endpoint: tiempo de respuesta p50/p95/p99 — diferido (post-50 clientes)
   - Dashboard de salud: conexiones Neon, hit rate caché Redis — diferido
- ✅ Fase 14: Multimoneda — VES + USD + EUR, tasa BCV (ver sección 22) — completada 2026-03-30
- ✅ Fase 14B: Medios de Pago Digitales — Cashea (BNPL), PagoMóvil, Zelle (ver sección 23) — completada 2026-03-30
- ✅ Fase 15: Cierre de Ejercicio Económico — completada 2026-03-31 (ver sección 25)
## 25. Fase 15 — Cierre de Ejercicio Económico ✅ completada 2026-03-31

### Schema añadido

```prisma
model FiscalYearClose {
  id                         String      @id @default(cuid())
  companyId                  String
  year                       Int
  closedAt                   DateTime    @default(now())
  closedBy                   String      // userId Clerk
  closingTransactionId       String      @unique
  closingTransaction         Transaction @relation("ClosingTransaction", ...)
  appropriationTransactionId String?     @unique
  appropriationTransaction   Transaction? @relation("AppropriationTransaction", ...)
  totalRevenue               Decimal     @db.Decimal(19, 4)
  totalExpenses              Decimal     @db.Decimal(19, 4)
  netResult                  Decimal     @db.Decimal(19, 4)  // positivo = ganancia
  @@unique([companyId, year])
  @@index([companyId])
}
```

**Cambios en Company**: `resultAccountId String?`, `retainedEarningsAccountId String?`
**Migración**: `20260331003204_feat_15_fiscal_year_close`

### Módulo `src/modules/fiscal-close/`
- `services/FiscalYearCloseService.ts` — `closeFiscalYear`, `appropriateFiscalYearResult`, `isFiscalYearClosed`, `getFiscalYearCloseHistory`
- `actions/fiscal-close.actions.ts` — `closeFiscalYearAction`, `appropriateFiscalYearResultAction`, `updateFiscalConfigAction`, `getFiscalConfigAction`, `getFiscalYearCloseHistoryAction`
- `schemas/fiscal-close.schema.ts` — Zod schemas
- `components/FiscalConfigForm.tsx` — Selector de cuentas EQUITY para cierre
- `components/FiscalYearCloseManager.tsx` — UI de cierre con AlertDialog + historial

### Rutas nuevas
`/company/[companyId]/fiscal-close` — Cierre de ejercicio + historial
`/company/[companyId]/settings` — Sección "Configuración Contable" añadida (cuentas de cierre)

### Reglas implementadas
- **Idempotencia**: `@@unique([companyId, year])` → solo se puede cerrar un año una vez
- **Serializable SSI**: `$transaction({ isolationLevel: 'Serializable' })`
- **Guard total post-cierre**: createTransaction, openPeriod, createInvoice, createRetencion rechazan operaciones con fecha en año cerrado
- **Asiento 1 (obligatorio)**: REVENUE + EXPENSE → cuenta Resultado del Ejercicio (`type: CIERRE`)
- **Asiento 2 (diferible)**: Resultado → Utilidades Retenidas (post-AGO)
- **Solo períodos existentes**: no se exigen 12 meses completos
- **Solo ADMIN** puede ejecutar cierre y apropiación

- ✅ Fase 16: Cartera CxC/CxP con Antigüedad de Saldos — completada 2026-03-31 (ver sección 25.1)
- ✅ Fase 17: Conciliación Bancaria — completada 2026-04-06 (commit `f110d93`)
  - Schema: BankAccount, BankStatement, BankTransaction con isReconciled, closingBalance
  - Migración: `20260331_fase17_bank_reconciliation` — aplicada
  - Servicios: BankAccountService, BankStatementService, BankingService, CsvParserService, ReconciliationService
  - Componentes: BankAccountList, BankStatementUpload, ReconciliationWorkbench (InvoicePayment match)
  - Páginas: `/bank-reconciliation/` + `/bank-reconciliation/[statementId]/`
  - Seguridad: 6 HIGH + 3 MEDIUM + 1 LOW remediados (ADR-006 D-1/D-2, LL-009, LL-010)
  - ADR-007 creado: RLS con SET LOCAL + withCompanyContext
- ✅ Fase 17B: BankReconciliationService + CsvImporter + ADR-008 — completada 2026-04-06 (commits `4f041f7`→`faf1972`)
  - Schema: BankTransaction extendido con `matchedTransactionId` + `matchedPaymentRecordId` (ADR-008)
  - BankReconciliationService: 3-way match (INVOICE_PAYMENT / JOURNAL_ENTRY / PAYMENT_RECORD)
  - CsvImporter.tsx: column mapper + importación bulk
  - ✅ UI completa: ReconciliationWorkbench con 3-way match (INVOICE_PAYMENT / JOURNAL_ENTRY / PAYMENT_RECORD)
- ✅ Fase 13D: RLS — Row Level Security — completada 2026-04-06 (commit `0ada843`)
  - src/lib/prisma-rls.ts: withCompanyContext(companyId, tx, fn) con SET LOCAL
  - Migrations: companyId backfill en BankTransaction + ENABLE RLS en 14 tablas de dominio
  - Todas las $transaction de dominio envuelven withCompanyContext
  - 6 tests unitarios prisma-rls.test.ts + regression LL-010 (BankStatementService.test.ts)
  - Compatible con PrismaPg pooled (SET LOCAL = per-transaction, ADR-007)
- ✅ Fase 18: Dashboard Analítico Avanzado (Recharts nativo) — completada 2026-04-06 (commit `b468af2`)
- ✅ Fase 14C: Auto-fetch Tasa BCV + botón UI — completada 2026-04-07 (commit `ee04693`)
- ✅ Fase 19A: Security Hardening ADR-006 — completada 2026-04-07 (commit `f0c8d5a`)
- ✅ Fase 19B: Security Residual — completada 2026-04-07 (commit `cb2d324`)
- ✅ Fase 19: Declaración Mensual IVA (Forma 30 SENIAT) — completada 2026-04-07 (ver sección 35)
- ✅ Fase 19C: Forma 30 PDF export — completada 2026-04-07 (ver sección 35)
- ✅ Fase 14D: Validación RIF SENIAT en tiempo real — completada 2026-04-07 (ver sección 27)
- ✅ Fase 12C: Asistente de Retenciones ISLR Inteligente — completada 2026-04-07 (ver sección 28)
- ✅ Fase OCR-v2: Migración schema VEN-NIF + Gemini Vision + pre-fill InvoiceForm — completada 2026-04-07
- ✅ Fase 20: XML SENIAT descargable + QR code en PDF comprobante — completada 2026-04-07 (ver sección 36)
- ✅ Fase 21: Activos Fijos y Depreciación VEN-NIF 16 — completada 2026-04-07 (ver sección 37)
- ✅ Fase 22: Ajuste por Inflación INPC (VEN-NIF 3) — completada 2026-04-07 (ver sección 38)
- ✅ Fase 23B: Auto-conciliación bancaria con Gemini Vision — completada 2026-04-08 (ver sección 39)
- ✅ ADR-010: Testing Strategy — completada 2026-04-08 (ver sección 40) | archivo `.claude/adr/ADR-010-testing-strategy.md` creado 2026-04-12
- ✅ Fase 23C: NC/ND Workflow completo — completada 2026-04-12 (ver sección 41)
- ✅ Fase 30: Exportación Masiva / Backup — ZIP fiscal con ExportJob + 24h expiry — completada 2026-04-13 (ver sección 42)
- ⏳ Fase 23 Nómina (LOTTT) — dividida en 5 subfases (ver sección 34 — estructura revisada 2026-04-14)
  - ✅ Fase NOM-A: Wizard de configuración de nómina — completada 2026-04-15 (ver sección 53)
  - ✅ Fase NOM-B: Empleados, conceptos, feriados, historial de salarios — completada 2026-04-15 (ver sección 54)
  - ⏳ Fase NOM-C: Motor de cálculo + recibo PDF + causación contable
  - ⏳ Fase NOM-D: Prestaciones, vacaciones, utilidades + Liquidación Final
  - ⏳ Fase NOM-E: Reportes legales (IVSS, INCES, Banavih, ARC/ISLR, SENIAT)
- ⏳ Fase 24: Firma Electrónica + QR (SUSCERTE)
- ⏳ Fase 25: Stripe + pagos automáticos
- ⏳ Fase 26: MCP + Asistente Contable IA
- ⏳ Fase 26B: IA Assistant de Tareas Pendientes — motor de reglas Prisma + Gemini Flash resumen ejecutivo — ~15 tests
  - Detecta: facturas sin causar, períodos sin cerrar, activos sin depreciar, declaración IVA vencida, retenciones sin vincular, extracto sin conciliar >30d
  - Reglas = queries Prisma (determinístico). Gemini redacta resumen; si falla → muestra tareas directamente
  - `PendingTasksService.ts` + `getPendingTasksAction` + `PendingTasksWidget.tsx` en Dashboard (lazy, TTL 5min)
- ⏳ Fase 27: PWA + modo offline
- ✅ Fase 28A: Expansión roles — `UserRole { OWNER ADMIN ACCOUNTANT ADMINISTRATIVE VIEWER }` + migration SQL + `src/lib/auth-helpers.ts` (`canAccess`, `ROLES`, `ROLE_LABELS`, `ROLE_HIERARCHY`) + CompanyService asigna OWNER al creador (ver sección 43)
- ✅ Fase 28B: Nav dinámico por rol — `src/lib/nav-items.ts` (`getNavItems(role, companyId)`) + Navbar refactorizado con dropdown agrupado por sección + badge "Pronto" para Inventario + layout pasa `userRole` (ver sección 43)
- ✅ Fase 28C: Role guards con `canAccess()` en 13 action files — ADMINISTRATIVE bloqueado en módulos contables, OWNER bug fix en banking — Dashboard dinámico con badge de rol, CTAs y accesos rápidos por área (ver sección 43)
- ✅ Fase 28D: Módulo Inventario — `InventoryItem` + `InventoryMovement` (Prisma + Neon) + `InventoryOperationsService` (CPP override, IDOR guards) + `InventoryAccountingService` (Serializable SSI, CPP fórmula, P2034) + 4 action files + 68 tests (870 total) (ver sección 44)
- ✅ Fase 28E: UI Módulo Inventario — 5 componentes cliente + page diferenciada por rol + nav activado (ver sección 45)
- ✅ Fase 28F: UX Hardening — Toaster global en company layout + migración sonner en 3 componentes + spinners en botones de acción (ver sección 46)
- ✅ Fase 31: AuditLog UI — `companyId` agregado a schema `AuditLog` (nullable + 2 indexes) + 44 `auditLog.create()` actualizados en 19 archivos + `AuditLogService` + `AuditLogTable` (filtros + DiffView) + page OWNER/ADMIN only + nav item — 881 tests (ver sección 47)
- ✅ Fase 28G: Inventario UI completado — `getItemMovements()` con CRITICAL-1 ownership guard + `ItemMovementHistory` (CPP cards + tabla movimientos con badges) + columna "Historial" en `InventoryItemList` — 891 tests (ver sección 48)
- ✅ Fase 33: Notificaciones in-app — `NotificationService.getAlerts()` (facturas vencidas/por vencer + retenciones PENDING + inventario DRAFT) + `NotificationBell` en navbar (badge por severity + dropdown lazy-load) — 908 tests (ver sección 49)
- ✅ Fase 32: KPIs Ejecutivos — `KpiDashboardService` (CxC, CxP, DSO, flujo de caja proyectado 30/60/90d) + `ExecutiveKpiPanel` en dashboard empresa (OWNER/ADMIN/ACCOUNTANT) — 926 tests (ver sección 50)
- ✅ Fase 23C Residual: NC/ND UI Completo — `RelatedInvoicePicker` + `CreditDebitNotesPanel` + `searchInvoicesForPickerAction` — 936 tests (ver sección 51)
- ✅ Fase 28H: Reportes Inventario — `InventoryReportService` (getStockSummary CPP + getMovementReport) + `InventoryReportsView` (tabs Existencias/Movimientos) + `minimumStock Decimal?` en `InventoryItem` + alerta `LOW_STOCK` en `NotificationService` — 956 tests (ver sección 52)
- ⏳ Fase 28: Módulo de Compras y Ventas
   - Cotizaciones/Presupuestos (pre-contable, sin asiento)
   - Órdenes de Compra vinculadas a cotización de proveedor
   - Órdenes de Venta vinculadas a presupuesto cliente
   - Conversión OC → Factura de Compra (Invoice tipo PURCHASE)
   - Conversión OV → Factura de Venta (Invoice tipo SALE)
   - Trazabilidad: factura hereda datos de la OC/OV origen
   - Regla VEN-NIF: OC/OV no generan asiento contable —
     solo registran compromiso pre-contable
   - Validez de oferta configurable (crítico por inflación VES)
   - Flujo de aprobación de cotizaciones
- ⏳ Fase 29A: TaxPlugin Architecture — `interface TaxPlugin { VE | CO }`, `VenezuelaTaxPlugin` extrae lógica VEN-NIF, `ColombiaTaxPlugin` stub, `Company.country` enum — prerequisito Fase 29 — ~15 tests
- ⏳ Fase 29: Expansión Colombia (DIAN)
- ✅ Fase 30: Exportación Masiva / Backup Contable — ZIP descargable (libros IVA, asientos, retenciones, activos, Forma 30 por mes) + ExportJob 24h expiry — 23 tests (ver sección 42)
- ✅ Fase 31: AuditLog UI — `/audit-log` tabla paginada con filtros + diff oldValue↔newValue — solo ADMIN/OWNER — 881 tests (ver sección 47)
- ⏳ Landing Page

## 20. Notas Técnicas Importantes

- Zod 4: usar `{ error: "mensaje" }` en lugar de `{ errorMap: () => ({message: "..."}) }`
- `vi.hoisted()` para mocks en Vitest cuando hay variables antes de `vi.mock()`
- `as never` en `mockResolvedValue` para evitar errores de TypeScript en tests
- `// @vitest-environment jsdom` debe ir en la **primera línea** del archivo de test de componentes React
- `vi.mock("next/cache")` necesario en tests de actions que usan `revalidatePath`
- Warning "Missing Description for DialogContent" en tests — cosmético, ignorar
- VS Code terminal puede no cargar .env — usar CMDer para `npm run dev`
- `list-models.mjs` en raíz — script para verificar modelos Gemini (NO eliminar)
- Prisma 7.5.0 disponible — pospuesta para antes de producción
- `prisma.iGTFTransaction` — así genera Prisma el nombre del modelo IGTFTransaction
- `environmentMatchGlobs` NO existe en Vitest 4 — usar `// @vitest-environment jsdom` en primera línea
- `vitest.config.ts` usa `environment: "node"` global
- **SIEMPRE reiniciar `npm run dev` después de `prisma generate`**
- Error "Cannot read properties of undefined" en Prisma = cliente cacheado = reiniciar
- IVA Adicional Lujo = 15% adicional sobre misma base que IVA General → total 31% en el libro
- `luxuryGroupId` en `TaxLine` vincula IVA_ADICIONAL con su IVA_GENERAL hermana
- Errores Prisma P2002 = unique constraint → "Ya existe una factura con ese número para esta empresa"
- Errores Prisma P2003 = foreign key → "Datos de referencia inválidos"
- `document.querySelector('input[name="date"]')` para acceder al input de fecha en tests jsdom
- Tasa de IVA en `InvoiceForm` es siempre `readOnly` — las tasas vienen del sistema, no del usuario
- Categorías EXENTA/EXONERADA/NO_SUJETA bloquean el submit si hay líneas con base imponible > 0
- **`$transaction` con `Serializable` obligatorio para**: getNextControlNumber, getNextVoucherNumber, cierre de período
- **Idempotencia**: Actions de Invoice y Retencion deben verificar `idempotencyKey` antes de insertar
- **`||` no `??` para fallbacks de env vars en CI**: GitHub Actions retorna `""` (empty string) para secrets no configurados — `??` solo coalescencía `null`/`undefined`, no `""`. Usar `process.env.DATABASE_URL || "fallback"` en `prisma.config.ts`
- **Cast type-safe sin `any`**: `element as Parameters<typeof renderToBuffer>[0]` — extrae el tipo del primer parámetro de la función sin usar `as any`
- **Mock de `$transaction` interactivo en Vitest**: `prisma.$transaction.mockImplementation(async (fn) => fn(txMock))` donde `txMock` delega a los mocks existentes del mismo objeto prisma mock
- **Rate limiting mock en tests**: `vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), limiters: { fiscal: {}, ocr: {} } }))` — necesario en todo test de action que use rate limiting
- **Coverage thresholds en vitest.config.ts**: branches 50%, functions 70%, lines 73%, statements 70%. PDFServices excluidos (`**/*PDFService.ts`) — no testeable en Node runner sin renderer real
- **`GEMINI_API_KEY`**: sin prefijo `NEXT_PUBLIC_` ni `VITE_` — corre en servidor (Server Action)
- **Rate limiter OCR**: 12 req/min en `src/lib/ratelimit.ts` — margen sobre límite gratuito Gemini (15 RPM)
- **Vitest 4 en Windows/Node 22**: usar `pool: 'vmForks'` en `vitest.config.ts` para evitar crashes
- **Sentry deprecation warning**: en `next.config.ts` cambiar `disableLogger: true` por `webpack.treeshake.removeDebugLogging: true` (pendiente, no urgente)
- **Zelle `$transaction` timeout**: usar `{ timeout: 30000 }` para prevenir error por cold-start de Neon
- **GeminiOCRService**: `extractFromImage(base64, mimeType)` — base64 sin prefijo `data:image/...;base64,`
- **Gemini response cleanup**: siempre limpiar bloques markdown con `.replace(/```json\s*/gi, "").replace(/```\s*/g, "")` — Gemini los incluye aunque el prompt diga que no

## 21. Estado de Bombas Críticas (Fase 13C completada 2026-04-05)

### ✅ BOMBA 1 — Singleton PrismaClient — RESUELTA

`src/lib/prisma.ts` usa `PrismaPg` (adapter-pg) con singleton `globalForPrisma`. Query monitoring activo (Bloque 6).

### ✅ BOMBA 2 — Paginación cursor-based — RESUELTA (Bloque 2)

- `InvoiceService.getInvoiceBookPaginated` — cursor + limit (max 50) + nextCursor
- `TransactionService.getTransactionsPaginated` + `listTransactions` — cursor + periodId opcional
- `ReceivableService.getReceivablesPaginated` + `getPayablesPaginated`
- BankTransaction: diferido a Fase 17 (servicio aún no existe)

### ⚠️ BOMBA 3 — PDFs síncronos en Vercel — MITIGADA (Bloque 5)

Cache en memoria (report-cache.ts) reduce carga. PDFs asíncronos via QStash: diferido post-producción.
Riesgo residual: spike de PDFs simultáneos en hora punta.

### ✅ BOMBA 4 — Snapshots y caché de reportes — RESUELTA (Bloques 3+4+5)

- `PeriodSnapshot` model: saldos precalculados al cierre de período
- `PeriodSnapshotService`: upsert en `closePeriod`, lecturas O(1) en reportes
- `report-cache.ts`: TTL 5 min para períodos cerrados

### ✅ RLS en base de datos — IMPLEMENTADA en Fase 13D (commit `0ada843`)

ADR-007 implementado. SET LOCAL + withCompanyContext. 14 tablas bajo RLS. 465 tests GREEN.

### RLS y Neon Pooling — Decisión Arquitectónica Requerida

Neon con PgBouncer en modo `transaction` no soporta `SET LOCAL` (necesario para RLS).
Opciones: (a) usar conexión directa para todas las queries, (b) conexión directa solo para RLS,
(c) Neon Auth como alternativa. Llevar a Chat ARCH antes de Fase 13C.

### PITR (Point-in-Time Recovery) — SLA a documentar

Neon Free: 7 días. Neon Pro: 30 días.
Para un software contable vendible, esto debe estar en el contrato con el cliente.
Documentar en Landing Page y en onboarding de Settings.

### Escalabilidad — Fase 13C (ver roadmap para bloques detallados)

**CRÍTICO ANTES DE LANZAR:** Bombas 2, 3 y 4 arriba + RLS.
**CRECIMIENTO 50+ CLIENTES:**
- Sin métricas de performance reales (solo errores via Sentry)
- Sin alertas de queries lentas de Prisma → ciego ante degradaciones graduales

## 22. Fase 14 — Multimoneda (VES + USD + EUR)

### Regla VEN-NIF fundamental
Todo registro contable en Venezuela **debe estar en VES (Bolívares Digitales)**. Las facturas en moneda extranjera se convierten al tipo de cambio BCV oficial vigente en la fecha de la transacción. Se deben guardar: moneda original, tasa usada, y monto en VES.

### Schema additions

```prisma
enum Currency { VES  USD  EUR }

model ExchangeRate {
  id        String   @id @default(cuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Restrict)
  currency  Currency
  rate      Decimal  @db.Decimal(19, 6)   // 1 USD/EUR = X VES
  date      DateTime @db.Date
  source    String   @default("BCV")       // "BCV" | "manual"
  createdAt DateTime @default(now())
  createdBy String
  @@unique([companyId, currency, date])
  @@index([companyId, currency, date])
}
```

**Cambios en modelos existentes:**
- `IGTFTransaction.currency`: `String @default("USD")` → `Currency @default(USD)`
- `Invoice`: + `currency Currency @default(VES)`, + `exchangeRateId String?` (→ ExchangeRate)
- `InvoiceTaxLine`: montos permanecen en VES (ya convertidos)

### Módulo nuevo: `src/modules/exchange-rates/`
- `ExchangeRateService` — `getLatestRate(companyId, currency)`, `getRateForDate(companyId, currency, date)`, `upsertRate(...)`
- CRUD actions + Zod schemas
- UI: `/company/[companyId]/exchange-rates` — tabla histórica + form para ingresar tasa del día
- Integración en `InvoiceForm`: si `currency !== VES`, mostrar campo tasa + calcular equivalente VES en tiempo real

### Reglas de conversión
- Facturas USD/EUR: `montoVES = montoOriginal × tasaBCV`
- IGTF: se calcula sobre `montoVES` (ya convertido)
- Si no hay tasa cargada para la fecha → error bloqueante (no permite registrar sin tasa)
- Tasa guardada en `Invoice.exchangeRateId` → auditable

## 23. Fase 14B — Medios de Pago Digitales ✅ completada 2026-03-30

### Scope
Cashea (BNPL venezolano), PagoMóvil (Bancos VEN), Zelle (USD informal), Efectivo, Transferencia.

### Schema añadido
```prisma
enum PaymentMethod { EFECTIVO TRANSFERENCIA PAGOMOVIL ZELLE CASHEA }

model PaymentRecord {
  id               String        @id @default(cuid())
  companyId        String        // → Company
  invoiceId        String?       // → Invoice (opcional)
  method           PaymentMethod
  amountVes        Decimal       // siempre en VES
  currency         Currency      @default(VES)
  amountOriginal   Decimal?      // monto en moneda original (Zelle USD)
  exchangeRateId   String?       // → ExchangeRate
  referenceNumber  String?       // PagoMóvil
  originBank       String?
  destBank         String?
  commissionPct    Decimal?      // Cashea (%)
  commissionAmount Decimal?      // Cashea monto calculado
  igtfAmount       Decimal?      // Zelle + Cashea USD
  date             DateTime
  notes            String?
  createdAt        DateTime      @default(now())
  createdBy        String
}
```
Migration: `20260330195116_feat_14b_payment_records`

### Módulo `src/modules/payments/`
- `schemas/payment.schema.ts` — `CreatePaymentSchema` con validación cruzada por método
- `services/PaymentService.ts` — `create`, `list`, `calcIgtf`, `calcCommission`
- `actions/payment.actions.ts` — `createPaymentAction` (con `$transaction` + AuditLog + rate limiting), `listPaymentsAction`
- `components/PaymentForm.tsx` — formulario dinámico por método (PagoMóvil, Zelle, Cashea)
- `__tests__/PaymentService.test.ts` — 10 tests

### Página
`/company/[companyId]/payments` — formulario + historial

### Reglas contables implementadas
- **PagoMóvil**: VES puro, sin IGTF, requiere número de referencia
- **Zelle**: moneda USD → IGTF 3% automático, guarda amountOriginal en USD
- **Cashea**: comisión % configurable (gasto financiero), IGTF opcional si liquida en USD
- **IGTF**: `PaymentService.calcIgtf(amountVes)` = `amountVes × 0.03`
- **Comisión Cashea**: `PaymentService.calcCommission(amountVes, pct)` = `amountVes × pct / 100`

## 24. Modelo de Negocio

- **Plan Free**: todas las funciones contables + OCR ~80% precisión
- **Plan Pro**: OCR con Gemini Flash ~95% precisión (futuro)
- Stripe en Fase 25
- Contacto actual: mailto:contacto@contaflow.app



## 25.1 Fase 16 — Cartera CxC/CxP con Antigüedad de Saldos ✅ completada 2026-03-31

### Schema añadido
- `InvoicePaymentStatus` enum: UNPAID, PARTIAL, PAID, VOIDED
- `Company.paymentTermDays Int @default(30)` — plazo configurable para auto-cálculo de dueDate
- `Invoice`: campos `dueDate`, `totalAmountVes`, `pendingAmount`, `paymentStatus` + índices compuestos
- Nuevo modelo `InvoicePayment` — semánticamente distinto de `PaymentRecord` (VEN-NIF)
- Migración: `20260331121653_feat_16_receivable_portfolio`

### Módulo añadido: `src/modules/receivables/`
- **ReceivableService**: `classifyAgingBucket()` (pure fn), `getReceivables()`, `getPayables()`, `recordPayment()`, `cancelPayment()`, `getPaymentsByInvoice()`
- **Actions**: `getReceivablesAction`, `getPayablesAction`, `recordPaymentAction`, `cancelPaymentAction`, `getPaymentsByInvoiceAction`, `updatePaymentTermsAction`
- **Schemas Zod**: `RecordPaymentSchema`, `CancelPaymentSchema`, `AgingReportFilterSchema`, `UpdatePaymentTermsSchema`
- **Componentes**: `AgingReportTable`, `RecordPaymentDialog`, `PaymentTermsForm`

### Rutas añadidas
- `/company/[companyId]/receivables` — Cartera CxC + aging report
- `/company/[companyId]/payables` — Cartera CxP + aging report

### Lógica VEN-NIF
- `NOTA_CREDITO` netea automáticamente contra factura original via `relatedDocNumber` (Reglamento IVA Art. 58)
- `REPORTE_Z` y `RESUMEN_VENTAS` excluidos del aging — no son instrumentos de cartera
- `pendingAmount` inicial = `totalAmountVes - ivaRetentionAmount - islrRetentionAmount`
- Guard `FiscalYearClose` en `recordPayment` y `cancelPayment`
- Buckets fijos VEN-NIF: Corriente (0–30), 31–60, 61–90, 91–120, +120 días

### Tests: 254/254 ✅

## 26. Análisis Competitivo — ContaFlow vs Odoo

### Por qué ContaFlow puede superar a Odoo en el nicho VEN/LATAM

Odoo es un ERP genérico global. Su mayor debilidad en Venezuela es exactamente la mayor fortaleza de ContaFlow: **hiper-especialización fiscal venezolana**. Las áreas donde Odoo falla en el mercado local:

- Configuración manual de tasa BCV (requiere conector externo de pago)
- Retenciones ISLR/IVA VEN-NIF sin UX guiada — el contador debe saber los códigos de memoria
- Validación de RIF inexistente — texto libre con errores manuales frecuentes
- Batch payments para bancos venezolanos requieren desarrollo a medida
- Soporte IGTF ausente en versión estándar

### Estrategia de posicionamiento

No competir en features genéricas (inventario, CRM, nómina global) — eso es terreno de Odoo.
Ganar en: **velocidad de adopción + compliance VEN-NIF automático + IA fiscal local**.

El contador venezolano no quiere configurar un ERP. Quiere abrir ContaFlow y que ya sepa las alícuotas, los códigos ISLR, la tasa del BCV de hoy, y que le avise si cometió un error fiscal.

## 27. Fase 14C — Auto-fetch Tasa BCV + Re-expresión Automática

### Objetivo
Eliminar el trabajo manual diario del contador: la tasa BCV se carga sola cada mañana.

### Implementación

**Vercel Cron** (`vercel.json`):
```json
{
  "crons": [{
    "path": "/api/cron/bcv-rate",
    "schedule": "0 8 * * 1-5"
  }]
}
```

**Route Handler** `/api/cron/bcv-rate/route.ts`:
- Verificar header `Authorization: Bearer CRON_SECRET`
- Scrapear/consumir fuente BCV confiable (API pública o scraper del portal oficial)
- Llamar `ExchangeRateService.upsertRate(companyId, 'USD', rate, today, 'BCV')`
- Ejecutar para todas las empresas con plan PRO o con flag `autoBcvEnabled`
- Loguear en AuditLog con `createdBy: 'SYSTEM_CRON'`

**Re-expresión automática (UI)**:
- Botón "Ver en USD" en Balance General y Estado de Resultados
- Aplica la tasa histórica de cada asiento desde `Invoice.exchangeRateId`
- No modifica la contabilidad — es una vista de lectura
- Diferencial cambiario automático: al cierre de período, calcular ganancia/pérdida cambiaria

### Ventaja vs Odoo
Odoo: el usuario carga la tasa a mano o paga un conector externo.
ContaFlow: automático, auditado, con fuente trazable "BCV" en cada `ExchangeRate.source`.

### Schema (sin cambios al existente)
`ExchangeRate.source` ya soporta `"BCV" | "manual"` — el cron usa `"BCV"`, el form manual usa `"manual"`.

## 28. Fase 14D — Validación RIF vs SENIAT en Tiempo Real

### Objetivo
Al crear un cliente o proveedor, validar el RIF contra el portal SENIAT y traer la razón social legal automáticamente. Cero errores de RIF, cero razones sociales incorrectas.

### Implementación

**Server Action `validateRifSeniatAction(rif: string)`**:
- Primero validar formato con `validateVenezuelanRif(rif)` (ya existe en `fiscal-validators.ts`)
- Si formato válido → fetch al portal SENIAT (scraper o API proxy)
- Retornar `{ valid: boolean, legalName: string | null, rif: string }`
- Rate limiting estricto: 5 req/min por empresa (SENIAT puede bloquear IPs)
- Cachear resultado en Redis por 24h — el RIF de una empresa no cambia

**UX en formularios de cliente/proveedor**:
- Input RIF con botón "Verificar" o auto-verificación al perder foco (onBlur)
- Si SENIAT confirma: mostrar nombre legal con badge "✓ Verificado SENIAT"
- Pre-llenar campo `name` con razón social si está vacío
- Si SENIAT no responde: degradar gracefully — permitir continuar con advertencia
- `legalNameVerified: Boolean @default(false)` en modelo de cliente/proveedor futuro

### Impacto fiscal
En Venezuela, el 40% de los errores de contabilidad son RIFs incorrectos o razones sociales que no coinciden con el SENIAT. Esto genera rechazos en auditorías. ContaFlow es el único software del mercado que previene esto de forma automática.

### Regla de fallback
SENIAT tiene disponibilidad variable. Si el portal no responde: la validación de formato local (`VEN_RIF_REGEX`) sigue activa como primera línea de defensa, y se guarda `legalNameVerified: false`. El sistema **nunca bloquea** el flujo por indisponibilidad del SENIAT — degrada gracefully.

## 29. Fase 12C — Asistente de Retenciones ISLR Inteligente

### Objetivo
Que el sistema sugiera automáticamente el código y porcentaje de retención ISLR correcto basándose en el concepto/descripción de la factura. El contador no necesita memorizar el Decreto 1808.

### Tabla de sugerencias (Decreto 1808 completo)

```typescript
// src/lib/islr-suggestions.ts
export const ISLR_CONCEPT_MAP: Record<string, { code: string; rate: number; label: string }> = {
  'honorarios': { code: 'H-PN', rate: 5, label: 'Honorarios Profesionales PN' },
  'consultoria': { code: 'S-PJ', rate: 2, label: 'Servicios PJ' },
  'servicios': { code: 'S-PJ', rate: 2, label: 'Servicios PJ' },
  'arrendamiento': { code: 'A', rate: 5, label: 'Arrendamiento' },
  'alquiler': { code: 'A', rate: 5, label: 'Arrendamiento' },
  'flete': { code: 'F', rate: 1, label: 'Fletes y Transporte' },
  'transporte': { code: 'F', rate: 1, label: 'Fletes y Transporte' },
  'publicidad': { code: 'P', rate: 3, label: 'Publicidad y Propaganda' },
  'construccion': { code: 'C', rate: 2, label: 'Construcción' },
  // ... tabla completa Decreto 1808
};

export function suggestIslrCode(concept: string): RetentionSuggestion | null
```

### UX en RetentionForm
- Al escribir el concepto de la factura → debounce 400ms → `suggestIslrCode(concept)`
- Mostrar sugerencia inline: "Sugerido: Honorarios Profesionales PN — 5%"
- Botón "Aplicar sugerencia" que pre-llena `islrCode` y `islrRate`
- El usuario puede ignorar la sugerencia y escribir manualmente
- Tooltip con referencia legal: "Decreto 1808, Art. X"

### Ventaja vs Odoo
Odoo VEN: el usuario debe conocer los códigos de retención de memoria.
ContaFlow: UX fiscal inteligente — imposible equivocarse si se acepta la sugerencia.

## 30. Fase 17C — Batch Payments para Bancos Venezolanos

### Objetivo
Desde la Cartera CxP (Fase 16), seleccionar múltiples facturas pendientes y exportar un archivo TXT/XML listo para cargar en el portal bancario venezolano. Pagar 20 proveedores en un clic.

### Bancos objetivo (prioridad)
1. Banesco — formato TXT delimitado por comas, encoding UTF-8
2. Mercantil — formato TXT posicional
3. Venezuela (BDV) — formato CSV con cabecera fija
4. Provincial (BBVA) — formato XML

### Implementación

**`BatchPaymentService.ts`**:
```typescript
export class BatchPaymentService {
  generateBanescoTxt(payments: BatchPaymentItem[]): string
  generateMercantilTxt(payments: BatchPaymentItem[]): string
  generateBDVCsv(payments: BatchPaymentItem[]): string
  // ...
}

interface BatchPaymentItem {
  providerRif: string
  providerName: string
  bankCode: string       // código SWIFT/BIC venezolano
  accountNumber: string
  amountVes: Decimal
  reference: string      // número de factura
  concept: string
}
```

**UI en `/company/[companyId]/payables`**:
- Checkbox en cada fila del aging report
- Botón "Generar pago masivo" → seleccionar banco → descargar archivo
- Validación: proveedor debe tener `bankCode` y `accountNumber` cargados
- Total seleccionado visible en tiempo real

### Integración con Fase 16
`BatchPaymentItem` se construye directamente desde `InvoicePayment` + datos del proveedor en Company.

### Ventaja vs Odoo
Odoo requiere un conector de pago local desarrollado a medida por un partner.
ContaFlow: nativo venezolano, cero configuración adicional.

## 31. Fase 26B — IA "Contador Junior": Clasificación y Detección de Anomalías

### Objetivo
Usar el stack Groq/Gemini ya activo para agregar inteligencia fiscal al flujo contable. Dos funciones principales:

### 31A. Clasificación Automática de Cuentas

Al registrar una factura o asiento manual, si el usuario no especifica la cuenta de gasto/ingreso:

**`AccountClassifierService.ts`** (usa `groq llama-3.1-8b-instant`):
```typescript
export async function suggestAccount(
  concept: string,
  companyId: string,
  invoiceType: InvoiceType
): Promise<AccountSuggestion[]>
```

Ejemplos de mapeo automático:
- "CORPOELEC" / "electricidad" → Cuenta: "Servicios Públicos" (EXPENSE)
- "Amazon AWS" / "cloud" / "hosting" → Cuenta: "Tecnología y Servicios en la Nube" (EXPENSE)
- "Alquiler oficina" → Cuenta: "Arrendamientos Pagados" (EXPENSE)
- "Venta de mercancía" → Cuenta: "Ventas" (REVENUE)

El sistema aprende del Plan de Cuentas propio de cada empresa (le pasa el catálogo como contexto al LLM).

### 31B. Detección de Anomalías Fiscales

Un "auditor automático" que revisa el Libro Mayor y genera alertas accionables:

**`FiscalAnomalyDetectorService.ts`**:

```typescript
interface FiscalAnomaly {
  severity: 'error' | 'warning' | 'info'
  invoiceId: string
  description: string
  legalReference: string  // ej: "Providencia 0056, Art. 5"
  suggestedAction: string
}

// Reglas implementadas:
// 1. Factura de Contribuyente Especial sin retención IVA
// 2. Pago Zelle sin IGTF registrado
// 3. Factura USD sin tasa de cambio BCV del día
// 4. Factura con monto > umbral sin retención ISLR
// 5. Nota de Crédito sin factura original vinculada
// 6. Período cerrado con facturas pendientes de pago
```

**UI**: Panel "Alertas Fiscales" en el Dashboard con contador de anomalías pendientes. Cada alerta tiene botón "Corregir" que lleva directamente al documento con el problema.

### Posicionamiento de mercado
Ningún software contable venezolano (Gálac, CG1, Monica, Odoo local) tiene un auditor fiscal automático. Es el primer diferenciador verdaderamente único de ContaFlow en el mercado.

### Stack
- Groq `llama-3.1-8b-instant` para clasificación (ya en stack, gratuito en Plan Free)
- Gemini Flash para detección de anomalías en Plan Pro (mayor precisión, contexto más largo)
- Las reglas de anomalías son deterministas primero (sin LLM), el LLM solo para descripción natural del error

## 32. Ventajas Competitivas Consolidadas vs Odoo

| Feature | ContaFlow | Odoo (Venezuela) |
|---|---|---|
| Tasa BCV automática | ✅ Cron diario, auditado, fuente trazable | ❌ Manual o conector de pago externo |
| Retenciones ISLR con sugerencia | ✅ Asistente inteligente Decreto 1808 | ❌ Configuración manual propensa a error |
| Validación RIF SENIAT | ✅ En tiempo real, fallback graceful | ❌ Texto libre, sin validación |
| IGTF automático | ✅ Nativo (Zelle, Cashea, divisas) | ❌ Requiere módulo local de terceros |
| Batch payments bancos VEN | ✅ Banesco, Mercantil, BDV nativo | ❌ Conector personalizado por partner |
| Detección anomalías fiscales | ✅ Auditor automático IA | ❌ No existe en ningún software VEN |
| PagoMóvil nativo | ✅ Con código de referencia obligatorio | ❌ No existe |
| Multimoneda VES/USD con historial | ✅ Por factura, auditado | ⚠️ Genérico, sin VEN-NIF |
| Cierre de ejercicio VEN-NIF | ✅ Con asiento de apropiación diferible | ⚠️ Genérico, sin flujo LOTTT/AGO |
| Nómina VEN-NIF wizard | ✅ Configuración guiada, no preguntas abiertas | ❌ Configuración manual compleja |
| Conciliación bancaria VEN | ✅ Doble columna + IGTF auto-detect + bancos VEN | ⚠️ Genérico, sin bancos locales |

## 33. Fase 17B — Conciliación Bancaria: Spec VEN-NIF Completo

### Lo que YA existe (scaffolding — no reimplementar)
- Schema parcial: `BankAccount`, `BankStatement`, `BankTransaction`
- Migración `20260331_fase17_bank_reconciliation` — aplicada
- Componentes parciales: `BankAccountList`, `BankStatementUpload`, `ReconciliationWorkbench`
- Páginas: `/bank-reconciliation/` + `/bank-reconciliation/[statementId]/`
- Navbar: link "Conciliación" ya activo con LandmarkIcon

### Schema — añadir a BankAccount
```prisma
accountNumber   String          // 20 dígitos Venezuela
accountType     BankAccountType // enum CORRIENTE | AHORROS | CUSTODIA
openingBalance  Decimal         @db.Decimal(19,4)

enum BankAccountType { CORRIENTE AHORROS CUSTODIA }
```

### Schema — nuevo modelo BankStatementLine
```prisma
model BankStatementLine {
  id            String    @id @default(cuid())
  companyId     String
  bankAccountId String
  date          DateTime
  description   String
  reference     String
  amount        Decimal   @db.Decimal(19, 4)
  isMatched     Boolean   @default(false)
  matchedAt     DateTime?
  transactionId String?   @unique  // → Transaction
  paymentId     String?   @unique  // → PaymentRecord
  createdAt     DateTime  @default(now())
  createdBy     String
  @@index([companyId, bankAccountId])
  @@index([isMatched])
}
```

### UI — vista de trabajo (doble columna)
- Izquierda: líneas del extracto bancario importado
- Derecha: movimientos del Libro Auxiliar (Transactions + PaymentRecord)
- Acción central: botón "Vincular" → marca `isMatched = true` en ambos lados
- Líneas no vinculadas resaltadas en amarillo

### Importador CSV/Excel
- Upload CSV/Excel del extracto bancario
- Mapeador de columnas: usuario indica qué columna es fecha, monto, referencia
- Bancos prioritarios: Banesco, Mercantil, BDV, Provincial

### Reporte PDF/Excel — formato VEN-NIF
```
Saldo según Libro al [Fecha]
(+) Cheques/Transferencias en tránsito
(+) Depósitos no acreditados
(-) Notas de Débito no registradas (comisiones/IGTF)
(-) Notas de Crédito no registradas
= Saldo según Estado de Cuenta Bancario
(en VES y en moneda original si cuenta USD/EUR)
```

### Automatizaciones VEN-NIF
- Detectar IGTF (3%) en notas de débito del extracto → sugerir asiento de gasto si no existe
- Cuenta USD/EUR: validar que saldo VES coincida con re-expresión a tasa BCV del cierre de mes

### Agentes responsables
- **arch-agent**: schema (BankStatementLine + campos BankAccount)
- **ledger-agent**: `ReconciliationService`: `matchLine`, `unmatchLine`, `getReconciliationReport`
- **ui-agent**: doble columna + importador CSV con mapeador de columnas
- **fiscal-agent**: IGTF auto-detect + diferencial cambiario USD/EUR

## 34. Fase 23 — Nómina (LOTTT): Subfases _(estructura revisada 2026-04-14)_

La nómina venezolana es el módulo más complejo del sistema. Dividida en 5 subfases
para evitar saturación de contexto y errores de implementación.

**Regla**: implementar una subfase por sesión de Claude Code. Reset de chat entre subfases.
**Prerequisito**: tener al menos 5 clientes pagando antes de iniciar Fase NOM-A.

> **Nota de nomenclatura**: las subfases de Nómina usan prefijo `NOM-` para evitar colisión
> con Fase 23B (auto-conciliación ✅) y Fase 23C (NC/ND ✅) ya completadas.

### Resumen de subfases

| Subfase | Contenido principal | Adiciones aprobadas 2026-04-14 |
|---|---|---|
| **NOM-A** | Wizard onboarding: tamaño, régimen LOTTT, moneda, frecuencia, organismos, cesta ticket, fideicomiso | — |
| **NOM-B** | CRUD empleados + tipo contrato + conceptos configurables + organismos | +Calendario/feriados, tipos de ausencia, historial de salarios |
| **NOM-C** | Motor de cálculo (quincenal/mensual) + recibo PDF + causación asiento | +Movimientos (HE, permisos, ausencias), guard doble-proceso |
| **NOM-D** | Prestaciones (doble régimen) + intereses + vacaciones + utilidades | +Flujo Liquidación Final al egreso |
| **NOM-E** | Forma 14-02 IVSS + INCES + Banavih + resumen SENIAT | +ARC/ISLR empleados (Forma AR-C) |

---

### Fase NOM-A — Wizard de Configuración de Nómina
Onboarding guiado con opciones (no preguntas abiertas):
- Tamaño empresa: < 20 / 20-100 / > 100 empleados
- Régimen LOTTT: post-2012 / mixto (empleados de ambos regímenes)
- Moneda de pago: VES / USD / mixto
- Frecuencia: quincenal / mensual
- Organismos activos (checkboxes): IVSS, INCES, Banavih
- Cesta ticket: tarjeta / efectivo / no aplica
- Fideicomiso: banco externo / contabilidad interna

### Fase NOM-B — Empleados, Conceptos, Feriados e Historial
- CRUD de empleados con campos LOTTT completos
- Tipo de contrato: tiempo indeterminado / determinado / obra determinada _(afecta liquidación)_
- Tabla de conceptos configurables (salario base, bonos, comisiones, deducciones)
- Cálculo automático IVSS, INCES, Banavih según configuración NOM-A
- **+Calendario laboral**: feriados nacionales fijos + variables (Carnaval, Semana Santa)
- **+Tipos de ausencia**: justificada / injustificada / reposo médico / permiso _(con/sin descuento)_
- **+Historial de salarios** (`SalaryHistory`): fecha_desde, monto, moneda — necesario para cálculo retroactivo de prestaciones y aumentos salariales

### Fase NOM-C — Motor de Cálculo, Recibo PDF y Causación Contable
- Motor de cálculo según frecuencia (quincenal/mensual)
- **+Movimientos de nómina**: ausencias por período, horas extras (diurnas +25%, nocturnas +75%, feriado +100% — LOTTT Art. 118), permisos
- **+Guard doble-proceso**: una nómina cerrada no puede recalcularse ni causarse dos veces
- Recibo de pago PDF por empleado (A4 portrait)
- Causación automática → asiento en `Transactions` (EXPENSE) — integra con ExchangeRate si moneda USD/EUR
- Retención ISLR si salario anual supera el UTAT exento

### Fase NOM-D — Prestaciones Sociales, Pasivos Laborales y Liquidación Final
- Cálculo de prestaciones (el más complejo — doble régimen pre/post 2012)
- Garantía de prestaciones trimestral (nuevo régimen LOTTT 2012)
- Prestación de antigüedad (viejo régimen LOT 1997 — empleados mixtos)
- Intereses sobre prestaciones (tasa BCV fideicomiso activa)
- Vacaciones y bono vacacional por antigüedad (escala LOTTT)
- Utilidades proporcionales (mínimo 15 días — cierre al 31/12 del período fiscal activo)
- Fideicomiso: registro en BD vs. banco externo (configurado en NOM-A)
- **+Flujo de Liquidación Final**: trigger al marcar empleado como `TERMINATED` → calcula prestaciones acumuladas + vacaciones fraccionadas + utilidades fraccionadas + bono vacacional fraccionado + preaviso (según tipo de contrato y causa de egreso) → genera recibo PDF de liquidación separado del recibo de nómina

### Fase NOM-E — Reportes Legales e ISLR Empleados
- Forma 14-02 IVSS (planilla mensual)
- Planilla INCES (declaración trimestral)
- Declaración Banavih
- Resumen de nómina para SENIAT
- **+ARC / ISLR empleados**: cálculo de ISLR persona natural sobre salario (tabla SENIAT progresiva), retención mensual, emisión de **Forma AR-C** (certificado de retenciones anual) y **Forma AR-I** (comprobante mensual)
- Reportes por departamento / centro de costo

---

### Integraciones con módulos existentes (sin código nuevo — solo conectar)

| Módulo | Integración |
|---|---|
| **ExchangeRate (Fase 14)** | Nóminas en USD → conversión BCV automática al día de pago |
| **FiscalYear (Fase 15)** | Utilidades se cierran al 31/12 del período fiscal activo |
| **AuditLog (Fase 31)** | Toda nómina procesada o modificada queda en `auditLog` |
| **ReportCache (Fase 13C)** | Nóminas ya causadas no recalculan (guard doble-proceso) |

## 37. Fase 21 — Activos Fijos y Depreciación (VEN-NIF 16 / IAS 16) ✅ completada 2026-04-07

### Norma aplicable

VEN-NIF 16 (equivalente a IAS 16 — Propiedades, Planta y Equipo). Fase 22 aplicará ajuste por inflación INPC. Esta fase registra costo histórico.

### Schema añadido

```prisma
enum DepreciationMethod { LINEA_RECTA  SUMA_DIGITOS  UNIDADES_PRODUCCION }
enum FixedAssetStatus   { ACTIVE  DISPOSED  FULLY_DEPRECIATED }

model FixedAsset {
  companyId                String  → Company (onDelete: Restrict)
  assetAccountId           String  → Account (onDelete: Restrict) — ASSET
  depreciationAccountId    String  → Account (onDelete: Restrict) — EXPENSE
  accDepreciationAccountId String  → Account (onDelete: Restrict) — ASSET crédito
  acquisitionDate          Date
  acquisitionCost          Decimal(19,4)
  residualValue            Decimal(19,4) @default(0)
  usefulLifeMonths         Int
  depreciationMethod       DepreciationMethod @default(LINEA_RECTA)
  status                   FixedAssetStatus @default(ACTIVE)
  totalUnits               Int?   — solo UNIDADES_PRODUCCION
  deletedAt                DateTime?  — soft delete ADR-005
  @@index([companyId, status])
}

model DepreciationEntry {
  fixedAssetId   String → FixedAsset (onDelete: Restrict)
  transactionId  String? @unique → Transaction (onDelete: Restrict)
  periodYear     Int
  periodMonth    Int
  amount                  Decimal(19,4)
  accumulatedDepreciation Decimal(19,4)
  bookValue               Decimal(19,4)
  @@unique([fixedAssetId, periodYear, periodMonth])
}
```

**Migración**: `20260407_feat_21_fixed_assets`

### Módulo `src/modules/fixed-assets/`

- **`FixedAssetService.ts`**:
  - `calcMonthlyDepreciation(asset, month1, units?)` — pure fn, testable, soporta los 3 métodos
  - `calcDepreciationForPeriod(asset, month1, prevAcc, units?)` — con cap al valor depreciable
  - `generateDepreciationSchedule(asset)` — tabla proyectada completa sin BD
  - `postDepreciation(assetId, year, month, userId, tx)` — idempotente (@@unique); crea `Transaction` tipo AJUSTE + `DepreciationEntry` en mismo `$transaction`
  - `postMonthlyDepreciation(companyId, year, month, userId, tx)` — masivo para todos los activos ACTIVE
  - `dispose(input, userId, tx)` — asiento de baja (crédito activo, débito dep. acumulada, ganancia/pérdida)
  - `getSummary(companyId)` — valor en libros actual por activo
  - `getSchedule(assetId, companyId)` — proyección + historial real registrado

- **Schemas Zod**: `CreateFixedAssetSchema`, `PostMonthlyDepreciationSchema`, `DisposeFixedAssetSchema`

- **Actions**: `createFixedAssetAction`, `postMonthlyDepreciationAction`, `disposeFixedAssetAction` (solo ADMIN), `getFixedAssetsAction`, `getDepreciationScheduleAction`, `previewDepreciationScheduleAction`
  - Guard año fiscal cerrado en create y post-depreciation
  - Rate limiting: `limiters.fiscal`
  - `withCompanyContext` (RLS ADR-007) en todas las mutations

- **Componentes**:
  - `FixedAssetList.tsx` — tabla con valor en libros, dep. acumulada, estado, botón baja
  - `FixedAssetForm.tsx` — crea activo con selector de cuentas contables por tipo
  - `DepreciationScheduleModal.tsx` — tabla mes a mes proyectada + estado registrado/pendiente

### Rutas

- `/company/[companyId]/fixed-assets` — listado + formulario + panel depreciación mensual
- Navbar: "Más → Activos Fijos" con icono `Building2`

### Fórmulas VEN-NIF implementadas

| Método | Fórmula cuota mensual |
|---|---|
| Línea Recta | (Costo − Residual) / Vida útil en meses |
| Suma de Dígitos | Depreciable × (n − m + 1) / Σ(1..n) |
| Unidades de Producción | (Costo − Residual) / Total unidades × Unidades del período |

### Tests

- 22 tests `FixedAssetService.test.ts`: los 3 métodos con fixtures exactos, cap al final, schedule completo, cruce año diciembre→enero (UTC fix)
- 13 tests `fixed-asset.actions.test.ts`: auth, roles, año cerrado, happy paths
- **691 tests GREEN | 0 TS errors**

## 38. Fase 22 — Ajuste por Inflación INPC (VEN-NIF 3) ✅ completada 2026-04-07

### Módulo `src/modules/inflation/`

VEN-NIF 3 (NIC 29) — reexpresión de estados financieros en unidad de poder adquisitivo corriente usando el INPC publicado por el BCV.

### Schema

```prisma
model INPCRate {
  companyId   String; year Int; month Int; indexValue Decimal(18,6)
  @@unique([companyId, year, month])
  onDelete: Restrict (ADR-003)
}

model InflationAdjustment {
  companyId; periodYear; periodMonth; baseYear; baseMonth
  accountId; originalAmount Decimal(19,4); adjustmentAmount Decimal(19,4)
  cumulativeIndex Decimal(18,6)
  transactionId String  // NON-NULLABLE — VEN-NIF 3 (ADR-008 D-1)
  @@unique([companyId, periodYear, periodMonth, accountId])
  onDelete: Restrict (ADR-003)
}
// Company: inflationBaseYear Int?; inflationBaseMonth Int?
```

### Fórmulas

| Variable | Fórmula |
|---|---|
| factor | `currentINPC / baseINPC` |
| adjustmentAmount | `accountBalance × (factor − 1)` |
| contrapartida | `−Σ(adjustments)` → cuenta actualizadora (EQUITY) |

### Pure functions (testables)

- `calcInflationFactor(baseIndex, currentIndex)` — lanza si baseIndex ≤ 0
- `calcAdjustmentAmount(balance, factor)` — hereda signo del saldo (débito/crédito correcto para todos los tipos)
- `lastDayOfMonth(year, month)` — UTC, para filtrar saldos del período

### Correcciones aprobadas (vs propuesta inicial)

1. **Scope completo**: ASSET + LIABILITY + EQUITY + REVENUE + EXPENSE
2. **transactionId NON-NULLABLE** — ADR-008 D-1
3. **inflationBaseYear/Month en Company** — ADR-008 D-3
4. **FiscalYearClose guard** en `runInflationAdjustmentAction` — ADR-008 D-7
5. **Preview detallado antes del AlertDialog** — muestra tabla de asientos proyectados

### Acciones

| Acción | Rol | Guard |
|---|---|---|
| `upsertINPCRateAction` | ACCOUNTANT+ | rate limit |
| `getINPCRatesAction` | cualquier miembro | — |
| `setInflationBaseAction` | ADMIN | — |
| `previewInflationAdjustmentAction` | cualquier miembro | — |
| `runInflationAdjustmentAction` | ADMIN | FiscalYearClose + Serializable |

### Tests

- 15 tests `INPCService.test.ts`: calcInflationFactor (5), calcAdjustmentAmount (5), lastDayOfMonth (5), invarianzas contables (2 — partida doble + roundtrip)
- 17 tests `inpc.actions.test.ts`: auth, VIEWER reject, ADMIN-only, FiscalYearClose guard, validación Zod
- **723 tests GREEN | 0 TS errors**

## 35. Fase 19 — Declaración Mensual IVA (Forma 30 SENIAT) ✅ completada 2026-04-07

### Módulo `src/modules/iva-declaration/`

- **`DeclaracionIVAService.ts`** — `calcularForma30(companyId, year, month)` → `Forma30Data`
  - Agrega taxLines por alícuota (IVA_GENERAL 16%, IVA_REDUCIDO 8%, IVA_ADICIONAL 15%, EXENTO)
  - Suma retenciones IVA soportadas (PURCHASE) y retenidas (SALE + isSpecialContributor)
  - Calcula débito fiscal, crédito fiscal, retenciones, saldo a pagar/favor
  - VEN-NIF: artículos 43–46 LIVA
- **`generarForma30Action(companyId, year, month)`** — auth-gated, rate limiting fiscal
- **`Forma30View.tsx`** — tabla fiscal resumen + filas por alícuota + saldo final coloreado

### Fase 19C — PDF export ✅

- **`Forma30PDFService.ts`** — A4 portrait, tabla Forma 30 completa con totales y saldo
- **`exportForma30PDFAction()`** — retorna `{ success: true; buffer: number[] }`
- Botón "Exportar PDF" en Forma30View

### Tests

- 23 tests `DeclaracionIVAService.test.ts` + 17 tests `Forma30PDFService.test.ts` (unit)
- Action tests incluidos

### Rutas

- `/company/[companyId]/iva-declaration` — formulario mes/año + Forma 30 calculada
- Navbar: link "IVA/Fiscal" activo

---

## 36. Fase 20 — XML SENIAT Descargable + QR Code en PDF ✅ completada 2026-04-07

### Contexto legal

Venezuela no tiene SDCA/SIEX operativo (anunciado, no desplegado). XML descargable es la implementación correcta de Providencia 0071 SENIAT — útil para software de terceros y auditorías.

### Arquitectura (ADR-008)

**D-1**: XML generado como string puro (KISS — sin xmlbuilder ni fast-xml-parser)
**D-2**: Namespace `urn:ve:seniat:factura:1.0` (convención, sin API oficial SENIAT)
**D-3**: Estructura: Encabezado → Emisor → Receptor → DetalleImpuestos → Totales → Retenciones? → IGTF?
**D-4**: QR format: `CONTAFLOW:RIF={rif};FACTURA={nro};CONTROL={ctrl};TOTAL={total};FECHA={fecha};MONEDA={moneda}`
**D-5**: QR generado server-side con `qrcode` Node.js → base64 data URL → `@react-pdf/renderer Image`
**D-6**: `escapeXml()` aplica a todos los valores de texto (5 caracteres: `& < > " '`)
**D-7**: Nodos opcionales omitidos si null/undefined/cero (NumeroControl, Direccion, Retenciones, IGTF)
**D-8**: `exportInvoiceXMLAction` con `limiters.fiscal` (30/min)

### Archivos nuevos/modificados

| Archivo | Cambio |
|---|---|
| `src/modules/invoices/services/SeniatXMLService.ts` | NUEVO — `generate()`, `filename()`, `qrContent()` |
| `src/modules/invoices/services/SeniatXMLService.test.ts` | NUEVO — 22 tests |
| `src/modules/invoices/services/InvoiceVoucherPDFService.ts` | + `QRSection` + `qrCodeDataUrl` param |
| `src/modules/invoices/actions/invoice.actions.ts` | + `exportInvoiceXMLAction` + QR en PDF action |
| `src/modules/invoices/actions/invoice.actions.test.ts` | + 8 tests XML action |
| `src/components/invoices/InvoiceBook.tsx` | + botón XML por fila (junto a botón PDF) |
| `contaflow-contract.md` | + ADR-008 documentado |

### Nodos XML por alícuota

```xml
<AlicuotaGeneral tasa="16.00"><BaseImponible>...</BaseImponible><MontoIVA>...</MontoIVA></AlicuotaGeneral>
<AlicuotaReducida tasa="8.00">...</AlicuotaReducida>
<AlicuotaAdicional tasa="15.00">...</AlicuotaAdicional>
<Exento><BaseImponible>...</BaseImponible></Exento>
```

### UI

- Botón "XML" (azul) por cada fila en InvoiceBook — junto al botón "PDF" existente
- Click → `exportInvoiceXMLAction()` → Blob download `application/xml`
- Toast de éxito/error con estado de carga individual por factura

### Tests totales post-Fase 20

**656 tests GREEN** | **0 TS errors** | **0 fallos**

---

## 39. Fase 23B — Auto-conciliación Bancaria con Gemini Vision ✅ completada 2026-04-08

### Contexto

La conciliación bancaria manual (CSV import + matching UI existente) era impráctica: el usuario tenía que preparar el CSV manualmente y marcar cada match. La nueva implementación permite subir el PDF del extracto bancario directamente — Gemini Vision lo parsea y el motor de scoring busca coincidencias automáticamente contra los registros del sistema.

### Arquitectura

**Fuentes de matching (3-way match)**:
- `InvoicePayment` — pagos de facturas de clientes
- `PaymentRecord` — pagos con múltiples medios (Pago Móvil, Zelle, etc.)
- `Transaction` — asientos contables (journals)

**Scoring algorithm** (base 100):
- Penalidad monto: hasta -40 (tolerancia ±1% del monto del extracto)
- Penalidad fecha: hasta -30 (tolerancia ±3 días)
- Bonus referencia: +20 si los números de referencia coinciden exactamente (capped a 100)
- Niveles: `AUTO` ≥ 90 | `SUGGESTED` 70–89 | `MANUAL` < 70

**Guard de período vacío**: si no hay transacciones en el período → `{ success: true, data: { periodHasData: false } }` (no error — es estado de negocio válido). UI muestra mensaje profesional bloqueante en ámbar.

**Formato venezolano**: los montos del extracto llegan como strings (`"1.000,50"`) — el servicio convierte con `parseAmount()` de `CsvParserService`. Gemini recibe instrucción explícita de no convertir los valores.

### Servicios nuevos

| Servicio | Responsabilidad |
|---|---|
| `GeminiBankStatementService.ts` | Parsea PDF bancario con Gemini Vision — `extractFromPdf(base64Pdf)` → `ExtractedBankStatement` |
| `AutoReconciliationService.ts` | Motor de matching — `run()`, `_scoreRow()`, `periodHasTransactions()` |

**Notas de concurrencia**: las filas se procesan en serie (no paralelo) dentro de `run()` para evitar presión en el pool de Neon.

### Acciones nuevas

| Acción | Rol mínimo | Rate limit |
|---|---|---|
| `parseBankStatementAction` | cualquiera (VIEWER incluido — solo lectura) | `limiters.ocr` (10/min) |
| `runAutoReconciliationAction` | ADMIN / ACCOUNTANT | `limiters.fiscal` (30/min) |
| `confirmSuggestedAction` | ADMIN / ACCOUNTANT | ninguno |

### Componente UI

**`AutoReconciliationPanel.tsx`** — máquina de estados con `useReducer`:

```
UPLOAD → PREVIEW → RUNNING → RESULTS → CONFIRMED
```

- **UPLOAD**: dropzone PDF (10 MB máx), base64 via FileReader
- **PREVIEW**: tabla de filas parseadas antes de procesar
- **RUNNING**: spinner + indicador de progreso
- **RESULTS**: 3 secciones colapsables: Auto-conciliados / Sugeridos / Sin conciliar
- **CONFIRMED**: resumen final + opción de nueva carga

Confirmación de sugeridos: `Map<string, {matchType, matchId}>` — batch confirm con `confirmSuggestedAction`.

### Fix incluido: selector de cuenta contable

El formulario de nueva cuenta bancaria reemplaza el `<input type="text">` del campo `accountId` (que causaba FK constraint violation cuando el usuario escribía códigos como "1.1.1.0") por un `<select>` dropdown con las cuentas del plan de cuentas cargadas desde el servidor (`code — name`, `value={id}`).

### Archivos nuevos/modificados

| Archivo | Cambio |
|---|---|
| `src/modules/bank-reconciliation/schemas/auto-reconciliation.schema.ts` | NUEVO — Zod schemas + tipos |
| `src/modules/bank-reconciliation/services/GeminiBankStatementService.ts` | NUEVO |
| `src/modules/bank-reconciliation/services/AutoReconciliationService.ts` | NUEVO |
| `src/modules/bank-reconciliation/actions/auto-reconciliation.actions.ts` | NUEVO |
| `src/modules/bank-reconciliation/components/AutoReconciliationPanel.tsx` | NUEVO |
| `src/modules/bank-reconciliation/components/BankAccountList.tsx` | + dropdown cuenta contable |
| `src/app/(dashboard)/company/[companyId]/bank-reconciliation/page.tsx` | + chartAccounts + AutoReconciliationPanel |
| `src/modules/bank-reconciliation/services/CsvParserService.ts` | `parseAmount` → export |

### Tests

- 7 tests `GeminiBankStatementService.test.ts`: happy path, markdown wrapping, HTTP 500, error body, JSON inválido, API key ausente, formato venezolano
- 12 tests `AutoReconciliationService.test.ts`: periodHasTransactions, score 100 AUTO, sin candidatos MANUAL, bonus referencia, multi-fuente, partición, CREDIT row, JOURNAL_ENTRY
- 11 tests `auto-reconciliation.actions.test.ts`: auth, VIEWER, Zod, rate limit, guard período, happy path por acción

**755 tests GREEN** | **0 TS errors**

---

## 40. ADR-010 — Testing Strategy ✅ completada 2026-04-08

### Cambios aplicados

**Mejora 1 — Phase gate step 0**: `CLAUDE.md` actualizado. El agente DEBE activar `security-agent` antes de proponer cualquier fase nueva para auditar superficie de ataque (Server Actions, endpoints, Prisma models, auth changes).

**Mejora 2 — ADR-010 Testing Strategy** (`contaflow-contract.md`):
- D-1: Unit tests con mocks (patrón actual) — `vitest run` por defecto
- D-2: Integration tests con DB real (`DATABASE_URL_TEST`) — `src/__tests__/integration/` — solo con `--config vitest.integration.config.ts`
- D-3: E2E Playwright — Fase futura, no bloquea fases actuales
- D-4: Cobertura mínima por fase: ≥ 2–3 casos negativos no triviales por servicio nuevo

**Mejora 3 — Guard INPC en `runInflationAdjustmentAction`**:
- Verifica `prisma.company.findUnique` para obtener `inflationBaseYear/Month`
- Verifica `prisma.iNPCRate.findUnique` para tasa base y tasa del período actual
- Error descriptivo si falta cualquiera: `"No existe tasa INPC base (2022/01). Cárgala antes de ejecutar el ajuste."`
- 2 tests nuevos: guard base no existe + guard período actual no existe
- Total `inpc.actions.test.ts`: 17 tests

**Mejora 4 — Integration tests tier base**:
- `vitest.config.ts`: excluye `src/__tests__/integration/**` del run por defecto
- `vitest.integration.config.ts`: config separada — `npx vitest run --config vitest.integration.config.ts`
- `src/__tests__/integration/README.md`: instrucciones + advertencia DB prod
- `src/__tests__/integration/control-number-sequence.test.ts`: primer test real — verifica que llamadas concurrentes a `getNextControlNumber` no retornan el mismo número (`describe.skipIf(!DATABASE_URL_TEST)`)

**Mejora 5 — ADR-011 OCR Idempotencia** (`contaflow-contract.md`): decisión PENDIENTE/YAGNI — hash SHA-256 del PDF como idempotencyKey opcional para `extractInvoiceAction`. No implementar hasta caso real reportado.

**755 tests GREEN** | **0 TS errors** _(actualizado a 779 en Fase 23C)_

---

## 41. Fase 23C — NC/ND Workflow completo ✅ completada 2026-04-12

### Objetivo

Workflow fiscal completo para Notas de Crédito y Débito (Reglamento IVA Art. 58). Vinculación formal con factura original, neto automático en CxC/CxP y asiento compensador.

### Schema

```prisma
// Invoice — self-relation NC/ND → FACTURA original
relatedInvoiceId  String?
relatedInvoice    Invoice?  @relation("CreditDebitNotes", fields: [relatedInvoiceId], references: [id], onDelete: Restrict)
creditDebitNotes  Invoice[] @relation("CreditDebitNotes")
@@index([relatedInvoiceId])
```

Migración: `20260412_feat_23c_nc_nd_self_relation` — `ADD COLUMN NULL`, 0 filas afectadas.

### Servicios nuevos (InvoiceService)

- `createCreditNote(companyId, data, createdBy)` — Serializable tx, pendingAmount-, paymentStatus recalculado
- `createDebitNote(companyId, data, createdBy)` — Serializable tx, pendingAmount+, PAID→PARTIAL
- `getCreditDebitNotes(originalInvoiceId, companyId)` — read-only, ADR-004

### Decisiones de seguridad (security-agent pre/post audit)

| Finding | Resolución |
|---|---|
| CRITICAL-1: cross-tenant `relatedInvoiceId` | `findFirst({ id, companyId })` dentro de tx Serializable |
| CRITICAL-2: TOCTOU en pendingAmount | `$transaction({ isolationLevel: 'Serializable' })` en NC y ND |
| HIGH-1: VOID guard en service layer | `deletedAt \|\| paymentStatus === "VOIDED"` en NC y ND |
| HIGH-2: role VIEWER en acciones | Ambas actions rechazan `role === "VIEWER"` |
| HIGH-3: loop self-reference | Guard `original.docType === "FACTURA"` antes de crear |
| MEDIUM-1: relatedDocNumber del cliente | `.transform()` lo elimina del schema; derivado server-side |
| MEDIUM-2: rate limit | `checkRateLimit(userId, limiters.fiscal)` en ambas actions |

### UI

- `InvoiceForm.tsx`: campo "Factura original" condicional (`docType === NOTA_CREDITO || NOTA_DEBITO`)
- `InvoiceBook.tsx`: badge `→ Factura {relatedDocNumber}` en filas NC/ND

### Tests

24 tests nuevos (15 service + 8 action + 1 regresión HIGH-1). **779 tests GREEN total.**

---

## 42. Fase 30 — Exportación Masiva / Backup ✅ completada 2026-04-13

**Branch:** `feat/fase-30-exportacion-masiva` → **commit:** `e8c9699`

### Objetivo

Permitir que contadores descarguen un ZIP con toda la data fiscal de una empresa en un rango de fechas. Es el segundo bloqueante de ventas identificado en el pre-launch checklist (el primero fue Fase 23C).

### Schema — nuevo modelo

```prisma
enum ExportJobStatus { PENDING | PROCESSING | DONE | ERROR }

model ExportJob {
  id        String          @id @default(cuid())
  companyId String          // → Company (onDelete: Restrict)
  createdBy String          // Clerk userId
  status    ExportJobStatus @default(PENDING)
  dateFrom  DateTime        @db.Date
  dateTo    DateTime        @db.Date
  fileData  Bytes?          // ZIP contents (null hasta DONE)
  fileSize  Int?
  expiresAt DateTime?       // now() + 24h al llegar a DONE
  errorMsg  String?
  @@index([companyId])
  @@index([createdBy])
}
```

### Archivos nuevos

- `src/modules/export/schemas/export.schema.ts` — `CreateExportJobSchema` con Zod refine (dateTo ≥ dateFrom, máx 366 días)
- `src/modules/export/services/ExportService.ts` — `generateExportZip(params)`: fetches invoices/transactions/retenciones/fixedAssets + Forma30 per-month via `DeclaracionIVAService.calculate`, genera ZIP con JSZip
- `src/modules/export/actions/export.actions.ts` — `createExportJobAction` + `listExportJobsAction`
- `src/app/api/export/download/route.ts` — GET route autenticado con Clerk + ownership check
- `src/app/(dashboard)/company/[companyId]/export/page.tsx` — página de exportación
- `src/modules/export/components/ExportForm.tsx` — form con rango de fechas + botón descarga
- `src/modules/export/components/ExportJobList.tsx` — historial de jobs con status badges

### Contenido del ZIP

```
LEEME.txt
libros-iva/libro-ventas.csv
libros-iva/libro-compras.csv
asientos/asientos.csv
retenciones/retenciones.csv
activos-fijos/activos.csv
forma-30/forma30.csv
```

### Seguridad (manual audit — security-agent no disponible)

| Finding | Mitigación |
|---------|-----------|
| CRITICAL-1: cross-tenant dump vía download route | `job.createdBy === userId` + companyMember check en GET /api/export/download |
| CRITICAL-2: queries sin companyId | `companyId` explícito en las 5 queries de ExportService |
| HIGH-1: DoS por rango ilimitado | Zod refine máx 366 días |
| MEDIUM-1: exports concurrentes por empresa | Guard `findFirst({ status: { in: ["PENDING","PROCESSING"] } })` |
| MEDIUM-2: rate limit | `limiters.export` (3/10min) en ratelimit.ts |

### Tests

23 tests nuevos (9 ExportService + 14 export.actions). **802 tests GREEN total.**

---

## Sección 43 — Fases 28A/28B/28C: Separación de Roles y Nav Dinámico (2026-04-13)

### Fase 28A — Schema + Auth Foundation

**UserRole enum** (5 roles):
```
OWNER         // Propietario — creador de empresa, acceso total
ADMIN         // Administrador — acceso total, asignado por propietario
ACCOUNTANT    // Contador — módulos contables
ADMINISTRATIVE // Administrativo — módulos operativos (Fase 28+)
VIEWER        // Observador — solo lectura en su área
```

- `prisma/migrations/20260413_feat_28a_role_expansion/migration.sql` — `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS`
- `CompanyService.createCompany`: asigna `OWNER` en lugar de `ADMIN` al creador
- `src/lib/auth-helpers.ts`: `canAccess(role, allowedRoles)`, `ROLE_HIERARCHY`, `ROLES` groups, `ROLE_LABELS`

**ROLES groups:**
- `ROLES.ADMIN_ONLY` = `[OWNER, ADMIN]`
- `ROLES.ACCOUNTING` = `[OWNER, ADMIN, ACCOUNTANT]`
- `ROLES.OPERATIONS` = `[OWNER, ADMIN, ADMINISTRATIVE]`
- `ROLES.WRITERS` = `[OWNER, ADMIN, ACCOUNTANT, ADMINISTRATIVE]`

### Fase 28B — Nav Dinámico por Rol

- `src/lib/nav-items.ts`: `getNavItems(role, companyId)` → `{ primary: NavItem[], sections: NavSection[] }`
- Navbar refactorizado: items primarios fijos + dropdown "Más" con headers de sección
- Badge "Pronto" para ítems `comingSoon` (Inventario) — deshabilitados visualmente
- Layout `company/[companyId]/layout.tsx` pasa `userRole={company.role}` al Navbar
- **VIEWER**: hereda nav de ACCOUNTANT; restricciones de escritura por guards (28C)

| Rol | Primary | Secciones en dropdown |
|---|---|---|
| OWNER/ADMIN | Dashboard, Asientos, Plan de Cuentas, Reportes | Contabilidad, Operaciones, Administración |
| ACCOUNTANT | Dashboard, Asientos, Plan de Cuentas, Libros IVA | Contabilidad, Inventario (pronto), Reportes |
| ADMINISTRATIVE | Dashboard, Facturas, Pagos | Operaciones, Inventario (pronto) |

### Fase 28C — Role Guards en Server Actions

**13 archivos de actions actualizados** con `canAccess()` de `auth-helpers.ts`:

| Guard | Módulos | Restricción nueva |
|---|---|---|
| `ROLES.ACCOUNTING` | transactions, accounts, retentions, IGTF, fixed-assets, inflation, banking, auto-reconciliation | ADMINISTRATIVE no puede escribir en módulos contables |
| `ROLES.WRITERS` | invoices, payments, exchange-rates, export, receivables-write | VIEWER bloqueado; todos los demás pueden operar |
| `ROLES.ADMIN_ONLY` | periods, company, import, banking-admin, receivables-cancel | Fix: OWNER ya no queda bloqueado (bug: `role !== "ADMIN"` → `!canAccess(role, ROLES.ADMIN_ONLY)`) |

**Dashboard dinámico** (`page.tsx`):
- `RoleBadge`: badge de color por rol (Propietario, Contador, Administrativo…)
- `DashboardCTA`: botones contextuales (Contador → "Nuevo Asiento"; Administrativo → "Facturas + Pago")
- `QuickAccess`: 6 accesos rápidos por área (Inventario aparece con badge "Pronto")
- Métricas contables ocultas para ADMINISTRATIVE (placeholder operativo)

### Tests
802 tests GREEN — sin nuevos tests en 28A/28B/28C (guards son cambios de comportamiento, no nueva lógica). 4 archivos de tests actualizados con regex `/módulo contable|no autorizado/i`.

---

## Sección 44 — Fase 28D: Módulo Inventario (2026-04-13)

### Schema (Prisma + Neon aplicado vía `prisma db push`)

```prisma
enum MovementType  { ENTRADA SALIDA AJUSTE }
enum MovementStatus { DRAFT POSTED VOIDED }

model InventoryItem {
  id            String    @id @default(cuid())
  companyId     String
  sku           String
  name          String
  description   String?
  unit          String
  averageCost   Decimal   @default(0) @db.Decimal(19,4)
  stockQuantity Decimal   @default(0) @db.Decimal(19,4)
  accountId     String?   // cuenta de inventario
  cogsAccountId String?   // cuenta COGS
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  createdBy     String
  @@unique([companyId, sku])
  @@index([companyId])
}

model InventoryMovement {
  id             String         @id @default(cuid())
  companyId      String
  itemId         String
  type           MovementType
  status         MovementStatus @default(DRAFT)
  quantity       Decimal        @db.Decimal(19,4)
  unitCost       Decimal        @db.Decimal(19,4)
  totalCost      Decimal        @db.Decimal(19,4)
  invoiceId      String?
  transactionId  String?        @unique
  reference      String?
  notes          String?
  date           DateTime
  idempotencyKey String         @unique
  createdAt      DateTime       @default(now())
  createdBy      String
  postedAt       DateTime?
  postedBy       String?
  @@index([companyId, status])
  @@index([companyId, date])
}
```

### Servicios

**`InventoryOperationsService`** — dominio ADMINISTRATIVE  
- `createInventoryItem`: CRITICAL-2 ownership de `accountId`/`cogsAccountId` antes de la TX  
- `updateInventoryItem`: CRITICAL-1 `findFirstOrThrow({ where: { id, companyId } })`  
- `createDraftMovement`: idempotency guard (`idempotencyKey @unique`), MEDIUM-2 (SALIDA usa `item.averageCost` — ignora `unitCost` del cliente), stock check para SALIDA  
- `voidDraftMovement`: solo si `status === DRAFT`  
- `getInventoryItems`, `getDraftMovements`: ADR-004 `companyId` obligatorio en `where`

**`InventoryAccountingService`** — dominio ACCOUNTANT, Serializable SSI obligatorio  
- `postMovement`: CPP = `(stock×avg + qty×unitCost)/(stock+qty)` para ENTRADA; SALIDA usa `avg` vigente. Genera `Transaction` + 2 `JournalEntry` (SALIDA: Débito COGS / Crédito Inventario; ENTRADA: Débito Inventario / Crédito proveedor placeholder). P2034 → "Conflicto de concurrencia — reintente la operación". `AuditLog` dentro de la misma TX.  
- `voidPostedMovement`: solo si `status === POSTED`. Revierte stock. Genera contra-asiento. Serializable SSI.  
- `getInventoryValuation`: `totalValue = Σ(stockQuantity × averageCost)`. ADR-004.

### Actions y Guards de Rol

| Action file | Guard | Quién accede |
|---|---|---|
| `inventory-operations.actions.ts` | `ROLES.OPERATIONS` | OWNER, ADMIN, ADMINISTRATIVE |
| `inventory-accounting.actions.ts` | `ROLES.ACCOUNTING` (mutaciones) | OWNER, ADMIN, ACCOUNTANT |
| `getInventoryValuationAction` | `ROLES.WRITERS` | OWNER, ADMIN, ACCOUNTANT, ADMINISTRATIVE |
| `softDeleteInventoryItemAction` | `ROLES.ADMIN_ONLY` | OWNER, ADMIN |

HIGH-2: ADMINISTRATIVE bloqueado en `postMovementAction` y `voidPostedMovementAction`.

### Tests (68 nuevos, 870 total GREEN)

- `InventoryOperationsService.test.ts` — 15 tests: CRITICAL-1/2, MEDIUM-2, idempotency, stock insuficiente, ADR-004  
- `InventoryAccountingService.test.ts` — 15 tests: CPP fórmula ENTRADA (avg=106.666…), SALIDA sin cambio de avg, HIGH-4 stock guard, asiento SALIDA, P2034, Serializable assertion, AuditLog  
- `inventory-operations.actions.test.ts` — 27 tests: auth, rate limit, roles, Zod ceilings  
- `inventory-accounting.actions.test.ts` — 11 tests: HIGH-2, P2034 propagation, WRITERS valuation

## Sección 45 — Fase 28E: UI Módulo Inventario (2026-04-14)

### Objetivo

Exponer el módulo de inventario (Fase 28D) al usuario final con una UI diferenciada por rol, accesible desde la navegación principal.

### Archivos creados

| Archivo | Descripción |
|---|---|
| `src/app/(dashboard)/company/[companyId]/inventory/page.tsx` | Server component principal — carga de datos por rol y serialización Decimal→string |
| `src/modules/inventory/components/InventoryItemForm.tsx` | Formulario crear/editar producto (modo dual: create o edit inline) |
| `src/modules/inventory/components/InventoryItemList.tsx` | Tabla catálogo con stock coloreado, CPP, valor en libros, edición inline, soft-delete |
| `src/modules/inventory/components/MovementForm.tsx` | Formulario ENTRADA/SALIDA/AJUSTE con selector tipo, info de ítem, idempotency key |
| `src/modules/inventory/components/PendingMovementsList.tsx` | Cola DRAFT → Contabilizar/Anular para rol ACCOUNTANT+ |
| `src/modules/inventory/components/InventoryValuation.tsx` | 3 KPI cards + tabla ordenada por valor con barra porcentual |

### Modificaciones

- `src/lib/nav-items.ts` — eliminado `comingSoon: true` de los 3 ítems de Inventario (OWNER/ADMIN, ACCOUNTANT, ADMINISTRATIVE)

### Vista por rol

| Sección | OWNER/ADMIN | ACCOUNTANT | ADMINISTRATIVE |
|---|---|---|---|
| Valoración CPP (InventoryValuation) | ✅ | ✅ | ❌ |
| Movimientos pendientes (PendingMovementsList) | ✅ | ✅ | ❌ |
| Agregar producto (InventoryItemForm) | ✅ | ❌ | ✅ |
| Registrar movimiento (MovementForm) | ✅ | ❌ | ✅ |
| Catálogo + editar (InventoryItemList, canEdit) | ✅ | read-only | ✅ |
| Catálogo + eliminar (InventoryItemList, canDelete) | ✅ | ❌ | ❌ |

### Patrones clave

- `useTransition` en todos los formularios de mutación (patrón estándar del proyecto)
- `softDeleteInventoryItemAction(companyId, itemId)` — 2 args posicionales (no objeto)
- `canEdit={isOperations}` / `canDelete={isAdminOnly}` — props booleanas pasadas al cliente
- Stock coloring: rojo si `=== 0`, amarillo si `< 5`, gris si normal
- `crypto.randomUUID()` generado en cliente por cada submit de MovementForm
- Decimal serializado a `string` en el server component antes de pasar a props

### Tests

Sin tests nuevos (componentes cliente — 870 total sin cambio).

## Sección 46 — Fase 28F: UX Hardening (2026-04-14)

### Objetivo

Eliminar la brecha de feedback visual: toasts silenciosos, spinners ausentes e inconsistencia en el patrón de error handling entre módulos.

### Cambios

**1. Toaster global**
- `src/app/(dashboard)/company/[companyId]/layout.tsx` — `<Toaster richColors position="top-right" />` agregado
- Cubría 0 de 9 páginas críticas (bank-reconciliation, exchange-rates, export, fixed-assets, inflation, inventory, invoices, iva-declaration, analytics). Bug: `InvoiceBook.tsx` llamaba `toast.error()` sin `<Toaster>` — silencioso
- Eliminado `<Toaster>` duplicado de 6 páginas individuales (accounts, fiscal-close, payables, receivables, settings, transactions/new)

**2. Migración a sonner en componentes con DIY toast**

| Componente | Antes | Después |
|---|---|---|
| `InventoryItemList.tsx` | `useState + setTimeout` local | `toast.success/error` de sonner |
| `PendingMovementsList.tsx` | `useState + setTimeout` local | `toast.success/error` de sonner |
| `FixedAssetList.tsx` | `useState + setTimeout` local | `toast.success/error` de sonner |

**3. Spinners visuales en botones de acción**

| Componente | Botón |
|---|---|
| `InventoryItemForm.tsx` | submit (Creando.../Guardando...) |
| `MovementForm.tsx` | submit (Registrando...) |
| `FixedAssetList.tsx` | Calcular Depreciación del Mes |
| `PendingMovementsList.tsx` | Contabilizar / Anulando... |

Patrón: `<span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />`

### Tests

Sin tests nuevos — UI puro. 870 total GREEN.

## Sección 47 — Fase 31: AuditLog UI (2026-04-14)

### Objetivo

Exponer el historial de auditoría (`AuditLog`) a OWNER y ADMIN con una tabla paginada, filtros por entidad/usuario/fecha y diff expandible oldValue↔newValue.

### Problema arquitectónico resuelto

`AuditLog` no tenía `companyId` — imposible filtrar por empresa en multi-tenant. Solución: `companyId String?` (nullable para preservar registros históricos) + 2 índices de rendimiento.

### Schema (prisma/schema.prisma)

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  companyId  String?
  entityId   String
  entityName String
  action     String
  userId     String
  oldValue   Json?
  newValue   Json
  createdAt  DateTime @default(now())

  @@index([companyId, createdAt(sort: Desc)])
  @@index([companyId, entityName, createdAt(sort: Desc)])
}
```

Aplicado con `prisma db push` (patrón establecido — `prisma migrate dev` falla por RLS shadow DB P3006).

### Mass update — 44 auditLog.create() en 19 archivos

Cada `auditLog.create()` en producción actualizado con `companyId` usando la fuente correcta en cada contexto:

| Archivo | Fuente companyId |
|---|---|
| `TransactionService.ts` | `validated.companyId` / `original.companyId` |
| `PeriodService.ts` | param `companyId` |
| `account.actions.ts` | `validated.companyId` / `before.companyId` |
| `BankingService.ts` | param `companyId` |
| `BankReconciliationService.ts` | param `companyId` |
| `BankStatementService.ts` | param `companyId` |
| `CompanyService.ts` | `created.id` (CREATE) / param `companyId` |
| `exchange-rate.actions.ts` | param `companyId` |
| `fiscal-close.actions.ts` | `parsed.data.companyId` |
| `FiscalYearCloseService.ts` | param `companyId` |
| `FixedAssetService.ts` | `input.companyId` |
| `igtf.actions.ts` | `data.companyId` |
| `ImportService.ts` | param `companyId` |
| `INPCService.ts` | `input.companyId` / param `companyId` |
| `InventoryAccountingService.ts` | param `companyId` |
| `InventoryOperationsService.ts` | param `companyId` |
| `invoice.actions.ts` | `parsed.data.companyId` |
| `InvoiceService.ts` | param `companyId` |
| `payment.actions.ts` | `d.companyId` |
| `receivable.actions.ts` | `parsed.data.companyId` |
| `ReceivableService.ts` | `input.companyId` / param `companyId` |
| `retention.actions.ts` | `data.companyId` |
| `RetentionService.ts` | param `companyId` |

### Archivos nuevos

| Archivo | Descripción |
|---|---|
| `src/modules/audit/services/AuditLogService.ts` | `list()` paginado con filtros + `getDistinctEntityNames()` |
| `src/modules/audit/actions/audit.actions.ts` | `listAuditLogsAction` + `getAuditEntityNamesAction` — guard ADMIN_ONLY |
| `src/modules/audit/components/AuditLogTable.tsx` | Client component — filtros, DiffView expandible, paginación `useTransition` |
| `src/app/(dashboard)/company/[companyId]/audit-log/page.tsx` | Server Component — SSR initial data, redirect si no ADMIN_ONLY |
| `src/modules/audit/__tests__/AuditLogService.test.ts` | 7 tests — filtros, paginación, pageSize capped |
| `src/modules/audit/__tests__/audit.actions.test.ts` | 4 tests — no-member, ACCOUNTANT, ADMIN, OWNER |

### Nav

`src/lib/nav-items.ts` — sección "Administración" de OWNER/ADMIN:
```typescript
item("Auditoría", p("/audit-log"), ShieldCheckIcon),
```

### Tests

11 tests nuevos. **881 total GREEN** | **0 TS errors**

## Sección 48 — Fase 28G: Inventario UI Completado (2026-04-14)

### Objetivo

Cerrar el módulo de inventario con historial de movimientos por ítem y cards de CPP visualmente prominentes.

### Archivos nuevos/modificados

| Archivo | Cambio |
|---|---|
| `InventoryOperationsService.ts` | +`getItemMovements(companyId, itemId)` con CRITICAL-1 ownership guard |
| `inventory-operations.actions.ts` | +`getItemMovementsAction()` — guard ROLES.WRITERS |
| `ItemMovementHistory.tsx` (nuevo) | Panel: 4 CPP cards (stock/CPP/valor/SKU) + tabla con type/status badges |
| `InventoryItemList.tsx` | +columna "Historial", toggle por fila, `<tr>` ancho completo para el panel |

### Tests

10 tests nuevos — ownership guard, companyId+itemId en where, ordenación, lazy-load. **891 total GREEN**

## Sección 49 — Fase 33: Notificaciones In-App (2026-04-14)

### Objetivo

Alertar a OWNER/ADMIN/ACCOUNTANT sobre eventos contables urgentes sin requerir nueva tabla DB — notificaciones computadas on-the-fly.

### Alertas implementadas

| Tipo | Severidad | Fuente |
|---|---|---|
| `INVOICE_OVERDUE` | error | `Invoice.dueDate < now`, `paymentStatus NOT IN [PAID, VOIDED]` |
| `INVOICE_DUE_SOON` | warning | `Invoice.dueDate` en próximos 7 días |
| `RETENCIONES_PENDING` | warning | `Retencion.status === PENDING` (count) |
| `INVENTORY_DRAFTS` | info | `InventoryMovement.status === DRAFT` (count) |

Ordenación: error → warning → info.

### Archivos nuevos/modificados

| Archivo | Descripción |
|---|---|
| `NotificationService.ts` (nuevo) | `getAlerts(companyId)` — 4 queries en `Promise.all` |
| `notifications.actions.ts` (nuevo) | `getNotificationsAction()` — guard ROLES.ACCOUNTING |
| `NotificationBell.tsx` (nuevo) | Campana con badge (rojo/amarillo/azul por severity) + dropdown lazy-load + refresh |
| `layout.tsx` | Inyecta `<NotificationBell>` para roles ACCOUNTING via `notificationSlot` prop |
| `Navbar.tsx` | +prop `notificationSlot?: React.ReactNode` — render entre nav y UserButton |

### Tests

17 tests nuevos — severidades, ordenación, singular/plural, href por empresa, role guards. **908 total GREEN** | **0 TS errors**

## Sección 50 — Fase 32: KPIs Ejecutivos (2026-04-14)

### Objetivo

Añadir métricas financieras ejecutivas al dashboard de empresa: cartera pendiente, días de cobro promedio (DSO) y flujo de caja proyectado a 90 días — sin nueva tabla DB, todo computado on-the-fly.

### KPIs implementados

| KPI | Descripción | Fuente |
|---|---|---|
| CxC Total | Suma de `pendingAmount` en facturas SALE activas UNPAID/PARTIAL | `Invoice` |
| CxP Total | Suma de `pendingAmount` en facturas PURCHASE activas UNPAID/PARTIAL | `Invoice` |
| Capital de Trabajo | CxC − CxP (puede ser negativo) | Calculado |
| DSO | `(CxC / ventas_últimos_30d) × 30` — null si sin ventas | `Invoice.totalAmountVes` |

### Flujo de caja proyectado

3 ventanas: 0-30d / 31-60d / 61-90d. Por ventana:
- **Cobros**: `pendingAmount` de SALE con `dueDate` en rango
- **Pagos**: `pendingAmount` de PURCHASE con `dueDate` en rango
- **Neto**: cobros − pagos (con badge verde/rojo + ícono)

Fila de totales consolidada al pie de la tabla.

### Archivos nuevos/modificados

| Archivo | Descripción |
|---|---|
| `KpiDashboardService.ts` (nuevo) | `getKpiSummary()` + `getCashFlowProjection()` — Decimal.js, sin mutaciones |
| `kpi-dashboard.actions.ts` (nuevo) | `getKpiDashboardAction()` — guard ROLES.ACCOUNTING |
| `ExecutiveKpiPanel.tsx` (nuevo) | 4 KPI cards + tabla flujo proyectado + botón Actualizar (`useTransition`) |
| `company/[companyId]/page.tsx` | +fetch KPI server-side + `<ExecutiveKpiPanel>` para OWNER/ADMIN/ACCOUNTANT |

### Tests

18 tests nuevos — CxC/CxP separados, workingCapital negativo, DSO null, DSO calculado, buckets cash flow, null guards, role guards. **926 total GREEN** | **0 TS errors**

## Sección 51 — Fase 23C Residual: NC/ND UI Completo (2026-04-14)

### Objetivo

Cerrar el gap de UX en el workflow de Notas de Crédito/Débito: el campo "Factura original" exigía pegar un CUID a mano — inutilizable en producción. Se añade picker buscable y panel de visualización.

### Archivos nuevos/modificados

| Archivo | Cambio |
|---|---|
| `invoice.actions.ts` | +`searchInvoicesForPickerAction(companyId, type, query)` — busca FACTURAs del mismo tipo, take:10, ROLES.WRITERS |
| `invoice.actions.ts` | +`getCreditDebitNotesAction(companyId, invoiceId)` — NC/ND vinculadas, ROLES.WRITERS |
| `RelatedInvoicePicker.tsx` (nuevo) | Input buscable debounced (300ms) + dropdown + label "F-0001 — Cliente X" + clear button |
| `CreditDebitNotesPanel.tsx` (nuevo) | Panel lazy-load: tabla NC/ND con badge tipo (NC verde / ND naranja), fecha, monto, estado |
| `InvoiceForm.tsx` | Reemplaza raw input con `<RelatedInvoicePicker>` |
| `InvoiceBook.tsx` | Botón "NC/ND" en columna de acciones para filas FACTURA; panel expandible en `<tr colSpan={12}>` usando React.Fragment |

### UX antes → después

| Antes | Después |
|---|---|
| Input de texto vacío — "pegue el ID de la factura" | Picker buscable: escribe "F-001" o "Cliente" y selecciona |
| Sin forma de ver NC/ND desde el libro IVA | Botón "NC/ND" en cada FACTURA del libro → panel inline |

### Tests

10 tests nuevos — role guards (VIEWER, ADMINISTRATIVE, ACCOUNTANT), auth guard, null totalAmountVes, array vacío. **936 total GREEN** | **0 TS errors**

## Sección 52 — Fase 28H: Reportes de Inventario + Alerta Bajo Stock (2026-04-14)

### Objetivo

Dar a los roles ACCOUNTING (ACCOUNTANT/OWNER/ADMIN) visibilidad del inventario valorado (CPP) con dos reportes:
- **Existencias**: tabla de todos los ítems con `qty × averageCost = totalValue`, bandera `isLowStock`, conteo de bajo stock y valor total del inventario.
- **Movimientos**: filtros por rango de fecha, tipo (ENTRADA/SALIDA/AJUSTE), ítem y estado (DRAFT/POSTED); fila de totales.

Además, agregar `minimumStock Decimal?` al schema `InventoryItem` para que el usuario configure el umbral por producto, y disparar una alerta `LOW_STOCK` en `NotificationBell` cuando `stockQuantity <= minimumStock`.

### Archivos nuevos/modificados

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | +`minimumStock Decimal? @db.Decimal(19,4)` en `InventoryItem` |
| `prisma/migrations/20260414_fase28h_minimum_stock/migration.sql` | `ALTER TABLE "InventoryItem" ADD COLUMN "minimumStock" DECIMAL(19,4)` |
| `InventoryReportService.ts` (nuevo) | `getStockSummary(companyId)` — Decimal.js CPP; `getMovementReport(companyId, filters)` — date range + filtros opcionales |
| `inventory-reports.actions.ts` (nuevo) | `getStockSummaryAction` + `getMovementReportAction` — auth + ROLES.ACCOUNTING guard |
| `InventoryReportsView.tsx` (nuevo) | Componente cliente con tabs Existencias / Movimientos; `StockTab` con cards resumen + tabla + badges isLowStock; `MovementsTab` con filtros + tabla con totales |
| `inventory/page.tsx` | +`InventoryReportService.getStockSummary()` en Promise.all; sección "Reportes de inventario" al final (solo ACCOUNTING) |
| `NotificationService.ts` | +`lowStockItems` query en Promise.all; alerta `LOW_STOCK` severity warning cuando qty ≤ minimumStock |
| `NotificationService.test.ts` | +mock `inventoryItem.findMany` en beforeEach |

### Tipos exportados

```ts
StockSummaryItem { id, sku, name, unit, stockQuantity, averageCost, totalValue, minimumStock, isLowStock }
StockSummary     { items, totalInventoryValue, lowStockCount }
MovementReportItem { id, date, type, status, quantity, unitCost, totalCost, reference, notes, invoiceId, itemId, itemSku, itemName, itemUnit }
MovementReportFilters { from, to, type?, itemId?, status? }
```

### Tests

20 tests nuevos (8 service + 11 actions + 1 notification). **956 total GREEN** | **0 TS errors**

## Sección 53 — Fase NOM-A: Wizard de Configuración de Nómina ✅ completada 2026-04-15

### Objetivo
Configurar la nómina de la empresa mediante un wizard guiado de 3 pasos, sin preguntas abiertas. Establece los parámetros que gobiernan todos los cálculos futuros (IVSS, INCES, Banavih, régimen LOTTT, frecuencia de pago).

### Schema añadido
```
6 enums: PayrollSizeRange (SMALL/MEDIUM/LARGE), LottRegime (POST_2012/MIXED),
         PayrollPaymentCurrency (VES/USD/MIXED), PayrollFrequency (BIWEEKLY/MONTHLY),
         CestaTicketType (CARD/CASH/NONE), FideicomisoType (EXTERNAL_BANK/INTERNAL)

model PayrollConfig {
  companyId @unique  // singleton por empresa — sin Serializable, el @unique es el mutex
  sizeRange, lottRegime, ivssEnabled, incesEnabled, banavihEnabled,
  cestaTicketType, paymentCurrency, frequency, fideicomiso
  // Sin deletedAt — historial en AuditLog (oldValue/newValue)
}
```
Migración: `20260415_nom_a_payroll_config`

### Seguridad — todos los findings del audit resueltos antes de implementar
| Finding | Severidad | Solución implementada |
|---|---|---|
| NOM-A-01: IDOR en read actions | CRITICAL | `companyMember.findFirst` en toda action antes de DB |
| NOM-A-02: UPSERT sin AuditLog | CRITICAL | `$transaction` con AuditLog (oldValue + newValue de todos los campos) |
| NOM-A-03: toggles fiscales sin confirmación | HIGH | `window.confirm()` al desactivar IVSS/INCES/Banavih en wizard |
| NOM-A-04: sin rate limit en UPSERT | HIGH | `checkRateLimit(userId, limiters.fiscal)` |
| NOM-A-05: rol no definido para write | HIGH | `ROLES.ADMIN_ONLY` (OWNER/ADMIN) para write; `ROLES.ACCOUNTING` para read; todos para status |
| NOM-A-06: info disclosure en status action | MEDIUM | auth guard en `getPayrollConfigStatusAction` |

### Role matrix
| Operación | VIEWER | ACCOUNTANT | ADMINISTRATIVE | ADMIN/OWNER |
|---|---|---|---|---|
| `getPayrollConfigStatusAction` | ✅ | ✅ | ✅ | ✅ |
| `getPayrollConfigAction` | ❌ | ✅ | ✅ | ✅ |
| `savePayrollConfigAction` | ❌ | ❌ | ❌ | ✅ ONLY |

### Archivos creados
- `prisma/migrations/20260415_nom_a_payroll_config/migration.sql`
- `src/modules/payroll/schemas/payroll-config.schema.ts` — Zod (9 campos enum/boolean)
- `src/modules/payroll/services/PayrollConfigService.ts` — getConfig, isConfigured, saveConfig
- `src/modules/payroll/actions/payroll-config.actions.ts` — 3 actions con guards completos
- `src/modules/payroll/components/PayrollWizard.tsx` — 3 pasos + resumen + confirmación organismos
- `src/modules/payroll/components/PayrollConfigSummary.tsx` — vista read-only para no-admin
- `src/app/(dashboard)/company/[companyId]/payroll/page.tsx` — SSR hub de nómina
- `src/lib/nav-items.ts` — "Nómina" añadido a OWNER/ADMIN, ACCOUNTANT, ADMINISTRATIVE

### Tests
28 nuevos: PayrollConfigService (8) + payroll-config.actions (20 — auth, ADMIN_ONLY, rate limit, Zod, NOM-A-01/02/04/05/06)

**1029 tests GREEN** | **0 TS errors**

---

## Sección 54 — Fase NOM-B: Empleados, Conceptos e Historial de Salarios

**Fecha:** 2026-04-15 | **Branch:** feat/fase-nom-b-empleados-conceptos | **Tests:** +69 (1098 total)

### Modelos Prisma

| Modelo | Descripción | Clave de integridad |
|---|---|---|
| `Employee` | Empleado con campos LOTTT | `@@unique([companyId, cedulaType, cedulaNumber])` |
| `SalaryHistory` | Historial append-only de salarios | `@@index([employeeId, effectiveFrom DESC])` |
| `PayrollConcept` | Catálogo de conceptos (asignaciones/deducciones) | `@@unique([companyId, code])` |
| `PublicHoliday` | Feriados nacionales fijos o anuales | `@@index([companyId, date])` |
| `AbsenceType` | Tipos de ausencia (justificada/médica/etc.) | `@@index([companyId, isActive])` |

Nuevos enums: `ContractType` · `EmployeeStatus` · `ConceptType` · `AbsenceCategory`

### Seguridad (pre-emptive audit NOM-B)

| Finding | Tipo | Implementación |
|---|---|---|
| NOM-B-01 | CRITICAL | `companyMember.findFirst` en todas las actions antes de cualquier query |
| NOM-B-02 | CRITICAL | `@@unique([companyId, cedulaType, cedulaNumber])` + P2002 → msg amigable |
| NOM-B-03 | HIGH | `SalaryHistory.create` + `AuditLog.create` dentro de `$transaction` |
| NOM-B-04 | HIGH | write = `ADMIN_ONLY`; read employees = `WRITERS`; read concepts = `ACCOUNTING` |
| NOM-B-05 | MEDIUM | `terminationDate >= hireDate` validado en Zod |

### Conceptos del sistema (seedDefaults — idempotente)

9 conceptos pre-configurados: `SAL_BASE`, `HE_DIURNA`, `HE_NOCTURNA`, `BONO_NOCHE`, `CESTA_TICKET` (asignaciones) + `IVSS_OBR`, `INCES_OBR`, `FAOV_OBR`, `ISLR_RET` (deducciones). `isSystem=true` → no eliminables, solo desactivar.

### Archivos creados

- `prisma/migrations/20260415_nom_b_empleados_conceptos/migration.sql`
- `src/modules/payroll/schemas/employee.schema.ts` (Create/Update/Terminate/AddSalary)
- `src/modules/payroll/schemas/payroll-concept.schema.ts`
- `src/modules/payroll/services/EmployeeService.ts`
- `src/modules/payroll/services/PayrollConceptService.ts`
- `src/modules/payroll/actions/employee.actions.ts` (6 actions)
- `src/modules/payroll/actions/payroll-concept.actions.ts` (4 actions)
- `src/modules/payroll/components/EmployeeList.tsx`
- `src/modules/payroll/components/EmployeeForm.tsx`
- `src/modules/payroll/components/SalaryHistoryPanel.tsx`
- `src/modules/payroll/components/ConceptList.tsx`
- `src/app/(dashboard)/company/[companyId]/payroll/employees/page.tsx`
- `src/app/(dashboard)/company/[companyId]/payroll/employees/new/page.tsx`
- `src/app/(dashboard)/company/[companyId]/payroll/employees/[employeeId]/page.tsx`
- `src/app/(dashboard)/company/[companyId]/payroll/concepts/page.tsx`

### Tests
69 nuevos: EmployeeService (18) + employee.actions (31) + PayrollConceptService (12) + payroll-concept.actions (18 — incluyendo seedDefaults, system guard, IDOR, Zod)

**1098 tests GREEN** | **0 TS errors**

---

## Sección 55 — Decisiones Estratégicas de Roadmap (2026-04-15)

**Tipo:** Sesión de planificación estratégica — sin código generado.
**Decisiones documentadas en:** ADR-012 (`.claude/adr/ADR-012-roadmap-sequencing.md`)

### Contexto

Se revisó el `ROADMAP_OPERACIONAL_CONTAFLOW.md` que proponía 5 nuevas fases operacionales (35A, 35B, 35C, 36A, 36B) con modelos Vendor, Customer, PurchaseOrder, GoodsReceipt, SalesOrder, Shipment (~150 tests nuevos). Se evaluó también el análisis de Gemini AI sobre brechas del producto.

### Decisiones adoptadas

#### 1. Secuencia pre-lanzamiento: NOM-C → NOM-D → NOM-E → [35A simplificado] → LAUNCH

| Fase | Prioridad | Razón |
|---|---|---|
| **NOM-C** — Motor de cálculo nómina | 1 — INMEDIATA | Nómina sin cálculo no es nómina. Mayor ROI Venezuela |
| **NOM-D** — Prestaciones, vacaciones, utilidades | 2 | Obligatorio legal LOTTT |
| **NOM-E** — Reportes legales (Forma 14-02, ARC/ISLR) | 3 | Requisito SENIAT |
| **35A simplificado** — Vendor/Customer básico | 4 — pre-launch | Formalizar entidad sin workflow P2P completo |
| **35B/35C/36A/36B** — P2P y O2C completos | DIFERIDO | Post-launch, según feedback real de clientes |

#### 2. Fases 35B-36B: diferidas a post-lanzamiento

**Razón principal:** Fase 28 ya tiene `QuotationService` + `OrderService` (45 tests). Reconstruir esto como módulo P2P formal antes de tener un cliente real es YAGNI. La migración `Invoice.vendorName (String)` → `vendorId (FK)` implica backfill de datos históricos — riesgo no justificado sin demanda confirmada.

#### 3. Brecha real identificada: entidad Vendor/Customer formal

`Invoice.vendorName` y `Invoice.clientName` son `String` libres. El "círculo de confianza" (factura → retención → cuenta por pagar → asiento) funciona técnicamente pero no hay entidad formal que conecte documentos de un mismo proveedor. La Fase 35A simplificada crea `Vendor` / `Customer` con FK opcional en `Invoice` — sin romper datos existentes (backfill `null` en FKs nuevas, nombres históricos preservados en los String fields).

#### 4. "Circle of trust" UI — gap de UX identificado

La cadena contable existe en el backend pero no hay vista unificada. Post NOM-E se evaluará una pantalla "Expediente de Proveedor" que conecte visualmente:

```
Vendor → Invoices → Retenciones → CxP → Asientos contables
```

#### 5. Correcciones al análisis de Gemini

| Punto Gemini | Estado real |
|---|---|
| "Inventario no existe" | INCORRECTO — Fase 28D ya implementó InventoryItem + InventoryMovement + CPP |
| "Contabilidad bimonetaria incompleta" | PARCIALMENTE correcto — ExchangeRate + Invoice.exchangeRateId existen; falta balance sheet paralelo USD/VES en UI |
| "Alerta bajo stock falta" | INCORRECTO — Fase 28H ya implementó LOW_STOCK + minimumStock + alertas |
| "Feature creep de roadmap 35-36" | CORRECTO — diferir a post-launch es la decisión adoptada |
| "Cerrar círculo de confianza" | CORRECTO — gap UI real, encolado post NOM-E |

### Próxima fase confirmada

**NOM-C — Motor de Cálculo de Nómina**

Incluye: cálculo quincenal/mensual con conceptos NOM-B, IVSS/INCES/Banavih según config NOM-A, horas extra LOTTT, recibo de pago PDF, causación asiento contable automático, guard de doble-proceso.
