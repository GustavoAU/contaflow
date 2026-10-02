# ContaFlow — Agent Guide
## 🚀 INICIO DE SESIÓN — Leer primero

1. `.claude/memory/decision-tree.md` → identifica tu árbol antes de escribir código
2. `contaflow-context-v3.md` → solo el bloque **Estado Activo** (primeras ~60 líneas)
3. Según el árbol → leer skills relevantes en `.claude/memory/skills-discovered.md`

No leer nada más hasta que el árbol lo indique.

> El bloque Estado Activo puede ir atrasado: confirmar con `git log --oneline -15` antes de asumir qué está en vuelo.

**Flujo de features (spec-driven):** `/spec <feature>` → revisar y aprobar la spec → `/implementar <SPEC-XXX>` → `/revisar`. Detalle en `.claude/specs/README.md`.

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
| ¿P2002 en correlativo al reintentar? | `p2002TargetIncludes(e, "<columna del @@unique>")` de `prisma-errors.ts` → "Error transitorio — intenta de nuevo." La columna es la del **CONSTRAINT**, no la del documento: `invoiceType` (ControlNumberSequence), `voucherNumber` (Retencion). **Nunca leer `meta.target` a mano** (con Prisma 7.8 + Neon no existe). Historia: LL-014 / ADR-056 |
| ¿`prisma migrate dev`? | **ROTO** → usar workflow manual (ver Prisma / DB) |
| ¿Errores Prisma al cliente? | Nunca raw. `P2002` → "Ya existe…" \| `P2003` → "Datos de referencia inválidos" |
| ¿Zod 4 mensajes? | `{ error: "msg" }` — **NO** `{ errorMap: ... }` |
| ¿`useTransition` vs `useActionState`? | `useTransition` para forms con Zod tipado (nuestro caso). `useActionState` solo para forms simples sin Zod |
| ¿`useReverification` destructuring? | **NO array** → `const fn = useReverification(action)` (no `const [fn] = ...`) — @clerk/shared@4.12.2 |
| ¿Sesiones con actividad (IP/device)? | `useUser().user.getSessions()` → `SessionWithActivitiesResource[]` (latestActivity + revoke). NO useSessionList |
| ¿Step-up config centralizado? | `src/lib/step-up.ts` — STEP_UP_CONFIG + reverificationError + StepUpError |
| ¿Tests con step-up actions? | Agregar `has: () => true` al mock de auth() + `if ('clerk_error' in result) throw` antes de `expect(result.success)` |
| ¿Action nueva? | `requireCompanyAction(companyId, {roles, limiter, captureNet})` de `src/lib/action-guard.ts` (ADR-041) — NUNCA el ritual manual auth→rl→member→canAccess. `roles` es OBLIGATORIO: array de ROLES.X o `"MEMBER_ANY"` (solo membresía, lecturas). Checks extra (ADMIN_ONLY, step-up, hasModuleAccess) van DESPUÉS del guard |
| ¿ActionResult / toActionError / ip-ua? | Fuente única `src/lib/{action-result,action-errors,net-context}.ts` — las copias de módulos son re-exports (ADR-041). IP siempre `.at(-1)` de x-forwarded-for |
| ¿Secreto de portal ausente (EMPLOYEE_PORTAL_SECRET / DOC_SHARE_SECRET)? | Los 3 firmadores lanzan `MissingPortalSecretError` (`src/lib/portal-secret.ts`). Toda action que firme un token DEBE atraparlo y devolver `PORTAL_SECRET_USER_MESSAGE` — sin catch el throw sube al error boundary y **tumba la página entera**; con `toActionError` a secas el mensaje llega crudo al cliente (`mapPrismaError` hace `return error.message`) filtrando el nombre de la variable. Precedente: 2026-08-23, la var estaba en Vercel escrita `EMPLOYER_…` |
| ¿Fallback entre dos env vars? | `||`, **NUNCA `??`**: una variable declarada VACÍA en el panel no es nullish, así que `??` corta la cadena y el fallback no ocurre. Precedente: `DOC_SHARE_SECRET ?? EMPLOYEE_PORTAL_SECRET` rompía compartir documentos con solo dejar la línea vacía |
| ¿La RLS me cubre esta query sin `companyId`? | **NO.** Olvidar `withCompanyContext` es fail-**OPEN**: la app conecta como `neondb_owner` (BYPASSRLS) y las policies ni se evalúan. Cubre ~15% de escrituras y ~0% de lecturas. El aislamiento real es 100% aplicativo (ADR-004 + ADR-041). Ningún hallazgo se cierra con "lo cubre la RLS" — ADR-044 |
| ¿Tope legal de nómina (IVSS/FAOV/INCES/RPE) contra un sueldo en USD? | Los topes son múltiplos del **salario mínimo, que es un monto en Bs.** Convertir el TOPE a la moneda del sueldo (`salaryMinimumInCurrency`), nunca comparar directo ni convertir el sueldo. Sin `ExchangeRate` USD del período **no se calcula** — se bloquea. Compararlos directo trataba "Bs. 650" como "USD 650" y retenía de más por el factor exacto de la tasa (H-4, 2026-08-24) |
| ¿Piso de PENSIONES_PAT (Ley Protección de Pensiones, G.O. 6.806) contra un sueldo en Bs.? | Es el **INVERSO** de la fila de arriba: el piso ("ingreso mínimo integral") está en **USD**, así que se MULTIPLICA por la tasa BCV para llevarlo a Bs. (`ingresoMinimoIntegralInCurrency`), nunca se divide. No son la misma operación con nombre distinto — si algún refactor las funde por "simetría", el signo queda invertido en silencio. Tasa = la del ÚLTIMO DÍA del mes ANTERIOR que se declara (no la del día de pago), verificado con contador (2026-09) |

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
[ ] ¿Modelo Prisma nuevo → ENABLE+FORCE RLS + policy company_isolation (USING+WITH CHECK) en la MISMA migración? (ADR-007 A1-bis; verificar con scripts/verify-rls.mjs)
[ ] ¿`$queryRaw`/`$executeRaw` sobre tabla con companyId → filtro `"companyId" = ${companyId}` explícito en el SQL, TAMBIÉN en los JOIN y los EXISTS anidados? (ADR-044 D-8.2 — la aserción de tenant NO puede verlo: no hay `model` que inspeccionar. Inventario 2026-08-15: 11 call-sites, todos limpios)
[ ] ¿Migración que SUELTA un índice/constraint → `npm run verify:drift` en verde? Un `@unique` se materializa como CONSTRAINT (columna en el `CREATE TABLE`) o como ÍNDICE (añadida por `ALTER`), y **`DROP CONSTRAINT IF EXISTS` sobre un índice es un NO-OP SILENCIOSO**. Un único que sobra es invisible para Prisma (sin tipo, sin build roto, sin test) y sólo aparece como P2002 en producción. Precedente: `RetentionSequence_companyId_key` tumbó la emisión de comprobantes de retención durante 2 meses (Z-1)

