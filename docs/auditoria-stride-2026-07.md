# Auditoría STRIDE — ContaFlow (2026-07-19)

Threat model módulo por módulo sobre las 6 categorías STRIDE (Spoofing, Tampering,
Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).

**Método:** análisis estático de código (server actions, rutas API, servicios, middleware,
guards centrales). **Limitación:** la BD Neon estaba con la cuota de cómputo agotada durante
la auditoría, así que NO se pudo correr `scripts/verify-rls.mjs` en vivo ni drivear la app —
la evaluación de RLS y de comportamiento en runtime se basa en el código y las migraciones,
no en ejecución.

**Alcance:** 37 módulos en `src/modules/*`, 11 rutas API en `src/app/api/*`, middleware, guards
centrales (`action-guard`, `module-access`, `net-context`, `prisma-billing-gate`, `step-up`).

---

## Veredicto ejecutivo

**Postura general: SÓLIDA.** Las defensas centrales están bien aplicadas y son consistentes a
lo ancho de los módulos. No se encontró ningún hallazgo **CRÍTICO ni ALTO**. Los hallazgos son
**BAJOS / informativos** y ninguno abre por sí solo un vector de abuso explotable (todos tienen
un control primario que los cubre).

| STRIDE | Postura | Nota |
|---|---|---|
| **S** Spoofing | ✅ Sólido | Webhooks con firma, portales con JWT+revocación, crons con CRON_SECRET |
| **T** Tampering | ✅ Sólido | Escrituras con guard + hasModuleAccess; dinero siempre Decimal (R-5) |
| **R** Repudiation | ✅ Sólido | AuditLog en 45 servicios; IP confiable `.at(-1)`; step-up 2FA |
| **I** Info Disclosure | ✅ Sólido | encryptedP12 nunca al cliente; RLS por tenant; selects explícitos |
| **D** Denial of Service | 🟡 Aceptable | Rate limiting amplio; 2 detalles bajos (ver D-1, D-2) |
| **E** Elevation | ✅ Sólido | ADMIN_ONLY en operaciones críticas; segregación de funciones |

---

## Estado de remediación (2026-07-19)

| Ref | Severidad | Estado | Nota |
|---|---|---|---|
| **D-1** | BAJO | ✅ **CORREGIDO** | commit `fix(security): rate-limit … IP no spoofeable` — helper `clientIpFromHeaders` + `.at(-1)` en ambas rutas. 3148 tests GREEN. |
| **D-2** | BAJO/INFO | ⏸️ **NO SE CORRIGE (por diseño)** | Capar con `take` truncaría agregaciones fiscales → cierre incorrecto / export incompleto. Ya mitigado por rate-limit + acotado por tenant/período. Vía correcta = paginación/streaming (cambio mayor, no un “detalle”). |
| **I-1** | INFO | ⏸️ **DIFERIDO** | Quitar `unsafe-inline` de `style-src` rompe los inline styles de React en toda la app; ya está en el roadmap post-lanzamiento de endurecimiento CSP. No verificable con la BD Neon caída. |
| **C-1** | INFO | ✅ **CORREGIDO** | Las 5 actions con `companyId` migradas a `requireCompanyAction`. Bonus real: `employee-loan` guardaba el `x-forwarded-for` completo (spoofeable) → ahora `.at(-1)` vía `captureNet` (R-6); `invoice-batch` ganó rate-limit fiscal. Las 3 sin `companyId` (`user`/`locale`/`view-mode`) quedan fuera correctamente. 3148 tests GREEN. |

---

## Hallazgos (todos BAJOS / informativos)

