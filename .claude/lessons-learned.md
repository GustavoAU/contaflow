# ContaFlow — Lessons Learned

> Real project errors. Format: [Phase] [Context] → [Error] → [Golden rule].
> Update here before reporting success to the orchestrator when a bug is detected in production or in an audit.

---

## LL-001 — Incomplete RIF Regex (Phase 12B / 18.6)

- **Phase detected**: 12B — pre-merge audit
- **Context**: RIF VEN-NIF validation regex in `invoice.schema.ts` and `retention.schema.ts`
- **Error**: `/^[JVEGP]-\d{8}-?\d?$/i` — missing `C` (Comunal) in the charset. Venezuelan comunal organizations with a `C-` RIF prefix could not register invoices.
- **Fix applied**: `VEN_RIF_REGEX = /^[JVEGCP]-\d{8}-?\d?$/i` in `src/lib/fiscal-validators.ts` as single source of truth
- **Golden rule**: The RIF regex lives in ONE place only (`fiscal-validators.ts`). Never duplicate it in schemas. Any change to the regex → update `fiscal-validators.ts` and the corresponding test.
- **Regression test**: `fiscal-validators.test.ts` — case `C-12345678` must pass, `C-12345678-9` also.

---

## LL-002 — Missing companyId in Idempotencia Queries (Phase 13C-B1) ✅ RESOLVED

- **Phase detected**: 13C-B1 — multi-tenant isolation audit 2026-04-01
- **Resolved**: 2026-04-04 — `retention.actions.ts` lines 70 and 164
- **Context**: `retention.actions.ts` — idempotencia fast-path and P2002 recovery path
- **Error**: `prisma.retencion.findFirst({ where: { idempotencyKey } })` without `companyId`. An attacker with a known `idempotencyKey` can confirm whether a retención exists in any company in the system (cross-tenant information-disclosure).
- **Fix applied**: `findFirst({ where: { idempotencyKey, companyId: data.companyId } })` — both fast-path (line 70) and recovery path (line 164)
- **Golden rule**: Idempotencia is always verified with `{ idempotencyKey, companyId }` — never by `idempotencyKey` alone. The key is globally unique by design (`@unique`), but the check must be scoped to the tenant to avoid revealing existence to other tenants.

---

## LL-003 — Missing companyId in Account Code Uniqueness (Phase 13C-B1) ✅ RESOLVED

- **Phase detected**: 13C-B1 — multi-tenant isolation audit 2026-04-01
- **Resolved**: 2026-04-04 — `account.actions.ts` line ~190
- **Context**: `account.actions.ts` `updateAccountAction` — unique code verification
- **Error**: `prisma.account.findFirst({ where: { code, NOT: { id } } })` — without `companyId`. Code `1.1.1.01` from company A blocks a legitimate update of that same code in company B.
- **Impact**: incorrect logic (not just information-disclosure) — legitimate operations are blocked.
- **Fix applied**: `findFirst({ where: { code, companyId: before.companyId, NOT: { id }, deletedAt: null } })`
- **Golden rule**: Uniqueness of business fields (account code, invoice number, etc.) is always `@@unique([companyId, field])` in the schema AND `findFirst({ where: { companyId, field } })` in code.

---

## LL-004 — `environmentMatchGlobs` Does Not Exist in Vitest 4

- **Phase detected**: initial test configuration
- **Context**: attempt to configure environments by glob in `vitest.config.ts`
- **Error**: `environmentMatchGlobs` was removed in Vitest 4. Using this option breaks configuration silently or with a cryptic error.
- **Fix**: `// @vitest-environment jsdom` on the FIRST line of each React component test file. The `vitest.config.ts` uses `environment: 'node'` globally.
- **Golden rule**: Never use `environmentMatchGlobs`. Always use the per-file directive.

---

## LL-005 — Advisory Locks Do Not Survive PgBouncer Transaction Mode (Neon)

