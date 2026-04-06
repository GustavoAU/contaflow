# ContaFlow — Contexto Completo del Proyecto

_Versión actualizada — Fase 13C completada. Última sincronización: 2026-04-05_
_v3: Incorpora análisis competitivo vs Odoo, deuda crítica de infraestructura, ventajas VEN-NIF y nuevas Fases 13C-bis, 13D, 14C, 26B_

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

- **Flujo híbrido**: Tesseract.js corre en el browser → extrae texto → Server Action envía texto a Groq
- **Modelo Groq**: llama-3.1-8b-instant (gratuito, 14.4K requests/día)
- **Plan Free**: OCR con ~80% precisión
- **Plan Pro (futuro)**: OCR con Gemini Flash pago (~95% precisión)
- `GROQ_API_KEY` en `.env`

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

**Branch activa**: `main` — Fase 13C completada (2026-04-05)
**Tests**: 422/422 passing · **CI**: verde (GitHub Actions)
**Último commit relevante**: Fase 13C — Bloque 6 (Prisma query monitoring)

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
- ⏳ Fase 17: Conciliación Bancaria
- ⏳ Fase 13D: RLS — Row Level Security en Neon (entre Fase 17 y Fase 19)
  - Implementar ADR-007: role `authenticated` + `SET LOCAL` por `$transaction`
  - Migration SQL: ENABLE ROW LEVEL SECURITY + CREATE POLICY en ~12 tablas de dominio
  - src/lib/prisma-rls.ts: withCompanyContext(companyId, tx, fn)
  - Refactor ~15-20 Server Actions para usar withCompanyContext
  - Defense-in-depth real: BD rechaza queries sin companyId correcto
  - Fail-closed: sin set_config → 0 rows (no explota, no expone)
  - Compatible con PrismaPg pooled (SET LOCAL = per-transaction)
  - Prerequisito: Fase 17 completada (BankTransaction debe estar bajo RLS también)
- ⏳ Fase 18: Dashboard Analítico Avanzado (Recharts nativo)
- ⏳ Fase 19: Declaración Mensual IVA (Forma 30 SENIAT)
- ⏳ Fase 20: Facturación Digital (SENIAT)
- ⏳ Fase 14C: Auto-fetch Tasa BCV + Re-expresión Automática (ver sección 26)
- ⏳ Fase 14D: Validación RIF vs SENIAT en tiempo real (ver sección 27)
- ⏳ Fase 12C: Asistente de Retenciones ISLR Inteligente (ver sección 28)
- ⏳ Fase 17B: Batch Payments — Exportación TXT para bancos venezolanos (ver sección 29)
- ⏳ Fase 21: Activos Fijos y Depreciación
- ⏳ Fase 22: Ajuste por Inflación Fiscal (INPC)
- ⏳ Fase 23: Nómina (LOTTT)
- ⏳ Fase 24: Firma Electrónica + QR (SUSCERTE)
- ⏳ Fase 25: Stripe + pagos automáticos
- ⏳ Fase 26: MCP + Asistente Contable IA
- ⏳ Fase 26B: IA "Contador Junior" — Clasificación y Detección de Anomalías Fiscales (ver sección 30)
- ⏳ Fase 27: PWA + modo offline
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
- ⏳ Fase 29: Expansión Colombia (DIAN)
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
- **Sentry solo activo en `NODE_ENV=production`** — no captura nada en dev/test. `sendDefaultPii: false` — nunca enviar env vars con credenciales

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

### ⏳ DEUDA — RLS en base de datos — PLANIFICADA como Fase 13D

ADR-007 aprobado. SET LOCAL compatible con PgBouncer. Implementar después de Fase 17.

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

## 30. Fase 17B — Batch Payments para Bancos Venezolanos

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
| Cartera CxC/CxP con aging VEN-NIF | ✅ Buckets fijos VEN-NIF, NOTA_CREDITO neto | ⚠️ Buckets genéricos |
