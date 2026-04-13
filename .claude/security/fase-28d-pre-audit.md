# Pre-Implementation Security Audit — Fase 28D: Módulo Inventario

**Date**: 2026-04-13
**Auditor**: security-agent
**Scope**: Auditoría preventiva de la superficie de ataque para `InventoryItem`, `InventoryMovement` y sus cuatro Server Actions, previo a escribir cualquier código.
**Baseline**: ADR-004, ADR-006 D-1/D-2/D-3/D-4/D-5, LL-002, LL-003, LL-009, LL-010

---

## Resumen

**2 CRITICAL / 3 HIGH / 5 MEDIUM / 2 LOW / 1 INFO**

| ID | Severidad | Vector | Asignar a |
|---|---|---|---|
| CRITICAL-1 | CRITICAL | TENANT_ISOLATION | ledger-agent |
| CRITICAL-2 | CRITICAL | TENANT_ISOLATION | ledger-agent + arch-agent (backport) |
| HIGH-1 | HIGH | AUTHORIZATION | ledger-agent |
| HIGH-2 | HIGH | AUTHORIZATION | ledger-agent |
| HIGH-3 | HIGH | RATE_LIMIT | ledger-agent |
| HIGH-4 | HIGH | BUSINESS_LOGIC_ABUSE | ledger-agent |
| MEDIUM-1 | MEDIUM | AMOUNT_VALIDATION | ledger-agent |
| MEDIUM-2 | MEDIUM | BUSINESS_LOGIC_ABUSE | ledger-agent |
| MEDIUM-3 | MEDIUM | BUSINESS_LOGIC_ABUSE | ledger-agent |
| MEDIUM-4 | MEDIUM | XSS | ledger-agent + ui-agent |
| MEDIUM-5 | MEDIUM | AUDIT_TRAIL | ledger-agent |
| LOW-1 | LOW | AUTHORIZATION | ledger-agent |
| LOW-2 | LOW | INPUT_SANITIZATION | ledger-agent |
| INFO-1 | INFO | RATE_LIMIT | arch-agent |

---

## CRITICAL-1 — IDOR via itemId: Cross-Tenant Inventory Access

- **Vector**: TENANT_ISOLATION
- **Descripción**: Si `recordInventoryMovementAction` y `updateInventoryItemAction` reciben un `itemId` del cliente y hacen `findUnique({ where: { id: itemId } })` sin scope de `companyId`, un miembro de Empresa A con un `itemId` conocido de Empresa B puede mutar su inventario. Mismo patrón que produjo LL-002 y LL-003.
- **Impacto**: CRITICAL — mutación cross-tenant. Un ADMINISTRATIVE de Empresa A puede agotar o inflar stock de Empresa B, generando asientos fraudulentos atribuidos a sus cuentas.
- **Fix**: En `InventoryService` — cada método que acepta `itemId` DEBE usar `findFirstOrThrow({ where: { id: itemId, companyId } })`. El `companyId` debe derivarse del lookup del miembro autenticado, nunca del cuerpo del request del cliente.
- **Test requerido**: Stub `prisma.inventoryItem.findFirst` retornando item con `companyId: "other-company"`, assert retorna `{ success: false, error: "Empresa no encontrada o acceso denegado" }`.
- **Refs**: ADR-004, LL-002, LL-003

---

## CRITICAL-2 — accountId Cross-Tenant Injection en InventoryItem

- **Vector**: TENANT_ISOLATION
- **Descripción**: Si el servicio crea el item con `{ accountId, companyId }` sin verificar primero que `account.companyId === companyId`, un miembro de Empresa A puede vincular su item de inventario a una `Account` de Empresa B. Cuando `generateInventoryJournalAction` genera un `JournalEntry` usando ese `accountId`, produce un asiento cross-tenant. El gap también existe en `FixedAssetService.create` — este módulo NO debe repetirlo.
- **Impacto**: CRITICAL — asiento contable cross-tenant via inyección de account ID. Corrompe el balance de la empresa víctima.
- **Fix**: En `InventoryService.create` y `update`: antes de persistir, verificar `await tx.account.findFirstOrThrow({ where: { id: accountId, companyId } })`. Backport del mismo fix a `FixedAssetService.create` para los tres accountId (asignar a ledger-agent, escalar a arch-agent).
- **Test requerido**: Submit `accountId` de otra empresa, assert rechazo.
- **Refs**: ADR-004, LL-003