- **Phase detected**: 12B — concurrency decision
- **Context**: proposal to use `pg_advisory_lock` to serialize correlativo generation
- **Error**: Neon serverless uses PgBouncer in `transaction` mode. Session-level advisory locks (`pg_advisory_lock`) do not survive the pool — each query may go to a different connection. Result: deadlocks under load or locks that are never released.
- **Fix**: `$transaction({ isolationLevel: 'Serializable' })` + atomic UPDATE (see ADR-001)
- **Golden rule**: On Neon serverless, never use session-level advisory locks. Always use transaction-level locking via Serializable SSI or explicit row-level locks inside `$transaction`.

---

## LL-006 — `||` vs `??` for Env Vars in CI/CD

- **Phase detected**: 13B — CI/CD infrastructure
- **Context**: `prisma.config.ts` — fallback for `DATABASE_URL_DIRECT`
- **Error**: GitHub Actions returns `""` (empty string) for secrets not configured in the environment. `??` only coalesces `null` and `undefined` — `""` passes through as a valid value and Prisma fails with a cryptic invalid URL error.
- **Fix**: use `||` for all env var fallbacks: `process.env.DATABASE_URL || "fallback"`
- **Golden rule**: For infrastructure configuration env vars, always use `||`, not `??`.

---

## LL-007 — Type-Safe Cast for @react-pdf/renderer Without `as any`

- **Phase detected**: 12B / 18.2 — PDF generation
- **Context**: `renderToBuffer()` from `@react-pdf/renderer` — the React PDF element type does not directly match the type expected by the function
- **Error**: using `element as any` passes TypeScript but hides real type errors in PDF component props.
- **Fix**: `element as Parameters<typeof renderToBuffer>[0]` — extracts the type of the function's first parameter at compile time. If the type changes in a future version, TypeScript will catch it.
- **Golden rule**: Never use `as any` to adapt library types. Use `Parameters<typeof fn>[N]`, `ReturnType<typeof fn>`, or `ConstructorParameters`.

---

## LL-009 — verifyMembership Boolean Anti-Pattern (Phase 17 / 2026-04-06) ✅ RESOLVED

- **Phase detected**: 17 — security audit 2026-04-06
- **Context**: `bank-reconciliation/actions/banking.actions.ts` — `verifyMembership` helper
- **Error**: A helper that returns `boolean` from a `companyMember` query permanently blocks ADR-006 D-1 enforcement because the `role` field is never surfaced. Any action using a boolean membership check can never verify whether the caller has ADMIN vs ACCOUNTANT vs VIEWER.
- **Fix applied**: Return `companyMember | null` from membership lookup; check `.role` at the action level per the ADR-006 D-1 matrix.
- **Golden rule**: Never write a `verifyMembership(): boolean` helper. The canonical pattern is `findUnique({ where: { userId_companyId }, select: { role: true } })` returning the member object or null. The action checks `member.role` against the required level.
- **Regression test**: Action tests with VIEWER-role stub must return `{ success: false, error: 'No autorizado para esta operación' }` for every mutating action.

---

## LL-010 — Service Methods Without $transaction Wrapping Are Auditable Surface (Phase 17 / 2026-04-06) ✅ RESOLVED

- **Phase detected**: 17 — security audit 2026-04-06
- **Context**: `BankStatementService.ts` — `addTransaction`, `matchTransaction`, `unmatchTransaction`
- **Error**: Service layer methods that mutate financial records without accepting a `tx` parameter or wrapping in `$transaction` violate CLAUDE.md even if no action currently calls them. Public surface = auditable surface. If a future action calls these methods directly, mutations occur without atomicity and without AuditLog.
- **Fix applied**: Either (a) accept a `Prisma.TransactionClient` parameter and require callers to wrap, or (b) route all action calls through a higher-level service (e.g. `BankingService`) that already provides transaction wrapping. Mark internal methods explicitly.
- **Golden rule**: Every public method on a service class that writes to the DB must either (a) accept a `tx: Prisma.TransactionClient` and delegate the transaction to the caller, or (b) wrap its own `prisma.$transaction` internally. A method that calls `prisma.model.create/update/delete` directly without either pattern is a violation of the `$transaction` mandatory rule.
- **Regression test**: Integration test asserting that a failed downstream write after `addTransaction` rolls back the bankTransaction record.

