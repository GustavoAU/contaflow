# ADR-044 — RLS fail-closed por defecto: corrección de ADR-007 y plan de cobertura

- **Status**: ACEPTADO (decisión) · IMPLEMENTACIÓN POR FASES (D-3 → D-7)
- **Fecha**: 2026-08-15
- **Autor**: arch-agent
- **Criticidad**: SECURITY — corrige una afirmación **falsa** de ADR-007 que se
  viene citando como control compensatorio en otros ADRs y auditorías.
- **Corrige**: [ADR-007](ADR-007.md) §Consequences (viñeta *fail-closed*) y el
  bloque «Corrección (hallazgo externo ADR — fail-closed)».
- **Complementa**: [ADR-007-addendum](ADR-007-addendum.md) (provisioning del rol
  `authenticated`), ADR-004 (aislamiento aplicativo por `companyId`), ADR-041
  (`requireCompanyAction` como chokepoint de autorización).

---

## 1. Contexto — lo MEDIDO (no lo supuesto)

| Hecho | Valor | Fuente |
|---|---|---|
| Tablas con `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `company_isolation` (USING + WITH CHECK) | **88 / 88** | `scripts/verify-rls.mjs` contra la BD real, 2026-08-09 |
| Archivos de producción con `$transaction` | **84** (270 ocurrencias) | script sobre `git ls-files`, 2026-08-15 |
| Archivos que llaman `withCompanyContext` | **14** (~30 call-sites) | ídem |
| Cobertura efectiva de RLS sobre **escrituras transaccionales** | **≈ 15 %** | 30 / ~200 bloques de dominio |
| Cobertura efectiva sobre **lecturas** | **≈ 0 %** | las lecturas no viven dentro de `$transaction` |
| Rol de conexión de la app (`DATABASE_URL`) | `neondb_owner` — **BYPASSRLS** | `src/lib/prisma.ts` + `pg_roles` |

Los 14 archivos que sí lo usan **no son una muestra aleatoria**: son el núcleo
financiero (`invoice`, `payment`, `retention`, `igtf`, `receivable`,
`FiscalYearCloseService`, `INPCService`, `BankingService`,
`BankReconciliationService`, `fixed-asset`, `account`, `inpc`, `invoice-batch`).
Ese sesgo es mérito de quien lo implementó y hay que reconocerlo antes de
criticar la cobertura.

---

## 2. H-0 — La omisión es **fail-OPEN**, no fail-closed (confirmado)

**La lectura del reporte es correcta. ADR-007 línea 104 es falsa tal como está montado hoy.**

### 2.1 Por qué, en semántica de Postgres

`FORCE ROW LEVEL SECURITY` somete al **dueño de la tabla** a sus propias policies.
No hace nada contra el atributo `BYPASSRLS`: el motor decide con
`check_enable_rls()` → `has_bypassrls_privilege(GetUserId())`, evaluado sobre el
**rol efectivo actual**. Si ese rol tiene `rolbypassrls = true`, las policies
**no se evalúan en absoluto** — ni `USING` ni `WITH CHECK`, con FORCE o sin él.

Por tanto hay dos escenarios de omisión, y ADR-007 solo describió el que **no puede ocurrir**:

| Escenario | Rol efectivo | ¿Policies? | Resultado |
|---|---|---|---|
| Entro a `withCompanyContext` pero falta `set_config` | `authenticated` | Sí, `current_setting` → NULL | **0 filas — fail-closed** ✅ (imposible en la práctica: el wrapper hace ambas cosas de forma atómica) |
| **Nunca entro al wrapper** (el caso real: ~70 archivos, 100 % de las lecturas) | `neondb_owner` | **No se evalúan** | **Ve todo — fail-OPEN** ❌ |

ADR-007 documentó el primero y lo presentó como la consecuencia de olvidar el
wrapper. El olvido real produce el segundo.

### 2.2 La prueba empírica, que no admite discusión

Las 88 tablas tienen `FORCE RLS` **y la aplicación funciona**. Si las policies se
evaluaran sin contexto, cada consulta de esos ~70 archivos devolvería 0 filas y
ContaFlow estaría visiblemente rota de punta a punta. No lo está. Ergo: **las
policies no se están evaluando**. No hace falta más instrumentación para
concluirlo.

Verificación de un comando (opcional, para el expediente):

```sql
SELECT current_user, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
-- Esperado hoy: neondb_owner | f | t
```

> Matiz que sí importa: `BYPASSRLS` **no se hereda** por pertenencia a un rol
> (los atributos de rol nunca se heredan). Si `neondb_owner` lo tuviera solo por
> ser miembro de `neon_superuser`, el flag propio sería `f` y las policies **sí**
> se evaluarían… en cuyo caso la app estaría caída. Como no lo está, el atributo
> es propio. La consulta de arriba lo deja por escrito.

### 2.3 Corrección de un dato del backlog

La memoria de la auditoría MP-4 (ítem I-4) afirma «`withCompanyContext` tiene
**cero callers** de producción». **Es incorrecto**: hay ~30 call-sites reales
(p. ej. `createAccountAction`/`updateAccountAction` envuelven su `$transaction`).
La prueba independiente es el bug **HA-01** (`permission denied for schema public`,
migración `20260628`): ese error **solo puede producirse bajo `SET LOCAL ROLE
authenticated`**. La RLS sí se evalúa en producción — en el ~15 % de las
escrituras. Lo que es falso no es la existencia del control, sino su **alcance**
y su **modo de fallo**.

### 2.4 Por qué esto es un hallazgo de gobernanza, no solo técnico

ADR-007 se cita como *capa de defensa* en otros ADRs y en auditorías previas. Un
control compensatorio que no existe es **peor que ninguno**: cambia decisiones de
riesgo aguas arriba («el `findMany` sin `companyId` está cubierto por RLS» →
falso). La corrección documental es, por sí sola, la acción de mayor valor de
este ADR y no cuesta nada.

---

## 3. Postura de seguridad REAL declarada (a partir de hoy)

> El aislamiento multi-tenant de ContaFlow es **100 % aplicativo**: ADR-004
> (`companyId` en todo `findMany`/`findFirst`) + ADR-041 (`requireCompanyAction`,
> 66/66 módulos) + `requireCompanyPage` en páginas. La RLS de Postgres es una
> **defensa en profundidad PARCIAL**: DDL completo en 88/88 tablas, pero solo
> activa dentro de los ~30 call-sites de `withCompanyContext`. Fuera de ellos no
> se evalúa. **Olvidar el wrapper es fail-open.**

Esta frase es la que debe copiarse a cualquier auditoría, cuestionario de
seguridad o due diligence hasta que D-7 esté cerrado.

---

## 4. Decisiones

### D-1 — Corregir la documentación YA (inmediato, coste cero)

`ADR-007.md` queda con banner de corrección y su viñeta de *Consequences*
reescrita. Cualquier ADR/auditoría que invoque «RLS» como mitigación debe
releerse bajo §3. **No se aprueba ningún hallazgo cerrado cuyo argumento de
cierre sea «lo cubre la RLS».**

### D-2 — El objetivo es fail-closed por defecto, pero **no** se llega con un flip

Se **rechaza** la alternativa 1 en su forma directa (cambiar hoy `DATABASE_URL` a
un rol sin `BYPASSRLS`). Motivo: convertiría de golpe **todas** las consultas no
instrumentadas (≈100 % de las lecturas) en **0 filas silenciosas**. Es
exactamente el riesgo D del planteamiento, con radio de explosión máximo y sin
excepción: balances en cero, libros de ventas vacíos, un cierre de ejercicio
calculado sobre conjunto vacío. En una app contable eso no es una caída, es
**corrupción de datos con apariencia de normalidad**.

El rol sin `BYPASSRLS` es el **último** paso (D-7), no el primero, y se activa
solo cuando el contador de consultas no instrumentadas llegue a 0.

### D-3 — Primero el control que cubre el 100 % HOY: extensión de aserción ADR-004

Antes de tocar la RLS, se cierra el hueco real con el mecanismo más barato, más
ruidoso y de cobertura inmediata: una **extensión de Prisma que exige `companyId`**
en toda operación sobre modelos tenant.

**Contrato:**

```ts
// src/lib/prisma-tenant-assert.ts  (nombre sugerido)
// Rechaza en tiempo de ejecución toda operación multi-fila sobre un modelo
// tenant que no acote por companyId. NO filtra, NO inyecta: solo AFIRMA.
//   - Modelos cubiertos: TENANT_MODELS (los 88 de verify-rls.mjs, menos User)
//   - Operaciones cubiertas: findMany, findFirst, count, aggregate, groupBy,
//     updateMany, deleteMany, createMany
//   - Exentas: findUnique/findUniqueOrThrow por PK (best-practices §1.2),
//     modelos no-tenant, y todo lo envuelto en `unscoped()`
//   - Modelos hijos sin companyId propio (JournalEntry, InvoiceTaxLine,
//     OrderItem, QuotationItem, PaymentBatchLine, InventoryMovementLot/Serial,
//     IncomeDistributionLine/Audit, SubscriptionPayment, PlanChangeRequest):
//     se acepta el filtro por el padre (mismo mapa que las policies de a1bis).
export function createTenantAssertExtension(mode: "report" | "enforce") { … }

