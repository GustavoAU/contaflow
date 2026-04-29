# ADR-019 — Cumplimiento PA-121: Trazabilidad de Red, Outbox SENIAT y Rol Auditor

**Estado:** DECIDIDO  
**Fecha:** 2026-04-29  
**Autor:** Software Architect — ContaFlow  
**Fase de implementación:** Fase 35H  
**ADRs relacionados:** ADR-001 (Correlativos Serializables), ADR-003 (onDelete Restrict), ADR-006 (Security Hardening)

---

## Contexto

La Providencia Administrativa SNAT/2024/000121 (PA-121) del SENIAT establece obligaciones para emisores de documentos fiscales electrónicos:

1. Cada factura, nota de crédito o nota de débito debe transmitirse al SENIAT en tiempo real o con el mínimo retardo posible tras su emisión.
2. Los registros de auditoría fiscal deben incluir trazabilidad de red: dirección IP y User-Agent del solicitante.
3. Los auditores del SENIAT pueden requerir acceso de solo lectura a los libros del contribuyente.

El sistema actual incumple los tres requisitos:

- No existe mecanismo de transmisión a la API SENIAT para documentos fiscales emitidos.
- El modelo `AuditLog` carece de campos `ipAddress` y `userAgent`.
- No existe un rol de acceso restringido para auditores externos (SENIAT).

La API de homologación del SENIAT no está disponible públicamente para todos los contribuyentes en el momento de redactar este ADR. La arquitectura debe anticipar el contrato sin bloquear el desarrollo.

---

## Decisiones

### D-1: Outbox Pattern con QStash para transmisión al SENIAT

**Problema central:** La API del SENIAT puede estar no disponible en el instante en que el usuario emite un documento fiscal. Bloquear la operación de negocio esperando respuesta HTTP del SENIAT es inaceptable — genera UX degradada y no está respaldado por la normativa, que admite transmisión con retardo razonable.

**Decisión:** Implementar el patrón Outbox. El registro `SeniatSubmission` se crea dentro del mismo `$transaction` Prisma que crea la factura, NC o ND. Un worker asíncrono (QStash de Upstash) consume la cola y reintenta con backoff exponencial ante falla de la API SENIAT.

La API del SENIAT es un detalle de infraestructura externa. No es un prerrequisito del flujo de negocio del contribuyente.

**Schema aprobado:**

```prisma
model SeniatSubmission {
  id           String           @id @default(cuid())
  companyId    String
  company      Company          @relation(fields: [companyId], references: [id], onDelete: Restrict)
  invoiceId    String           @unique
  invoice      Invoice          @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  status       SubmissionStatus @default(PENDING)
  attempts     Int              @default(0)
  payload      Json
  lastResponse Json?
  sentAt       DateTime?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  @@index([companyId, status])
  @@index([status, createdAt])
}

enum SubmissionStatus {
  PENDING
  SENT
  FAILED
}
```

**Invariantes obligatorias:**

- `SeniatSubmission` solo se crea mediante `tx.seniatSubmission.create()` dentro del mismo `$transaction` que persiste el documento fiscal. Nunca fuera de transacción.
- `onDelete: Restrict` en ambas FKs (`companyId`, `invoiceId`) — nunca `Cascade`. Conforme a ADR-003.
- El campo `payload` almacena el JSON firmado que se enviará al SENIAT. Se genera antes de la transacción y se persiste como snapshot inmutable; el estado del documento en DB es la fuente de verdad, no la respuesta del SENIAT.
- `attempts` se incrementa mediante update atómico en el worker, nunca en el flujo de emisión principal.
- `AuditLog` de la operación de emisión ya cubre la transaccionalidad del documento; `SeniatSubmission` no duplica el log — es el registro de transmisión externa.

**Flujo de reintento:**

```
QStash → POST /api/webhooks/seniat-report
  → Verificar firma QSTASH_CURRENT_SIGNING_KEY
  → Cargar SeniatSubmission[status=PENDING]
  → Llamar SeniatReportingService.transmit(submission)
  → Si éxito: UPDATE status=SENT, sentAt=now()
  → Si error: UPDATE attempts++, status=FAILED si attempts >= 5
  → QStash reintenta con backoff exponencial (configurable en Upstash dashboard)
```

**Consecuencias:**