---

## LL-008 — Restart `npm run dev` After `prisma generate`

- **Phase detected**: multiple phases
- **Context**: any schema change + `prisma generate`
- **Error**: Next.js caches the Prisma module in development. Without restarting, the client uses the previous version of the schema and throws `Cannot read properties of undefined` on new models/fields.
- **Golden rule**: Mandatory flow always: `prisma migrate dev` → `prisma generate` → restart `npm run dev`. No shortcut exists.

---

## LL-011 — Read-Only Server Actions Also Need Auth (Security Audit 2026-05-18)

- **Phase detected**: full security audit 2026-05-18
- **Context**: `account.actions.ts` — `getAccountsAction`, `getNextAccountCodeAction`; `period.actions.ts` — `getActivePeriodAction`, `getPeriodsAction`
- **Error**: Read-only Server Actions that query domain tables (accounts, periods) were written without `auth()` + `companyMember` checks because they "only read data." Next.js Server Actions are callable via direct POST to the action endpoint — middleware does NOT protect Server Action invocations that bypass the page render flow.
- **Impact**: CRITICAL — any unauthenticated caller who knows a `companyId` can read the full chart of accounts or period history of any company.
- **Fix required**: EVERY `"use server"` function that queries company-scoped data must start with `auth()` + `companyMember` check, regardless of whether it's a mutation or a read. The middleware only protects page navigation — it does not protect direct Server Action POST calls.
- **Golden rule**: There is no such thing as a "safe read-only action" that skips auth. ALL `"use server"` exports that accept `companyId` as a parameter must call `auth()` and verify `companyMember` before any DB query. The test for this: "would this endpoint leak data if called from curl with no cookies?" If yes, it needs auth.
- **Regression test**: For every action in `account.actions.ts` and `period.actions.ts`, test that a call with a mocked empty Clerk session returns `{ success: false, error: "No autorizado" }`.

---

## LL-012 — Sentry Tunnel Must Pin DSN to Application DSN (Security Audit 2026-05-18)

- **Phase detected**: full security audit 2026-05-18
- **Context**: `src/app/monitoring/route.ts` — Sentry tunnel handler
- **Error**: The tunnel extracts the DSN from the user-supplied request body and relays to it. An attacker can send any Sentry DSN and the server will relay the payload to an arbitrary Sentry project, turning the app into an open relay.
- **Fix required**: Pin the allowed DSN: `const ALLOWED_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN; if (sentryDsn !== ALLOWED_DSN) return 400`. Add `checkRateLimit` on the tunnel route.
- **Golden rule**: Sentry tunnel routes must validate that the envelope DSN matches the application's own DSN before forwarding. Never relay to arbitrary Sentry endpoints.

---

## LL-013 — GL Configuration Changes Require AuditLog (Security Audit 2026-05-18)

- **Phase detected**: full security audit 2026-05-18
- **Context**: `src/modules/settings/actions/gl-config.actions.ts` — `saveGLConfigAction`
- **Error**: `companySettings.upsert` (GL account mapping) runs without `$transaction` and without `AuditLog.create`. Changing which GL accounts receive invoice postings leaves no audit trail.
- **Fix required**: Wrap in `prisma.$transaction`, capture `oldValue` (previous settings), create `AuditLog` with `action: "UPDATE_GL_CONFIG"`, include `ipAddress`/`userAgent` per R-6.
- **Golden rule**: Any mutation to `CompanySettings` is a fiscal configuration change — it must be wrapped in `$transaction` with `AuditLog` exactly like a `closeFiscalYearAction`. Configuration changes are as auditable as data changes.

---

## LL-014 — P2002 sin `meta.target` con Prisma 7.8 + adaptador Neon (2026-10-01)

