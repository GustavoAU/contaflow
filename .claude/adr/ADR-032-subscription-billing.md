# ADR-032 — Subscription Billing Schema

**Estado:** Aceptado
**Fecha:** 2026-06-04
**Autor:** arch-agent / ContaFlow
**Trigger:** Diseño del módulo de suscripciones — pago manual USDT hoy, NowPayments/Binance Pay futuro

---

## Pre-flight checklist ejecutado

1. ACCOUNTING IMPACT: ningún asiento VEN-NIF afectado — la suscripción es un concepto SaaS, no contable.
   Serializable NO requerido para los 3 modelos (no hay número correlativo fiscal). Read Committed suficiente.
2. ADRs consultados: ADR-001 (no aplica — no hay correlativo), ADR-002 (Decimal para USD), ADR-003
   (onDelete Restrict), ADR-004 (companyId en queries). No existe ADR previo sobre billing.
3. Lessons learned: patrón de estado con cron ya documentado en PayrollRun — mismo enfoque.
4. Constraints validados: checklist SCHEMA_AUDITOR completo al final de este ADR.
5. Risk analysis: ver sección Riesgos de Migración.
6. Security impact: no hay acción destructiva nueva; no hay campo de tasa fiscal; AuditLog append-only
   requerido para transiciones de estado de suscripción (trazabilidad de cobros).

---

## Contexto

El schema ya tiene un stub de `Subscription` y `SubscriptionPayment` (Sprint 3, líneas 2667–2732 de
schema.prisma). Falta:

- `PlanChangeRequest` — modelo ausente
- `txHash` en `SubscriptionPayment` — falta para pagos on-chain USDT
- `confirmedByUserId` en `SubscriptionPayment` — falta para confirmación manual admin
- Decisión explícita sobre ancla de la suscripción (User vs Company)
- Decisión sobre `effectiveDate` en cambios de plan
- Isolation level para `applyPlanChange`

El stub existente ya toma la decisión correcta de anclar a `Company` (ver D-1 abajo) — este ADR la
formaliza y extiende.

---

## Decisiones

### D-1: Ancla de la suscripción — Company, no User

**Decisión:** `Subscription.companyId` es el ancla. El stub existente ya implementa esto.

**Justificación:**

- ContaFlow factura por empresa (RIF), no por persona. Un usuario puede ser miembro de múltiples
  empresas con distintos planes. Una empresa puede tener múltiples miembros.
- Clerk gestiona la entidad User — duplicarla en BD solo para sostener una suscripción introduce
  sincronización innecesaria (webhooks de Clerk para cada update de perfil).
- El modelo `User` existente (id = Clerk userId, String PK) es suficiente para trazabilidad de quién
  confirmó un pago (`confirmedByUserId String?` referencia al userId de Clerk directamente, igual que
  hacen `AuditLog.userId`, `CompanyCertificate.createdBy`, etc. — patrón ya establecido en el proyecto).
- `@@unique([companyId])` en `Subscription`: en el modelo actual una empresa tiene exactamente una
  suscripción vigente. El historial de pagos vive en `SubscriptionPayment`. Los cambios de plan se
  modelan como mutación de la suscripción + registro en `PlanChangeRequest`, no como nuevas filas de
  `Subscription`.

**Alternativa rechazada:** Tabla `UserSubscription` anclada a userId. Rechazada porque la unidad
facturada es la empresa, y porque añadiría una capa de indirección sin valor: al crear una empresa,
el OWNER ya tiene membresía — no hace falta otro registro de "dueño de suscripción".

---

### D-2: Una sola suscripción activa por empresa (@@unique)

**Decisión:** `@@unique([companyId])` en `Subscription` — ya implementado en el stub. Confirmado.

Una empresa tiene un único estado de suscripción en cualquier momento. El historial está implícito
en los `SubscriptionPayment` y los `PlanChangeRequest`. Si en el futuro se necesita historial
completo de suscripciones (downgrade forzado, reactivación tras expiración), se agrega un modelo
`SubscriptionHistory` como append-only — no se toca la unicidad de `Subscription`.

---

