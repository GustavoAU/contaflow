---
id: SPEC-016
titulo: Aislamiento multi-tenant — de report a enforce
estado: BORRADOR
fecha: 2026-10-07
rama: feat/spec-016-tenant-assert-enforce
arbol: "[11]"
zonas: [Z-1, Z-2, Z-3, Z-4, Z-5]
adrs: [ADR-004, ADR-007, ADR-041, ADR-044]
---

# Aislamiento multi-tenant — de `report` a `enforce`

## 1. Problema
La app conecta como `neondb_owner` (BYPASSRLS). La RLS solo se evalúa dentro de `withCompanyContext` (ADR-044 §2): olvidar el wrapper es fail-OPEN.

La defensa aplicativa existe y está bien diseñada: `src/lib/prisma-tenant-assert.ts` (ADR-044 D-3). Estado real, medido contra `origin/main`:

- **Corre en modo `report` por defecto** (`resolveMode` → `"report"`). Solo avisa a Sentry, no bloquea. `src/lib/prisma.ts` lo monta con `process.env.TENANT_ASSERT_MODE`.
- **Sí cubre las operaciones de fila única** (D-3-bis: `UNIQUE_ROW_OPERATIONS` = `findUnique`, `findUniqueOrThrow`, `update`, `delete`, `upsert`). La única exención que queda es `where: { id: "<string>" }` a secas, porque se asume un CUID generado por el servidor. Ese es el hueco real: si la action recibe el `id` del cliente y no valida pertenencia, el assert no lo ve.
- **No ve `$queryRaw`/`$executeRaw`**, pero el inventario D-8.2 **ya está hecho** (ADR-044 §9, marcado `[x]`): hay 15 call-sites de producción en 9 archivos, y el test `idempotency-key-tenant-scope.test.ts` ya los escanea con `findRawSqlSites` (hoy solo exige que ninguno toque `idempotencyKey` sin `companyId`).
- **`unscoped()` no tiene ningún uso fuera de tests.** La vía de escape existe, pero ningún flujo cross-company está anotado (ADR-044 D-3b sigue abierto: ~8 flujos). En `enforce`, esos flujos lanzarían.
- **Los tests de integración no pasan por `@/lib/prisma`**: los 4 archivos en `src/__tests__/integration/` crean su propio `new PrismaClient({ adapter: new PrismaPg(...) })`. Fijar `TENANT_ASSERT_MODE` en `vitest.integration.config.ts` no tendría ningún efecto sobre ellos.
- El gate "ADR-004" de CI es un `grep` sobre `src/modules` (`findMany`/`findFirst`, ventana de 15 líneas antes y 10 después): una palabra `companyId` en un comentario lo satisface.

Un contador de la empresa A no debe poder ver ni modificar un dato de la empresa B por un olvido de código.

## 2. Base legal / contable
Confidencialidad de la información contable y fiscal del contribuyente (COT; Ley de Infogobierno / protección de datos). Riesgo reputacional y contractual directo.

## 3. Alcance
**Incluye:**
- A) **Inventario en producción (lo hace el usuario, o Claude con el MCP de Sentry si el usuario lo pide):** eventos `tenant_assert_violation` en modo `report` de los últimos 30 días, agrupados por `modelo.operación`. Se pegan en la sección 11. Sin ese inventario no se pasa a `enforce` en producción. ADR-044 pide además una ventana de una semana en `report`.
- B) **D-3b — anotar los flujos cross-company (prerrequisito de `enforce`).** Envolver con `unscoped(razón, fn)` los flujos que ADR-044 lista (`user.actions.ts:33`, `dashboard/page.tsx:34`, `BillingService.ts:120,213`, `PlanChangeService.ts:189`, `NotificationEmailService.ts:140`, `cron/seniat-outbox`, `CompanyService.ts:319`) más los que salgan del inventario A. Los números de línea pueden haber cambiado: se buscan por símbolo.
  - Ampliar `UnscopedReason` con razones tipadas para los flujos que hoy no tienen una. La unión actual es: `auth-bootstrap`, `company-create`, `cron:billing-lifecycle`, `cron:plan-change`, `webhook:nowpayments`, `webhook:qstash`, `health`, `seed`, `despacho:managed-clients`. Faltan al menos los crons `daily-notifications`, `payroll-auto-draft` y `seniat-outbox` (no existe una razón `CRON_CROSS_TENANT`; no se inventa un nombre genérico, se añade una por flujo).
  - Test de arquitectura: cada ruta de `src/app/api/cron/**` usa `unscoped(` o acota por `companyId`.
  - Si B toca más de ~10 sitios, partirlo en una spec previa (SPEC-016a) y dejar esta para los tests y el paso a `enforce`.