- **Phase detected**: importación de plan de cuentas — detectado contra producción (ADR-056)
- **Context**: `src/lib/prisma-errors.ts` y ~13 call-sites que distinguen qué `@@unique` falló (correlativos, retenciones, idempotencia de pagos, PayrollRun, inventario)
- **Error**: dos fallas encadenadas. (1) Una regla vieja comparaba contra `controlNumber`, columna que no está en ningún índice único → rama muerta: el usuario recibía "ya existe una factura con ese número" en lugar de "error transitorio". (2) Desde Prisma 7.8.0 con `@prisma/adapter-neon`, `meta.target` no existe (`meta` llega `{}`); las columnas viven en `meta.driverAdapterError.cause.constraint.fields`, con o sin comillas literales. Todos los call-sites devolvían `false` en silencio.
- **Fix applied**: `p2002TargetIncludes` cubre ambas formas.
- **Golden rule**: nunca leer `meta.target` a mano; siempre `p2002TargetIncludes(e, "<columna del CONSTRAINT>")`. La columna es la del `@@unique`, no la del documento. Al subir Prisma de minor, re-verificar la forma del error P2002 contra la base real.
- **Regression test**: `src/lib/__tests__/prisma-errors.test.ts`

---

## LL-015 — El historial de migraciones nunca se había repetido desde cero (2026-10-03)

- **Phase detected**: SPEC-002, primer job de integración contra una BD vacía en CI (ADR-057)
- **Context**: `prisma/migrations/` (164 migraciones aplicadas en producción con el flujo manual `db execute` + `resolve --applied`)
- **Error**: dos migraciones no se podían repetir desde cero y nadie lo sabía porque en producción nunca se repiten. (1) `20260507_item72_legal_thresholds` duplicaba exactamente `20260428_legal_threshold` (`type already exists`). (2) `20260511_contra_asset` hacía `ALTER TYPE ... ADD VALUE` y usaba el valor nuevo en el mismo archivo (`55P04 unsafe use of new value`); Prisma ejecuta cada archivo como una transacción. Pasó meses sin detectarse: ningún test tocaba una BD real.
- **Fix applied**: la duplicada pasó a no-op; el `UPDATE` se movió a `20260511_contra_asset_backfill`. Verificado: 165/165 desde BD vacía, 94 tablas = 94 modelos.
- **Golden rule**: toda migración debe poder aplicarse sobre una base vacía; el job `integration` del CI lo comprueba en cada PR. Un `ADD VALUE` de enum y cualquier uso de ese valor van en migraciones separadas. Lo que nunca se ejecuta no se puede dar por verificado: probar los flujos manuales de despliegue desde cero en CI.
- **Regression test**: job `integration` de `.github/workflows/ci.yml` (aplica `prisma migrate deploy` a un branch vacío de `contaflow-ci`)

---

## LL-016 — La verificación de cuadre se hacía sobre valores distintos de los que se guardan (2026-10-04)

- **Phase detected**: auditoría de solo lectura de producción para la SPEC-001; causa raíz en SPEC-004 / ADR-058
- **Context**: `assertBalancedGLEntries` (N4) en 38 call-sites de 21 servicios; columna `JournalEntry.amount Decimal(19,4)`
- **Error**: los servicios calculan en precisión alta de `Decimal.js` (~20 dígitos), multiplican por la tasa BCV y verifican el cuadre SIN redondear; Postgres luego redondea CADA línea por separado al guardar. Un asiento de nómina en USD (tasa 779,9522, 11 líneas) quedó con Σ = −0,0001 aunque la verificación pasó. Además la verificación toleraba ±0,01, lo que escondía el defecto, y ningún test tocaba una base real.
- **Fix applied**: función central `quantizeGLEntries` (redondea al céntimo, absorbe el residuo en la línea mayor que no sea `noAbsorb`, modo `exact` para derivados de saldos guardados), redondeo de cada documento en su origen, y cuadre exacto en `assertBalancedGLEntries`.
- **Golden rule**: se verifica lo que SE GUARDA, no lo que se calculó: cuantizar a la precisión de persistencia ANTES de verificar y de persistir, y persistir el resultado cuantizado. Un asiento derivado de saldos ya guardados (anulación, cierre, liquidación) se niega EXACTO, sin redondear. Una tolerancia en una invariante contable esconde defectos reales. Un test de arquitectura exige que todo archivo que llame `assertBalancedGLEntries` llame `quantizeGLEntries`.
- **Regression test**: `src/lib/__tests__/gl-quantize.test.ts`, `src/__tests__/architecture/gl-quantize-coverage.test.ts` y `src/__tests__/integration/gl-quantize-balance.test.ts` (corre contra Postgres real en el job `integration`)