// Vía de escape ÚNICA, explícita, greppable y auditada:
export function unscoped<T>(reason: string, fn: () => Promise<T>): Promise<T>;
//   reason ∈ "cron:billing-lifecycle" | "webhook:nowpayments" | "health" |
//            "company-create" | "auth-bootstrap" | …
//   En prod: Sentry breadcrumb con tag `unscoped_reason`. Sin reason → no compila.
```

**Despliegue: `report` → `enforce`.** Primero solo instrumenta (Sentry
`captureMessage`, tag `tenant_assert_violation`, sin lanzar) durante una ventana
de una semana en producción; después se pasa a `enforce`. Es el mismo patrón que
este equipo ya ejecutó bien con CSP Report-Only.

**Por qué esto va primero, y es el argumento decisivo del ADR:** el inventario de
violaciones y de `unscoped()` que produce esta fase **es exactamente el insumo que
D-7 necesita** para saber qué flujos requieren rol admin. Hacerlo al revés obliga
a adivinar la lista de excepciones.

Coste: 1 archivo, **0 round-trips**, 0 latencia. Cobertura: 100 % de las lecturas
desde el día uno. Fallo: **ruidoso**.

Limitación reconocida: no ve `$queryRaw`/`$executeRaw` (no hay `model`). Ver D-8.

### D-4 — La RLS **nunca** puede devolver 0 filas en silencio

Se cambia el predicado de las policies para que la ausencia de contexto **lance
excepción** en lugar de filtrar. Esto convierte el riesgo D (dato incorrecto
silencioso) en un error duro observable, y es prerrequisito de D-6/D-7.

```sql
-- Migración: 20260816_rls_raise_on_missing_context
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.current_company_id', true);
BEGIN
  -- NULL (nunca seteado) y '' (SET LOCAL revertido en una conexión reciclada del
  -- pool) son el MISMO error: no hay tenant. Nunca devolver 0 filas por esto.
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'RLS_CONTEXT_MISSING: consulta bajo rol % sin app.current_company_id', current_user
      USING ERRCODE = '42501';
  END IF;
  RETURN v;
