# ADR-011 — Módulo Inventario (Fase 28D)

**Status**: DECIDED
**Date**: 2026-04-13
**Deciders**: arch-agent
**Branch**: feat/fase-28d-inventario

---

## Contexto

Fase 28D agrega el Módulo Inventario a ContaFlow. El rol ADMINISTRATIVE (Fase 28A) necesita una superficie operativa real. El ACCOUNTANT requiere asientos automáticos de consumo compatibles con VEN-NIF 2 y el entorno hiperinflacionario venezolano.

---

## Decision 1 — Schema Prisma

### Nuevos enums

```prisma
enum MovementType {
  ENTRADA    // compra, recepción de producción, ajuste positivo
  SALIDA     // venta, consumo, ajuste negativo
  AJUSTE     // corrección administrativa — requiere motivo
}

enum MovementStatus {
  DRAFT      // registrado sin asiento — solo ADMINISTRATIVE puede ver
  POSTED     // asiento generado y contabilizado — ACCOUNTANT aprobó
  VOIDED     // anulado con contrapartida — NUNCA DELETE
}
```

### InventoryItem

```prisma
model InventoryItem {
  id              String    @id @default(cuid())
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)
  sku             String
  name            String
  description     String?
  unit            String                              // "unidad", "kg", "litro", etc.
  averageCost     Decimal   @db.Decimal(19, 4) @default(0)   // CPP vigente
  stockQuantity   Decimal   @db.Decimal(19, 4) @default(0)   // unidades en existencia
  accountId       String?
  account         Account?  @relation(fields: [accountId], references: [id], onDelete: Restrict)
  cogsAccountId   String?
  cogsAccount     Account?  @relation("CogsAccount", fields: [cogsAccountId], references: [id], onDelete: Restrict)
  deletedAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  createdBy       String
  movements       InventoryMovement[]

  @@unique([companyId, sku])
  @@index([companyId])
  @@index([companyId, deletedAt])
}
```

### InventoryMovement

```prisma
model InventoryMovement {
  id              String          @id @default(cuid())
  companyId       String
  company         Company         @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemId          String
  item            InventoryItem   @relation(fields: [itemId], references: [id], onDelete: Restrict)
  type            MovementType
  status          MovementStatus  @default(DRAFT)
  quantity        Decimal         @db.Decimal(19, 4)   // siempre positivo
  unitCost        Decimal         @db.Decimal(19, 4)   // CPP snapshot al momento del movimiento
  totalCost       Decimal         @db.Decimal(19, 4)   // quantity × unitCost — almacenado, no calculado en consulta
  invoiceId       String?
  invoice         Invoice?        @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  transactionId   String?         @unique
  transaction     Transaction?    @relation(fields: [transactionId], references: [id], onDelete: Restrict)
  reference       String?
  notes           String?
  date            DateTime
  idempotencyKey  String          @unique
  createdAt       DateTime        @default(now())
  createdBy       String
  postedAt        DateTime?
  postedBy        String?

  @@index([companyId])
  @@index([companyId, itemId])
  @@index([companyId, status])
  @@index([companyId, date])
  @@index([invoiceId])
  @@index([transactionId])
}
```

### Relaciones inversas en modelos existentes (adiciones mínimas)

- `Company`: `inventoryItems InventoryItem[]` + `inventoryMovements InventoryMovement[]`
- `Transaction`: `inventoryMovement InventoryMovement?`
- `Invoice`: `inventoryMovements InventoryMovement[]`
- `Account`: `inventoryItems InventoryItem[]` + `inventoryItemsAsCogs InventoryItem[] @relation("CogsAccount")`

**Migration name**: `add_inventory_module`

### SCHEMA_AUDITOR checklist