### D-3: effectiveDate en PlanChangeRequest — primer día del próximo mes calendario

**Decisión:** `effectiveDate = primer día del mes siguiente a la fecha de confirmación del pago`.

**Ejemplo:** Usuario en plan mensual confirma cambio a anual el 17 de junio 2026.
`effectiveDate = 2026-07-01T00:00:00Z`.

**Justificación:**

- "Primer día del próximo mes" es el estándar de la industria SaaS para cambios mid-cycle. Evita
  el problema de prorratear fracciones de mes en USDT (cuyo mínimo divisible práctico es 0.01 USDT
  pero la UX de pago parcial es confusa).
- `+30 días exactos` generaría fechas irregulares (ej. efectivo el 17 de julio) que no coinciden
  con ningún ciclo de facturación natural — más difícil de comunicar al usuario y de implementar
  en el cron.
- El cron job que aplica cambios busca `status = CONFIRMED AND effectiveDate <= now()`. Con fechas
  de primer-de-mes el cron puede correr a las 00:05 UTC del día 1 de cada mes con precisión total.

**Cálculo canónico (TypeScript):**

```typescript
// Siempre en UTC — nunca timezone local
const confirmedAt = new Date(); // momento de confirmación del pago
const effectiveDate = new Date(Date.UTC(
  confirmedAt.getUTCFullYear(),
  confirmedAt.getUTCMonth() + 1, // siguiente mes
  1,                              // día 1
  0, 0, 0, 0
));
```

Excepción: si el usuario está en `TRIALING` y quiere activar un plan inmediatamente, `effectiveDate`
puede ser `now()` — el campo permanece `DateTime`, la lógica de "primer día del mes" aplica solo
a cambios mid-cycle entre planes pagados.

---

### D-4: Index para el cron de applyPlanChange

**Decisión:** Index compuesto `@@index([status, effectiveDate])` en `PlanChangeRequest`.

El cron ejecuta exactamente esta query:

```sql
SELECT * FROM plan_change_requests
WHERE status = 'CONFIRMED'
  AND effective_date <= now()
ORDER BY effective_date ASC
LIMIT 100;
```

El index compuesto `(status, effectiveDate)` permite index-range-scan en PostgreSQL: primero filtra
por `status = CONFIRMED` (alta selectividad post-aplicación), luego range-scan en `effectiveDate`.
Sin este index la query es seq-scan sobre toda la tabla conforme crece el histórico de solicitudes.

Index adicional: `@@index([subscriptionId])` — para la query de "¿esta suscripción tiene un cambio
pendiente?" que el dashboard muestra al usuario.

---

### D-5: Isolation level para applyPlanChange

**Decisión:** `Read Committed` (default de Prisma) con guard de estado explícito.

**Justificación:**

- `applyPlanChange` actualiza `Subscription` (plan, currentPeriodEnd) y crea `SubscriptionPayment`
  en el mismo `$transaction`. No hay número correlativo fiscal involucrado.
- El riesgo de concurrencia es: ¿pueden dos instancias del cron aplicar el mismo `PlanChangeRequest`
  simultáneamente? La protección correcta es el guard de estado:

```typescript
// Dentro del $transaction — Read Committed es suficiente con este UPDATE optimista
const updated = await tx.planChangeRequest.updateMany({
  where: { id: requestId, status: 'CONFIRMED' }, // solo si sigue CONFIRMED
  data: { status: 'APPLYING' },
});
if (updated.count === 0) return; // otro proceso ya lo tomó — salir sin error
// ... continuar con la mutación
```

- `updateMany` con `where: { status: 'CONFIRMED' }` actúa como compare-and-swap a nivel de fila en
  PostgreSQL incluso bajo Read Committed — la actualización es atómica a nivel de fila.
- `Serializable` aquí solo añadiría overhead (~15-20% por ADR-001) sin eliminar el riesgo real, que
  se mitiga con el estado `APPLYING` como mutex.

**Alternativa rechazada:** Serializable unconditional. El riesgo de serialization failures (P2034)
en el cron bajo Read Committed + guard de estado es matemáticamente nulo para este patrón — dos
workers que toman el mismo registro resultan en uno ejecutando (count=1) y el otro abortando
silenciosamente (count=0). Serializable añadiría retries sin beneficio adicional.