- El documento fiscal es válido normativamente desde el momento en que se persiste con `SeniatSubmission` en PENDING, aunque SENIAT esté caído.
- Eventual consistency: SENIAT puede confirmar el documento segundos o minutos después de su creación.
- Requiere instalar `@upstash/qstash` y configurar `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` en variables de entorno.
- El route handler `/api/webhooks/seniat-report` debe verificar la firma QStash antes de procesar — nunca procesar un payload sin firma válida (riesgo de replay attack).
- El worker debe aplicar `checkRateLimit(limiters.fiscal, companyId)` para evitar flood hacia la API SENIAT (ADR-006 D-5).

**Nombre de migración sugerido:** `20260430_fase35h_seniat_submission`

---

### D-2: Trazabilidad de red obligatoria en AuditLog

**Problema:** PA-121 exige que toda operación fiscal registre la dirección IP y el User-Agent del solicitante. El modelo `AuditLog` actual no tiene estos campos.

**Decisión:** Agregar `ipAddress String?` y `userAgent String?` al modelo `AuditLog`. Ambos son nullable para no romper los `auditLog.create()` de operaciones no fiscales (correcciones de configuración, actualizaciones de UI, etc.).

**Cambio de schema:**

```prisma
model AuditLog {
  // ... campos existentes sin cambio ...
  ipAddress  String?   // capturado desde x-forwarded-for o x-real-ip
  userAgent  String?   // capturado desde el header User-Agent
}
```

**Patrón de captura en Server Actions fiscales:**

```typescript
import { headers } from 'next/headers'

const h = await headers()
const ipAddress = h.get('x-forwarded-for')?.split(',')[0]?.trim()
               ?? h.get('x-real-ip')
               ?? null
const userAgent = h.get('user-agent') ?? null
```

**Alcance:** Los 44 `auditLog.create()` existentes en Server Actions fiscales deben incluir `ipAddress` y `userAgent`. Las acciones no fiscales (configuración, UI) pueden omitirlos — los campos son nullable.

**Clasificación de acciones fiscales (deben capturar IP/UA):**

- `createInvoiceAction`, `voidInvoiceAction`
- `createRetentionAction`, `createIGTFAction`
- `recordPaymentAction`
- `generarForma30Action`, `exportForma30PDFAction`
- `createAccountAction`, `closeAccountingPeriodAction`
- `postInventoryMovementAction`, `voidInventoryMovementAction`
- Todas las actions de nómina que generan asientos (`createPayrollRunAction`, `postPayrollAction`)
- `createInflationAdjustmentAction`
- `depreciateBatchAction`

**Consecuencias:**

- Migración es no-breaking: columnas nullable, sin DEFAULT requerido.
- Los mocks de tests existentes deben agregar `ipAddress: null, userAgent: null` en los objetos retornados por `auditLog.create`. El tipo Prisma generado incluirá los nuevos campos.
- En entornos de test, `headers()` se mockea; los campos quedan `null` — comportamiento esperado y correcto.

**Migración:**

```sql
ALTER TABLE "AuditLog"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;
```

**Nombre de migración sugerido:** `20260430_fase35h_auditlog_network_trace`

---

### D-3: Rol SENIAT — auditor de solo lectura

**Problema:** El SENIAT puede requerir acceso directo para verificar los libros del contribuyente. Ese acceso debe estar estrictamente acotado a lectura de informes de auditoría — sin posibilidad de mutación, sin acceso a datos operacionales de otras empresas.

**Decisión:** Agregar el valor `SENIAT` al enum `UserRole` existente. Este rol tiene la menor superficie de acceso de todos los roles del sistema.

**Permisos del rol SENIAT:**

| Recurso | Acceso |
|---------|--------|
| `InvoiceAuditReport` | Solo lectura |
| `CashAuditReport` | Solo lectura |
| `AuditLog` (propio de la empresa) | Solo lectura |
| Todas las rutas de mutación | BLOQUEADO — 403 |
| Datos de otras empresas | BLOQUEADO — companyId guard obligatorio (ADR-004) |
| Panel de administración | BLOQUEADO |
| Nómina, configuración, inventario | BLOQUEADO |

**Implementación:**

