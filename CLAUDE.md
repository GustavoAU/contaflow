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
| ¿Dónde va el IGTF? | `PaymentRecord` en `recordPaymentAction` (Sección 32) |
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
- IGTF solo si `currency !== VES` OR (`isSpecialContributor` AND `currency === VES`)
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
Next.js 16 App Router | Prisma 7.4.1 + @prisma/adapter-pg (pooled) | Neon serverless
Clerk | Zod 4 | Vitest 4 | Decimal.js | @upstash/ratelimit | @sentry/nextjs
```

## Prisma / DB

- `src/lib/prisma.ts`: singleton `PrismaPg` con `pg.Pool` y `DATABASE_URL` (pooled)
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
3. Si falla: parar, corregir, re-ejecutar, reportar antes de mencionar siguiente fase.

**Nunca cargar errores TS o tests fallidos entre fases.**

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
- **Fase 35G** ⏳ pendiente (Lot/Serial Tracking — construye sobre 35F)
- **Fase 36C** ⏳ pendiente (Distribución de Pagos / batch multi-destinatario)

**1562 tests GREEN** | **0 TS errors** | **CI passing** (2026-04-30)

### middleware.ts

- Públicas: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/monitoring(.*)`, `/api/webhook/(.*)`
- Todo lo demás: `auth.protect()` → redirige a sign-in
- Post-lanzamiento: nonce CSP para eliminar `unsafe-inline`

## Roadmap — pre-lanzamiento (ADR-012)

NOM-C → NOM-D → NOM-E → Fase 35A simplificada → LAUNCH
Fases 35B/35C/36A/36B diferidas a post-lanzamiento.

---

## Dinámica de trabajo

1. **Documentar en el momento**: patrón nuevo o decisión → `CLAUDE.md` / ADR / `quick-reference.md`. No en el chat.
2. **Contexto primero**: leer `CLAUDE.md` y archivos relevantes antes de proponer implementación.
3. **Feedback loop**: cada fase termina con `tsc` + `vitest` en verde. Nueva regla descubierta → documentar antes de continuar.