- C) **Tests en `enforce`, con el cliente real de la extensión.** Helper en `src/__tests__/helpers/` que construye `new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL_TEST }) }).$extends(createTenantAssertExtension("enforce"))`. No se toca `vitest.integration.config.ts`.
  - Test de integración (`src/__tests__/integration/tenant-isolation.test.ts`, branch efímero de SPEC-002) con dos empresas sembradas. Para cada uno de los 10 modelos de mayor riesgo, una operación multi-fila sin `companyId` **lanza**, y con `companyId` devuelve solo filas de esa empresa:
    `Invoice`, `JournalEntry`, `Transaction`, `Retencion`, `PaymentRecord`, `Employee`, `PayrollRun`, `Account`, `InventoryMovement`, `AuditLog`.
    (La versión anterior de la lista incluía `JournalLine`, que **no existe** en el schema: las líneas de asiento son `JournalEntry`; el libro diario es `Transaction`.)
  - Y que `unscoped(razón, fn)` lo permite.
- D) **Guard del mapa de scope.** Hoy el test unitario `SCOPE_MAP (DMMF real)` fija `SCOPE_MAP.size` en exactamente 93 (y el comentario del código dice 88: está desactualizado). Comparar el tamaño contra el DMMF sería circular, porque el mapa se construye del DMMF. Lo nuevo:
  - Verificación independiente contra el texto de `prisma/schema.prisma`: `SCOPE_MAP.size` ≥ número de modelos con columna `companyId` directa (hoy 79) y ≤ total de modelos (hoy 94); y modelos centinela presentes.
  - RN-4: `createTenantAssertExtension("enforce")` **lanza al construirse** si `SCOPE_MAP.size === 0` (hoy solo manda un `captureMessage` a Sentry). En `report` se mantiene el comportamiento actual. **Decisión por defecto: fail-closed solo en `enforce`** (el usuario puede revertirla; queda confirmada al aprobar esta spec). Esto revierte una decisión documentada en el propio archivo (líneas ~218-227: "degradar a sin vigilancia y avisar es infinitamente mejor que un outage"). Motivos: (1) un mapa vacío solo puede aparecer tras un cambio de generador o de versión de Prisma, y el test `SCOPE_MAP (DMMF real)` (tamaño fijado en 93) ya lo atrapa en el PR, así que el arranque en producción es la última línea de defensa de un evento que el CI debería impedir; (2) si llegara a producción, fail-open es una fuga silenciosa de datos entre empresas (impacto de confidencialidad), mientras que fail-closed es un error ruidoso e inmediato; (3) en `report` se conserva el comportamiento actual, porque ahí no hay nada que proteger. Si `next build` construye el cliente, el build también fallaría antes de desplegar; se comprueba al implementar y, si no, se cubre con un test que construya la extensión en `enforce`.