- El guard de rol SENIAT se implementa como middleware de ruta: si `companyMember.role === 'SENIAT'`, solo se permite acceso a las rutas de auditoría listadas arriba.
- Todas las Server Actions de mutación verifican `role !== 'SENIAT'` junto con la verificación de `companyMember.role` existente (ADR-006 D-1). El SENIAT nunca puede crear, modificar ni anular documentos.
- El acceso del rol SENIAT a `AuditLog` filtra siempre por `companyId` del contribuyente auditado — nunca retorna logs de otras empresas.
- La asignación del rol `SENIAT` a un usuario solo puede realizarla un `OWNER` de la empresa auditada. Queda registrada en `AuditLog` con `ipAddress` y `userAgent`.

**Consecuencias:**

- El enum `UserRole` pasa de N valores a N+1. Las sentencias `switch` exhaustivas en TypeScript requieren agregar el caso `SENIAT` o usar una rama `default` existente que lo rechace explícitamente.
- No se crea un tenant separado para auditores SENIAT — el auditor se agrega como `companyMember` con rol `SENIAT` en la empresa que está siendo auditada. El aislamiento multi-tenant (ADR-004) ya garantiza que no puede ver otras empresas.

---

### D-4: Stub del adapter SENIAT — sin implementación HTTP real en esta fase

**Problema:** La API de homologación del SENIAT no está disponible públicamente en el momento de implementar esta fase. Implementar una integración HTTP contra un endpoint inexistente crea código muerto y riesgo de mantenimiento.

**Decisión:** `SeniatReportingService` implementa la lógica de encolado, construcción y firma del payload, y el manejo de estado (`PENDING → SENT / FAILED`). El adapter HTTP queda como stub que retorna un mock de respuesta exitosa en desarrollo y lanza `SeniatApiNotAvailableError` en producción si se invoca directamente.

```
SeniatReportingService
  ├── buildPayload(invoice): SeniatPayload   ← lógica real, testeada
  ├── enqueue(payload): SeniatSubmission     ← persiste en DB + encola en QStash
  └── transmit(submission): TransmitResult  ← delega a SeniatHttpAdapter (stub)

SeniatHttpAdapter (stub)
  └── send(payload): Promise<TransmitResult>
        → en NODE_ENV=development: retorna { success: true, referenceId: 'MOCK-...' }
        → en NODE_ENV=production: lanza SeniatApiNotAvailableError con log Sentry
```

**Consecuencias:**

- Cuando el SENIAT publique su API, únicamente se reemplaza `SeniatHttpAdapter.send()`. El resto de la arquitectura (Outbox, QStash, estado, AuditLog) permanece intacto.
- `SeniatApiNotAvailableError` en producción genera una alerta en Sentry pero no bloquea al contribuyente — el documento ya está en PENDING en DB.
- Los tests de `SeniatReportingService` cubren `buildPayload` y `enqueue` con mocks del adapter. No se testea el HTTP real.

---

## Pre-flight checklist (ejecutado)

**1. ACCOUNTING IMPACT**
`SeniatSubmission` no afecta asientos ni correlativos. `AuditLog` es append-only — los nuevos campos son observacionales. El rol SENIAT no puede crear ni modificar asientos. Impacto contable: ninguno.

**2. CONSULT ADRs**
- ADR-001: Serializable no aplica — `SeniatSubmission` no es un correlativo.
- ADR-003: `onDelete: Restrict` aplicado en `SeniatSubmission` sobre `Company` e `Invoice`.
- ADR-004: companyId guard obligatorio en todos los queries de `SeniatSubmission` y en los endpoints del rol SENIAT.
- ADR-006 D-1: rol SENIAT verificado antes de cualquier mutación. D-4: AuditLog sigue siendo append-only. D-5: rate limiting en worker QStash.
- No existe ADR previo que cubra transmisión a API gubernamental — este ADR es el primero.

**3. CONSULT LESSONS LEARNED**
No hay lección documentada sobre integración con APIs gubernamentales venezolanas. Patrón nuevo. El Outbox Pattern sí está documentado como patrón canónico para integraciones con sistemas externos no confiables.

**4. VALIDATE CONSTRAINTS**
- `SeniatSubmission.payload` como `Json` es correcto — el contenido es un snapshot del documento, no datos financieros calculables.
- Sin campos Float ni Decimal en este schema — los montos provienen del `Invoice` ya validado.
- `@@index([companyId, status])` para queries de worker por empresa. `@@index([status, createdAt])` para queries de limpieza y monitoreo.

