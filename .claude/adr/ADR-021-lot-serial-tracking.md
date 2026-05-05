# ADR-021 — Lot/Serial Tracking (Fase 35G)

- **Estado**: DECIDIDO
- **Fecha**: 2026-05-04
- **Fase**: 35G
- **Depende de**: ADR-011 (Inventario + SSI), ADR-018 (UoM múltiples), ADR-002 (Decimal), ADR-003 (onDelete Restrict), ADR-004 (companyId isolation), ADR-006 (Security hardening)

---

## Contexto

ContaFlow necesita rastrear lotes (ej. alimentos con fecha de vencimiento) y números de serie (ej. equipos electrónicos) dentro del módulo de inventario. El modelo `InventoryItem` actual no distingue entre artículos sin tracking, por lote y por serie. `InventoryMovement` tampoco registra contra qué lote o serial específico se operó.

Los modelos `InventoryLot` e `InventorySerial` son nuevos. No hay datos existentes que migrar; los ítems existentes obtienen `trackingType = NONE` por defecto.

---

## Decisiones

### D-1: Enum `TrackingType` y campo `trackingType` en `InventoryItem`

**Decisión**: Agregar enum `TrackingType { NONE LOT SERIAL }` y campo `trackingType TrackingType @default(NONE)` en `InventoryItem`.

**Justificación**: El modelo de discriminación por enum es el único que permite:
- Validar en la capa de servicio que un ítem LOT no acepte operaciones seriales y viceversa.
- Evitar el anti-patrón de tener `lotId` y `serialId` simultáneamente poblados en la misma fila.
- Extensión futura (ej. BATCH) sin migración de datos existentes.

**Inmutabilidad post-POSTED**: El campo `trackingType` es inmutable una vez que existen movimientos con `status = POSTED` para ese ítem. Esta restricción se aplica a nivel de servicio (no DB constraint), con la siguiente lógica en `updateInventoryItem`:

```typescript
// En InventoryItemService.updateTrackingType()
const postedCount = await tx.inventoryMovement.count({
  where: { itemId, status: 'POSTED' }
});
if (postedCount > 0 && newTrackingType !== item.trackingType) {
  throw new BusinessError(
    'No se puede cambiar el tipo de seguimiento: el artículo tiene movimientos contabilizados.'
  );
}
```

Cambiar de `NONE → LOT` cuando solo hay movimientos `DRAFT` o `VOIDED` está permitido, porque esos movimientos no tienen impacto contable y no tienen lotes asociados (nunca se les asignó lote).

---

### D-2: Modelo `InventoryLot`

**Decisión**: `InventoryLot` es scoped por `(companyId, itemId, lotNumber)`. La unicidad incluye `companyId` explícitamente en el constraint — simétrico con `InventorySerial` (ver D-3) y por las mismas razones de defensa en profundidad: error messages de P2002 no deben confirmar la existencia de lotes de otra empresa. El estado del lote se determina por `quantityOnHand` — no hay enum `LotStatus` separado (YAGNI).

**Guard multi-tenant obligatorio** (security-agent CRITICAL-1): todo lookup de `InventoryLot` en `LotTrackingService` DEBE incluir `companyId: movement.companyId` en el `where`, donde `movement.companyId` proviene de la DB (cargado dentro del mismo `$transaction`), nunca del input del cliente.

La relación con `InventoryMovement` usa **tabla intermedia `InventoryMovementLot`** (ver D-4).

```prisma
model InventoryLot {
  id            String    @id @default(cuid())
  companyId     String
  company       Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemId        String
  item          InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  lotNumber     String
  expiresAt     DateTime?  // Opcional — null = sin vencimiento
  quantityOnHand Decimal   @db.Decimal(19, 4) // en unidad base — actualizada en postMovement SSI
  notes         String?
  receivedAt    DateTime   @default(now()) // fecha de recepción física del lote
  createdAt     DateTime   @default(now())
  createdBy     String     // Clerk userId

  movementLines InventoryMovementLot[]

  @@unique([itemId, lotNumber])
  @@index([companyId])
  @@index([companyId, itemId])
  @@index([companyId, itemId, expiresAt]) // para queries FEFO
}
```

**Por qué `quantityOnHand` materializado y no calculado**: El cálculo `SUM(entradas) - SUM(salidas)` sobre `InventoryMovementLot` requiere un full scan del historial de movimientos por lote. Con SSI Serializable cubriendo la actualización, el valor materializado es correcto y O(1).

---

### D-3: Modelo `InventorySerial`

