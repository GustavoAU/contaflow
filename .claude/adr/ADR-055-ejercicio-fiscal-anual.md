# ADR-055 — Ejercicio Fiscal Anual: apertura y cierre por ejercicio completo

**Estado:** Aceptado (decisión del dueño D-A/D-B + diseño arch-agent, 2026-09-27)
**Fecha:** 2026-09-27
**Relacionados:** ADR-001 (Serializable correlativos/cierre), ADR-003 (onDelete Restrict), ADR-004/ADR-041
(aislamiento companyId), ADR-006 (D-1 rol destructivo, D-5 rate limit), ADR-007/ADR-044 (RLS),
ADR-015-BORRADOR (eventos extemporáneos — alcance reducido por este ADR), R-1/R-3 (CLAUDE.md)
**Origen:** feedback de dos contadoras reales (tester Alpha + esposa del dueño) sobre el módulo de
cierre de períodos — transcripción de audio, 2026-09.

## Decisión en una frase

`AccountingPeriod` sigue siendo mensual y su `year`/`month` siguen significando el año/mes calendario
**literal** de esa fila — cero cambios ahí. Lo que cambia es que ahora se agrupan 12 a la vez, al
abrirse, bajo un modelo nuevo `FiscalYear` (el "ejercicio económico" real de la contadora, que puede
NO coincidir con el año calendario); la restricción "solo un período OPEN a la vez" desaparece; el
cierre pasa a ser una única operación sobre el ejercicio completo (los 12 meses + el asiento de cierre
de resultados, en la misma transacción Serializable); y dos ejercicios pueden convivir OPEN al mismo
tiempo (el que se declara/cierra y el que ya empezó operativamente).

---

## Contexto

### Feedback textual — tester Alpha (contadora real)

> "El periodo contable va de un año... el periodo que contable que me tiene que hacer es de un año, no
> de un mes." — sobre por qué el sistema solo le dejó crear un mes (septiembre) cuando necesitaba
> trabajar de una vez desde abril.

> "Lo de cerrar cada mes lo hacemos es a final del año... uno cierra el periodo fiscal cuando de verdad
> ya uno declaró el impuesto sobre la renta... eso de cerrar el periodo fiscal mes a mes sí va, pero
> uno lo hace es a final del año... tendría que tener varios meses abiertos para hacer el impuesto
> sobre la renta."

Explica además que existen dos regímenes de ejercicio fiscal en Venezuela: el **regular**
(enero-diciembre, declarado en marzo del año siguiente) y un **irregular** (12 meses que no coinciden
con el año calendario, con su propia ventana de declaración), configurable por empresa ante el SENIAT.

### Feedback adicional — esposa del dueño (contadora)

Pide (a) que los períodos de ejercicios que no son "el año en que se está trabajando" queden bloqueados
u ocultos por defecto para evitar confusión, y (b) un indicador visible del ejercicio activo. El propio
dueño señaló la implicación no trivial de esto: la contadora cierra 2026 en abril de **2027**, así que
durante enero-marzo de 2027 conviven **dos** ejercicios: 2027 (activo para operaciones nuevas) y 2026
(todavía abierto, solo para los ajustes de cierre/ISLR). El diseño debe soportar esa convivencia, no
prohibirla.

### Estado actual verificado (hechos, no hipótesis)

1. `AccountingPeriod` (schema.prisma:608-625) es mensual: `year`/`month` + `@@unique([companyId, year,
   month])`. Ningún modelo tiene noción de "mes de inicio de ejercicio" — se asume calendario Ene-Dic
   siempre. **Hallazgo H-1**: `company Company @relation(fields: [companyId], references: [id])` no
   declara `onDelete` explícito — inconsistente con ADR-003 (aunque el comportamiento efectivo en
   Postgres hoy ya es restrictivo por default de conector). Se corrige en la migración de este ADR.
2. `PeriodService.openPeriod()` lanza si ya existe un período `OPEN` — solo uno por empresa, nunca por
   año. `closePeriod()` cierra ese único período OPEN y genera `PeriodSnapshot`. No existe "cerrar el
   año completo".
3. `PeriodManager.tsx` solo ofrece abrir el mes siguiente / cerrar el único mes activo. (Fuera de mi
   dominio — `NEVER touch src/app/`, `src/modules/**/components/` — documentado aquí solo como
   contrato que el UI-agent deberá consumir.)
