# ContaFlow — Contexto Completo del Proyecto
_Versión actualizada — incluye puntos de robustez Senior identificados en revisión_

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
- **Monitoreo (futuro)**: Sentry

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
  id                   String             @id @default(cuid())
  name                 String
  rif                  String?            @unique
  address              String?
  status               CompanyStatus      @default(ACTIVE)
  plan                 CompanyPlan        @default(FREE)
  isSpecialContributor Boolean            @default(false)
  members              CompanyMember[]
  accounts             Account[]
  transactions         Transaction[]
  periods              AccountingPeriod[]
  retenciones          Retencion[]
  igtfTransactions     IGTFTransaction[]
  invoices             Invoice[]
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
}

// ... resto del schema igual al original ...
```
_(Schema completo en prisma/schema.prisma del repositorio)_

## 8. Módulos Implementados
- `src/modules/accounts/` — Plan de Cuentas
- `src/modules/transactions/` — Asientos contables
- `src/modules/periods/` — Períodos contables
- `src/modules/retentions/` — Retenciones IVA/ISLR
- `src/modules/igtf/` — IGTF
- `src/modules/invoices/` — Libro de Compras y Ventas
- `src/modules/reports/` — Estado de Resultados, Balance General
- `src/modules/import/` — Importación Plan de Cuentas (Excel/CSV)
- `src/modules/ocr/` — OCR híbrido

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
**Branch activa**: `main` — Fase 12A completada y mergeada

## 18. Fase 12B — Pendientes Detallados

**Branch a crear**: `feat/invoice-books-v2`

### 18.1 Número de Control Automático (Correlativo)
**⚠️ REQUIERE ARCH PRIMERO** — decisión de concurrencia y formato pendiente.
- Agregar `enum BillingMode { FORMATO_LIBRE MAQUINA_FISCAL }` al schema
- Agregar `billingMode BillingMode @default(FORMATO_LIBRE)` en model `Company`
- Migración: `npx prisma migrate dev --name add_billing_mode`
- `getNextControlNumber()` DEBE usar `$transaction` con `isolationLevel: Serializable`
- En `InvoiceForm`: si `FORMATO_LIBRE` → campo `readOnly`. Si `MAQUINA_FISCAL` → deshabilitado y vacío
- Selección de `billingMode` en Settings de la empresa

### 18.2 Exportación PDF
**⚠️ REQUIERE ARCH PRIMERO** — decisión de librería pendiente.
- Crear `src/modules/invoices/services/InvoicePDFService.ts`
- Formato SENIAT: encabezado empresa+RIF, período, columnas, totales, número de página
- Botón "Exportar PDF" en `InvoiceBook.tsx` junto al botón Excel
- PDF idéntico en formato al Excel export existente

### 18.3 Efectos de Cascada en Categoría Fiscal
**✅ LISTO PARA IMPL** — sin cambios de schema.
- `AlertDialog` confirmación al cambiar a EXENTA/EXONERADA/NO_SUJETA
- Reset de taxLines a una línea EXENTO vacía si confirma
- Campo `importFormNumber` obligatorio si `taxCategory === IMPORTACION`

### 18.4 Vinculación con Retenciones Existentes
**⚠️ REQUIERE ARCH PRIMERO** — cambio de schema.
- Agregar `invoiceId String?` en model `Retencion`
- Migración: `npx prisma migrate dev --name link_retention_invoice`
- Selector "Vincular a factura" en `RetentionForm`
- Vista de retenciones vinculadas en detalle de factura

### 18.5 Comprobantes de Retención PDF
**⏳ BLOQUEADO** — espera decisión de librería de 18.2.
- `RetentionVoucherService.ts` con `generateVoucher()` y `getNextVoucherNumber()`
- `getNextVoucherNumber()` requiere `Serializable` — mismo patrón que `getNextControlNumber()`

### 18.6 Validación de RIF en Formulario
**✅ LISTO PARA IMPL** — solo Zod, sin cambios de schema.
- Regex: `/^[JVEGCP]-\d{8}-?\d?$/i`
- Error: `"RIF inválido. Formato: J-12345678-9"`
- Aplicar en `CreateInvoiceSchema.counterpartRif` y `RetentionSchema.providerRif`

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
- ✅ CI/CD: GitHub Actions
- ✅ Fase 10: Contribuyentes Especiales + Retenciones IVA/ISLR
- ✅ Fase 11: IGTF — Impuesto a las Grandes Transacciones Financieras
- ✅ Fase 12A: Libro de Compras y Ventas — modelo dinámico InvoiceTaxLine, alícuotas VEN-NIF, exportación Excel
- ⏳ Fase 12B: Ver sección 18 para desglose completo
- ⏳ Fase 13: Hardening de Seguridad y Robustez
  - Row Level Security (RLS) en Neon — **⚠️ requiere decisión arquitectónica sobre Neon pooling vs. conexión directa**
  - AuditLog activo en todas las mutations (dentro del mismo $transaction)
  - Migrar useTransition a useActionState (React 19)
  - Rate limiting en Server Actions
  - Sentry para monitoreo de errores en producción
  - Validación de reglas de negocio en Zod (formato RIF, códigos de cuenta)
  - Redis para caché de reportes pesados
  - Idempotencia en Actions de creación fiscal (`idempotencyKey`)
  - Soft delete en entidades fiscales (`deletedAt`)
- ⏳ Fase 14: Multimoneda (BsD + USD, tasa BCV)
- ⏳ Fase 15: Cierre de Ejercicio Económico
- ⏳ Fase 16: Cartera CxC/CxP con Antigüedad de Saldos
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

## 22. Modelo de Negocio
- **Plan Free**: todas las funciones contables + OCR ~80% precisión
- **Plan Pro**: OCR con Gemini Flash ~95% precisión (futuro)
- Stripe en Fase 25
- Contacto actual: mailto:contacto@contaflow.app