### D-1 (BAJO) — Rate-limit de rutas públicas cakeado por IP spoofeable · ✅ CORREGIDO
**Dónde:** `api/webhooks/nowpayments/route.ts:11` y `api/doc/[token]/route.ts:20`.
Ambas rutas públicas keyean su rate-limit con la **primera** IP de `x-forwarded-for`
(`.split(",")[0]`), que la escribe el cliente y es falsificable. Un atacante que rote el header
`X-Forwarded-For` puede eludir el límite por IP.
**Por qué NO es crítico:** el límite es defensa en profundidad, no la frontera de seguridad —
nowpayments valida **firma HMAC** antes de procesar y `doc/[token]` valida **JWT + revocación**.
Sin firma/token válido no se procesa nada aunque se sature el límite.
**Recomendación:** keyear por identidad no-spoofeable (nowpayments → `payment_id`; doc → `jti`
del token) o usar `.at(-1)` como en `net-context`. Es el mismo patrón que ya se erradicó del
resto del código (ADR-041).

### D-2 (BAJO/INFO) — `findMany` sin cota en servicios de reportes
**Dónde:** varios servicios de agregación/exportación (`ExportService` 8×, `FiscalYearCloseService`
4×, `FiscalAnomalyDetectorService` 4×, `PeriodSnapshotService`, `CashFlowProjectionService`, …).
Hacen `findMany` sin `take:`.
**Por qué NO es crítico:** todos están acotados por `companyId` + rango de período — no hay
full-scan cross-tenant. El riesgo es que **una sola empresa con volumen enorme** cause
memoria/timeout (DoS auto-infligido). El Libro Diario ya está capado a 5.000 filas con aviso de
resultado parcial.
**Recomendación:** poner `take` de seguridad en los más pesados (Export/FiscalYearClose) o
paginar. Coincide con el handoff previo "reportes-query-caps" (parcialmente cubierto).

### I-1 (INFO) — CSP permite `style-src 'unsafe-inline'`
**Dónde:** `middleware.ts:26`. Los **scripts** ya están blindados con `nonce` + `strict-dynamic`
(sin `unsafe-inline`), pero los **estilos** aún permiten inline. Riesgo bajo (no ejecuta JS).
Ya está contemplado en el roadmap post-lanzamiento de endurecimiento CSP.

### C-1 (INFO — consistencia, no vulnerabilidad) — 8 actions fuera del guard central
**Dónde:** `auth/user.actions`, `invoices/invoice-batch.actions`, `iva-declaration/generarForma30`
+ `exportForma30PDF`, `payroll/employee-loan.actions`, `rif-validation/validateRifAction`,
`settings/locale.actions` + `view-mode.actions`.
Usan el ritual manual (`auth → companyMember → canAccess → rateLimit`) en vez de
`requireCompanyAction` (ADR-041). **Se verificó que TODAS tienen guard correcto** (tenant +
rol + rate limit donde aplica) — no hay hueco de autorización. Pero quedar fuera del patrón
central es justo donde antes se escondía la clase de bug de IP spoofeable.
**Recomendación:** migrarlas al guard por uniformidad (deuda técnica, no urgente).

---

## Detalle por categoría (diseño correcto verificado)

### S — Spoofing ✅
- **Webhooks firmados:** `nowpayments` verifica HMAC (`verifyNowPaymentsSignature`) y `seniat-report`
  verifica firma QStash (`Receiver.verify`) **antes** de tocar el payload; rechazan 401 sin firma.
- **Portales por token:** `doc/[token]` valida JWT (`DOC_SHARE_SECRET`) + chequea revocación
  (`docShareToken.revokedAt`) + `companyId` embebido como guard. Portales empleado/cliente por JWT.
- **Crons:** los 4 (`apply-plan-changes`, `billing-lifecycle`, `daily-notifications`, `seniat-outbox`)
  exigen `Authorization: Bearer ${CRON_SECRET}`.
- **Middleware:** solo rutas intencionadas son públicas; el resto pasa por `auth.protect()`.

### T — Tampering ✅
- **Escrituras con guard:** las mutaciones pasan por `requireCompanyAction` con rol explícito, y
  las de módulo financiero refuerzan con `hasModuleAccess` (que excluye a VIEWER de
  invoicing/accounting: no es rol base). Ej.: `createTransaction`, `voidTransaction`,
  `createInvoice`, `createCreditNote/DebitNote` — todas con checks posteriores.
