# ADR-034 — Fase Despacho: Tier de Suscripción y Gestión Multi-RIF

**Estado:** DECIDIDO
**Fecha:** 2026-06-15
**Autores:** arch-agent (Software Architect)
**Branch objetivo:** feat/tier-despacho

---

## 1. Contexto y Problema

`ScopeProfile.DESPACHO` (ADR-033) identifica estudios jurídicos/contables que operan desde
una sola cuenta ContaFlow pero gestionan la contabilidad de múltiples clientes, cada uno con
su propio RIF SENIAT.

Hoy no existe ningún mecanismo para:
- Registrar qué RIFs externos gestiona un Despacho.
- Limitar el número de RIFs según el tier de suscripción del Despacho.
- Asociar datos de facturación/billing al tier DESPACHO (independiente del plan MONTHLY/ANNUAL
  del Subscription general, que es empresa-céntrico).

El modelo `Subscription` (ADR-032, Sprint 3) ya existe con NOWPayments, `SubscriptionPlan`
(TRIAL/MONTHLY/ANNUAL/EARLY_ADOPTER) y `SubscriptionStatus`. Los precios y límites de RIF
**no se hardcodean en el schema** — son constantes TODO en el servicio de negocio.

### ¿Multi-empresa ya existe?

Sí, parcialmente. Un usuario puede pertenecer a múltiples `Company` vía `CompanyMember`. Sin
embargo, ese modelo representa membresía con rol contable, no la relación "este Despacho
administra el RIF de este cliente externo". Son capas distintas:

| Capa | Modelo | Propósito |
|------|--------|-----------|
| Multi-empresa (ya existe) | `CompanyMember` | Un usuario tiene rol en N empresas |
| Multi-RIF Despacho (nuevo) | `ManagedClient` | Un Despacho gestiona N RIFs de clientes |

Un RIF gestionado puede o no tener su propia `Company` en ContaFlow. El Despacho registra el
RIF del cliente externo para efectos de reporting SENIAT y de límite de tier — no para crear
una Company en nombre del cliente (eso es un flujo separado y futuro).

---

## 2. Decisión

### 2.1 Nuevo modelo: `ManagedClient`

Representa un RIF externo gestionado por un Despacho. Es un registro liviano de gobernanza —
no una Company completa. Un `ManagedClient` pertenece siempre a una Company con
`scopeProfile = DESPACHO`.

### 2.2 Extensión de `Subscription`: campo `despachoTier`

En lugar de crear un modelo de billing separado para DESPACHO, se extiende `Subscription` con
un campo opcional `despachoTier` que solo aplica cuando `Company.scopeProfile = DESPACHO`.
Esto evita un segundo sistema de billing y reutiliza el flujo NOWPayments ya implementado.

### 2.3 `rifLimit` calculado en servicio, no en schema

El límite de RIFs por tier (`STARTER: 5 RIF`, `PRO: 25 RIF`, `UNLIMITED: sin límite`) se
define como constante TODO en `DespachoService`. El schema solo almacena el tier — el guard
de límite vive en la Server Action de creación de `ManagedClient`.

---

## 3. Schema Prisma propuesto

### 3.1 Nuevos enums

```prisma
// Tier de suscripción para el perfil DESPACHO.
// Precios TODO — definir en DespachoService.DESPACHO_TIER_PRICES antes de lanzamiento.
enum DespachoTier {
  STARTER   // TODO: hasta N_STARTER RIFs — precio placeholder
  PRO       // TODO: hasta N_PRO RIFs — precio placeholder
  UNLIMITED // TODO: sin límite de RIFs — precio placeholder
}

// Estado del RIF gestionado en el Despacho.
enum ManagedClientStatus {
  ACTIVE    // RIF activo — contabilizado
  SUSPENDED // Suspendido temporalmente (cliente no pagó al Despacho)
  ARCHIVED  // Histórico — sin operaciones nuevas
}
```

### 3.2 Nuevo modelo: `ManagedClient`

