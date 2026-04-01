# ContaFlow — Contexto Completo del Proyecto

_Versión actualizada — Fase 16 completada. Última sincronización: 2026-03-31_

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
- **OCR**: Tesseract.js (cliente) + Groq llama-3.1-8b-instant (servidor)
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

**Branch activa**: `main` — Fase 12B completada y mergeada (2026-03-30)
**Tests**: 196/196 passing · **CI**: verde (GitHub Actions)
**Último commit relevante**: `6cf4909` — feat(18.5): individual invoice voucher PDF

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
  - ⏳ Row Level Security (RLS) en Neon — **⚠️ requiere decisión: pooling PgBouncer vs. conexión directa** (ver sección 21)
  - ⏳ Redis caché para reportes pesados (Upstash disponible — implementar en Fase 18 Dashboard)
- ⏳ Fase 13C: Producción Real — Escalabilidad Crítica
   BLOQUE 1 — Seguridad (no negociable antes de lanzar):
   - RLS (Row Level Security) en Neon con conexión directa
     (decisión arch pendiente: pooling vs. directa — sección 21)
   - Auditoría de todos los queries Prisma: verificar que
     NINGUNO omite companyId en where clause
   - Test arquitectural: query sin companyId = test falla

   BLOQUE 2 — Paginación (no negociable antes de lanzar):
   - Cursor-based pagination en InvoiceBook
   - Cursor-based pagination en AgingReport (receivables/payables)
   - Cursor-based pagination en TransactionList
   - Cursor-based pagination en BankTransaction (Fase 17)
   - Regla: ningún listado carga más de 50 registros sin paginar

   BLOQUE 3 — Snapshots multimoneda (no negociable antes de lanzar):
   - Snapshot de saldos pre-calculados en VES + moneda original
     al cierre de cada período contable
   - Balance General y Estado de Resultados leen snapshot,
     no recalculan en tiempo real
   - ExchangeRateSnapshot model en schema Prisma
   - Evita el "efecto bola de nieve": 10,000 facturas USD
     no se reconvierten en cada carga de reporte

   BLOQUE 4 — Caché de reportes (primer mes en producción):
   - Redis (Upstash disponible) para Balance General,
     Estado de Resultados y Aging Report
   - TTL: 5 minutos por defecto, invalidar en cada mutation
   - No recalcular lo que no cambió

   BLOQUE 5 — Operaciones asíncronas (primer mes en producción):
   - Queue con QStash (Upstash) para:
     → Generación de PDFs (@react-pdf/renderer)
     → Exportación Excel de libros grandes
     → OCR pesado
   - UX: botón "Generar" responde inmediato →
     notificación cuando está listo
   - Elimina riesgo de Vercel timeout 504 bajo carga

   BLOQUE 6 — Observabilidad (crecimiento 50+ clientes):
   - Prisma query logging: queries > 1000ms → alerta Sentry
   - Métricas por endpoint: tiempo de respuesta p50/p95/p99
   - Dashboard de salud: conexiones Neon, hit rate caché Redis,
     jobs QStash pendientes/fallidos
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
- ⏳ Fase 18: Dashboard Analítico Avanzado (Recharts nativo)
- ⏳ Fase 19: Declaración Mensual IVA (Forma 30 SENIAT)
- ⏳ Fase 20: Facturación Digital (SENIAT)
- ⏳ Fase 21: Activos Fijos y Depreciación
- ⏳ Fase 22: Ajuste por Inflación Fiscal (INPC)
- ⏳ Fase 23: Nómina (LOTTT)
- ⏳ Fase 24: Firma Electrónica + QR (SUSCERTE)
- ⏳ Fase 25: Stripe + pagos automáticos
- ⏳ Fase 26: MCP + Asistente Contable IA
- ⏳ Fase 27: PWA + modo offline
- ⏳ Fase 28: Expansión Colombia (DIAN)
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

## 21. ⚠️ Puntos Críticos Pendientes de Verificación

### Singleton PrismaClient — VERIFICAR URGENTE

Prisma 7 + Neon serverless en Vercel requiere el Neon adapter para evitar connection exhaustion.
Buscar en el repo: `find . -type f -name "*.ts" | xargs grep -l "PrismaClient" | grep -v node_modules`
Estructura esperada en `src/lib/prisma.ts`:

```typescript
import { neon } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
// + singleton pattern con globalThis
```

Si no existe o no usa el adapter → **bug de producción latente**.

### RLS y Neon Pooling — Decisión Arquitectónica Requerida

Neon con PgBouncer en modo `transaction` no soporta `SET LOCAL` (necesario para RLS).
Opciones: (a) usar conexión directa para todas las queries, (b) conexión directa solo para RLS,
(c) Neon Auth como alternativa. Llevar a Chat ARCH antes de Fase 13.

### PITR (Point-in-Time Recovery) — SLA a documentar

Neon Free: 7 días. Neon Pro: 30 días.
Para un software contable vendible, esto debe estar en el contrato con el cliente.
Documentar en Landing Page y en onboarding de Settings.

### Escalabilidad — Fase 13C

**CRÍTICO ANTES DE LANZAR:**
- Paginación cursor-based ausente en listados principales
  → con 500+ facturas los reportes colapsan en memoria
- Snapshots multimoneda no implementados
  → 10k facturas USD recalculadas en tiempo real = timeout
- RLS pendiente (ya documentado arriba)

**URGENTE PRIMER MES:**
- PDFs síncronos → riesgo Vercel timeout 504 con 10+ usuarios
  generando PDFs simultáneamente
- Sin caché de reportes → cada Balance General = query pesada

**CRECIMIENTO 50+ CLIENTES:**
- Sin métricas de performance reales (solo errores via Sentry)
- Sin alertas de queries lentas de Prisma

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