**Decisión**: `InventorySerial` es scoped por `(companyId, itemId, serialNumber)`. La unicidad del número de serie incluye `companyId` explícitamente en el constraint — dos empresas distintas pueden tener el mismo número de serie sin conflicto (sensibilidad fiscal Venezuela: los números de serie pueden estar ligados a importaciones, garantías o fiscalización SENIAT en algunos rubros). `itemId` ya es company-scoped, pero `companyId` en el constraint agrega defensa en profundidad y hace la intención evidente en el schema. El estado usa enum `SerialStatus { AVAILABLE IN_TRANSIT SOLD VOIDED }`.

**Guard multi-tenant obligatorio** (security-agent CRITICAL-1): todo lookup de `InventorySerial` en `SerialTrackingService` DEBE incluir `companyId: movement.companyId` en el `where`, donde `movement.companyId` proviene de la DB, nunca del input del cliente.

**Prohibición absoluta en `createSerials()`** (security-agent HIGH-3): `createSerials()` usa `createMany()` únicamente — nunca `upsert`, nunca `update` de un registro existente. Si un `serialNumber` ya existe en DB para ese `(companyId, itemId)`, el P2002 se captura y se devuelve un error de negocio con el estado actual del serial (`status`): `"El número de serie [X] ya existe con estado [VOIDED|SOLD|...]"`. Bajo ninguna circunstancia se actualiza un serial existente a `status = AVAILABLE` — ese camino está permanentemente cerrado.

**Error messages**: Los errores de `SerialTrackingService` usan códigos opacos — nunca incluyen el valor de `serialNumber` en el mensaje devuelto al cliente (dato sensible — security-agent MEDIUM-3).

La relación con `InventoryMovement` usa **tabla intermedia `InventoryMovementSerial`** (ver D-4).

**Un movimiento ENTRADA de `quantity = N` crea N registros `InventorySerial`** en el mismo `$transaction`. Un movimiento SALIDA de `quantity = M` requiere que el llamador provea exactamente M `serialId`s en el input — el servicio los valida y marca como `SOLD`.

**Un serial VOIDED nunca se reutiliza** (similar a un asiento VOID — no DELETE).

```prisma
enum SerialStatus {
  AVAILABLE   // en stock, listo para venta
  IN_TRANSIT  // movimiento DRAFT asociado — reservado pero no POSTED
  SOLD        // salida POSTED — ya no está en stock
  VOIDED      // el movimiento que lo creó fue anulado
}

model InventorySerial {
  id            String       @id @default(cuid())
  companyId     String
  company       Company      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemId        String
  item          InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  serialNumber  String
  status        SerialStatus @default(AVAILABLE)
  notes         String?
  createdAt     DateTime     @default(now())
  createdBy     String       // Clerk userId
  soldAt        DateTime?    // poblado cuando status → SOLD
  voidedAt      DateTime?    // poblado cuando status → VOIDED

  movementLines InventoryMovementSerial[]

  @@unique([itemId, serialNumber])
  @@index([companyId])
  @@index([companyId, itemId])
  @@index([companyId, itemId, status]) // para queries de disponibilidad
}
```

---

### D-4: Linkeo entre `InventoryMovement` y lotes/seriales

**Decisión: Opción B — Tablas intermedias `InventoryMovementLot` y `InventoryMovementSerial` para ambos tipos.**

**Rechazo de Opción A (FK directa)**: Una SALIDA puede consumir stock de múltiples lotes (ej. necesito 8 unidades, Lote A tiene 5 y Lote B tiene 3). FK directa `lotId?` en `InventoryMovement` solo puede referenciar un lote. Modelo roto para el caso de uso principal.

**Rechazo de Opción C (híbrido)**: Introduce asimetría estructural — entradas usan FK directa, salidas usan tabla intermedia. Un developer leyendo el código necesitaría conocer el `MovementType` para saber qué relación consultar. Viola KISS.

**Opción B** es uniforme para entradas y salidas:
- ENTRADA Lote: crea `InventoryLot` (o encuentra existente por `lotNumber`) + 1 fila `InventoryMovementLot` con la cantidad recibida.
- SALIDA multi-lote: crea N filas `InventoryMovementLot` (una por lote consumido) con la cantidad parcial de cada una.
- ENTRADA Serial: crea M filas `InventorySerial` + M filas `InventoryMovementSerial`.
- SALIDA Serial: el input provee M `serialId`s; se crean M filas `InventoryMovementSerial`.

```prisma
model InventoryMovementLot {
  id          String            @id @default(cuid())
  movementId  String
  movement    InventoryMovement @relation(fields: [movementId], references: [id], onDelete: Restrict)
  lotId       String
  lot         InventoryLot      @relation(fields: [lotId], references: [id], onDelete: Restrict)
  // Cantidad en UNIDAD BASE aplicada a este lote en este movimiento
  quantity    Decimal           @db.Decimal(19, 4)

  @@unique([movementId, lotId])
  @@index([movementId])
  @@index([lotId])
}

model InventoryMovementSerial {
  id          String            @id @default(cuid())
  movementId  String
  movement    InventoryMovement @relation(fields: [movementId], references: [id], onDelete: Restrict)
  serialId    String
  serial      InventorySerial   @relation(fields: [serialId], references: [id], onDelete: Restrict)

  @@unique([movementId, serialId])
  @@index([movementId])
  @@index([serialId])
}
```