---

## HIGH-1 — VIEWER Puede Triggear recordInventoryMovementAction

- **Vector**: AUTHORIZATION
- **Descripción**: Si la nueva action solo verifica existencia de `companyMember` sin verificar `member.role` (anti-patrón LL-009), un VIEWER puede registrar movimientos que alteren `currentStock` y disparar asientos contables. ADR-006 D-1 es inequívoco: toda action que crea/modifica/anula datos financieros requiere un role check.
- **Impacto**: HIGH — privilege escalation. VIEWER (solo lectura por diseño) puede crear `InventoryMovement` que afectan stock y potencialmente `Transaction` records.
- **Fix**: Enforcer `canAccess(member.role, ROLES.OPERATIONS)` — `[OWNER, ADMIN, ADMINISTRATIVE]`. Usar `ROLES.WRITERS` si ACCOUNTANT también debe poder registrar ajustes. Patrón: `invoice.actions.ts` línea 43.
- **Test requerido**: Stub `role: "VIEWER"` en todas las actions mutantes, assert `{ success: false, error: "No autorizado" }`.
- **Refs**: ADR-006 D-1, LL-009

---

## HIGH-2 — ADMINISTRATIVE Puede Triggear Mutación Contable (generateInventoryJournalAction)

- **Vector**: AUTHORIZATION
- **Descripción**: `generateInventoryJournalAction` crea `Transaction` + `JournalEntry`. Si `recordInventoryMovementAction` llama internamente a `generateInventoryJournalAction`, o si setea un flag que dispara la generación del asiento, ADMINISTRATIVE efectivamente produce una mutación contable sin clearance `ROLES.ACCOUNTING`. ADR-006 D-1 mapea "Crear asientos" a ACCOUNTANT+.
- **Impacto**: HIGH — bypass de límite de rol. Un operador de almacén (ADMINISTRATIVE) crea `Transaction` y `JournalEntry` que deben estar restringidos a ACCOUNTANT/ADMIN/OWNER.
- **Fix**: `generateInventoryJournalAction` debe enforcer `canAccess(member.role, ROLES.ACCOUNTING)`. Diseñar flujo en dos fases: ADMINISTRATIVE registra movimiento (solo stock), ACCOUNTANT aprueba y genera el asiento (acción separada).
- **Test requerido**: Stub `role: "ADMINISTRATIVE"` llamando `generateInventoryJournalAction`, assert rechazo.
- **Refs**: ADR-006 D-1

---

## HIGH-3 — Rate Limiting Faltante en las Cuatro Nuevas Actions

- **Vector**: RATE_LIMIT
- **Descripción**: ADR-006 D-5 requiere rate limiting en toda Server Action que crea/modifica/anula datos fiscales o contables. Ninguna de las cuatro nuevas actions está en la lista de cobertura actual. `generateInventoryJournalAction` crea `Transaction` + `JournalEntry` — impacto financiero idéntico a `createTransactionAction` que ya tiene rate limit. Sin límiter, un script puede generar cientos de movimientos por segundo.
- **Impacto**: HIGH — bypass de rate limit. Stock puede ser inflado/agotado masivamente; generación masiva de asientos.
- **Fix**: En todas las actions mutantes del módulo:
  ```typescript
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };
  ```
  Posición: después de `auth()`, antes de `safeParse`. Pre-existing gap: añadir `checkRateLimit` también a `disposeFixedAssetAction` (`fixed-asset.actions.ts` línea 121).
- **Test requerido**: Mock `checkRateLimit` retornando `{ allowed: false }`, assert todas las actions retornan `{ success: false }`.
- **Refs**: ADR-006 D-5, CLAUDE.md §Rate Limiting

---

## HIGH-4 — Stock Negativo via Movimientos OUT Concurrentes (Race Condition)