- [x] `onDelete: Restrict` en todas las relaciones a tablas contables
- [x] `onDelete: Cascade` ausente
- [x] Todos los campos monetarios: `Decimal @db.Decimal(19,4)` — sin Float
- [x] `InventoryItem` tiene `deletedAt DateTime?`
- [x] `InventoryMovement` tiene `idempotencyKey String @unique`
- [x] `@@unique([companyId, sku])` — no `@@unique([sku])`
- [x] Índices en `companyId`, `itemId`, `invoiceId`, `transactionId`, `status`, `date`
- [x] AuditLog obligatorio dentro del mismo `$transaction`
- [x] `createMovementAction` y `postMovementAction` usan rate limiting

---

## Decision 2 — Método de Valoración: CPP (Costo Promedio Ponderado)

**PEPS bloqueado por YAGNI.** No existe requerimiento contractual en `contaflow-contract.md`.

| Criterio | PEPS | CPP |
|---|---|---|
| VEN-NIF 2 compliance | Permitido | Permitido |
| Entorno hiperinflacionario | Subestima COGS (costos viejos más baratos) | Distribuye impacto uniformemente |
| Complejidad de schema | Requiere `InventoryBatch` + dequeue FIFO | Un campo `averageCost` en `InventoryItem` |
| Complejidad de servicio | O(n lotes) por egreso | O(1) por egreso |

**Fórmula CPP** (aplicada en cada ENTRADA, dentro de transacción Serializable):

```
nuevo_averageCost = (stockQuantity × averageCost + quantity × unitCost)
                    ÷ (stockQuantity + quantity)
```

En SALIDA: `unitCost` del movimiento se toma de `InventoryItem.averageCost` al momento de la transacción — el cliente NO lo suministra. `InventoryMovement.unitCost` es un snapshot inmutable para trazabilidad histórica.

---

## Decision 3 — Asiento Automático al Consumo (SALIDA)

**Asiento generado:**
```
Débito:  cogsAccountId  (EXPENSE — Costo de Ventas / Costo de Producción)
Crédito: accountId      (ASSET  — Inventario)
Monto:   quantity × unitCost (CPP snapshot)
```

**Serializable es obligatorio.** Dos razones concurrentes:

1. El recálculo CPP lee `(stockQuantity, averageCost)` y escribe ambos. Read Committed no detecta que otra transacción concurrente escribió esos campos entre la lectura y la escritura — el promedio resultante sería silenciosamente erróneo.
2. Dos SALIDAs concurrentes de quantity=5 sobre stock=6 pueden ambas pasar el guard `stockQuantity >= quantity` bajo Read Committed (ambas leen 6 > 5) y ambas decrementar, dejando stock=-4. SSI Serializable detecta la dependencia rw y aborta una con P2034.

**Manejo de P2034**: el servicio captura P2034 y retorna `{ success: false, error: 'Conflicto de concurrencia — reintente la operación' }`. El frontend muestra el error con un botón de reintento. Sin retry automático en servidor.

**Vinculación Movimiento ↔ Transacción**: `InventoryMovement.transactionId` es `@unique` y null hasta POSTED. La relación 1:1 es enforced por el unique constraint.

### Máquina de estados

```
DRAFT → POSTED  (ACCOUNTANT ejecuta postMovementAction)
DRAFT → VOIDED  (ADMINISTRATIVE cancela antes de aprobación)
POSTED → VOIDED (ACCOUNTANT anula — genera un segundo Transaction con entradas revertidas
                 y un segundo InventoryMovement de tipo AJUSTE referenciando el original)
```

---

## Decision 4 — Arquitectura de Servicios: Dos servicios separados

```
src/modules/inventory/
  schemas/
    inventory-item.schema.ts
    inventory-movement.schema.ts
  services/
    InventoryOperationsService.ts    ← dominio ADMINISTRATIVE
    InventoryAccountingService.ts    ← dominio ACCOUNTANT
  actions/
    inventory-operations.actions.ts
    inventory-accounting.actions.ts
  components/
  __tests__/
```

Un servicio único con métodos diferenciados por rol viola SOLID-S y obliga a la capa de servicio a conocer el contexto del rol del llamador. Los dos servicios se comunican únicamente a través de transiciones de estado en `InventoryMovement` — nunca mediante importación directa (DDD).