---

## LL-017 — Un test que dice "alta y edición" pero solo prueba el alta deja pasar un limiter faltante (2026-10-05)

- **Phase detected**: auditoría de seguridad de SPEC-008 (cuentas de 9 dígitos con título padre)
- **Context**: `src/modules/accounting/actions/account.actions.ts`; `requireCompanyAction(..., { limiter })` (ADR-041)
- **Error**: `updateAccountAction` llamaba al guard sin `limiter`, la única mutación de cuentas sin rate limit. Existía un test
  llamado "alta y edición siguen en el limiter fiscal" que solo ejercitaba `createAccountAction`: el nombre prometía una
  cobertura que no había. Mismo patrón en otra tanda: `setIsSuggesting(true)` sin `finally` dejaba la UI bloqueada si la
  Server Action se rechazaba por red.
- **Fix applied**: `limiter: limiters.fiscal` en update + test propio; `try/catch/finally` en la sugerencia del formulario.
- **Golden rule**: los tests de limiter/rol se parametrizan por CADA acción de mutación del módulo, y el nombre del test
  debe coincidir con lo que ejecuta; todo estado `loading` que se activa antes de un `await` se desactiva en `finally`.
- **Regression test**: `account.actions.test.ts` "[M-1] la edición pasa por el limiter fiscal…" y
  `AccountsTable.parent.test.tsx` "[L-1] si la llamada a la action se rechaza…"

---

## LL-018 — Un id del cliente decidía el tratamiento contable sin validarse contra su fuente (2026-10-04)

- **Phase detected**: revisión de seguridad de la SPEC-007 (contrapartida de inventario)
- **Context**: `InventoryAccountingService.postMovement`, rama de una ENTRADA ligada a factura; `createMovementAction`; `prisma-tercero-required-gate` (ADR-054)
- **Error**: (1) `invoiceId` llegaba del cliente (el formulario nunca lo envía) y bastaba que esa factura existiera y tuviera `transactionId` para enlazar el movimiento a SU asiento: una ENTRADA colgada del asiento de una venta subía el stock y el CPP sin débito a Inventario. (2) El borrador aceptaba una contrapartida que luego el gate de terceros rechazaba al contabilizar (Cuentas por pagar exige tercero y el movimiento no lo registra): un borrador imposible de contabilizar, sin salida para el contador. (3) La anulación armaba el contra-asiento con las cuentas que HOY tenía el ítem, no con las del asiento original, y no conservaba los terceros.
- **Fix applied**: la rama con factura exige factura de COMPRA de la empresa, línea vigente de esa factura y asiento de la empresa y POSTED, todo antes de escribir; la action descarta `invoiceId` del cliente; una sola guarda (`inventory-guards.ts`) valida la contrapartida al crear el borrador y otra vez al contabilizar; la anulación niega las LÍNEAS GUARDADAS, terceros incluidos.
- **Golden rule**: un id que decide el tratamiento contable se valida contra su fuente (tipo, relación, empresa, vigencia) en el momento de usarlo, y los campos que ningún formulario envía no se aceptan del cliente. Todo borrador que se acepta debe poder contabilizarse: la misma guarda corre en los dos pasos. Lo derivado de lo ya guardado (anulaciones) se calcula de las filas guardadas, no de la configuración de hoy. Y un `@unique` 1:1 sobre un asiento que comparten N movimientos es un bug latente que los mocks de Prisma no ven (PA-5, seguimiento).
- **Regression test**: `src/modules/inventory/__tests__/InventoryAccountingService.test.ts` (H-1, M-1, M-2, L-A), `inventory-guards.test.ts`, `inventory-operations.actions.test.ts` y `src/__tests__/architecture/inventory-no-single-line-entries.test.ts`