4. `FiscalYearCloseService.closeFiscalYear()` (fiscal-close/services, líneas 53-285) YA asume cierre a
   nivel de año, pero como PRECONDICIÓN exige que **todos** los `AccountingPeriod` del año ya estén
   `CLOSED` individualmente — exactamente lo opuesto al flujo real (los 12 meses abiertos en paralelo,
   un solo cierre al final). **Hallazgo H-2** (nuevo, encontrado en esta auditoría): la función asume
   régimen calendario de forma dura en tres puntos — `new Date(year, 11, 31)` como fecha de cierre,
   correlativo con prefijo fijo `${year}-12-`, y `periods.find(p => p.month === 12)` /
   `periods.sort((a,b) => b.month - a.month)[0]` para hallar "el último período". Bajo un ejercicio
   irregular (ej. jul-jun) esto calcula la fecha de cierre y el último período **mal** — hoy es
   inofensivo porque no existe ningún ejercicio irregular en producción (hecho #6 del brief), pero es
   un defecto latente que este ADR debe corregir explícitamente, no solo diseñar alrededor.
5. `ADR-015-BORRADOR` (nunca implementado) es el mecanismo previo para "ajustar un período ya cerrado
   sin reabrirlo" (asiento en el período actual + FK causal). Cita un "ADR-014: período cerrado = bloqueo
   total" que **no existe como tal** — esa regla vive solo como R-3 en `CLAUDE.md`.
6. No hay ninguna empresa con ejercicio irregular hoy — diseño nuevo, sin precedente en ontología ni
   `DECISIONS.md`.
7. ContaFlow está en Alpha con empresas reales usando `AccountingPeriod` bajo el modelo mensual
   secuencial actual. Ningún cambio de este ADR puede exigir un reset destructivo de esos datos.

---

## Decisión

### D-A / D-B (ya decididas por el dueño — no se re-derivan)

- **D-A**: ejercicio fiscal configurable por empresa desde ya (no YAGNI).
- **D-B**: cierre SOLO a nivel de ejercicio completo. Se elimina el cierre de mes individual del flujo:
  abrir ejercicio crea los 12 `AccountingPeriod` de una vez (todos `OPEN`); durante el ejercicio, los 12
  quedan editables en paralelo (se elimina "un solo período OPEN a la vez"); un único botón "Cerrar
  Ejercicio" cierra los 12 y ejecuta el cierre de resultados en el mismo flujo.

### Semántica de `year` — sin ambigüedad (pregunta obligatoria del brief)

**`AccountingPeriod.year` NUNCA cambia de significado: es siempre el año calendario literal de ese mes
específico.** Esto es deliberado y es la decisión más importante de este ADR: significa que **ninguno**
de los ~30 call-sites que hoy resuelven un período por `date.getUTCFullYear()` / `date.getUTCMonth()+1`
necesita cambiar su lógica de resolución (ver "Impacto en módulos existentes").

Lo que agrupa "estos 12 meses son el mismo ejercicio declarable" es el nuevo modelo `FiscalYear`, cuyo
campo `year` es una **etiqueta** distinta: *el año calendario en que INICIA el ejercicio*. Coincide con
`AccountingPeriod.year` de todos sus períodos solo en el régimen regular (`startMonth = 1`). Ejemplo
numérico explícito con el caso irregular que describe la tester (`startMonth = 7`, julio-junio):

```
FiscalYear { companyId: "acme", year: 2025, startMonth: 7, status: OPEN }
  → agrupa:
    AccountingPeriod(year: 2025, month: 7)   ← jul 2025
    AccountingPeriod(year: 2025, month: 8)
    AccountingPeriod(year: 2025, month: 9)
    AccountingPeriod(year: 2025, month: 10)
    AccountingPeriod(year: 2025, month: 11)
    AccountingPeriod(year: 2025, month: 12)
    AccountingPeriod(year: 2026, month: 1)   ← YA es año calendario 2026, pero mismo FiscalYear
    AccountingPeriod(year: 2026, month: 2)
    AccountingPeriod(year: 2026, month: 3)
    AccountingPeriod(year: 2026, month: 4)
    AccountingPeriod(year: 2026, month: 5)
    AccountingPeriod(year: 2026, month: 6)   ← jun 2026, fin del ejercicio

FiscalYearClose { companyId: "acme", year: 2025, fiscalYearId: <id de arriba> }
  → year=2025 es la ETIQUETA del ejercicio, aunque 6 de sus 12 AccountingPeriod tengan year=2026.
```

En régimen regular (`startMonth = 1`, el default y el de **el 100% de las empresas Alpha existentes**),
`FiscalYear.year` y `AccountingPeriod.year` coinciden siempre — cero cambio de comportamiento observable
para ninguna empresa existente hasta que alguna configure explícitamente un `startMonth` distinto de 1.

### D-1 — Modelo `FiscalYear` (no se extiende `FiscalYearClose`, no se infiere por rango de fechas)

Se descartó (a) que `FiscalYearClose` cargue también el rol de "contenedor de períodos abiertos" —
mezclaría dos responsabilidades (evento de cierre financiero inmutable vs. contenedor de ciclo de vida
mutable) violando SOLID-S; y (b) inferir el ejercicio solo por rango de fechas sin tabla — no hay dónde
persistir el `status` (OPEN/CLOSED) de la agrupación en sí, ni un punto único donde aplicar el guard
"máximo 2 ejercicios OPEN simultáneos" (D-9) de forma atómica. `FiscalYear` es el contenedor de ciclo de
vida; `FiscalYearClose` sigue siendo el evento de cierre (snapshot financiero inmutable), ahora enlazado
por FK.

Reutiliza el enum `PeriodStatus` (`OPEN`/`CLOSED`) que ya existe para `AccountingPeriod.status` — mismo
significado de negocio, evita duplicar un enum idéntico (DRY, CLAUDE.md §Principles).

### D-2 — `Company.fiscalYearStartMonth`, no un modelo `FiscalYearConfig` separado

Se evaluó explícitamente crear `FiscalYearConfig` versionado en el tiempo (para el caso "empresa cambia
de régimen con autorización SENIAT"). Se descarta: la versión histórica que importa (¿con qué
`startMonth` se abrió ESTE ejercicio?) ya queda capturada de forma natural en `FiscalYear.startMonth`,
copiado desde `Company.fiscalYearStartMonth` **en el momento de abrir** y nunca reinterpretado después.
Un `FiscalYearConfig` aparte sería una tabla con un solo campo útil que `FiscalYear` ya versiona
gratis — YAGNI. `Company.fiscalYearStartMonth` es solo "el valor por defecto para el PRÓXIMO ejercicio
a abrir"; cambiarlo no reinterpreta ningún `FiscalYear` ya existente.

### D-3 — El guard financiero es 100% por fecha; "ejercicio activo" es un dato derivado, no persistido

La única fuente de verdad para permitir o bloquear una mutación con fecha `d` sigue siendo (mismo
espíritu que hoy, re-scopeado): *¿existe un `AccountingPeriod` con `(companyId, year=d.year,
month=d.month)` en estado `OPEN`, cuyo `FiscalYear.status` también sea `OPEN`?* Esto es válido para
**cualquiera** de los ejercicios OPEN de la empresa — no solo el "activo" — lo cual es exactamente lo
que permite la convivencia 2026(en cierre)/2027(activo) que pide el punto 4 del brief: ambos son OPEN,
ambos son postable, sin caso especial.

"Ejercicio activo para nuevas operaciones" (el indicador que pide la esposa del dueño) es **puramente
derivado**, no un puntero persistido en `Company`: *el `FiscalYear` con `status: OPEN` cuyo `(year,
startMonth)` es el más reciente*. Se descartó persistir `Company.activeFiscalYearId`: sería un puntero
que puede desincronizarse (ADR-044/lecciones del proyecto: preferir dato derivado sobre estado
duplicado cuando la derivación es barata — aquí es un `findFirst` con índice `(companyId, status)`).
El bloqueo/ocultamiento de "otros años" que pide la esposa del dueño es, con este diseño, un problema
que ya no existe estructuralmente para años verdaderamente ajenos (un año cerrado ya está 100%
bloqueado por R-3; un año nunca abierto no tiene períodos que mostrar) — el único caso real es 2026
en-cierre conviviendo con 2027, que es exactamente el caso que DEBE seguir editable. Lo que la UI debe
ofrecer (fuera de mi dominio, contrato para el UI-agent): filtrar por defecto al ejercicio activo
derivado + una sección explícita "Ejercicios en cierre" para los OPEN-no-activos + badge "Ejercicio
activo: 2027".

### D-4..D-8 — Contratos de servicio (cero cambio de firma donde es posible)

- **D-4**: `PeriodService.assertDateInOpenPeriod(companyId, date, tx?)` **conserva firma y forma de
  retorno** (`{id, year, month}`). Solo cambia su implementación interna: en vez de buscar "el único
  período con status OPEN" (`getActivePeriod`), busca el `AccountingPeriod` de `(year, month)` literal
  de `date` y valida `status === 'OPEN'` (y, en profundidad, que su `fiscalYear.status !== 'CLOSED'`).
  **Cero cambios requeridos en los ~30 call-sites** que la invocan.
- **D-5**: `PeriodService.resolveFiscalPeriodId(...)` **no cambia — ya es forward-compatible**. Ya
  resuelve por `(companyId, year, month)` literal, nunca asumió un único OPEN global. Confirmado
  leyendo su implementación completa; no es una suposición.
- **D-6**: `PeriodService.getActivePeriod()` se **elimina** — su invariante de cardinalidad 0-o-1 es
  incompatible con el nuevo modelo (puede haber 0, 12 o 24 períodos OPEN). Cualquier caller directo
  (fuera de `PeriodService` mismo) requiere un grep-sweep dedicado antes de mergear (ver "Impacto").
  Reemplazo: `FiscalYearService.getActiveFiscalYear(companyId)` + iterar `.periods` si se necesita la
  lista completa.
- **D-7**: `PeriodService.openPeriod`/`closePeriod` (mes individual) se **retiran de la superficie
  pública** (Server Action y UI) por D-B. Su lógica de persistencia (crear una fila de período /
  cerrarla + snapshot + AuditLog) se refactoriza a helpers privados reutilizados por los nuevos flujos
  masivos — no se duplica (DRY).
- **D-8**: `FiscalYearCloseService.closeFiscalYear(companyId, year, closedBy, ip, ua)` **conserva
  firma** (sigue recibiendo el `year`-etiqueta, no un `fiscalYearId` — resuelve el FK internamente vía
  `companyId_year`). Se extiende para: (1) resolver el `FiscalYear`, rechazar si no existe o ya está
  `CLOSED`; (2) cerrar sus 12 `AccountingPeriod` + generar `PeriodSnapshot` por cada uno (reutilizando
  `PeriodSnapshotService.upsertAllSnapshotsForPeriod`, sin cambio de firma), todo en la misma
  transacción; (3) **corregir H-2**: la fecha de cierre y el "último período" ya no asumen diciembre —
  se calculan como el período de mayor índice cronológico dentro del `FiscalYear` (ver pseudocódigo
  abajo), lo cual para régimen regular produce exactamente el mismo resultado de hoy (diciembre), byte
  a byte — cero cambio de comportamiento observable para toda empresa existente.

Corrección de H-2 (ilustrativa, no código de producción — reemplaza el bloque de resolución de
"último período"/fecha de cierre dentro de `closeFiscalYear`):

```
// ANTES (asume calendario):
//   decemberPeriod = periods.find(p => p.month === 12)
//   lastPeriod     = periods.sort((a,b) => b.month - a.month)[0]
//   closingDate    = new Date(year, 11, 31)
//   prefix         = `${year}-12-`

// DESPUÉS (régimen-agnóstico; idéntico resultado en régimen regular):
chronologicalKey = (p) => (p.year - fiscalYear.year) * 12 + p.month
lastPeriod   = periods.sort((a, b) => chronologicalKey(b) - chronologicalKey(a))[0]
closingDate  = lastDayOfMonth(lastPeriod.year, lastPeriod.month)
prefix       = `${lastPeriod.year}-${pad2(lastPeriod.month)}-`
```

### D-9 / D-10 — Reglas de apertura de ejercicio (evitan una nueva clase de carrera)

- **D-9**: máximo **2** `FiscalYear` con `status: OPEN` simultáneos por empresa. Cubre exactamente el
  caso real descrito (2026 en cierre + 2027 activo) sin permitir una acumulación descontrolada de
  ejercicios abiertos.
- **D-10**: la apertura es **estrictamente secuencial, sin huecos ni saltos**: si ya existe un
  `FiscalYear` previo, el nuevo `year`/`startMonth` se **calculan siempre** como "el mes inmediato
  siguiente al fin del ejercicio anterior" — nunca se piden como input libre al usuario. Solo el primer
  `FiscalYear` que abre una empresa (bootstrap, sin ningún `FiscalYear` previo) toma `startMonth` de
  `Company.fiscalYearStartMonth` y el `year` de un input validado del usuario. Esto elimina por
  construcción la clase de bug "hueco/solape entre ejercicios" — no depende de que el usuario lo haga
  bien.
- Deliberadamente **no** se deriva nada a partir de "hoy" (ni `new Date()` ni zona horaria) para decidir
  qué ejercicio abrir — el próximo ejercicio se calcula 100% a partir de datos ya persistidos
  (`FiscalYear` anterior), evitando la clase de bug de "hoy" en UTC vs. VET que ya mordió a este
  proyecto en otros módulos.

### D-11 — Aislamiento de transacción: Serializable obligatorio en ambos flujos masivos (confirma punto 8)

Tanto `openFiscalYear` (crea `FiscalYear` + 12 `AccountingPeriod` de una vez, valida D-9/D-10) como
`closeFiscalYear` (ya Serializable hoy, se mantiene) **deben** correr en
`prisma.$transaction({ isolationLevel: 'Serializable' })`, envueltos en `withCompanyContext` (ADR-044)
igual que `closeFiscalYear` ya lo hace. Razón concreta, no genérica: la validación D-9 ("¿hay como
máximo 1 otro `FiscalYear` OPEN?") es lectura-decide-escribe sobre un conteo — bajo `Read Committed`,
dos llamadas concurrentes que abren **años distintos** (ej. 2027 y 2028) no chocan contra ningún
`@@unique` (los años difieren) y ambas podrían leer "solo hay 1 OPEN" antes de que la otra confirme,
terminando con 3 ejercicios OPEN simultáneos — viola D-9 en silencio. `Serializable` + reintento en
`P2034` (mismo patrón ya usado en `PaymentBatch`/ADR-043, `withSerializableRetry`) es el mecanismo
correcto, consistente con Z-3/ADR-001 ("cierre de período... permanecen en Serializable siempre" — este
ADR extiende el mismo criterio a la apertura, porque la apertura ahora también protege un invariante
estructural crítico, no solo un correlativo).

El guard de fecha (`assertDateInOpenPeriod`/`resolveFiscalPeriodId`), en cambio, sigue siendo una simple
lectura de existencia+estado — `Read Committed` (o sin transacción propia, dentro de la tx que ya traiga
la mutación que lo invoca) sigue siendo suficiente, sin cambio respecto a hoy.

### D-12 — Seguridad (ADR-006/ADR-041, pre-flight paso 6)

- `openFiscalYearAction`: rol `OWNER|ADMIN|ACCOUNTANT` (mismo nivel que hoy exige abrir/cerrar un
  período — no es más destructivo que la acción que reemplaza). Rate limit `limiters.fiscal`
  (ADR-006 D-5). **No** requiere step-up 2FA — mismo criterio que el `openPeriod` actual (no genera
  asientos ni bloquea nada de forma irreversible).
- `closeFiscalYearAction`: conserva **sin degradar** el step-up 2FA que ya tiene desde Q2-3
  (`STEP_UP_CONFIG`, `src/lib/step-up.ts`) — cerrar un ejercicio sigue siendo la acción más
  irreversible del sistema contable, ahora con mayor radio de efecto (cierra 12 meses de una vez, no
  1). Rol `OWNER|ADMIN|ACCOUNTANT`, rate limit `limiters.fiscal`.
- `AuditLog`: una entrada `FiscalYear`/`OPEN` (con la lista de los 12 `periodId` creados en `newValue`,
  en vez de 12 entradas separadas — evita spam de auditoría sin perder trazabilidad) y se conserva la
  entrada `FiscalYearClose`/`CLOSE` que ya existe hoy. Ambas dentro del mismo `$transaction`, con
  `ipAddress`/`userAgent` (R-6). Ninguna operación nueva de `update`/`delete` sobre `AuditLog`
  (ADR-006 D-4, sin cambios).
- No hay campos de monto nuevos ni tasa impositiva del cliente en este ADR — D-2/D-3 de ADR-006 no
  aplican.

---

## Modelos Prisma propuestos

```prisma
// ── Ejercicio Fiscal (ADR-055) ──────────────────────────────────────────────
// Agrupa los AccountingPeriod (siempre mensuales, year/month sin cambio de
// significado) que componen UN ejercicio económico declarable ante ISLR.
// Reutiliza PeriodStatus — mismo enum, mismo significado de negocio que
// AccountingPeriod.status (DRY).
model FiscalYear {
  id        String       @id @default(cuid())
  companyId String
  company   Company      @relation(fields: [companyId], references: [id], onDelete: Restrict)

  // Año calendario en el que INICIA el ejercicio — es la ETIQUETA del
  // ejercicio, no necesariamente el año calendario de TODOS sus períodos.
  // Ver ADR-055 §Semántica de `year` para el caso irregular.
  year       Int

  // Copiado de Company.fiscalYearStartMonth AL MOMENTO de abrir. Inmutable:
  // si la empresa cambia su régimen después (autorización SENIAT), los
  // ejercicios ya abiertos no se reinterpretan retroactivamente (D-2).
  startMonth Int

  status     PeriodStatus @default(OPEN)

  periods         AccountingPeriod[]
  fiscalYearClose FiscalYearClose?

  openedAt DateTime  @default(now())
  openedBy String // userId
  closedAt DateTime?
  closedBy String? // userId

  // Sin deletedAt / idempotencyKey: mismo criterio que AccountingPeriod — nunca
  // se elimina desde su creación (solo transiciona status), y @@unique([companyId,
  // year]) ya cubre la idempotencia de "abrir dos veces el mismo ejercicio"
  // (documentado, no es un descuido del checklist SCHEMA_AUDITOR).
  @@unique([companyId, year])
  @@index([companyId, status])
}
```

```prisma
model AccountingPeriod {
  id              String           @id @default(cuid())
  companyId       String
  // H-1: onDelete explícito (antes ausente) — alinea con ADR-003.
  company         Company          @relation(fields: [companyId], references: [id], onDelete: Restrict)
  year            Int
  month           Int // 1-12 — SIN CAMBIO DE SIGNIFICADO: año/mes calendario literal, siempre.
  status          PeriodStatus     @default(OPEN)
  openedAt        DateTime         @default(now())
  closedAt        DateTime?
  openedBy        String
  closedBy        String?
  transactions    Transaction[]
  invoices        Invoice[]
  periodSnapshots PeriodSnapshot[]

  // ADR-055: agrupación al ejercicio. Nullable durante la ventana de backfill
  // (empresas Alpha existentes) — ver Plan de Migración Fase 2 para NOT NULL.
  fiscalYearId String?
  fiscalYear   FiscalYear? @relation(fields: [fiscalYearId], references: [id], onDelete: Restrict)

  @@unique([companyId, year, month])
  @@index([companyId, fiscalYearId])
}
```

```prisma
model FiscalYearClose {
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
  year      Int // se mantiene — etiqueta del ejercicio, == FiscalYear.year (sin cambio de firma)

  // ADR-055: FK explícito. Nullable durante backfill, luego NOT NULL (Fase 2).
  fiscalYearId String?     @unique
  fiscalYear   FiscalYear? @relation(fields: [fiscalYearId], references: [id], onDelete: Restrict)

  closedAt DateTime @default(now())
  closedBy String

  closingTransactionId String      @unique
  closingTransaction   Transaction @relation("ClosingTransaction", fields: [closingTransactionId], references: [id], onDelete: Restrict)

  appropriationTransactionId String?      @unique
  appropriationTransaction   Transaction? @relation("AppropriationTransaction", fields: [appropriationTransactionId], references: [id], onDelete: Restrict)

  totalRevenue  Decimal @db.Decimal(19, 4)
  totalExpenses Decimal @db.Decimal(19, 4)
  netResult     Decimal @db.Decimal(19, 4)

  createdAt DateTime @default(now())

  @@unique([companyId, year])
  @@index([companyId])
}
```

```prisma
model Company {
  // ... campos existentes sin cambio ...

  // ADR-055: mes (1-12) en que inicia el próximo ejercicio a abrir. Default 1 =
  // régimen regular Ene-Dic — el 100% de las empresas Alpha existentes heredan
  // este valor sin cambio de comportamiento observable. CHECK 1-12 vía SQL
  // (Prisma DSL no expresa CHECK — mismo criterio que company_country_iso3166_alpha3,
  // ADR-043).
  fiscalYearStartMonth Int          @default(1)
  fiscalYears          FiscalYear[]
}
```

Migración sugerida: `20260927_fiscal_year_model`

```sql
-- prisma/migrations/20260927_fiscal_year_model/migration.sql
-- Pre-flight: SELECT count(*) FROM "Company"; SELECT count(*) FROM "AccountingPeriod";

ALTER TABLE "Company" ADD COLUMN "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Company" ADD CONSTRAINT "company_fiscal_year_start_month_range"
  CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12);

CREATE TABLE "FiscalYear" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "year"       INTEGER NOT NULL,
  "startMonth" INTEGER NOT NULL,
  "status"     "PeriodStatus" NOT NULL DEFAULT 'OPEN',
  "openedAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "openedBy"   TEXT NOT NULL,
  "closedAt"   TIMESTAMP(3),
  "closedBy"   TEXT,
  CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT;
ALTER TABLE "FiscalYear" ADD CONSTRAINT "fiscal_year_start_month_range"
  CHECK ("startMonth" BETWEEN 1 AND 12);
CREATE UNIQUE INDEX "FiscalYear_companyId_year_key" ON "FiscalYear"("companyId", "year");
CREATE INDEX "FiscalYear_companyId_status_idx" ON "FiscalYear"("companyId", "status");
-- RLS (ADR-007 A1-bis / ADR-044) — misma migración, no diferir:
ALTER TABLE "FiscalYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalYear" FORCE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON "FiscalYear"
  USING ("companyId" = current_setting('app.current_company_id', true))
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "AccountingPeriod" ADD COLUMN "fiscalYearId" TEXT;
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT;
CREATE INDEX "AccountingPeriod_companyId_fiscalYearId_idx" ON "AccountingPeriod"("companyId", "fiscalYearId");
-- H-1: hacer explícito el onDelete (verificar con verify:drift que no es un DROP silencioso)
ALTER TABLE "AccountingPeriod" DROP CONSTRAINT IF EXISTS "AccountingPeriod_companyId_fkey";
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT;

ALTER TABLE "FiscalYearClose" ADD COLUMN "fiscalYearId" TEXT;
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "FiscalYearClose_fiscalYearId_key" ON "FiscalYearClose"("fiscalYearId");
```

Migración de seguimiento (diferida hasta verificar 100% de cobertura del backfill en prod):
`20260928_fiscal_year_fk_required`

```sql
-- Pre-flight OBLIGATORIO antes de correr esto:
--   SELECT count(*) FROM "AccountingPeriod" WHERE "fiscalYearId" IS NULL;   -- debe ser 0
--   SELECT count(*) FROM "FiscalYearClose"  WHERE "fiscalYearId" IS NULL;   -- debe ser 0
ALTER TABLE "AccountingPeriod" ALTER COLUMN "fiscalYearId" SET NOT NULL;
ALTER TABLE "FiscalYearClose"  ALTER COLUMN "fiscalYearId" SET NOT NULL;
```

---

## Plan de migración (empresas Alpha existentes — sin reset destructivo)

**Orden obligatorio**: (1) aplicar `20260927_fiscal_year_model` → (2) correr el backfill (script de
datos, una sola vez, idempotente) → (3) desplegar el código nuevo (`FiscalYearService`,
`PeriodService`/`FiscalYearCloseService` actualizados, UI nueva) en el **mismo release** que (2) — nunca
dejar una ventana en producción donde convivan el flujo viejo de "abrir un mes" y el flujo nuevo de
"abrir un ejercicio" para la misma empresa, porque el viejo no mantiene el invariante "los 12 meses del
ejercicio existen y están OPEN" que el nuevo cierre masivo asume.

**Backfill** (algoritmo, no código de producción — vive en un script de datos, mismo patrón que otros
data-fixes ya hechos en el proyecto):

Por cada `Company`, agrupar sus `AccountingPeriod` existentes por `year` literal:

1. Por cada `(companyId, year)` con al menos un período:
   - `status = CLOSED` si ya existe `FiscalYearClose{companyId, year}`; si no, `OPEN`.
   - Crear `FiscalYear{companyId, year, startMonth: 1, status, openedBy: "system-backfill"}` —
     `startMonth = 1` siempre es correcto aquí porque, por el hecho #6 del brief, **ninguna** empresa
     existente usa un régimen distinto del regular hoy.
   - Asignar `fiscalYearId` a todos los `AccountingPeriod` del grupo.
   - Si `status = CLOSED`: asignar `fiscalYearId` al `FiscalYearClose` correspondiente.
2. **Paso sensible — el único grupo con `status = OPEN` por empresa** (el ejercicio en curso, a lo sumo
   uno, por construcción del modelo viejo): para conformar el nuevo invariante "los 12 meses del
   ejercicio existen y están OPEN en paralelo",
   - crear los `AccountingPeriod` de los meses 1-12 que todavía no existan para ese año, en `OPEN`;
   - **reabrir** (`CLOSED → OPEN`) cualquier mes de ese mismo grupo que haya sido cerrado
     individualmente bajo el flujo viejo — no hay `FiscalYearClose` para ese año todavía, por lo que
     ese cierre mensual nunca fue, en términos VEN-NIF, un cierre real; era un artefacto de la
     limitación de UI que este ADR corrige. Cada reapertura genera una fila `AuditLog`
     (`entityName: "AccountingPeriod"`, `action: "BACKFILL_REOPEN"`, `oldValue`/`newValue` con el
     status) para trazabilidad — no es una operación silenciosa.
   - Recomendación operativa: correr primero en modo dry-run contra un dump/branch de Neon y confirmar
     con Gustavo el conteo exacto de períodos reabiertos antes de aplicar en prod (ver Pregunta Abierta
     #1 — es la única parte de este ADR que toca el `status` de filas ya existentes en empresas reales).
3. Empresas sin ningún `AccountingPeriod` (demo/onboarding nuevo) — sin tocar; usarán el flujo
   "Abrir Ejercicio" por primera vez de forma nativa.

**Riesgo si la migración falla a la mitad**: el `ALTER TABLE ... ADD COLUMN` es aditivo y no bloqueante
(columna nullable, sin default costoso); si falla, no hay filas parcialmente migradas porque cada
sentencia DDL es atómica en Postgres. El backfill de datos corre fuera de la migración DDL, en su propio
script — si falla a la mitad, es **reanudable e idempotente por diseño** (cada paso hace `upsert`/
`skip-if-exists` por `(companyId, year)`, nunca depende de haber completado una empresa anterior).
Rollback de la migración DDL: `DROP TABLE "FiscalYear" CASCADE; ALTER TABLE "Company" DROP COLUMN
"fiscalYearStartMonth"; ALTER TABLE "AccountingPeriod" DROP COLUMN "fiscalYearId"; ALTER TABLE
"FiscalYearClose" DROP COLUMN "fiscalYearId";` — seguro mientras la Fase 2 (`NOT NULL`) no se haya
aplicado.

**Índices nuevos para mantener performance**: `FiscalYear(companyId, year)` único,
`FiscalYear(companyId, status)`, `AccountingPeriod(companyId, fiscalYearId)`,
`FiscalYearClose(fiscalYearId)` único — los cuatro cubren los patrones de acceso descritos (buscar el
ejercicio activo, listar períodos de un ejercicio, resolver el cierre de un ejercicio).

**Filas afectadas**: proporcional al número de empresas Alpha × años con actividad — bajo, dado que el
proyecto sigue en Alpha (ver `estado-bd-2026-08-09`: 294 filas totales en la última medición conocida;
confirmar conteo real antes de ejecutar, no asumir que sigue igual).

---

## Impacto en módulos existentes

**No verificado exhaustivamente con grep en este entorno** (sin acceso a herramienta de búsqueda en esta
sesión) — lo siguiente es el contrato exacto que cualquier caller debe cumplir, más una tarea explícita
de barrido para el ingeniero que implemente:

- **`assertDateInOpenPeriod` / `resolveFiscalPeriodId`** (invoices, orders, payments, payroll,
  cajachica, exchange-rates, y el resto de los ~30 sitios que el brief menciona): **cero cambios de
  código** — firma y contrato de retorno intactos (D-4/D-5). El invariante que cambia es interno a la
  implementación, no observable desde el caller.
- **`getActivePeriod`**: **sí requiere** un grep-sweep (`grep -rn "getActivePeriod" src/`) antes de
  mergear, porque su cardinalidad pasa de 0-o-1 a 0..24 — cualquier caller que asuma "hay como mucho un
  resultado" fuera de `PeriodService` mismo se rompe en silencio bajo el nuevo modelo. Este es
  exactamente el tipo de barrido que CLAUDE.md exige ("bug = clase de bug") — aquí es un *cambio* de
  clase, no un bug, pero el mismo mecanismo de barrido aplica.
- **`openPeriod` / `closePeriod`** (mes individual): se retiran de la Server Action y de la UI (D-7).
  Cualquier test o caller que los invoque directamente debe migrar a `FiscalYearService.openFiscalYear`
  / `FiscalYearCloseService.closeFiscalYear`.
- **`FiscalYearCloseService.isFiscalYearClosed(companyId, year)`**: sin cambio de firma ni de contrato
  — sigue funcionando igual (consulta `FiscalYearClose` por `companyId_year`), usado hoy como guard
  rápido en `createTransaction`/`createInvoice`/`createRetencion` y en el propio `PeriodService`.
- **UI** (`PeriodManager.tsx` y cualquier componente que muestre "período activo"): fuera de mi dominio
  — el contrato que debe consumir es `FiscalYearService.getActiveFiscalYear(companyId)` (derivado, no
  persistido — D-3) y `FiscalYearService.getFiscalYears(companyId)` para listar todos con sus períodos
  anidados.

---

## Relación con ADR-015 (eventos extemporáneos)

Con este rediseño, la **mayoría** de los "ajustes retroactivos" que motivaron ADR-015 dejan de necesitar
su mecanismo: si el mes afectado cae dentro de un `FiscalYear` que sigue `OPEN` (que ahora es el caso
normal durante todo el ejercicio, no solo el mes calendario corriente), el contador simplemente registra
el ajuste con fecha real en ese mes — sigue editable. El mecanismo de ADR-015 (asiento en el período
actual + FK causal, sin reabrir) pasa a ser el **respaldo exclusivo para correcciones posteriores al
cierre FORMAL del ejercicio** (existe `FiscalYearClose` para ese año) — un caso genuinamente más raro
(ej. hallazgo de auditoría SENIAT 2 años después) que sigue sin mecanismo implementado.

**Decisión**: ADR-015 pasa de `PENDIENTE` a **`ACEPTADO — ALCANCE REDUCIDO`** (actualizado directamente
en su archivo, ver diff abajo). No se re-deriva su contenido (`AuditoryAdjustment`, etc.) — sigue siendo
el mecanismo correcto para el caso que le queda, solo se acota cuándo aplica y se corrige su referencia
rota a un inexistente "ADR-014" (esa regla es R-3 en `CLAUDE.md`, nunca fue un ADR formal).

Diff aplicado a `.claude/adr/ADR-015-BORRADOR-eventos-extemporaneos.md` (líneas 1-25):

```diff
-# ADR-015 (BORRADOR) — Eventos Extemporáneos: Ajustes Retroactivos de Períodos Cerrados
+# ADR-015 — Eventos Extemporáneos: Ajustes Retroactivos DESPUÉS del Cierre Formal del Ejercicio

-**Status**: PENDIENTE — Requiere decisión arch-agent
-**Prioridad**: ALTA — Brecha crítica identificada post-demo
+**Status**: ACEPTADO — ALCANCE REDUCIDO por ADR-055 (2026-09-27)
+**Prioridad**: MEDIA — con ADR-055, los 12 meses del ejercicio quedan OPEN en paralelo durante todo el
+año; este mecanismo solo aplica a correcciones DESPUÉS de que `FiscalYearClose` ya existe para el año
+afectado (ej. hallazgo de auditoría SENIAT años después). Ver ADR-055 §Relación con ADR-015.
 **Referencia**: Feedback de contador real (audio WhatsApp 2026-04-25)
 **Autor**: orchestrator-agent (compilación)
```

y en la sección "Estado actual de ContaFlow" (línea 24), corregir la referencia rota:

```diff
-- ✅ ADR-014: "Período cerrado = bloqueo total"
+- ✅ R-3 (CLAUDE.md): "Período cerrado = bloqueo total" — nunca fue ADR-014; ese número es de
+  arquitectura de nómina/prestaciones, no relacionado.
```

*(Estos diffs se aplican directamente al archivo `ADR-015-BORRADOR-eventos-extemporaneos.md` como parte
de este ADR — ver archivo actualizado.)*

---

## Alternativas consideradas y descartadas

| Alternativa | Por qué se descartó |
|---|---|
| Mantener `AccountingPeriod.year`/`month` pero reinterpretarlos según el régimen de la empresa (ej. `year` = etiqueta del ejercicio siempre) | Rompe los ~30 call-sites que resuelven período por fecha calendario literal (`getUTCFullYear()`); exige tocar cada uno para "traducir" fecha real → etiqueta de ejercicio. La opción elegida logra el mismo resultado de negocio con cero cambios ahí. |
| Extender `FiscalYearClose` para que también sea el contenedor "abierto" de períodos (sin `FiscalYear` nuevo) | Mezcla el evento de cierre (inmutable, snapshot financiero) con el ciclo de vida mutable de apertura — viola SOLID-S; no hay dónde persistir "OPEN" sin reinterpretar la existencia misma de la fila (`FiscalYearClose` hoy significa, por diseño, "ya cerrado" — `isFiscalYearClosed` depende de que EXISTA la fila). |
| Inferir el ejercicio por rango de fechas sin ninguna tabla nueva | No hay dónde aplicar atómicamente el guard D-9 (máx. 2 OPEN simultáneos) ni persistir cuándo se abrió/cerró un ejercicio para auditoría. |
| `FiscalYearConfig` versionado en el tiempo, separado de `Company` | Redundante: `FiscalYear.startMonth`, copiado al abrir, ya versiona correctamente el régimen histórico sin tabla adicional (D-2). |
| `Company.activeFiscalYearId` persistido | Puntero que puede desincronizarse; dato 100% derivable en O(1) con índice — se prefiere el derivado (D-3). |
| Permitir "stub" de ejercicio irregular más corto de 12 meses (transición de régimen) | Caso real (cambio de régimen con autorización SENIAT) pero sin cliente actual que lo necesite — YAGNI explícito, documentado como fuera de alcance, no descartado por siempre. |
| Cerrar automáticamente el ejercicio anterior al abrir el siguiente (sin convivencia) | Contradice directamente el flujo real descrito por la tester (declara y cierra 2026 en abril 2027, después de ya operar en 2027) — habría forzado un cierre prematuro sin los ajustes de ISLR aplicados. |

---

## Preguntas abiertas para el usuario (minimizadas — las 2 grandes ya están resueltas)

1. **Backfill que reabre meses ya cerrados individualmente** (Plan de Migración, paso 2): para el
   ejercicio en curso de cada empresa Alpha, algunos meses pudieron cerrarse bajo el flujo viejo aunque
   el año todavía no tenga `FiscalYearClose`. Mi recomendación es reabrirlos (con `AuditLog` de rastro)
   porque, en términos VEN-NIF, nunca fueron un cierre real — pero es la única parte de este ADR que
   cambia el `status` de filas de producción ya existentes. ¿Confirmas ese criterio, o prefieres que la
   ejecución del backfill se te muestre primero en dry-run (conteo de empresas/meses afectados) antes de
   aplicar?
2. **Ejercicio irregular más corto de 12 meses** (transición de régimen con autorización SENIAT): quedó
   explícitamente fuera de alcance (YAGNI) porque hoy ningún cliente lo necesita. ¿De acuerdo en
   diferirlo hasta que aparezca un caso real, o algún prospecto de Alpha ya lo requiere?

---

## Checklist SCHEMA_AUDITOR

```
[x] Relaciones a tablas contables con onDelete: Restrict — FiscalYear.company,
    AccountingPeriod.fiscalYear, FiscalYearClose.fiscalYear, y FIX de
    AccountingPeriod.company (H-1)
[x] onDelete: Cascade ausente — confirmado en los 3 modelos tocados
[x] Campos monetarios Decimal(19,4) — sin campos monetarios nuevos en este ADR
[x] Campos de porcentaje Decimal(5,2) — no aplica, sin campos de porcentaje nuevos
[x] deletedAt en entidades fiscales — N/A documentado: FiscalYear nunca se elimina desde su
    creación, mismo criterio que AccountingPeriod (precedente ya existente en el schema)
[x] idempotencyKey @unique en entidades de creación fiscal — N/A documentado: @@unique([companyId,
    year]) ya es la idempotencia (mismo criterio que AccountingPeriod.@@unique([companyId,year,month]))
[x] Unicidad de negocio @@unique([companyId, field]) — @@unique([companyId, year]) en FiscalYear,
    @@unique([fiscalYearId]) en FiscalYearClose
[x] Índices en FKs frecuentes — companyId+status, companyId+fiscalYearId, fiscalYearId
[x] AuditLog donde se requiere auditabilidad — FiscalYear OPEN, FiscalYearClose CLOSE (ya existía)
[x] Análisis de riesgo de migración documentado — ver Plan de Migración
[x] Acciones destructivas verifican companyMember.role — D-12
[x] Campos de monto en Zod con .max() — N/A, sin campos de monto nuevos
[x] Ninguna tasa impositiva del cliente — N/A, sin inputs fiscales nuevos
[x] AuditLog append-only — sin update/delete introducidos
[x] Mutación financiera nueva con rate limiting — D-12, limiters.fiscal en ambas actions
```

## Owner files

- `prisma/schema.prisma` — `FiscalYear` (nuevo), `AccountingPeriod` (+`fiscalYearId`, fix H-1),
  `FiscalYearClose` (+`fiscalYearId`), `Company` (+`fiscalYearStartMonth`)
- `src/modules/accounting/services/PeriodService.ts` — `assertDateInOpenPeriod` (reescrito, firma
  intacta), `resolveFiscalPeriodId` (sin cambios), `getActivePeriod`/`openPeriod`/`closePeriod`
  (eliminados de la superficie pública; lógica de persistencia movida a helpers privados)
- `src/modules/accounting/services/FiscalYearService.ts` (**nuevo**) — `getActiveFiscalYear`,
  `getFiscalYears`, `openFiscalYear`
- `src/modules/fiscal-close/services/FiscalYearCloseService.ts` — `closeFiscalYear` (extendido: cierre
  masivo de los 12 períodos + snapshots + fix H-2 fecha/último-período), `isFiscalYearClosed`
  (sin cambios de firma)
- Server Actions que invocan lo anterior — requieren grep-sweep para ubicarlas exactamente (no
  verificado en esta sesión)
- `.claude/adr/ADR-015-BORRADOR-eventos-extemporaneos.md` — actualizado (status + referencia corregida,
  ver diff arriba)