- **Vector**: BUSINESS_LOGIC_ABUSE_DETECTOR
- **Descripción**: Dos requests `OUT` concurrentes sobre el mismo item ambos leen `stockQuantity = 5`, ambos computan `5 - 3 = 2` como válido, y ambos commitean — dejando stock=-1. Mismo problema que los números correlativos (ADR-001). Read Committed con optimistic locking no es suficiente bajo Neon + PgBouncer.
- **Impacto**: HIGH — stock negativo. Produce inventario fantasma y cálculos de COGS incorrectos en los asientos.
- **Fix**: En `InventoryService.postMovement` para `SALIDA` y `AJUSTE`: usar `prisma.$transaction({ isolationLevel: 'Serializable' })`. P2034 se captura y retorna error descriptivo con botón de reintento. Sin retry automático en servidor.
- **Test requerido**: Test de requests concurrentes: dos SALIDAs simultáneas de 3 unidades sobre stock de 5. Assert exactamente una tiene éxito y la otra falla con "Stock insuficiente".
- **Refs**: ADR-001 (Serializable para contadores), LL-005

---

## MEDIUM-1 — Falta Ceiling de Monto en costUnit y quantity

- **Vector**: AMOUNT_VALIDATION
- **Descripción**: ADR-006 D-2 requiere `.min` y `.max` en todos los campos monetarios Zod. Sin ceilings, un cliente puede enviar `costUnit: "99999999999999"` produciendo asientos con montos que desbordan `Decimal(19,4)` o producen valoraciones absurdas.
- **Fix**: Usar la constante `MAX_INVOICE_AMOUNT` de `src/lib/fiscal-validators.ts`:
  ```typescript
  costUnit: z.string().regex(/^\d+(\.\d{1,4})?$/).refine(v => new Decimal(v).gt(0)).refine(v => new Decimal(v).lte(new Decimal(MAX_INVOICE_AMOUNT))),
  quantity: z.number().int().positive().max(9_999_999),
  ```
- **Refs**: ADR-006 D-2, `src/lib/fiscal-validators.ts`

---

## MEDIUM-2 — costUnit No Debe Ser Editable por el Cliente en Movimientos de SALIDA

- **Vector**: BUSINESS_LOGIC_ABUSE_DETECTOR
- **Descripción**: Si `RecordMovementSchema` acepta `unitCost` como campo editable del cliente para SALIDA, un ADMINISTRATIVE puede enviar movimientos con costo fabricado, generando asientos a un costo diferente al CPP real. Análogo de ADR-006 D-3 (tasas de impuestos controladas por cliente).
- **Fix**: Para SALIDA, el servicio siempre lee `item.averageCost` del DB — ignora `unitCost` del cliente. Para ENTRADA, aceptar `unitCost` del cliente es válido pero debe disparar actualización del CPP.
- **Refs**: ADR-006 D-3

---

## MEDIUM-3 — Falta Guard de Año Fiscal en movementDate

- **Vector**: BUSINESS_LOGIC_ABUSE_DETECTOR
- **Descripción**: Si `recordInventoryMovementAction` y `generateInventoryJournalAction` aceptan un `movementDate` sin verificar que el año fiscal no esté cerrado, un atacante con acceso ADMINISTRATIVE puede inyectar movimientos backdateados en períodos ya auditados, alterando retroactivamente el COGS.
- **Fix**: Llamar a `FiscalYearCloseService.isFiscalYearClosed(companyId, movementDate.getFullYear())` antes de persistir. Patrón exacto: `invoice.actions.ts` líneas 59-69.
- **Refs**: `invoice.actions.ts` líneas 59-69, `fixed-asset.actions.ts` líneas 43-49

---

## MEDIUM-4 — Superficie XSS en campos de texto libre (name, description, notes)

- **Vector**: XSS
- **Descripción**: `InventoryItem.name`, `description` y `InventoryMovement.notes`/`reference` son campos de texto libre. Sin `.trim()` y `.max()`, pueden acumular datos sucios o intentos de inyección. Si la UI renderiza con `dangerouslySetInnerHTML` o los valores llegan a PDFs/XML, el riesgo es XSS almacenado.
- **Fix**:
  ```typescript
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  notes: z.string().max(500).trim().optional().nullable(),
  ```
  En componentes UI: verificar rendering via JSX `{item.name}` — nunca `dangerouslySetInnerHTML`.
- **Refs**: ADR-006

---

## MEDIUM-5 — AuditLog Faltante en updateInventoryItemAction y recordInventoryMovementAction