**5. RISK ANALYSIS**

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| QStash no disponible | Baja | Medio | `SeniatSubmission` permanece PENDING; cron backup cada hora para reintentar PENDING > 30 min |
| Replay attack en `/api/webhooks/seniat-report` | Media | Alto | Verificación obligatoria de firma QStash antes de procesar cualquier payload |
| Worker procesa submission de otra empresa | Baja | Crítico | Guard `companyId` en el fetch de la submission antes de transmitir |
| Campo `ipAddress` con datos de proxy incorrectos | Media | Bajo | Tomar solo el primer valor de `x-forwarded-for` (IP del cliente, no del proxy) |
| Migración falla a mitad en producción | Baja | Medio | Ambas migraciones son `ADD COLUMN` nullable — rollback es `DROP COLUMN`, no destructivo |

**6. SECURITY IMPACT**
- D-1: el route handler `/api/webhooks/seniat-report` verifica firma QStash — acción nueva sin exposición pública directa. Rate limiting en el worker (ADR-006 D-5).
- D-2: `ipAddress` y `userAgent` son campos de captura, no de input del cliente — no aplica `.max()` ceiling de ADR-006 D-2. No son campos editables por el usuario.
- D-3: rol SENIAT es el rol de menor privilegio del sistema. El guard de companyId (ADR-004) previene cross-tenant leak. La asignación del rol queda en AuditLog.
- D-4: el stub no expone ningún endpoint ni acepta input externo.
- `AuditLog` sigue siendo append-only — no se agregan operaciones `update` ni `delete` sobre él (ADR-006 D-4).

---

## Checklist SCHEMA_AUDITOR

- [x] `SeniatSubmission.company` → `onDelete: Restrict`
- [x] `SeniatSubmission.invoice` → `onDelete: Restrict`
- [x] `onDelete: Cascade` ausente en tablas contables
- [x] Sin campos Float ni Decimal en este schema (no aplica — payload es Json, montos no se almacenan aquí)
- [x] Sin entidad fiscal nueva con datos históricos propios — no aplica soft delete
- [x] `SeniatSubmission` no tiene correlativo — no aplica idempotencyKey
- [x] Unicidad: `invoiceId @unique` — correcto, un documento tiene una única submission activa
- [x] Indexes: `[companyId, status]` y `[status, createdAt]`
- [x] AuditLog: la operación de emisión ya crea AuditLog en el mismo `$transaction` — `SeniatSubmission` no duplica
- [x] Migración `ADD COLUMN nullable` — no destructiva, rollback simple
- [x] Destructive actions (asignación rol SENIAT) verifican `companyMember.role` del solicitante (ADR-006 D-1)
- [x] No hay campos de amount en Zod input — no aplica ceiling (ADR-006 D-2)
- [x] No se acepta tasa fiscal desde input del cliente (ADR-006 D-3)
- [x] AuditLog sigue siendo append-only (ADR-006 D-4)
- [x] Worker QStash aplica rate limiting (ADR-006 D-5)

---

## Notas de implementación para el agente de código

1. Las migraciones deben seguir el workflow manual obligatorio (shadow DB roto):
   - Crear carpeta `prisma/migrations/YYYYMMDD_nombre/migration.sql`
   - `npx prisma db execute --file ...`
   - `npx prisma migrate resolve --applied ...`
   - `npx prisma generate`

2. Los 44 `auditLog.create()` fiscales deben actualizarse en el mismo PR que agrega los campos al schema. No dejar el schema adelantado con campos sin poblar en acciones fiscales.

3. El mock de `auditLog.create()` en tests existentes debe extenderse para incluir `ipAddress: null` y `userAgent: null` en los objetos retornados. El agente de código debe buscar todos los `mockResolvedValue` sobre `auditLog.create` en `src/modules/**/__tests__/` y actualizarlos.

4. La variable de entorno `QSTASH_TOKEN` debe marcarse como requerida en producción pero opcional en desarrollo (el no-op pattern ya establecido en `src/lib/ratelimit.ts` aplica como referencia).

5. El enum `UserRole` se extiende en el schema Prisma — revisar que no haya `switch` exhaustivos sin rama `default` que fallen silenciosamente al agregar `SENIAT`.

6. `SeniatReportingService` vive en `src/modules/invoices/services/SeniatReportingService.ts`. No debe importar desde otros módulos excepto `src/lib/prisma.ts` y `src/lib/ratelimit.ts` (DDD — bounded context).