**Invariante de integridad**: Para un movimiento con `status = POSTED` y `item.trackingType = LOT`, la suma de `InventoryMovementLot.quantity` donde `movementId = movement.id` DEBE ser igual a `movement.quantity`. Esta invariante es validada en `LotTrackingService.validateLotAllocation()` antes del `postMovement`.

---

### D-5: Nivel de aislamiento para operaciones de lote/serial

**Decisión: SSI Serializable obligatorio para toda operación que modifique `InventoryLot.quantityOnHand` o `InventorySerial.status`.**

**Justificación**: El problema es idéntico al de `InventoryItem.stockQuantity` (ADR-011 D-5). Dos SALIDAs concurrentes del mismo lote pueden ambas leer `quantityOnHand = 5`, ambas decrementar, y el lote queda en -5. SSI detecta el conflicto de escritura y serializa las transacciones — la segunda recibe P2034 (serialization failure), que se captura y re-expone al frontend como botón de reintento (patrón ya establecido en ADR-011).

La transacción de `postMovement` existente ya corre en SSI Serializable. Las operaciones de lot/serial tracking se incluyen **dentro del mismo `$transaction`** — no hay transacción separada.

**Secuencia de operaciones dentro del `$transaction` Serializable al postear un movimiento LOT (SALIDA)**:

```
1. SELECT InventoryItem WHERE id = itemId FOR UPDATE (ya existente — ADR-011)
2. SELECT InventoryLot WHERE id IN [lotIds] FOR UPDATE (nuevo — D-5)
3. Validar que SUM(lotLines.quantity) == movement.quantity
4. Validar que cada lot.quantityOnHand >= lotLine.quantity
5. UPDATE InventoryLot SET quantityOnHand -= lotLine.quantity (por cada lote)
6. UPDATE InventoryItem SET stockQuantity -= movement.quantity, averageCost = CPP
7. CREATE Transaction + JournalEntry (COGS)
8. UPDATE InventoryMovement SET status = POSTED
9. CREATE AuditLog
```

**Captura P2034 obligatoria**: igual que en ADR-011 — mensaje de negocio al frontend, botón de reintento.

**Secuencia de void obligatoria para LOT** (security-agent HIGH-1 — simétrica a la secuencia de post):
```
1. SELECT InventoryMovementLot WHERE movementId = movementId
2. SELECT InventoryLot WHERE id IN [lotIds] FOR UPDATE (dentro del $transaction Serializable)
3. Para cada lote: UPDATE quantityOnHand += lotLine.quantity (revertir el decremento)
4. UPDATE InventoryMovement SET status = VOIDED
5. CREATE Transaction contra-asiento
6. CREATE AuditLog con fefoOverridden (si aplica)
```

**Secuencia de void obligatoria para SERIAL** (security-agent HIGH-1):
```
1. SELECT InventoryMovementSerial WHERE movementId = movementId
2. SELECT InventorySerial WHERE id IN [serialIds] FOR UPDATE
3. Determinar tipo del movimiento original:
   - Si voiding una SALIDA (seriales en SOLD): UPDATE status = AVAILABLE, soldAt = NULL
   - Si voiding una ENTRADA (seriales en AVAILABLE/IN_TRANSIT): UPDATE status = VOIDED, voidedAt = now()
4. UPDATE InventoryMovement SET status = VOIDED
5. CREATE Transaction contra-asiento
6. CREATE AuditLog
```

**Implementación parcial bloqueada** (security-agent HIGH-1): el path de `postMovement` para LOT/SERIAL y el path de `voidPostedMovement` para LOT/SERIAL DEBEN implementarse en la misma sub-fase B. No se puede mergear `postMovement` sin `voidPostedMovement`. Si un ítem tiene `trackingType != NONE` y se llama a `voidPostedMovement` antes de que el void path esté implementado, lanzar `BusinessError("Void de movimientos LOT/SERIAL aún no implementado — contacte soporte")` como guard temporal hasta que ambos estén listos.

---

### D-5b: Límites de array en Zod (security-agent HIGH-2)

Los campos `lotAllocations` y `serialIds` en `PostMovementSchema` llevan límites de array **obligatorios en Zod**:

```typescript
lotAllocations: z.array(
  z.object({
    lotId: z.string().cuid(),
    quantity: z.string().regex(/^\d+(\.\d{1,4})?$/)
      .refine(v => new Decimal(v).greaterThan(new Decimal(0)), { message: "Cantidad debe ser positiva" }),
  })
).max(50).optional(),   // 50 lotes por movimiento es un techo generoso para PYMEs
serialIds: z.array(z.string().cuid()).max(500).optional(),
```

Justificación del límite `max(500)` para seriales: un `postMovement` con N seriales crea N `SELECT FOR UPDATE` + N `UPDATE` dentro del mismo `$transaction Serializable` en Neon. Con timeout de 30s de Neon y throughput estimado de ~1000 rows/s en transacciones cortas, 500 seriales es el techo práctico seguro. Por encima de 500 unidades, el usuario debe dividir en múltiples movimientos.

---

### D-6: Estrategia de selección de lotes en SALIDA (FEFO vs manual)

**Decisión: Opción C — El sistema propone FEFO, el usuario puede hacer override.**

**Justificación**:
- FEFO puro (Opción A) cumple el caso principal (distribuidoras de alimentos) sin trabajo extra del usuario. Es la estrategia fiscalmente más sólida para minimizar vencimientos.
- Override manual (Opción C sobre Opción A) agrega cobertura para casos especiales sin aumentar la complejidad del modelo — el API recibe `lotAllocations?: { lotId: string, quantity: string }[]` opcional.
- Opción B (solo manual) pone la carga operativa en el usuario en cada movimiento, lo que genera errores.

**Implementación**:
```typescript
// En LotTrackingService.resolveLotAllocations()
//   Si el input no provee lotAllocations → algoritmo FEFO automático
//   Si el input provee lotAllocations → usar las provistas, validar que suman = quantity
//
// FEFO: ORDER BY expiresAt ASC NULLS LAST, createdAt ASC
// Los lotes sin fecha de vencimiento se consumen al final (NULLS LAST)
```

La UI presenta la propuesta FEFO prellenada y permite al usuario modificar las cantidades por lote antes de confirmar.

**Audit trail de override FEFO** (security-agent MEDIUM-1): el `AuditLog.newValue` del `postMovement` en ítems LOT incluye `fefoOverridden: boolean`:
- `fefoOverridden: false` → el sistema usó FEFO automático
- `fefoOverridden: true` → el usuario proveyó `lotAllocations` manualmente

Esto no requiere cambio de schema — es un campo adicional en el JSON de `newValue`. Permite detectar en auditoría si un usuario sistemáticamente bypaseó FEFO para diferir consumo de lotes próximos a vencer.

---

### D-7: Restricciones de cambio de `trackingType`

**Política exacta**:

| Estado de movimientos del ítem | Cambio permitido | Acción requerida |
|---|---|---|
| Sin movimientos | Cualquier cambio (`NONE ↔ LOT ↔ SERIAL`) | Libre |
| Solo `DRAFT` o `VOIDED` | `NONE → LOT`, `NONE → SERIAL` | Permitido — no hay impacto contable ni lotes/seriales existentes |
| Solo `DRAFT` o `VOIDED` | `LOT → NONE`, `SERIAL → NONE` | Permitido solo si no existen filas en `InventoryLot`/`InventorySerial` para ese ítem |
| Cualquier movimiento `POSTED` | Cualquier cambio | **BLOQUEADO** — error de negocio |
| Cualquier estado | `LOT ↔ SERIAL` | **BLOQUEADO siempre** — cambio de modalidad de tracking, nunca permitido |

**Regla simplificada para implementación**:
```typescript
// Bloquear si:
// (a) hay al menos 1 movimiento POSTED, o
// (b) newTrackingType != NONE y existen lotes/seriales en DB para ese ítem, o
// (c) se intenta cambiar entre LOT y SERIAL (en cualquier dirección)
```

---

### D-8: Migraciones

Dado que `prisma migrate dev` está roto en Neon (`shadow DB` no soportada), se usan migraciones manuales con el workflow: `db execute` → `migrate resolve --applied` → `prisma generate`.

**Dos migraciones en orden**:

**Migración 1** — `20260504_fase35g_tracking_type`
```sql
-- 1. Enum TrackingType
CREATE TYPE "TrackingType" AS ENUM ('NONE', 'LOT', 'SERIAL');

-- 2. Campo en InventoryItem (con DEFAULT para backfill implícito)
ALTER TABLE "InventoryItem"
  ADD COLUMN "trackingType" "TrackingType" NOT NULL DEFAULT 'NONE';
```
No requiere backfill de datos — el DEFAULT en el ALTER TABLE aplica a todas las filas existentes en la misma operación (PostgreSQL aplica el DEFAULT en DDL, sin UPDATE separado).