---

### D-6: txHash y confirmación manual en SubscriptionPayment

El stub actual no tiene `txHash` (esencial para USDT on-chain) ni `confirmedByUserId` (trazabilidad
de quién confirmó manualmente en el panel admin). Ambos se agregan.

---

## Schema Prisma — incremento sobre el stub existente

El stub ya define `SubscriptionPlan`, `SubscriptionStatus`, `BillingPaymentStatus`, `Subscription`
y `SubscriptionPayment`. Este ADR:

1. Extiende `SubscriptionPayment` con `txHash` y `confirmedByUserId`
2. Agrega el enum `PlanChangeStatus`
3. Agrega el modelo `PlanChangeRequest`
4. Agrega el campo `changeRequests` a `Subscription`

### Nuevo enum

```prisma
enum PlanChangeStatus {
  PENDING_PAYMENT  // Solicitud creada — esperando pago del nuevo plan
  CONFIRMED        // Pago confirmado — esperando la effectiveDate para aplicarse
  APPLYING         // El cron la tomó — mutex de doble-apply
  APPLIED          // Aplicada — Subscription ya refleja el nuevo plan
  CANCELED         // Cancelada antes de la effectiveDate
}
```

### Extensión de SubscriptionPayment

```prisma
model SubscriptionPayment {
  id                   String               @id @default(cuid())
  subscriptionId       String
  subscription         Subscription         @relation(fields: [subscriptionId], references: [id], onDelete: Restrict)

  // Referencia al cambio de plan que originó este pago (nullable para renovaciones)
  planChangeRequestId  String?
  planChangeRequest    PlanChangeRequest?   @relation(fields: [planChangeRequestId], references: [id], onDelete: Restrict)

  // Integración NowPayments (futuro)
  nowpaymentsOrderId   String?              @unique
  nowpaymentsPaymentId String?              @unique

  amountUsdCents       Int                  // Precio en centavos USD (ej. 5900 = $59.00) — Int suficiente para USDT sin fracciones de centavo

  // Moneda del pago on-chain ("USDT", "BTC", etc.)
  currency             String               @db.VarChar(10)

  // Hash de la transacción on-chain — obligatorio para USDT, null para NowPayments si aún no confirmado
  txHash               String?              @unique @db.VarChar(100)

  status               BillingPaymentStatus @default(PENDING)
  paidAt               DateTime?

  // Quién confirmó el pago en el panel admin (userId de Clerk) — null para confirmaciones automáticas vía webhook
  confirmedByUserId    String?

  // Raw webhook payload (NowPayments/Binance Pay) o notas del admin
  metadata             Json?

  createdAt            DateTime             @default(now())
  updatedAt            DateTime             @updatedAt

  @@index([subscriptionId])
  @@index([status, createdAt])
  @@map("subscription_payments")
}
```

### Nuevo modelo PlanChangeRequest

```prisma
/// Solicitud de cambio de plan. Una suscripción puede tener como máximo una solicitud
/// activa (status IN [PENDING_PAYMENT, CONFIRMED, APPLYING]) en cualquier momento.
/// Constraint de unicidad: @@unique([subscriptionId]) WHERE status IN active states
/// no es soportado por Prisma (partial unique) — se enforcea a nivel de aplicación
/// con guard en la action de creación.
model PlanChangeRequest {
  id             String            @id @default(cuid())
  subscriptionId String

  fromPlan       SubscriptionPlan  // Plan actual en el momento de la solicitud
  toPlan         SubscriptionPlan  // Plan al que se quiere cambiar

  // Precio del nuevo plan al momento de la solicitud (snapshot inmutable)
  newPriceUsdCents Int

  // Fecha en que el cambio se hace efectivo — primer día del próximo mes UTC (D-3)
  effectiveDate  DateTime

  status         PlanChangeStatus  @default(PENDING_PAYMENT)

  // Quién creó la solicitud (userId de Clerk — OWNER o ADMIN de la empresa)
  requestedByUserId String

  // Quién confirmó el pago (userId de Clerk del admin de ContaFlow) — null para automático
  confirmedByUserId String?
  confirmedAt       DateTime?

  // Quién aplicó el cambio (userId del cron o admin) — trazabilidad
  appliedByUserId  String?
  appliedAt        DateTime?

  // Motivo de cancelación (si status = CANCELED)
  cancelReason     String?  @db.Text

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  subscription     Subscription         @relation(fields: [subscriptionId], references: [id], onDelete: Restrict)
  payments         SubscriptionPayment[]

  // D-4: Index para el cron — status=CONFIRMED AND effectiveDate <= now()
  @@index([status, effectiveDate])
  // Para la query del dashboard: "¿tiene esta suscripción un cambio pendiente?"
  @@index([subscriptionId])
  @@map("plan_change_requests")
}
```