### Matriz de autorización (ADR-006 D-1)

| Acción | Rol mínimo |
|---|---|
| `createItemAction` | ADMINISTRATIVE |
| `updateItemAction` | ADMINISTRATIVE |
| `softDeleteItemAction` | ADMIN |
| `createMovementAction` (→ DRAFT) | ADMINISTRATIVE |
| `voidDraftMovementAction` | ADMINISTRATIVE |
| `postMovementAction` (DRAFT → POSTED) | ACCOUNTANT |
| `voidPostedMovementAction` (POSTED → VOIDED) | ACCOUNTANT |
| `getInventoryValuationAction` | ACCOUNTANT, ADMINISTRATIVE |

### Ceilings Zod (ADR-006 D-2)

```typescript
// inventory-movement.schema.ts
const CreateMovementSchema = z.object({
  companyId:      z.string().cuid(),
  itemId:         z.string().cuid(),
  type:           z.enum(['ENTRADA', 'SALIDA', 'AJUSTE']),
  quantity:       z.number().positive().max(1_000_000),
  unitCost:       z.number().nonnegative().max(9_999_999_999),  // ignorado por servicio en SALIDA
  invoiceId:      z.string().cuid().optional(),
  reference:      z.string().max(100).optional(),
  notes:          z.string().max(500).optional(),
  date:           z.string().datetime(),
  idempotencyKey: z.string().uuid(),
})
```

`unitCost` en SALIDA es ignorado del input del cliente — el servicio siempre lee `InventoryItem.averageCost` al momento de la transacción.

**Rate limiting**: `createMovementAction` y `postMovementAction` usan `limiters.fiscal` (30/min).

---

## Decision 5 — Concurrencia

**Serializable SSI obligatorio para todas las mutaciones de stock.**

| Operación | Isolation | Razón |
|---|---|---|
| `createItem` / `updateItem` | Read Committed | Solo metadata — sin cálculo financiero |
| `createMovement` (→ DRAFT) | Read Committed | Solo registro — stock no se actualiza |
| `postMovement` (DRAFT → POSTED) | **Serializable** | Actualiza `averageCost`, `stockQuantity`, crea `Transaction` |
| `voidPostedMovement` | **Serializable** | Revierte stock + crea contra-asiento atómicamente |
| `getInventoryValuation` | Read Committed | Solo lectura |

Optimistic locking con `version: Int` fue considerado y rechazado: Prisma no expone `rowsAffected` idiomáticamente en upserts, el patrón es más frágil que SSI, y LL-005 confirma que SSI es el patrón canónico para Neon + PgBouncer en modo transacción.

---

## Decision 6 — Branch

**Branch nuevo**: `feat/fase-28d-inventario`

`feat/fase-28a-roles-schema` ya fue mergeado a main. Un branch nuevo provee aislamiento de phase gate.

---

## Consecuencias

**Positivas:**
- CPP minimiza complejidad de schema y servicio — correcto para el contexto inflacionario venezolano.
- SSI Serializable elimina race conditions sin advisory locks (compatible con Neon per LL-005).
- Separación en dos servicios respeta DDD y SOLID-S.
- `InventoryLocation` bloqueado por YAGNI — añadible en Fase 28E si se firma contrato.
- `idempotencyKey` en `InventoryMovement` previene movimientos duplicados por resubmisión de formularios.

**Restricciones / Riesgos:**
- Serializable puede causar P2034 bajo alta carga concurrente. Aceptable para el mercado objetivo (PyMEs venezolanas).
- Si PEPS es requerido en el futuro, se debe añadir `InventoryBatch` con migración de backfill — debe contratarse en `contaflow-contract.md` antes de implementar.
- `InventoryItem.accountId` es opcional — `postMovementAction` debe validar que tanto `accountId` como `cogsAccountId` estén seteados antes de intentar el asiento, retornando un error descriptivo si falta alguno.