- E) **SQL crudo — endurecer el inventario que ya existe**, no crear otro. Extender `idempotency-key-tenant-scope.test.ts` (o extraer `findRawSqlSites` a un módulo compartido) con una allowlist `src/__tests__/architecture/raw-sql-allowlist.ts` de `{ archivo, método, razón, acotaPorCompanyId }` y el conteo fijado (hoy 15). Un uso nuevo sin entrada falla; `$queryRawUnsafe`/`$executeRawUnsafe` (hoy 0) fallan siempre salvo entrada explícita. Esto automatiza la regla D-8.2 que hoy solo vive en el checklist de `CLAUDE.md`.
- F) **Fila única con `where: { id }` (propuesta; decide `arch-agent` + usuario).** Hoy no existe un "contexto de empresa de la request" accesible desde la extensión (el único `AsyncLocalStorage` es el de `unscoped`). Verificar `result.companyId` después de `findUnique`/`update`/`delete` exige introducir ese contexto (p. ej. un `AsyncLocalStorage` poblado dentro de `requireCompanyAction`, ADR-041). Es un cambio de mecanismo, no un ajuste: si se aprueba, va en una spec propia; si no, queda como ADR de seguimiento. Mientras tanto, la mitigación es el barrido de actions que reciben un `id` del cliente.
- G) **Reemplazar el grep ADR-004 de `ci.yml`: solo cuando el reemplazo cubra lo mismo.** `company-isolation.test.ts` audita una lista **escrita a mano** (`SERVICE_FILES`), mientras que el grep recorre todo `src/modules/**/*.ts`. Reemplazar uno por otro **reduce** cobertura. Prerrequisito: que el test recorra `src/modules` (con un `walk`, como el test de idempotencia), con la misma regla de ventana y la excepción `// ADR-004-EXCEPTION`. Hecho eso, se borra el paso grep; si no, se deja.
- H) **Paso a `enforce` en producción (lo hace el usuario):** con B hecho, el inventario A resuelto (cada caso corregido o marcado `unscoped` con razón) y una semana en `report`, el usuario fija `TENANT_ASSERT_MODE=enforce` en Vercel (Preview primero, Production después). Una variable de entorno de Vercel solo se aplica a despliegues nuevos: volver a `report` o a `off` en un incidente exige redeploy. Documentarlo en `RUNBOOK.md`.

**No incluye (explícito):**
- Rol de conexión sin BYPASSRLS (ADR-044 D-7): spec propia después de esta.
- Reescribir las actions existentes: solo se tocan las que aparezcan en el inventario A.
- El mecanismo de contexto de empresa de la request (punto F), salvo que se apruebe.

## 4. Reglas de negocio
- RN-1: En los tests de integración, toda operación multi-fila sobre un modelo tenant sin `companyId` lanza.
- RN-2: `unscoped()` exige una razón tipada (`UnscopedReason`); un `unscoped` nuevo sin razón no compila.
- RN-3: Todo SQL crudo está en la allowlist con su razón; el `Unsafe` está prohibido salvo entrada explícita.
- RN-4: En `enforce`, el mapa de scope nunca está vacío en tiempo de ejecución: si lo está, la extensión lanza al construirse; no se degrada en silencio.
- RN-5: Producción pasa a `enforce` solo con B hecho y el inventario de la sección 11 resuelto.

## 5. Asientos contables
No aplica.

## 6. Modelo de datos
Sin cambios de schema.

## 7. Contrato de servicio y actions
Sin cambios de firma salvo `UnscopedReason` (unión ampliada). Archivos:
- `src/lib/prisma-tenant-assert.ts` (RN-4 y razones nuevas)
- los archivos de servicios/actions/crons que B anote con `unscoped`
- `src/__tests__/helpers/` (cliente con la extensión) y `src/__tests__/integration/tenant-isolation.test.ts` (nuevo)
- `src/__tests__/architecture/raw-sql-allowlist.ts` (nuevo) y ajustes a `idempotency-key-tenant-scope.test.ts`
- `src/__tests__/architecture/company-isolation.test.ts` (recorrido completo, si G procede) y test de crons
- `.github/workflows/ci.yml` (borrar el grep ADR-004, solo si G procede)
- `RUNBOOK.md`

## 8. UI
No aplica.