- **Vector**: AUDIT_TRAIL_INTEGRITY_GUARD
- **Descripción**: ADR-006 D-4 y CLAUDE.md requieren AuditLog en toda mutación financiera dentro del mismo `$transaction`. `updateInventoryItemAction` modifica `averageCost` (valoración) y `recordInventoryMovementAction` altera `stockQuantity` — ambas son mutaciones financieras. Sin AuditLog, modificaciones de costo son indetectables.
- **Fix**: En `InventoryService` — `tx.auditLog.create(...)` dentro del mismo `$transaction` en cada operación. Para `updateInventoryItem`: capturar `oldValue: { averageCost: before }`, `newValue: { averageCost: after }`. Plantilla: `FixedAssetService.create` líneas 160-173.
- **Refs**: ADR-006 D-4, CLAUDE.md §AuditLog

---

## LOW-1 — Orden de safeParse Antes de auth() Expone Schema

- **Vector**: AUTHORIZATION
- **Descripción**: `createInvoiceAction` llama `safeParse` antes de `auth()`. Mensajes de error de validación se retornan sin verificar autenticación. Un probe no autenticado puede inferir shape del schema.
- **Fix**: Seguir orden de `createPaymentAction` (`payment.actions.ts` líneas 21-31): `auth()` → `rateLimit` → `safeParse`. Aplicar en todas las nuevas actions de inventario.
- **Refs**: ADR-006 D-5

---

## LOW-2 — movementType Enum No Debe Aceptar Strings Arbitrarios

- **Vector**: INPUT_SANITIZATION_AUDITOR
- **Descripción**: Si el schema usa `z.string()` en lugar de `z.enum(["ENTRADA","SALIDA","AJUSTE"])`, un cliente puede enviar `movementType: "VOID"` u otro string que bypasee guards condicionales en el servicio.
- **Fix**: Usar `z.enum(["ENTRADA", "SALIDA", "AJUSTE"])` o `z.nativeEnum(MovementType)` una vez definido el enum Prisma.
- **Refs**: ADR-006 D-2

---

## INFO-1 — Considerar limiters.inventory para Movimientos Operativos

- **Vector**: RATE_LIMIT
- **Descripción**: `limiters.fiscal` (30/min) cubre mutaciones fiscales. Movimientos de inventario son operativos y podrían requerir mayor frecuencia en contexto de almacén. `generateInventoryJournalAction` es definitivamente fiscal. Considerar `limiters.inventory` (ej. 60/min) para `recordInventoryMovementAction` y `createInventoryItemAction`, mientras `generateInventoryJournalAction` usa `limiters.fiscal`.
- **Decisión para arch-agent**: Si se anticipa integración POS en Fase futura, añadir `limiters.inventory`. Si no, usar `limiters.fiscal` uniformemente. Documentar en ADR-006 D-5 amendment.
- **Refs**: ADR-006 D-5

---

## Pre-Implementation Checklist para el implementador

Cada nueva action de inventario DEBE tener en este orden exacto antes de aprobación:

1. `auth()` → `checkRateLimit(userId, limiters.fiscal)` → `safeParse` → `companyMember findFirst({ where: { companyId, userId }, select: { role: true } })` → `canAccess(member.role, ...)`
2. `recordInventoryMovementAction` y `createInventoryItemAction`: `canAccess` para `[OWNER, ADMIN, ACCOUNTANT, ADMINISTRATIVE]`
3. `generateInventoryJournalAction`: `canAccess(member.role, ROLES.ACCOUNTING)` — ADMINISTRATIVE NO puede alcanzar esta action
4. `updateInventoryItemAction` (cambio de `averageCost`): `canAccess(member.role, ROLES.ACCOUNTING)`
5. Cada lookup de `itemId`: `findFirstOrThrow({ where: { id: itemId, companyId } })` — nunca `findUnique({ where: { id: itemId } })` solo
6. Cada referencia de `accountId`: verificar `account.companyId === companyId` antes de vincular
7. `postMovement` para SALIDA/AJUSTE: `$transaction({ isolationLevel: 'Serializable' })`
8. Guard `FiscalYearCloseService.isFiscalYearClosed` en `movementDate`
9. `tx.auditLog.create` dentro del mismo `$transaction` en toda mutación
10. `withCompanyContext(companyId, tx, ...)` envolviendo todos los writes dentro de la transacción