END $$;

-- Y en cada policy: reemplazar current_setting('app.current_company_id', true)
-- por app_current_company_id()  (USING y WITH CHECK, 88 tablas + subqueries).
```

- **Riesgo de esta migración: nulo para lo que hoy funciona.** Los ~70 archivos
  no instrumentados corren como `neondb_owner` → BYPASSRLS → la función ni se
  invoca. Los ~30 call-sites instrumentados siempre setean el contexto.
- **Rollback**: re-`CREATE OR REPLACE` de la función devolviendo
  `current_setting(...,true)` sin `RAISE`. Una sentencia, sin tocar policies.
- **Coste de plan**: la función es `STABLE` en plpgsql (no se inlinea) → una
  llamada por fila evaluada. Medir en el piloto sobre el listado más grande
  (Libro de Ventas). Si el coste apareciera, la salida es una policy híbrida
  `("companyId")::text = current_setting(...,true) OR app_assert_context()`
  — el `OR` corto-circuita en la vía feliz y solo raísa cuando no hay contexto.
- **Mapeo en la app**: el token `RLS_CONTEXT_MISSING` debe detectarse en
  `toActionError` → error genérico al usuario + `Sentry.captureException` con tag
  `rls_context_missing`. **Prohibido** degradarlo a lista vacía.

### D-5 — Un solo origen del contexto: el guard de ADR-041

El `companyId` que alimenta `app.current_company_id` debe ser **el verificado por
`requireCompanyAction`/`requireCompanyPage`**, nunca una variable local re-tecleada
en el call-site.

Razón: si el contexto sale de la **misma** variable que va al `where`, la RLS no
aporta nada contra un IDOR — solo contra un `where` olvidado. Atada al valor ya
validado contra `CompanyMember`, sí detecta la discrepancia «el parámetro dice X,
tu membresía es Y».

Corolario que resuelve la objeción del bootstrap de autorización: **no hace falta
vía de escape** para `companyMember.findFirst({ where: { companyId, userId } })`.
Se setea el contexto con el `companyId` *reclamado* y se consulta; la policy de
`CompanyMember` (`companyId = contexto`, migración a1bis) se satisface por
construcción y la autorización la sigue dando el `userId` del `where`. Si el
usuario no es miembro → 0 filas → denegado. No hay huevo-gallina.

Los flujos legítimamente no-tenant (alta de empresa sin `companyId`, `User`,
`Subscription`, crons que barren todas las empresas —`PlanChangeService`,
ADR-040 D-5—, webhooks QStash/NOWPayments, `/api/health`) se declaran vía
`unscoped(reason, …)` de D-3 y, en D-7, corren contra el cliente admin.

### D-6 — Cobertura por fases, en orden de RIESGO, con ratchet y comparación en sombra

Mecanismos (dos, porque el driver impone dos formas):

1. **Transacciones interactivas** → el `withCompanyContext` actual (ya existe, ya
   funciona). Micro-optimización aplicable hoy a los 30 call-sites: fusionar los
   dos `$executeRaw` en un round-trip —
   `SELECT set_config('role','authenticated',true), set_config('app.current_company_id',$1,true)`.
2. **Lecturas sueltas** → extensión de Prisma con el patrón documentado por
   Prisma para RLS: `$transaction([$executeRaw(set_config…), query(args)])`.
   Apilable sobre el billing gate (misma técnica que ya usa `src/lib/prisma.ts`).
   **No** debe activarse dentro de una transacción interactiva (abriría una
   segunda conexión → deadlock): la extensión vive en el handle no-transaccional.

Gobierno de la migración:

- **Ratchet**: contador de consultas tenant sin contexto, solo puede bajar
  (mismo mecanismo que el ratchet multi-país 20→17).
- **Modo sombra por módulo**: durante su ventana, el módulo migrado ejecuta bajo
  `authenticated` y compara el conteo de filas contra el resultado del rol
  propietario; divergencia → Sentry, **sin** romper la petición. Detecta el
  «habría devuelto 0 filas» **antes** de que lo vea un usuario.
- **Interruptor por módulo** (`RLS_ENFORCE_<MODULO>=off`) que solo puede
  *revertir al statu quo de hoy* (owner + BYPASSRLS). Por construcción no puede
  empeorar la postura actual; su estado se registra en el arranque.
- **Presupuesto de latencia**: p95 de una página de listado no debe empeorar
  > 15 %. Si se excede, el piloto se detiene y se replantea (ver §7, alternativa 4).

### D-7 — Endgame: rol de login sin BYPASSRLS + cliente admin explícito

Cuando el ratchet llegue a 0:

- `DATABASE_URL` pasa a un rol de login `app_rls` **sin** `BYPASSRLS` (mismos
  grants que `authenticated`, según el checklist del addendum de ADR-007).
- Se crea `prismaAdmin` con `DATABASE_URL_ADMIN` (rol propietario), **de uso
  restringido** a los flujos del inventario producido por `unscoped()` en D-3.
  Import prohibido fuera de `src/lib/**`, `src/app/api/cron/**`,
  `src/app/api/webhook*/**` — verificado por test de arquitectura.
- Solo a partir de aquí la frase «olvidar el contexto es fail-closed» es
  **cierta** — y con D-4 además es *ruidosa*, no silenciosa.

### D-8 — Reglas permanentes (van al checklist pre-merge)

1. Modelo Prisma nuevo → `ENABLE` + `FORCE` + policy `company_isolation`
   (USING + WITH CHECK) **en la misma migración** (ADR-007 A1-bis, ya vigente)
   **+ alta en `TENANT_MODELS`** (nuevo).
2. **SQL crudo (`$queryRaw`/`$executeRaw`) sobre tablas tenant: solo dentro de
   `withCompanyContext`.** La aserción de D-3 no puede verlo. Inventariarlo hoy
   (empezando por los `SELECT … FOR UPDATE` de correlativos) es tarea de la fase 1.
3. `scripts/verify-rls.mjs` (estructural) **no demuestra que la RLS se evalúe**.
   Se añade `scripts/verify-rls-runtime.mjs` (**conductual**): dos empresas de
   prueba; bajo `authenticated` + contexto A, afirmar (a) las filas de A se ven,
   (b) las de B **no**, (c) sin contexto **lanza** `RLS_CONTEXT_MISSING`. Ese
   script es la única prueba admisible de «RLS activa» en una auditoría.

---

## 5. Orden de ataque por RIESGO

Criterio: impacto de una fuga × probabilidad de que falte el alcance. **No** por
facilidad.

| # | Superficie | Por qué es la primera | Cobertura RLS hoy |
|---|---|---|---|
| **R1** | **Nómina y RRHH**: `Employee`, `PayrollRun(Line)`, `SalaryHistory`, `Termination`, `BenefitBalance`, `EmployeeLoan`, `VacationRecord` | Salarios y datos personales: máximo daño legal/reputacional; una fuga aquí no se «corrige», se notifica. Cobertura actual **0 %** | 0 % |
| **R2** | **Superficie despacho / multi-empresa**: `ManagedClient`, `Company`, `CompanyMember` y **toda página que tome `companyId` de la URL** | Es el actor con **mayor probabilidad** de disparar el bug: un usuario con N empresas legítimas. La clase MEDIUM-2 (lectura sin scope en 5 páginas) ya ocurrió aquí | parcial |
| **R3** | **Material secreto**: `CompanyCertificate` (`encryptedP12`, Z-5), campos `*ApiKeyEnc` | No se filtra un dato, se filtra una **llave de firma**. Ya hubo un incidente de fuga al AuditLog | 0 % |
| **R4** | **Ventas/Compras**: `Invoice`, `InvoiceLine`, `InvoiceTaxLine`, `Expense`, `Retencion`, `SeniatSubmission` | Volumen + valor fiscal; secreto comercial del cliente | escrituras sí, lecturas no |
| **R5** | **Libro Mayor y forense**: `Transaction`, `JournalEntry`, `Account`, `AccountingPeriod`, `AuditLog` | Integridad contable (R-1) y cadena de custodia; un `AuditLog` cruzado destruye el valor probatorio | escrituras sí, lecturas no |
| **R6** | **Correlativos** (`ControlNumberSequence`, `RetentionSequence`, `JournalSequence`) y **banca** (`BankAccount`, `BankStatement`, `BankTransaction`) | Aquí lo que protege es el **`WITH CHECK`**: una escritura cruzada de correlativo es infracción SENIAT (Z-1) | escrituras sí |
| **R7** | Catálogos: `INPCRate`, `PublicHoliday`, `ExpenseCategory`, `AbsenceType`, `LegalThreshold` | Fuga aburrida; migrar al final | 0 % |

**Piloto recomendado: R1 (Nómina).** Máximo impacto por unidad de trabajo,
módulo acotado, cobertura actual nula y sin dependencias con correlativos.

---

## 6. Riesgo de regresión: cómo se hace RUIDOSO el fallo

Seis capas, de la más barata a la más cara. Las tres primeras se implantan
**antes** de ampliar cobertura:

1. **La BD raísa, no filtra** (D-4). Sin contexto → `RLS_CONTEXT_MISSING`
   (SQLSTATE 42501). Un dato faltante deja de ser plausible: es una excepción.
2. **Mapeo obligatorio en la app**: `toActionError` reconoce el token → error
   genérico + `Sentry.captureException` con tag `rls_context_missing`.
   **Prohibido** que ninguna capa lo convierta en `[]` o en `0,00`.
3. **Aserción aplicativa previa** (D-3, modo report): la violación se detecta
   **antes** de que la consulta llegue a la BD, y en producción, sin romper nada.
4. **Modo sombra por módulo** (D-6): comparación de conteos entre rol
   instrumentado y rol propietario. Es el único mecanismo que atrapa el
   «devolvió 0 y era plausible» sin usuarios afectados.
5. **Verificador conductual en CI** (D-8.3) contra una branch de Neon: la
   propiedad «contexto ajeno → 0 filas / sin contexto → excepción» se prueba,
   no se declara.
6. **Interruptor por módulo** que solo revierte al statu quo (D-6).

Regla transversal, y la más importante de todas: **ninguna capa de ContaFlow
puede tratar «cero filas» como resultado normal en un cálculo contable**. Un
balance, un libro o un cierre que se apoya en un conjunto vacío debe fallar
explícitamente. Esto vale con RLS y sin ella.

---

## 7. Alternativas evaluadas

| # | Alternativa | Veredicto |
|---|---|---|
| 1 | **Rol sin BYPASSRLS por defecto ya** + escape para no-tenant | **Adoptada como destino (D-7), rechazada como primer paso (D-2)**: hoy convertiría el 100 % de las lecturas en 0 filas silenciosas |
| 2 | **Opt-in obligatorio + test de arquitectura** que exija `withCompanyContext` en todo `$transaction` tenant | **Insuficiente sola**: no cubre las lecturas (que son el 100 % del hueco y donde ya ocurrió la clase MEDIUM-2), y deja el modo de fallo en fail-open. Se conserva su parte útil: el **ratchet** (D-6) |
| 3 | **Aceptar aislamiento aplicativo y degradar la RLS en la documentación** | **Adoptada solo en su parte de honestidad (D-1)**. Como decisión final se **rechaza**: la tasa base de bugs de scope en este repo **no es cero** (MEDIUM-2 en 5 páginas, 1 IDOR y 11 IPs spoofeables durante la migración ADR-041). Renunciar a la segunda capa justo donde ya se demostró que la primera falla es la decisión equivocada. **Fallback explícito**: si D-6/D-7 no se financian, el estado final aceptable es D-1 + D-3 + D-4 + D-8 — que cubre la mayor parte del riesgo real a coste bajo — y ADR-007 queda como *defensa en profundidad parcial* de forma permanente y declarada |
| 4 | **Extensión que INYECTA `companyId`** en cada `where` | Rechazada como sustituto: reimplementa las policies en TS (incluidos los 10 modelos hijos sin `companyId`), es la **misma capa** que ADR-004 (no es defensa en profundidad) y falla en silencio igual. Su versión *aserción* (no inyectar, afirmar) sí se adopta: D-3 |
| 5 | **Contexto por sesión** en vez de por transacción | Rechazada (ya en ADR-007): endpoint *pooled* de Neon = PgBouncer en modo transacción; el valor se filtraría entre peticiones (LL-005) |
| 6 | **Neon Authorize / `pg_session_jwt`** con el JWT de Clerk | Rechazada: ata el aislamiento al proveedor (mismo motivo por el que ADR-007 descartó Supabase RLS) y desplaza la autorización a un token del cliente, cuando ADR-041 ya la resuelve en servidor contra `CompanyMember` |
| 7 | **Schema-per-tenant / DB-per-tenant** | Rechazada: N × migraciones, coste de branches, y el modelo despacho (un usuario, muchas empresas) haría de cada consulta un fan-out |

---

## 8. Checklist de cierre

- [x] **D-1** ADR-007 corregido + postura real declarada (§3) — *este ADR*
- [x] **D-3** `prisma-tenant-assert` en modo `report` — `src/lib/prisma-tenant-assert.ts`,
      190 tests (100 % de cobertura, 16 mutantes inyectados y muertos). Auditado por
      `security-agent`: 1 HIGH y 5 MEDIUM, los bloqueantes corregidos (ver §10).
- [ ] **D-3b** Anotar con `unscoped()` los ~8 flujos cross-company reales
      (`user.actions.ts:33` es ruta caliente, `dashboard/page.tsx:34`,
      `BillingService.ts:120,213`, `PlanChangeService.ts:189`,
      `NotificationEmailService.ts:140`, `cron/seniat-outbox`, `CompanyService.ts:319`),
      cerrar LOW-4, y sólo entonces pasar a `enforce`
- [ ] **D-4** Migración `app_current_company_id()` con `RAISE` + mapeo en `toActionError`
- [x] **D-8.2** Inventario de SQL crudo sobre tablas tenant — 16 usos, 11 tocan
      tablas tenant y **los 11 llevan `companyId` explícito**, incluidos los `EXISTS`
      anidados. Punto ciego limpio hoy; la regla ya está en el checklist de CLAUDE.md
      porque la aserción nunca podrá vigilarlo.
- [x] **D-8.3** `scripts/verify-rls-runtime.mjs` (conductual) — sale 1 si no puede
      verificar nada. Falta engancharlo a CI (necesita una branch de Neon sembrada).
- [ ] **D-6** Piloto R1 (Nómina) con modo sombra + medición de p95
- [ ] **D-6b** R2 … R7 según §5, ratchet monótono decreciente
- [ ] **D-7** `app_rls` sin BYPASSRLS + `prismaAdmin` restringido por test de arquitectura

## 10. Auditoría de D-3 (`security-agent`, 2026-08-15)

Veredicto: **GO condicionado**. 0 CRITICAL · 1 HIGH · 5 MEDIUM · 4 LOW.

**HIGH-1 — corregido.** `whereIsScoped` aceptaba la *presencia* de la clave de
tenant, no su *semántica*. Pasaban por «acotado» sin acotar nada:
`{companyId:{not:X}}` (todas menos una), `{startsWith:"c"}` (todos los CUID
empiezan por `c`), y —los peligrosos porque son silenciosos—
`{in: undefined}` / `{equals: undefined}`, donde **Prisma elimina el predicado
entero**. Un falso negativo aquí es una fuga que ninguna otra capa atrapa, porque
la RLS cubre ≈0 % de las lecturas. Arreglado con `keyIsScoping`: lista **blanca
por forma** (`equals`/`in` con operando definido), no lista negra de operadores —
así un operador nuevo de Prisma entra como «no acota» (ruido en `report`) y nunca
como «acota» (fuga).

**M-1 — corregido.** La promesa «`report` no puede romper nada» era falsa: la
instrumentación corría sin `try/catch`, así que una excepción del SDK de Sentry
tumbaba la **consulta**, no sólo la telemetría. Ahora todo el bloque va en
`try/catch` y el `throw` de `enforce` se hace fuera, para no tragárselo.

**M-2 — corregido a medias, resto en D-3b.** Sin deduplicar, `report` emitía un
evento de Sentry por consulta violatoria, y hay violaciones en ruta caliente
(la resolución de empresas del usuario corre en cada carga de página). Ahora se
reporta sólo la primera de cada `modelo.operación` por proceso. Deliberadamente
**no** se pone un tope duro de eventos: truncaría el inventario, que es justo el
insumo que D-7 necesita. La otra mitad —anotar las excepciones conocidas— es D-3b.

**M-3 y M-4 — fuera de esta rama, tasks propios.** Dos bugs de producción
preexistentes que la auditoría destapó al examinar la exención de `findUnique`:
1. `Expense.idempotencyKey` e `InventoryMovement.idempotencyKey` son `@unique`
   **global** y el valor lo **suministra el cliente**; el lookup no filtra por
   `companyId` y **devuelve la fila ajena**. Rompe la premisa que justifica eximir
   `findUnique` («la clave única no es adivinable»). Barrido obligatorio de los 10
   `idempotencyKey @unique` del schema. `invoice.actions` y `payment.actions` ya lo
   hacen bien — es un desvío, no un criterio.
2. `IncomeDistribution.referenceNumber` es `@unique` global pero el correlativo se
   calcula **por empresa** → la primera distribución de la segunda empresa genera
   `DIST-000000`, que ya existe → **P2002 permanente**. Bug latente hoy.

**Consecuencia para el ADR**: §4 D-3 justificaba eximir `findUnique/update/delete/
upsert` con «un CUID no es adivinable». Eso es **falso** para claves `@unique` de
valor suministrado por el cliente. La justificación correcta es «lo protege la
lectura acotada previa», que es una disciplina, no una garantía — y por tanto
superficie que la aserción no vigila por diseño.

## 9. Archivos de referencia

- `src/lib/prisma.ts` — cliente único, rol `neondb_owner` (origen del fail-open)
- `src/lib/prisma-rls.ts` — `withCompanyContext` (correcto; su alcance es el problema)
- `src/lib/prisma-billing-gate.ts` — precedente de extensión `$extends` en runtime
- `src/lib/action-guard.ts` — chokepoint de ADR-041, origen único del `companyId` (D-5)
- `prisma/migrations/20260406110000_fase13d_rls_company_isolation`, `20260611_rls_force_with_check`, `20260628_rls_grant_schema_usage`, `20260706_rls_a1bis`
- `scripts/verify-rls.mjs` — verificación **estructural** (no conductual)