```prisma
// Un RIF externo gestionado por un Despacho (Company con scopeProfile = DESPACHO).
// onDelete: Restrict — registro histórico fiscal, nunca DELETE.
// @@unique([despachoCompanyId, rif]) previene duplicar el mismo RIF en el mismo Despacho.
// deletedAt: soft delete para baja de cliente sin perder auditoría.
model ManagedClient {
  id                String              @id @default(cuid())
  // FK al Despacho que gestiona este RIF (debe tener scopeProfile = DESPACHO)
  despachoCompanyId String
  despachoCompany   Company             @relation("DespachoManagedClients", fields: [despachoCompanyId], references: [id], onDelete: Restrict)

  // RIF del cliente externo — validado en Zod con VEN_RIF_REGEX
  rif               String
  // Nombre comercial o razón social del cliente externo
  clientName        String
  // Código de actividad económica CIIU (opcional — para reporting SENIAT)
  ciiu              String?
  // Notas internas del Despacho sobre este cliente
  notes             String?

  status            ManagedClientStatus @default(ACTIVE)

  // Vínculo opcional: si el cliente también tiene su propia Company en ContaFlow.
  // SetNull — si el cliente crea su propia cuenta, no fuerza borrar el registro del Despacho.
  linkedCompanyId   String?
  linkedCompany     Company?            @relation("ManagedClientLinkedCompany", fields: [linkedCompanyId], references: [id], onDelete: SetNull)

  // Auditoría
  createdBy         String  // userId Clerk del OWNER que registró el cliente
  deletedAt         DateTime?
  deletedBy         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([despachoCompanyId, rif])
  @@index([despachoCompanyId, status])
  @@index([despachoCompanyId, deletedAt])
}
```

### 3.3 Extensión de `Subscription` (campo adicional)

```prisma
// Campo a agregar dentro del bloque model Subscription existente:
despachoTier  DespachoTier? // null si scopeProfile != DESPACHO
```

### 3.4 Extensión de `Company` (relaciones inversas)

```prisma
// Campos a agregar dentro del bloque model Company existente:
managedClients      ManagedClient[] @relation("DespachoManagedClients")
managedClientLinks  ManagedClient[] @relation("ManagedClientLinkedCompany")
```

### 3.5 Migration name

```
20260615_fase_despacho_tier
```

SQL outline (manual workflow — ver CLAUDE.md § Prisma / DB):
```sql
-- 1. Nuevos enum types
CREATE TYPE "DespachoTier" AS ENUM ('STARTER', 'PRO', 'UNLIMITED');
CREATE TYPE "ManagedClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- 2. Columna despachoTier en Subscription (nullable, no rompe filas existentes)
ALTER TABLE "subscriptions" ADD COLUMN "despachoTier" "DespachoTier";

-- 3. Tabla ManagedClient
CREATE TABLE "ManagedClient" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid(),
  "despachoCompanyId" TEXT NOT NULL,
  "rif"               TEXT NOT NULL,
  "clientName"        TEXT NOT NULL,
  "ciiu"              TEXT,
  "notes"             TEXT,
  "status"            "ManagedClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "linkedCompanyId"   TEXT,
  "createdBy"         TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  "deletedBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedClient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedClient_despachoCompanyId_rif_key" UNIQUE ("despachoCompanyId", "rif"),
  CONSTRAINT "ManagedClient_despachoCompanyId_fkey"
    FOREIGN KEY ("despachoCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT,
  CONSTRAINT "ManagedClient_linkedCompanyId_fkey"
    FOREIGN KEY ("linkedCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL
);

-- 4. Indexes
CREATE INDEX "ManagedClient_despachoCompanyId_status_idx"
  ON "ManagedClient"("despachoCompanyId", "status");
CREATE INDEX "ManagedClient_despachoCompanyId_deletedAt_idx"
  ON "ManagedClient"("despachoCompanyId", "deletedAt");
```

---

## 4. Alternativas consideradas

### Alt-A: Un DespachoAccount separado (modelo raíz propio)

Crear un `DespachoAccount` independiente de `Company`, al que pertenecen múltiples Companies
cliente. Descartado: duplica toda la lógica de billing, auth y miembros. La Company actual
ya tiene `scopeProfile = DESPACHO` como discriminador suficiente.

### Alt-B: Reutilizar `Customer` para registrar RIFs gestionados

`Customer` (Fase 35A) es una contraparte de facturación dentro de la contabilidad de una
empresa. Un RIF gestionado tiene semántica diferente (es el cliente-de-negocio del Despacho,
no una contraparte fiscal de sus propias facturas). Mezclarlos viola R-1 (separación de
libros) y genera confusión en reportes. Descartado.

### Alt-C: Límite de RIFs como campo en `Subscription.rifLimit`

Guardar el número máximo en la BD. Descartado: el límite es una función del tier y puede
cambiar sin migración — mantenerlo como constante en código evita migraciones cada vez que
se ajusta el pricing.

### Alt-D: `SetNull` en `despachoCompany` FK

Si el Despacho se archiva, los `ManagedClient` quedarían huérfanos con `despachoCompanyId =
null`. Inaceptable para auditoría fiscal. Se mantiene `Restrict`.

---

## 5. SCHEMA_AUDITOR checklist