**Migración 2** — `20260504_fase35g_lot_serial_models`
```sql
-- SerialStatus enum
CREATE TYPE "SerialStatus" AS ENUM ('AVAILABLE', 'IN_TRANSIT', 'SOLD', 'VOIDED');

-- InventoryLot
CREATE TABLE "InventoryLot" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "lotNumber"      TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3),
  "quantityOnHand" DECIMAL(19,4) NOT NULL,
  "notes"          TEXT,
  "receivedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT NOT NULL,
  CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);
-- companyId explícito: simétrico con InventorySerial — P2002 no revela lotes de otra empresa (security-agent CRITICAL-2)
CREATE UNIQUE INDEX "InventoryLot_companyId_itemId_lotNumber_key" ON "InventoryLot"("companyId", "itemId", "lotNumber");
-- CHECK no-negativo: defensa en profundidad contra bugs de service layer (security-agent MEDIUM-2)
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_quantityOnHand_nonneg" CHECK ("quantityOnHand" >= 0);
CREATE INDEX "InventoryLot_companyId_idx" ON "InventoryLot"("companyId");
CREATE INDEX "InventoryLot_companyId_itemId_idx" ON "InventoryLot"("companyId", "itemId");
CREATE INDEX "InventoryLot_companyId_itemId_expiresAt_idx" ON "InventoryLot"("companyId", "itemId", "expiresAt");
ALTER TABLE "InventoryLot"
  ADD CONSTRAINT "InventoryLot_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLot_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventorySerial
CREATE TABLE "InventorySerial" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "itemId"       TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "status"       "SerialStatus" NOT NULL DEFAULT 'AVAILABLE',
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"    TEXT NOT NULL,
  "soldAt"       TIMESTAMP(3),
  "voidedAt"     TIMESTAMP(3),
  CONSTRAINT "InventorySerial_pkey" PRIMARY KEY ("id")
);
-- companyId explícito en el unique: dos empresas distintas pueden tener el mismo serialNumber (ADR-021 D-3)
CREATE UNIQUE INDEX "InventorySerial_companyId_itemId_serialNumber_key" ON "InventorySerial"("companyId", "itemId", "serialNumber");
CREATE INDEX "InventorySerial_companyId_idx" ON "InventorySerial"("companyId");
CREATE INDEX "InventorySerial_companyId_itemId_idx" ON "InventorySerial"("companyId", "itemId");
CREATE INDEX "InventorySerial_companyId_itemId_status_idx" ON "InventorySerial"("companyId", "itemId", "status");
ALTER TABLE "InventorySerial"
  ADD CONSTRAINT "InventorySerial_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryMovementLot (tabla intermedia)
CREATE TABLE "InventoryMovementLot" (
  "id"         TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "lotId"      TEXT NOT NULL,
  "quantity"   DECIMAL(19,4) NOT NULL,
  CONSTRAINT "InventoryMovementLot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryMovementLot_movementId_lotId_key"
  ON "InventoryMovementLot"("movementId", "lotId");
CREATE INDEX "InventoryMovementLot_movementId_idx" ON "InventoryMovementLot"("movementId");
CREATE INDEX "InventoryMovementLot_lotId_idx" ON "InventoryMovementLot"("lotId");
ALTER TABLE "InventoryMovementLot"
  ADD CONSTRAINT "InventoryMovementLot_movementId_fkey"
    FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovementLot_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryMovementSerial (tabla intermedia)
CREATE TABLE "InventoryMovementSerial" (
  "id"         TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "serialId"   TEXT NOT NULL,
  CONSTRAINT "InventoryMovementSerial_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryMovementSerial_movementId_serialId_key"
  ON "InventoryMovementSerial"("movementId", "serialId");
CREATE INDEX "InventoryMovementSerial_movementId_idx" ON "InventoryMovementSerial"("movementId");
CREATE INDEX "InventoryMovementSerial_serialId_idx" ON "InventoryMovementSerial"("serialId");
ALTER TABLE "InventoryMovementSerial"
  ADD CONSTRAINT "InventoryMovementSerial_movementId_fkey"
    FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovementSerial_serialId_fkey"
    FOREIGN KEY ("serialId") REFERENCES "InventorySerial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**Backfill**: No requerido. Ítems existentes obtienen `trackingType = NONE` (DEFAULT en migración 1). Las tablas `InventoryLot`, `InventorySerial`, `InventoryMovementLot`, `InventoryMovementSerial` arrancan vacías.

**Riesgo de rollback**: Si la migración 2 falla a mitad, las tablas parcialmente creadas se eliminan con `DROP TABLE IF EXISTS` antes de reintentar. La migración 1 puede revertirse con `ALTER TABLE "InventoryItem" DROP COLUMN "trackingType"` + `DROP TYPE "TrackingType"` si no hay datos (arranque limpio).

---

### D-9: Nombre del branch

```
feat/fase-35g-lot-serial-tracking
```

Sigue el patrón `feat/fase-XX-description` del proyecto (ver git log: `feat/fase-35f-uom`, `feat/fase-35i-digital-signing`).

---

## Schema Prisma completo — modelos nuevos

Listo para insertar en `prisma/schema.prisma` después del bloque `InventoryItemUnit`:

```prisma
// ─── Fase 35G: Lot/Serial Tracking — ADR-021 ─────────────────────────────────