- **Aislamiento multi-tenant:** lookups de entidad scopeados por `companyId` (ej.
  `getTransactionById` filtra `where:{companyId, OR:[{id},{number}]}`; `voidTransaction` valida
  `companyId` — sin IDOR).
- **R-5 dinero:** barrido sin aritmética float sobre dinero — `Decimal.js` en todo el cálculo fiscal.
- **Gate de escritura por suscripción** (`prisma-billing-gate`) bloquea toda mutación de negocio
  si la suscripción venció (con modelos exentos y fail-open).

### R — Repudiation ✅
- **AuditLog** presente en 45 servicios de mutación, dentro del mismo `$transaction` (ACID).
- **IP confiable:** patrón spoofeable `.split(",")[0]` **erradicado** en `src/modules`/`src/lib`;
  fuente única `net-context` usa `.at(-1)` (la IP que añade nuestro proxy).
- **Step-up 2FA** (reverification) en operaciones sensibles: cierre de ejercicio, eliminar
  miembro, archivar empresa, datos SENIAT, caja chica.

### I — Information Disclosure ✅
- **`encryptedP12`** solo se selecciona en `DocumentSigningService` (server-side) con `select`
  explícito, y se limpia con `buf.fill(0)` post-firma (Z-5). Nunca se retorna al cliente.
- **RLS por tenant:** policies `company_isolation` en migraciones (ADR-007 A1-bis) + `verify-rls.mjs`
  en CI. _(No ejecutado en vivo por la cuota Neon agotada.)_
- **Descargas:** `export/download` verifica ownership (`createdBy`) + membresía + expiración.

### D — Denial of Service 🟡
- **Rate limiting** amplio: `fiscal` (60/min, compartido, **falla cerrado**), `ocr` (10/min, cubre
  OCR Gemini y parseo bancario — cómputo caro), `export`, `rif`, `publicDoc`, `nowpayments`, `qstash`.
- Ver **D-1** (IP spoofeable en llaves públicas) y **D-2** (findMany sin cota).

### E — Elevation of Privilege ✅
- **ADMIN_ONLY** en operaciones de alto impacto: anular asiento, abrir/cerrar período, aprobar/
  rechazar préstamos de nómina, archivar empresa.
- **Segregación de funciones:** crear ≠ aprobar (ej. préstamos: crear=ACCOUNTING, aprobar=ADMIN).
- **`hasModuleAccess`** (ADR-025) combina rol base + grants granulares; VIEWER/ADMINISTRATIVE
  quedan fuera de los módulos donde no son rol base.

---

## Recomendaciones priorizadas

1. ~~**(BAJO) D-1** — llave de rate-limit no-spoofeable.~~ ✅ **HECHO** (2026-07-19): `.at(-1)`
   vía `clientIpFromHeaders`.
2. **(BAJO) D-2** — NO capar con `take` (truncaría fiscales). Si el volumen se vuelve un problema
   real, paginar/streaming en `ExportService`; ya mitigado por rate-limit + acotado por período.
3. ~~**(INFO) C-1** — migrar las 5 con `companyId` a `requireCompanyAction`.~~ ✅ **HECHO**
   (2026-07-19): incluyó un fix real de captura de IP en `employee-loan` y rate-limit en
   `invoice-batch`. Las 3 sin `companyId` quedan fuera correctamente.
4. **(INFO) I-1** — endurecer `style-src` en la tanda CSP post-lanzamiento ya planificada (rompe
   inline styles de React si se hace sin migrarlos; no hacer aislado).
5. **Pendiente de verificación runtime:** correr `verify-rls.mjs` cuando la BD esté estable, para
   confirmar RLS en vivo (esta auditoría lo validó solo por código/migraciones).

---

_Auditoría estática. No sustituye un pentest dinámico ni la verificación de RLS en runtime._