---

## LL-019 — Un test copió el valor que producía el código y blindó el error durante semanas (2026-10-05)

- **Phase detected**: SPEC-013, al corregir el asiento de causación de nómina con cuota de préstamo
- **Context**: `PayrollRunService.approve` y el test de ADR-058 del caso USD con préstamo (`PayrollRunService.test.ts`)
- **Error**: el gasto de sueldos se calculaba como `totalEarnings − cuota`, pero `totalEarnings` solo suma líneas EARNING y la cuota es una DEDUCTION, así que se restaba dos veces (el asiento cuadraba, por eso nada lo detectó). El test que cubría ese caso se había escrito con el valor que producía el código (gasto 899,61 = 1.043,32 − 143,71) y no con uno derivado del recibo: en vez de detectar el error, lo fijó. Además el comentario del código describía un `totalEarnings` que no existe.
- **Fix applied**: el gasto es el bruto completo; una nómina con cuotas de préstamo exige la cuenta de préstamos al personal; el test se rehízo con valores esperados calculados aparte, a partir del recibo, y se añadió una prueba de invariante (Nómina por pagar = neto del recibo + retenciones sin cuenta propia) sobre 14 combinaciones.
- **Golden rule**: el valor esperado de un test se calcula de una fuente independiente del código que prueba (aquí, el neto del recibo), nunca copiando lo que el código devuelve. Un asiento que cuadra no está por eso bien: hay que comparar sus líneas contra el documento de origen. Un comentario que describe un total debe poder comprobarse contra la definición real de ese total.
- **Regression test**: `src/modules/payroll/__tests__/PayrollRunService.test.ts` (describe "PayrollRunService.approve — cuota de préstamo (SPEC-013)")

---

## LL-020 — Un guard definido por "quien llama X" no ve a quien debió llamar X (2026-10-05)

- **Phase detected**: SPEC-001, al preparar el trigger de cuadre exacto (T = 0) en la BD
- **Context**: `gl-quantize-coverage.test.ts` (SPEC-004) exigía que todo archivo que llama `assertBalancedGLEntries(` cuantizara antes; `InvoiceGLPostingService`
- **Error**: el guard de arquitectura de SPEC-004 solo miraba a los archivos que YA llamaban `assertBalancedGLEntries(`. La causación de facturas creaba asientos sin llamarlo y sin cuantizar, así que quedó fuera de la migración de 21 servicios y del guard, aunque era el generador más usado. Con el trigger de cuadre exacto, un total con más de 2 decimales (conversión de moneda) habría hecho fallar el COMMIT de una factura en producción.
- **Fix applied**: `InvoiceGLPostingService` cuantiza y verifica (residuo en la línea de base); el guard nuevo `gl-entry-creators-quantize.test.ts` parte de lo que se CREA (`entries: { create` / `journalEntry.create`) y exige `quantizeGLEntries(` en cada archivo; se comprobó con un mutante que falla si se quita la llamada.
- **Golden rule**: un guard de cobertura se define por el efecto que se quiere impedir ("nadie crea asientos sin cuantizar"), no por quien ya cumple parte del patrón ("quien llama a assert cuantiza"). Al añadir una restricción nueva en la BD, el barrido previo es sobre TODOS los escritores de esa tabla, no sobre los que ya pasan por la función central.
- **Regression test**: `src/__tests__/architecture/gl-entry-creators-quantize.test.ts` y `src/modules/invoices/__tests__/InvoiceGLPostingService.quantize.test.ts`