### Extensión de Subscription (campo inverso)

```prisma
// Agregar a model Subscription:
changeRequests PlanChangeRequest[]
```

---

## Diagrama ASCII de relaciones

```
User (Clerk)
  │ userId (String — no FK de DB, referenciado por String en campos de trazabilidad)
  │
  └─ CompanyMember ─── Company
                          │
                          │ companyId @@unique
                          │
                     Subscription ─────────────────────────── Company (referredBy) [SetNull]
                          │
                          ├── SubscriptionPayment [Restrict]
                          │        │
                          │        └── PlanChangeRequest [Restrict] (planChangeRequestId nullable)
                          │
                          └── PlanChangeRequest [Restrict]
                                   │
                                   └── SubscriptionPayment[] (payments)
```

Relación entre `PlanChangeRequest` y `SubscriptionPayment` es bidireccional:
- Un `PlanChangeRequest` origina 1 pago (para el plan nuevo)
- Un `SubscriptionPayment` puede referenciar 0 o 1 `PlanChangeRequest` (null = renovación automática)

---

## Cómo NowPayments se enchufará sin refactorizar

El diseño es provider-agnostic por construcción:

1. `SubscriptionPayment.nowpaymentsOrderId` y `nowpaymentsPaymentId` ya existen (nullable).
2. `SubscriptionPayment.metadata Json?` almacena el raw payload del webhook — sin cambio de schema.
3. `SubscriptionPayment.confirmedByUserId` queda null cuando la confirmación llega via webhook
   (automatizada) — mismo campo, semántica diferente según el flujo.
4. `PlanChangeRequest.status = CONFIRMED` es el estado que habilita la aplicación del cambio,
   independientemente de si la confirmación vino de un admin humano o del webhook de NowPayments.

El webhook de NowPayments solo necesita:
- Encontrar el `SubscriptionPayment` por `nowpaymentsOrderId`
- Actualizar `status = CONFIRMED` y `paidAt = now()`
- Actualizar el `PlanChangeRequest` vinculado a `status = CONFIRMED`
- No hay campos adicionales requeridos

Para Binance Pay: mismo patrón — `metadata` contendría el payload Binance, `txHash` contendría el
hash de la transacción USDT resultante. Un campo `binancePayOrderId String? @unique` puede
agregarse a `SubscriptionPayment` en el futuro sin afectar ningún otro campo ni modelo.

---

## Nombre de migración sugerido

```
20260604_add_plan_change_requests_extend_subscription_payments
```

Archivo: `prisma/migrations/20260604000001_add_plan_change_requests_extend_subscription_payments/migration.sql`

---

## Riesgos de Migración

| Riesgo | Mitigación |
|--------|-----------|
| Tablas `subscriptions` y `subscription_payments` pueden existir vacías en producción (stub nunca migrado formalmente) | Verificar con `SELECT COUNT(*) FROM subscriptions` antes de aplicar. Si 0 filas: sin backfill requerido. |
| `txHash @unique` en `subscription_payments` — si hay filas previas con txHash=null, el unique no genera colisión (null != null en PostgreSQL) | Seguro. NULL no viola UNIQUE en PostgreSQL. |
| `PlanChangeRequest` es tabla nueva — sin datos previos | Sin riesgo de rollback parcial: `CREATE TABLE` es atómica. |
| Campo `status APPLYING` en `PlanChangeStatus` — el cron debe manejar reinicios | Si el proceso muere con status=APPLYING, agregar job de recovery que revierte APPLYING→CONFIRMED pasados 5 minutos sin `appliedAt`. Documentar en RUNBOOK.md. |