## 9. Criterios de aceptación
- [ ] CA-1: Con el cliente en `enforce`, un `findMany` sobre `Invoice` sin `companyId` lanza en el test de integración; con `companyId` devuelve solo filas de esa empresa.
- [ ] CA-2: El mismo `findMany` dentro de `unscoped("<razón válida>", …)` no lanza.
- [ ] CA-3: Añadir un `$queryRaw` nuevo en `src/` sin entrada en la allowlist hace fallar el test de arquitectura; un `$queryRawUnsafe` también.
- [ ] CA-4: Con un DMMF simulado vacío, `createTenantAssertExtension("enforce")` lanza; en `report` no lanza y avisa. El test de cobertura contra `schema.prisma` falla si `SCOPE_MAP.size` queda fuera del rango.
- [ ] CA-5: Todo flujo de ADR-044 D-3b y toda ruta de `src/app/api/cron/**` está anotado con `unscoped` y razón tipada, o acota por `companyId` (test de arquitectura).
- [ ] CA-tenant: un usuario de la empresa B no obtiene ninguna fila de la empresa A en los 10 modelos del punto C.
- [ ] CA-6: El paso grep "ADR-004" ya no existe en `ci.yml` **solo si** `company-isolation.test.ts` recorre todo `src/modules`; en otro caso sigue y la sección 12 lo explica.
- [ ] CA-7: La sección 11 contiene el inventario de Sentry y la fecha en que producción pasó a `enforce`.

## 10. Plan de agentes

## 11. Riesgos y preguntas abiertas
- **PAUSA — requiere al usuario:** el inventario de Sentry (A) y la decisión sobre F. (La decisión fail-closed del punto D tiene valor por defecto: fail-closed solo en `enforce`.)
- R-1: Los cron jobs (`/api/cron/*`) operan sobre varias empresas. Cada uno necesita una `UnscopedReason` propia; sin ellas, `enforce` los rompe en producción. De ahí B.
- R-2: Si el inventario muestra muchas violaciones en un módulo, ese módulo se corrige en su propia spec. Esta solo bloquea lo nuevo y deja la deuda listada.
- R-3: `security-agent` debe revisar la allowlist de SQL crudo completa antes del merge.
- R-4: Los tests de integración usan `PrismaPg` (TCP) y producción `PrismaNeon` (WebSocket). La extensión es independiente del adaptador, pero LL-014 ya mostró diferencias de comportamiento entre adaptadores; no se asume equivalencia fuera de la aserción.

**Verificación fase 1 (2026-10-07, contra `origin/main` faca04a6):**
- Corregido: "no cubre operaciones de fila única" era falso; las cubre desde D-3-bis salvo `where: { id }` a secas.
- Corregido: "inventario D-8.2 sigue pendiente" era falso; está marcado `[x]` en ADR-044 y existe `findRawSqlSites` con tests. El conteo es 15 call-sites en 9 archivos (ADR-044 decía 16 en 2026-08; el test mide 14 el 2026-08-19).
- Corregido: la ventana del grep ADR-004 es de 15 líneas antes y 10 después, no ±25, y solo recorre `src/modules`.
- Corregido: `CRON_CROSS_TENANT` no existe; la unión real de razones está en el punto B. Hay 0 usos de `unscoped(` fuera de tests.
- Corregido: la lista de 10 modelos incluía `JournalLine` (inexistente).
- Corregido: `TENANT_ASSERT_MODE` en `vitest.integration.config.ts` no tendría efecto; los tests de integración no importan `@/lib/prisma`.
- Corregido: reemplazar el grep por `company-isolation.test.ts` reducía cobertura (lista fija de archivos).
- Confirmado: `resolveMode` devuelve `"report"` por defecto; `SCOPE_MAP` se construye de `Prisma.dmmf` con `?? []` y un `captureMessage` si queda vacío; ADR-044 D-3b está sin marcar.
- No comprobado: el contenido real de Sentry (requiere el inventario A).

## 12. Cierre