enum TrackingType {
  NONE   // sin tracking — comportamiento pre-35G
  LOT    // seguimiento por lote (número de lote + fecha de vencimiento)
  SERIAL // seguimiento por número de serie (1 serial = 1 unidad física)
}

enum SerialStatus {
  AVAILABLE  // en stock, disponible para venta/uso
  IN_TRANSIT // reservado por un movimiento DRAFT (no POSTED aún)
  SOLD       // salida POSTED — ya no está en inventario físico
  VOIDED     // el movimiento de creación fue VOIDED — registro histórico inmutable
}

// Representa un lote recibido de un ítem con trackingType = LOT.
// quantityOnHand: saldo actual en unidad base — actualizado dentro del $transaction
// Serializable de postMovement (ADR-021 D-5).
// Un lote no se elimina aunque su saldo llegue a cero — es registro histórico.
model InventoryLot {
  id             String        @id @default(cuid())
  companyId      String
  company        Company       @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemId         String
  item           InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  lotNumber      String        // número de lote del proveedor — scoped por ítem
  expiresAt      DateTime?     // null = sin fecha de vencimiento
  quantityOnHand Decimal       @db.Decimal(19, 4) // en unidad base — nunca negativo
  notes          String?
  receivedAt     DateTime      @default(now()) // fecha de recepción física
  createdAt      DateTime      @default(now())
  createdBy      String        // Clerk userId

  movementLines InventoryMovementLot[]

  // companyId en el unique: simétrico con InventorySerial — P2002 no debe revelar lotes de otra empresa
  @@unique([companyId, itemId, lotNumber])
  @@index([companyId])
  @@index([companyId, itemId])
  @@index([companyId, itemId, expiresAt]) // queries FEFO: ORDER BY expiresAt ASC NULLS LAST
}

// Tabla intermedia: un movimiento puede consumir/producir stock de múltiples lotes.
// Invariante: SUM(quantity) por movementId == InventoryMovement.quantity para movimientos POSTED.
// onDelete: Restrict en ambas FKs — nunca eliminar un movimiento ni un lote con líneas activas.
model InventoryMovementLot {
  id         String            @id @default(cuid())
  movementId String
  movement   InventoryMovement @relation(fields: [movementId], references: [id], onDelete: Restrict)
  lotId      String
  lot        InventoryLot      @relation(fields: [lotId], references: [id], onDelete: Restrict)
  quantity   Decimal           @db.Decimal(19, 4) // en unidad base — siempre positivo

  @@unique([movementId, lotId])
  @@index([movementId])
  @@index([lotId])
}

// Representa una unidad física identificada por número de serie.
// trackingType = SERIAL: 1 movimiento ENTRADA quantity=N → N registros InventorySerial.
// 1 movimiento SALIDA quantity=M → M seriales existentes deben ser provistos en el input.
// NUNCA eliminar un serial — VOIDED es el estado terminal para anulaciones.
model InventorySerial {
  id           String        @id @default(cuid())
  companyId    String
  company      Company       @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemId       String
  item         InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  serialNumber String        // número de serie del fabricante — scoped por companyId+itemId (ADR-021 D-3)
  status       SerialStatus  @default(AVAILABLE)
  notes        String?
  createdAt    DateTime      @default(now())
  createdBy    String        // Clerk userId
  soldAt       DateTime?     // poblado cuando status → SOLD (postMovement SALIDA)
  voidedAt     DateTime?     // poblado cuando status → VOIDED (voidMovement)

  movementLines InventoryMovementSerial[]

  // companyId explícito en el constraint — dos empresas distintas pueden tener el mismo
  // serialNumber sin conflicto (sensibilidad fiscal Venezuela: series ligadas a importaciones/SENIAT).
  // itemId es ya company-scoped, pero el companyId explícito agrega defensa en profundidad.
  @@unique([companyId, itemId, serialNumber])
  @@index([companyId])
  @@index([companyId, itemId])
  @@index([companyId, itemId, status]) // queries de disponibilidad en formulario SALIDA
}