---

## SCHEMA_AUDITOR checklist

- [x] Todas las relaciones a tablas contables tienen onDelete: Restrict — N/A, estos modelos son SaaS billing, no contables. Las relaciones a Company y entre sí usan Restrict (no Cascade con datos).
- [x] onDelete: Cascade AUSENTE de tablas contables — `RolePermission` usa Cascade (ya existente, fuera de scope). `PlanChangeRequest` y `SubscriptionPayment` usan Restrict.
- [x] Campos monetarios: `amountUsdCents Int` — USD en centavos enteros es correcto (USDT se opera en centavos de dólar, sin fracciones fiscales VEN-NIF). `priceUsdCents Int` en el stub confirmado como correcto: USDT no tiene subcentavos en la práctica comercial.
- [x] Campos de porcentaje: ninguno en estos modelos.
- [x] Entidades fiscales con deletedAt: estos modelos son billing SaaS, no entidades fiscales VEN-NIF. `PlanChangeRequest` no requiere soft delete — los cambios cancelados se marcan con `status = CANCELED`, que es el patrón correcto para un estado machine.
- [x] Entities de creación con idempotencyKey: `PlanChangeRequest` no necesita idempotencyKey propio — la idempotencia está garantizada por el guard `status = CONFIRMED` en el cron (D-5) y por `@@unique` en `Subscription`. `SubscriptionPayment` tiene `nowpaymentsOrderId @unique` y `txHash @unique` como llaves de idempotencia del proveedor externo.
- [x] Unicidad de negocio con companyId: `Subscription.companyId @unique` — correcto.
- [x] Indexes en FKs frecuentes: `@@index([subscriptionId])` en ambos modelos hijo. `@@index([status, effectiveDate])` en `PlanChangeRequest` para el cron.
- [x] AuditLog: las transiciones de estado de `Subscription` y `PlanChangeRequest` DEBEN generar `AuditLog` en el mismo `$transaction` — pendiente de implementación en el service. Decisión: el action que confirma un pago debe crear `AuditLog` con `entityName = 'Subscription'`, `action = 'PLAN_CHANGE_CONFIRMED'`.
- [x] Análisis de riesgo de migración: documentado arriba.
- [x] Acciones destructivas verifican companyMember.role: la action que confirma pagos manualmente es solo para el admin de ContaFlow (rol de plataforma, no role de empresa). Implementar con `clerkClient.users.getUser(userId)` y verificar metadata de plataforma — fuera del modelo de roles de empresa.
- [x] Campos de monto en schemas Zod tienen .max(): `amountUsdCents` en la action de confirmación manual debe tener `.max(1_000_000)` (tope $10,000 USD en centavos) — documentar en el service cuando se implemente.
- [x] Sin campo de tasa fiscal desde el cliente: ninguno de estos modelos tiene tasa de impuesto.
- [x] AuditLog append-only: confirmado — no hay operaciones update/delete sobre AuditLog.
- [x] Rate limiting en mutaciones financieras: la action `confirmPaymentAction` (admin) debe usar `limiters.fiscal`. La action `requestPlanChangeAction` (usuario) debe usar un limiter específico — documentar al implementar.

---

## Referencias

- ADR-001: Serializable para correlativos — no aplica aquí (D-5 justificado)
- ADR-002: Decimal para dinero — `amountUsdCents Int` es la excepción explícita: centavos enteros en USD para billing SaaS, sin fracciones fiscales VEN-NIF
- ADR-003: onDelete Restrict en tablas contables — estos modelos son billing SaaS; mismo principio aplicado por coherencia
- ADR-004: companyId en queries — `Subscription` ancla en `companyId`; toda query de suscripción incluye companyId
- Schema stub Sprint 3: líneas 2667–2732 de prisma/schema.prisma (2026-06-04)