CALIDAD
[ ] tsc --noEmit = 0 errores
[ ] npx vitest run = 0 fallos
[ ] ¿Editaste `prisma/schema.prisma` a mano → `npm run verify:schema-format` en verde? El CI corre `prisma format --check` y **falla el job entero por un solo espacio de alineación**. Quitar un atributo (`@unique`, `@default`) desalinea la columna del resto del bloque y ni tsc ni vitest lo ven. Precedente: c003569 tumbó el Architecture audit de main dos runs seguidos (#412/#413)
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
Next.js 16.2 App Router | Prisma 7.8 + @prisma/adapter-neon (WebSocket) | Neon serverless
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
- IGTF 3%: solo si `currency !== VES` AND `isSpecialContributor` — fuente única `IGTFService.applies` (Fix A5)
- Retenciones IVA: 75%/100% — solo si `isSpecialContributor`
- Retenciones ISLR Decreto 1808: tasas variables por tipo de pago
- RIF regex: `/^[JVEGCP]-\d{8}-?\d$/i` (dígito verificador obligatorio — fuente única: `VEN_RIF_REGEX` en `tax-config.ts`)

## Rate Limiting

- `limiters.fiscal` (60/min) + `limiters.ocr` (10/min) — Upstash sliding window
- `fiscal` es un balde COMPARTIDO por todas las mutaciones fiscales del usuario (crear→enviar→aprobar→convertir = 4 llamadas). Subido de 10→60/min (2026-07) para no bloquear trabajo interactivo. `fiscal` falla CERRADO si Redis cae; el resto fail-open
- Sin `UPSTASH_REDIS_REST_URL` → no-op. Redis falla en runtime → silencioso, permite
- Mock: `vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), fiscalKey: (c, u) => c + ":" + u, limiters: { fiscal: {}, ocr: {} } }))` — `fiscalKey` requerido si la action usa `requireCompanyAction` (ADR-041)

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

## Estado del proyecto

- Estado actual → `contaflow-context-v3.md` (Estado Activo) + `git log --oneline -15`.
- Historial de fases completadas → `docs/historial-fases.md` (no leer salvo que la tarea lo pida).

### middleware.ts

- Públicas: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/monitoring(.*)`, `/api/webhook/(.*)`
- Todo lo demás: `auth.protect()` → redirige a sign-in
- Post-lanzamiento: nonce CSP para eliminar `unsafe-inline`

## Roadmap — pre-lanzamiento (ADR-012)

**Backlog pre-lanzamiento COMPLETO** (2026-06-15). Items 1 y 2 (verificados
2026-07-12): `/despacho/upgrade` page existe y `DespachoService.DESPACHO_TIER_PRICES_USD_CENTS`
ya tiene precios reales — ambos quedaron HECHOS por "Fase Despacho — flujo de
pago" y "Precios definitivos lanzamiento" (ver Current status). Solo quedan
diferidos por decisión, no bloqueantes:
1. Tanda B landing (testimonios) — DIFERIDA a post-Alpha (no hay testimonios reales aún)
2. Tanda D (checkout embebido) — DIFERIDA (spike post-Alpha)
3. **LAUNCH** 🚀 — sin bloqueantes de backlog conocidos

Fases 35B/35C/36A/36B diferidas a post-lanzamiento.

---

## Dinámica de trabajo

1. **Documentar en el momento**: patrón nuevo o decisión → `CLAUDE.md` / ADR / `quick-reference.md`. No en el chat.
2. **Contexto primero**: leer `CLAUDE.md` y archivos relevantes antes de proponer implementación.
3. **Feedback loop**: cada fase termina con `tsc` + `vitest` en verde. Nueva regla descubierta → documentar antes de continuar.
4. **Bug encontrado = clase de bug (barrido obligatorio)**: al confirmar un bug que sigue un patrón replicable (validación faltante, helper local copiado, mismo ritual duplicado entre módulos), buscar con grep TODAS las instancias del patrón en el repo y corregirlas en el mismo fix — NUNCA cerrar solo la instancia reportada. Precedentes: IP spoofeable `.split(",")[0]` (11 módulos, ADR-041), fechas sin cota de año que tumbaban listados completos (10 schemas en 9 módulos, auditoría Compras/Ventas 2026-07 → `zBusinessDate`/`zBusinessDateString` en `zod-helpers.ts`, obligatorios para toda fecha de input de usuario).