// Tabla intermedia: un movimiento referencia exactamente los seriales operados.
// ENTRADA: crea los seriales + esta línea en el mismo $transaction.
// SALIDA: el input provee los serialIds; se valida status = AVAILABLE antes de postear.
model InventoryMovementSerial {
  id         String            @id @default(cuid())
  movementId String
  movement   InventoryMovement @relation(fields: [movementId], references: [id], onDelete: Restrict)
  serialId   String
  serial     InventorySerial   @relation(fields: [serialId], references: [id], onDelete: Restrict)

  @@unique([movementId, serialId])
  @@index([movementId])
  @@index([serialId])
}
```

**Campos a agregar en modelos existentes**:

```prisma
// En InventoryItem — agregar después de updatedAt:
trackingType TrackingType @default(NONE)

// Relaciones inversas en InventoryItem:
lots    InventoryLot[]
serials InventorySerial[]

// Relaciones inversas en InventoryMovement:
lotLines    InventoryMovementLot[]
serialLines InventoryMovementSerial[]

// En Company — agregar en el bloque Fase 35G:
inventoryLots    InventoryLot[]
inventorySerials InventorySerial[]
```

---

## Archivos afectados

### Schema y migraciones
- `prisma/schema.prisma` — agregar enums `TrackingType`, `SerialStatus`; agregar campo `trackingType` en `InventoryItem`; agregar modelos `InventoryLot`, `InventoryMovementLot`, `InventorySerial`, `InventoryMovementSerial`; relaciones inversas en `InventoryItem`, `InventoryMovement`, `Company`
- `prisma/migrations/20260504_fase35g_tracking_type/migration.sql` — Migración 1
- `prisma/migrations/20260504_fase35g_lot_serial_models/migration.sql` — Migración 2

### Servicios (a crear)
- `src/modules/inventory/services/LotTrackingService.ts` — `resolveLotAllocations()` (FEFO), `validateLotAllocation()`, `applyLotMovement()`, `voidLotMovement()`
- `src/modules/inventory/services/SerialTrackingService.ts` — `createSerials()`, `validateSerialAvailability()`, `applySerialMovement()`, `voidSerialMovement()`

### Servicios existentes a modificar
- `src/modules/inventory/services/InventoryOperationsService.ts` — `postMovement()` debe despachar a `LotTrackingService` o `SerialTrackingService` según `item.trackingType`; capturar P2034 (ya existe el patrón)
- `src/modules/inventory/services/InventoryItemService.ts` — agregar `updateTrackingType()` con la lógica de inmutabilidad post-POSTED (D-1, D-7)

### Actions a crear/modificar
- `src/modules/inventory/actions/postMovementAction.ts` — agregar campos opcionales `lotAllocations` y `serialIds` en el Zod input schema; verificar `companyMember.role` (ADR-006 D-1); `quantity.max()` obligatorio (ADR-006 D-2); rate limiting `limiters.fiscal` (ADR-006 D-5)

### Tests
- `src/modules/inventory/services/__tests__/LotTrackingService.test.ts`
- `src/modules/inventory/services/__tests__/SerialTrackingService.test.ts`
- `src/modules/inventory/actions/__tests__/postMovementAction.test.ts` — extender tests existentes con casos LOT/SERIAL

---

## SCHEMA_AUDITOR checklist

- [x] Todas las relaciones a tablas contables tienen `onDelete: Restrict`
- [x] `onDelete: Cascade` AUSENTE en tablas contables
- [x] Campos de cantidad usan `Decimal @db.Decimal(19,4)`, no Float
- [x] No hay campos de porcentaje — no aplica `Decimal(5,2)` en estos modelos
- [x] `InventoryLot` e `InventorySerial` no tienen `deletedAt` — **decisión justificada**: son registros históricos inmutables. El cierre de un lote se expresa por `quantityOnHand = 0`; la anulación de un serial por `status = VOIDED`. No hay operación de "borrar un lote o serial" en el dominio fiscal.
- [x] No aplica `idempotencyKey` en `InventoryLot`/`InventorySerial` directamente — la idempotencia está en `InventoryMovement.idempotencyKey` (ya existente). Si el `postMovement` se reintenta con el mismo `idempotencyKey`, la transacción completa (incluyendo lotes/seriales) es idempotente por el guard en `InventoryOperationsService`.
- [x] Unicidad de negocio: `@@unique([itemId, lotNumber])`, `@@unique([itemId, serialNumber])` — scoped por ítem, no solo por campo
- [x] Indexes en FKs frecuentes: `companyId`, `itemId`, `movementId`, `lotId`, `serialId` — todos indexados
- [x] `AuditLog` en el mismo `$transaction` que la mutación — obligatorio en `postMovement`, `voidMovement`, `updateTrackingType`
- [x] `AuditLog.newValue` incluye `fefoOverridden: boolean` para movimientos LOT — trazabilidad de bypass FEFO (security-agent MEDIUM-1)
- [x] `InventoryLot.quantityOnHand` tiene `CHECK >= 0` en DB (security-agent MEDIUM-2)
- [x] Todo lookup de `InventoryLot`/`InventorySerial` en servicios incluye `companyId: movement.companyId` desde DB (security-agent CRITICAL-1)
- [x] `@@unique([companyId, itemId, lotNumber])` en `InventoryLot` — simétrico con `InventorySerial` (security-agent CRITICAL-2)
- [x] `createSerials()` usa solo `createMany()` — prohibido `upsert` o actualizar registros existentes (security-agent HIGH-3)
- [x] `serialIds.max(500)` y `lotAllocations.max(50)` en Zod — enforcement en schema layer (security-agent HIGH-2)
- [x] void path para LOT/SERIAL implementado en la misma sub-fase que post path — sin implementación parcial (security-agent HIGH-1)
- [x] Error messages de `SerialTrackingService` no contienen valores de `serialNumber` — códigos opacos (security-agent MEDIUM-3)
- [x] Análisis de riesgo de migración documentado (D-8)
- [x] Acciones destructivas verifican `companyMember.role` (ADR-006 D-1) — mandatorio en `postMovementAction`
- [x] Campos `quantity` en Zod input tienen `.max()` (ADR-006 D-2) — mandatorio en schema Zod de `postMovementAction`
- [x] No se aceptan tasas impositivas del cliente (ADR-006 D-3) — no aplica a este módulo
- [x] `AuditLog` es append-only — no `auditLog.update/delete` en ningún service nuevo (ADR-006 D-4)
- [x] Mutaciones financieras con rate limiting (ADR-006 D-5) — `limiters.fiscal` en `postMovementAction`

---

## Consecuencias

### Positivas
- El módulo de inventario pasa a soportar trazabilidad completa de lotes (distribuidoras, farmacéuticas) y series (equipos, electrónica).
- FEFO automático con override manual minimiza errores operativos y vencimientos no detectados.
- Las tablas intermedias `InventoryMovementLot`/`InventoryMovementSerial` permiten auditar exactamente qué lote o serial fue afectado en cada movimiento, cumpliendo trazabilidad fiscal.
- `InventoryItem.trackingType = NONE` preserva compatibilidad total con todos los ítems existentes — cero regresión.
- El patrón SSI + P2034 reintento ya está implementado; extenderlo a lotes/seriales no requiere nueva infraestructura de concurrencia.

### Restricciones y riesgos
- El formulario de movimiento SALIDA para ítems SERIAL requiere que el usuario seleccione seriales específicos — introduce fricción UX. Mitigado con búsqueda y selección rápida en la UI (fuera del scope de este ADR).
- `postMovement` con N seriales crea N inserts en `InventorySerial` dentro del mismo `$transaction` Serializable. Para lotes grandes (>500 unidades por movimiento), esto puede acercarse al timeout de Neon (30s). Recomendación: validar en Zod `serialIds.max(500)` e informar al usuario que lotes mayores requieren múltiples movimientos.
- `trackingType` no tiene constraint DB de inmutabilidad — depende del service layer. Si alguien usa Prisma directamente (migraciones, seed scripts), puede cambiar el campo sin pasar por la validación. Documentado como riesgo conocido; aceptable porque el acceso directo a DB está restringido a operaciones de mantenimiento.
- La invariante `SUM(movementLines.quantity) == movement.quantity` para lotes POSTED no tiene CHECK constraint en DB — se valida solo en `LotTrackingService.validateLotAllocation()`. Un fallo en esa capa resultaría en inconsistencia silenciosa. Mitigado con tests que cubren el invariante explícitamente.

---

## Requisito pre-implementación: security-agent

**Obligatorio por CLAUDE.md**: nueva Server Action (`postMovementAction` extendida), nuevos modelos Prisma con datos sensibles (`InventorySerial.serialNumber`), nuevas rutas de mutación → security-agent DEBE auditar la superficie de ataque antes de aplicar cualquier migración.

**Surface a auditar**:
1. `postMovementAction` — nuevos campos `lotAllocations` y `serialIds` en input Zod → riesgo de inyección de IDs cross-company
2. `InventorySerial.serialNumber` — dato sensible en contexto fiscal venezolano
3. `LotTrackingService.resolveLotAllocations()` — lógica FEFO con override → riesgo de manipulación de allocations para extraer de lotes incorrectos
4. Guard multi-tenant en todo acceso a `InventoryLot`/`InventorySerial`: `companyId` debe validarse siempre desde la sesión Clerk, nunca del input del cliente
5. `SerialStatus` transitions — verificar que un serial `SOLD` o `VOIDED` no pueda ser reusado en una ENTRADA

**Estado**: ✅ completado — 2 CRITICAL + 3 HIGH resueltos en este ADR. 4 MEDIUM + 1 LOW resueltos en checklist y D-5b/D-6. Ver findings detallados en el reporte del security-agent (sesión 2026-05-04).