- [x] FK `despachoCompany` → `onDelete: Restrict` (tabla fiscal/auditable)
- [x] FK `linkedCompany` → `onDelete: SetNull` (vínculo opcional, no contable)
- [x] `onDelete: Cascade` AUSENTE en tablas contables
- [x] Sin campos monetarios en `ManagedClient` — no aplica Decimal
- [x] `deletedAt DateTime?` — soft delete presente
- [x] Sin idempotencyKey — ManagedClient no genera documentos fiscales (no necesita)
- [x] `@@unique([despachoCompanyId, rif])` — unicidad de negocio multi-tenant
- [x] `@@index([despachoCompanyId, status])` — index en FK frecuente
- [x] AuditLog requerido en addManagedClient / archiveManagedClient (ver § 6)
- [x] Migration risk: solo ADDs, sin ALTER de columnas con datos existentes — rollback = DROP TABLE
- [x] Backfill: no requerido (tabla nueva; `despachoTier` nullable en Subscription)
- [x] Destructive actions (archiveManagedClient) verifican `companyMember.role === OWNER || ADMIN` (ADR-006 D-1)
- [x] No hay campos de monto en Zod input — no aplica .max() (ADR-006 D-2)
- [x] Sin campos de tasa fiscal aceptados del cliente (ADR-006 D-3)
- [x] AuditLog es append-only — no se hace update/delete de AuditLog (ADR-006 D-4)
- [x] Sin mutación financiera en esta fase — rate limiting en `limiters.fiscal` para
      addManagedClient como guardia de abuso (ADR-006 D-5)

---

## 6. Contrato de servicio hacia agents

### 6.1 `DespachoService` — contrato hacia ledger-agent

El ledger-agent NO implementa este service. Lo implementa el **billing-agent** o el agente
de módulo DESPACHO. Se documenta aquí el contrato de interfaz:

```typescript
// src/modules/despacho/services/DespachoService.ts

// Constantes TODO — NUNCA hardcoded en schema ni en acción
const DESPACHO_TIER_RIF_LIMITS: Record<DespachoTier, number | null> = {
  STARTER:   TODO_N_STARTER,   // placeholder: 5
  PRO:       TODO_N_PRO,       // placeholder: 25
  UNLIMITED: null,             // sin límite
};

// Precio en centavos USD — TODO antes de lanzamiento
const DESPACHO_TIER_PRICES_USD_CENTS: Record<DespachoTier, number> = {
  STARTER:   TODO_PRICE_STARTER,
  PRO:       TODO_PRICE_PRO,
  UNLIMITED: TODO_PRICE_UNLIMITED,
};

interface DespachoService {
  /**
   * Verifica si el Despacho puede agregar un RIF más según su tier activo.
   * Retorna { allowed: boolean, currentCount: number, limit: number | null }.
   * Precondición: company.scopeProfile === 'DESPACHO'.
   * Aislamiento: Read Committed suficiente — no hay correlativo, solo un count.
   */
  canAddManagedClient(companyId: string): Promise<{
    allowed: boolean;
    currentCount: number;
    limit: number | null;
  }>;

  /**
   * Agrega un RIF al Despacho. Verifica límite antes de insertar.
   * Crea AuditLog dentro del mismo $transaction.
   * Precondición: caller tiene rol OWNER o ADMIN en companyId.
   * Retorna el ManagedClient creado o error de negocio.
   */
  addManagedClient(
    companyId: string,
    input: AddManagedClientInput,
    callerUserId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ success: true; client: ManagedClient } | { success: false; error: string }>;

  /**
   * Archiva (soft-delete) un RIF gestionado.
   * Precondición: caller tiene rol OWNER o ADMIN.
   * No elimina — solo pone deletedAt + deletedBy.
   */
  archiveManagedClient(
    companyId: string,
    managedClientId: string,
    callerUserId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ success: true } | { success: false; error: string }>;

  /**
   * Lista los RIFs gestionados por el Despacho (excluye soft-deleted por defecto).
   * Siempre incluye companyId en where — ADR-004.
   */
  listManagedClients(
    companyId: string,
    opts?: { includeArchived?: boolean },
  ): Promise<ManagedClient[]>;

  /**
   * Actualiza el tier DESPACHO de la suscripción.
   * Solo OWNER puede invocar. Genera SubscriptionPayment vía NOWPayments (ADR-032).
   * NO cambia el Subscription.plan — solo el campo despachoTier.
   */
  upgradeDespachoTier(
    companyId: string,
    newTier: DespachoTier,
    callerUserId: string,
  ): Promise<{ success: true; paymentUrl: string } | { success: false; error: string }>;
}
```

### 6.2 Contrato hacia ui-agent

El ui-agent debe implementar las siguientes páginas/componentes en la branch `feat/tier-despacho`:

| Componente | Ruta o ubicación | Descripción |
|---|---|---|
| `DespachoRifList` | `/company/[id]/despacho/rifs` | Tabla de RIFs gestionados + status badges + botón archivar |
| `AddRifModal` | modal en la lista | Formulario RIF + clientName + ciiu + notes. Validación VEN_RIF_REGEX client-side. |
| `DespachoTierCard` | `/company/[id]/settings` sección Despacho | Badge tier activo + count/limit + botón "Mejorar Plan" |
| `DespachoUpgradeFlow` | `/company/[id]/despacho/upgrade` | Selector Starter/Pro/Unlimited + NOWPayments redirect (reutiliza flujo ADR-032) |
| `DespachoOnboardingBanner` | dashboard cuando `scopeProfile === DESPACHO && !subscription?.despachoTier` | Prompt inicial para elegir tier |

Restricciones UI:
- El botón "Agregar RIF" debe quedar `disabled` cuando `currentCount >= limit` (STARTER/PRO) con tooltip explicativo.
- `aria-busy` en submit del modal AddRifModal (guard doble-submit, DECISIONS.md § cold start Neon).
- Toda la sección `/despacho/` solo visible si `company.scopeProfile === 'DESPACHO'` — nav con progressive disclosure (patrón ADR-033).

### 6.3 Superficie de auditoría para security-agent

Al implementar la branch, security-agent debe auditar:

1. **`addManagedClient` action** — verificar: `companyId` en where de todos los findMany/findFirst; rol OWNER/ADMIN antes del insert; que el `rif` input pasa VEN_RIF_REGEX; que `canAddManagedClient` se llama ANTES del insert dentro del mismo `$transaction` para evitar TOCTOU.
2. **`listManagedClients` action** — verificar: `where: { despachoCompanyId: companyId }` presente (ADR-004 anti cross-tenant).
3. **`upgradeDespachoTier` action** — verificar: solo OWNER; que el nuevo tier no baja el límite por debajo del count actual (downgrade protection); AuditLog creado.
4. **`/despacho/rifs` route** — verificar: layout con `auth.protect()` middleware activo; la query no filtra solo por `linkedCompanyId` (podría exponer RIFs de otro Despacho).
5. **IDOR check** — `managedClientId` en archiveManagedClient debe verificarse contra `despachoCompanyId` antes de operar (no asumir ownership por el ID solo).

---

## 7. Consecuencias y trade-offs

### Positivos
- Schema mínimo: 1 tabla nueva + 1 campo nullable en Subscription. Migración safe (solo ADDs).
- Reutiliza NOWPayments (ADR-032) para el pago del tier Despacho — sin nuevo proveedor de pagos.
- El tier DESPACHO es ortogonal al plan MONTHLY/ANNUAL — un Despacho puede tener plan ANNUAL + tier PRO sin conflicto.
- `ManagedClient` es un registro de gobernanza liviano. No requiere schema contable completo por cliente.

### Negativos / riesgos
- Si en el futuro se quiere que el Despacho gestione libros contables por cliente (cada RIF con sus propias cuentas, períodos, etc.), necesitará un `DespachoWorkspace` más complejo. Este ADR no bloquea eso — `linkedCompanyId` ya crea el puente.
- `canAddManagedClient` con Read Committed puede tener TOCTOU bajo inserción concurrente masiva. Mitigación: la `@@unique([despachoCompanyId, rif])` del schema garantiza que no se duplique el mismo RIF. El límite de count puede excederse en ms por dos requests simultáneos — aceptable para este tier (no es un correlativo fiscal).

### Deuda documentada
- `TODO_N_STARTER`, `TODO_N_PRO`, `TODO_PRICE_*` en `DespachoService` deben resolverse antes del lanzamiento del tier. El schema no bloquea el lanzamiento mientras los valores sean constantes en código.
- Downgrade de tier (PRO → STARTER cuando hay >N_STARTER RIFs activos): la action `upgradeDespachoTier` debe bloquear downgrade si `currentCount > newTierLimit`. No implementar downgrade parcial (archivar RIFs automáticamente) — decisión de negocio pendiente.

---

## 8. Referencias

- ADR-032: Billing y Suscripciones (NOWPayments, PlanChangeRequest)
- ADR-033: ScopeProfile enum (SOLO/EMPRESA/DESPACHO)
- ADR-004: Multi-tenant isolation (companyId mandatory en findMany/findFirst)
- ADR-006: Security hardening (rol checks, D-1 a D-5)
- ADR-003: onDelete Restrict en tablas contables
- CLAUDE.md § Zonas de Peligro Z-1/Z-2 — no aplican a este ADR (sin correlativos ni impuestos)
- `src/lib/fiscal-validators.ts` — VEN_RIF_REGEX (re-export para validar el campo `rif`)
