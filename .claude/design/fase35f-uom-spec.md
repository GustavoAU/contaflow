# Fase 35F — Unidades de Medida Múltiples (UoM) para Inventario

**Estado:** PENDIENTE DE APROBACION  
**Fecha:** 2026-04-29  
**Autor:** Software Architect — ContaFlow  
**Pre-flight check:** Completado (ver sección 5)

---

## Pre-flight check interno

1. **ACCOUNTING IMPACT**: CPP (Costo Promedio Ponderado) es el método de valoración de inventario
   vigente. Introducir UoM cambia la unidad en la que se expresan `quantity` y `averageCost`.
   Todo el stock en DB debe estar en **unidad base**. Los asientos contables no cambian en
   estructura — solo cambia el insumo (cantidad ya convertida a unidad base × costo unitario base).
   Impacto: moderado. `onDelete: Restrict` obligatorio. AuditLog requerido. Serializable sigue siendo
   obligatorio en `postMovement`.

2. **ADRs**: ADR-001 (Serializable correlativos), ADR-002 (Decimal), ADR-003 (onDelete Restrict),
   ADR-004 (companyId en findMany). Ninguno cubre UoM directamente. Se requiere **ADR-018**.

3. **LESSONS LEARNED**: No hay lección documentada sobre UoM. Patrón nuevo.

4. **BEST PRACTICES**: Decimal obligatorio para factores de conversión (R-5). onDelete: Restrict
   sobre tablas contables (ADR-003). Soft delete en entidad con impacto en integridad histórica.

5. **RISK ANALYSIS**: Ver sección 6.

6. **SECURITY IMPACT**: No hay acción destructiva nueva en esta fase. Los campos de factor de
   conversión son internos (no input directo del cliente sobre tasas). Se requiere guard de
   companyId en toda query sobre `InventoryItemUnit`.

---

## 1. Schema Prisma propuesto para `InventoryItemUnit`

### Modelo nuevo: `InventoryItemUnit`

```prisma
// ─── Fase 35F: Unidades de Medida Múltiples (UoM) ────────────────────────────
// Una unidad base por ítem (isBase = true). El stock y el CPP se mantienen
// SIEMPRE en unidad base. Los movimientos pueden registrarse en cualquier
// unidad configurada; la conversión ocurre en el service layer antes de
// modificar stockQuantity/averageCost.

model InventoryItemUnit {
  id             String        @id @default(cuid())
  companyId      String
  company        Company       @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemId         String
  item           InventoryItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  name           String        // "Caja", "Unidad", "Kg", "Litro"
  abbreviation   String        // "CJ", "UN", "KG", "L" — máximo 10 chars
  // Factor: cuántas unidades BASE equivale 1 de ESTA unidad.
  // Unidad base: conversionFactor = 1.0000000000 exactamente.
  // Ejemplo: 1 Caja = 12 Unidades → conversionFactor = 12.0000000000
  // NUNCA Float — ADR-002 / R-5.
  conversionFactor Decimal     @db.Decimal(19, 10)
  isBase         Boolean       @default(false)
  // Soft delete: no eliminar si hay movimientos históricos en esta unidad.
  deletedAt      DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  createdBy      String

  movements      InventoryMovement[]

  // Solo una unidad base por ítem.
  // La combinación (itemId, name) también debe ser única para evitar
  // duplicar "Caja" con factores distintos.
  @@unique([itemId, isBase], map: "uq_inventory_item_unit_base")
  @@unique([itemId, name])
  @@index([companyId])
  @@index([itemId])
}
```

**Nota sobre `@@unique([itemId, isBase])`**: PostgreSQL permite múltiples NULLs en un unique
index, pero `isBase` es Boolean (no nullable), por lo que este constraint solo permite una fila
con `isBase = true` por ítem — comportamiento exactamente deseado.

### Cambios en `InventoryItem`

```prisma
model InventoryItem {
  // ... campos existentes sin cambio ...

  // CAMPO ELIMINADO:
  // unit  String   ← reemplazado por la relación a InventoryItemUnit

  // CAMPO NUEVO — denormalización calculada para evitar JOIN en cada query:
  baseUnitName   String   @default("unidad")  // sync desde InventoryItemUnit.name donde isBase = true
  baseUnitAbbr   String   @default("UN")      // sync desde InventoryItemUnit.abbreviation

  // CAMPO NUEVO — unidad base FK opcional para queries directas:
  baseUnitId     String?
  baseUnit       InventoryItemUnit? @relation("ItemBaseUnit", fields: [baseUnitId], references: [id], onDelete: Restrict)

  // RELACION NUEVA:
  units          InventoryItemUnit[]

  // stockQuantity y averageCost: SIN CAMBIO.
  // Siguen expresando stock y costo en UNIDAD BASE.
}
```

**Advertencia de diseño**: La desnormalización `baseUnitName`/`baseUnitAbbr` se usa solo para
display en listas y reportes sin JOIN adicional. El service layer es responsable de mantenerlos
sincronizados al crear/actualizar la unidad base. Es un tradeoff aceptable dado que la unidad
base raramente cambia de nombre.

### Cambios en `InventoryMovement`

```prisma
model InventoryMovement {
  // ... campos existentes ...

  // CAMPOS NUEVOS — capturan la unidad en que se registró el movimiento:
  unitId              String?
  unit                InventoryItemUnit? @relation(fields: [unitId], references: [id], onDelete: Restrict)
  // Cantidad en la unidad del movimiento (la que el usuario ingresó).
  // Si unitId es NULL o la unidad es base, quantityInUnit == quantity.
  quantityInUnit      Decimal            @db.Decimal(19, 4)
  // Factor snapshot al momento del movimiento — inmutable por auditoría.
  conversionSnapshot  Decimal            @db.Decimal(19, 10)

  // CAMPO EXISTENTE — SIN CAMBIO SEMÁNTICO:
  // quantity   Decimal  @db.Decimal(19, 4)
  // Sigue representando la cantidad en UNIDAD BASE.
  // quantity = quantityInUnit × conversionSnapshot
}
```

### Estrategia de migración para datos existentes

El campo `unit String` actual en `InventoryItem` tiene contenido de texto libre ("unidad", "kg",
"litros", etc.). La migración es de dos fases:

**Fase de migración A — schema-only (sin romper producción):**

```sql
-- 1. Crear tabla InventoryItemUnit
CREATE TABLE "InventoryItemUnit" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "itemId"           TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "abbreviation"     TEXT NOT NULL,
  "conversionFactor" DECIMAL(19,10) NOT NULL,
  "isBase"           BOOLEAN NOT NULL DEFAULT false,
  "deletedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "createdBy"        TEXT NOT NULL,
  CONSTRAINT "InventoryItemUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_inventory_item_unit_base" ON "InventoryItemUnit"("itemId", "isBase")
  WHERE "isBase" = true;
CREATE UNIQUE INDEX "InventoryItemUnit_itemId_name_key" ON "InventoryItemUnit"("itemId", "name");
CREATE INDEX "InventoryItemUnit_companyId_idx" ON "InventoryItemUnit"("companyId");
CREATE INDEX "InventoryItemUnit_itemId_idx" ON "InventoryItemUnit"("itemId");

ALTER TABLE "InventoryItemUnit"
  ADD CONSTRAINT "InventoryItemUnit_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryItemUnit_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Agregar columnas nuevas en InventoryItem (nullable inicialmente)
ALTER TABLE "InventoryItem"
  ADD COLUMN "baseUnitName" TEXT,
  ADD COLUMN "baseUnitAbbr" TEXT,
  ADD COLUMN "baseUnitId"   TEXT;

-- 3. Agregar columnas nuevas en InventoryMovement (nullable inicialmente)
ALTER TABLE "InventoryMovement"
  ADD COLUMN "unitId"             TEXT,
  ADD COLUMN "quantityInUnit"     DECIMAL(19,4),
  ADD COLUMN "conversionSnapshot" DECIMAL(19,10);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "InventoryItemUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

**Fase de migración B — backfill de datos existentes (script one-shot):**

```sql
-- Por cada InventoryItem existente, crear una InventoryItemUnit base usando
-- el valor actual de InventoryItem.unit como nombre.
INSERT INTO "InventoryItemUnit" ("id", "companyId", "itemId", "name", "abbreviation",
                                  "conversionFactor", "isBase", "createdAt", "updatedAt", "createdBy")
SELECT
  gen_random_uuid()::text,
  i."companyId",
  i."id",
  COALESCE(i."unit", 'unidad'),
  UPPER(LEFT(COALESCE(i."unit", 'UN'), 10)),
  1.0000000000,
  true,
  NOW(),
  NOW(),
  'SYSTEM_MIGRATION'
FROM "InventoryItem" i
WHERE NOT EXISTS (
  SELECT 1 FROM "InventoryItemUnit" u WHERE u."itemId" = i."id" AND u."isBase" = true
);

-- Sync baseUnitName / baseUnitAbbr en InventoryItem
UPDATE "InventoryItem" i
SET
  "baseUnitName" = u."name",
  "baseUnitAbbr" = u."abbreviation",
  "baseUnitId"   = u."id"
FROM "InventoryItemUnit" u
WHERE u."itemId" = i."id" AND u."isBase" = true;

-- Backfill en movimientos existentes: todos estaban en unidad base
UPDATE "InventoryMovement"
SET
  "quantityInUnit"     = "quantity",
  "conversionSnapshot" = 1.0000000000
WHERE "quantityInUnit" IS NULL;
```

**Fase de migración C — NOT NULL constraints post-backfill:**

```sql
ALTER TABLE "InventoryItem"
  ALTER COLUMN "baseUnitName" SET NOT NULL,
  ALTER COLUMN "baseUnitAbbr" SET NOT NULL;

ALTER TABLE "InventoryMovement"
  ALTER COLUMN "quantityInUnit"     SET NOT NULL,
  ALTER COLUMN "conversionSnapshot" SET NOT NULL;

-- CAMPO ELIMINADO (después de confirmar que ningún servicio lo lee):
-- ALTER TABLE "InventoryItem" DROP COLUMN "unit";
-- Recomendado: mantener "unit" como deprecated nullable en la primera
-- versión desplegada, eliminarlo en Fase 35G o siguiente cleanup.
```

**Nombre de migración sugerido:** `20260430_fase35f_uom_inventory_item_unit`

---

## 2. Cambios en modelos existentes

### `InventoryItem` — campos afectados

| Campo | Acción | Notas |
|-------|--------|-------|
| `unit String` | Deprecar → nullable → eliminar en cleanup | No eliminar hasta que backfill complete |
| `baseUnitName String` | AGREGAR `@default("unidad")` | Denorm display |
| `baseUnitAbbr String` | AGREGAR `@default("UN")` | Denorm display |
| `baseUnitId String?` | AGREGAR | FK a unidad base |
| `units InventoryItemUnit[]` | AGREGAR relación | Lista de todas las unidades |

### `InventoryMovement` — campos afectados

| Campo | Acción | Notas |
|-------|--------|-------|
| `unitId String?` | AGREGAR | FK a unidad usada en este movimiento |
| `quantityInUnit Decimal` | AGREGAR `@db.Decimal(19,4)` | Cantidad en unidad del proveedor/usuario |
| `conversionSnapshot Decimal` | AGREGAR `@db.Decimal(19,10)` | Factor inmutable al momento del movimiento |

`quantity` existente **no cambia semántica**: siempre es cantidad en unidad base.

### `Company` — campo nuevo necesario

```prisma
inventoryItemUnits  InventoryItemUnit[]
```

### Archivos Zod schema afectados

| Archivo | Cambio requerido |
|---------|-----------------|
| `src/modules/inventory/schemas/inventory-item.schema.ts` | Eliminar `unit: z.string()` de `CreateInventoryItemInput`; agregar `units: z.array(UomUnitInput).min(1)` con validación de exactamente un `isBase: true` |
| `src/modules/inventory/schemas/inventory-movement.schema.ts` | Agregar `unitId: z.string().cuid().optional()` en `CreateMovementInput`; agregar `quantityInUnit: z.number().positive()` |

**Schema nuevo requerido:**

`src/modules/inventory/schemas/inventory-item-unit.schema.ts`

```typescript
// Zod 4 — usar { error: "msg" } no errorMap
export const UomUnitInput = z.object({
  name:             z.string().min(1).max(50),
  abbreviation:     z.string().min(1).max(10),
  conversionFactor: z.string().regex(/^\d+(\.\d+)?$/, { error: "Factor debe ser número positivo" }),
  isBase:           z.boolean(),
});

export const CreateInventoryItemUnitInput = z.object({
  companyId:       z.string().cuid(),
  itemId:          z.string().cuid(),
  name:            z.string().min(1).max(50),
  abbreviation:    z.string().min(1).max(10),
  conversionFactor: z.string().regex(/^\d+(\.\d+)?$/, { error: "Factor debe ser número positivo" }),
});
// conversionFactor se recibe como string y se convierte a Decimal en el service.
// Nunca como number nativo — R-5.
```

**Por qué `conversionFactor` como `string` en Zod**: evitar que el runtime de JavaScript
pierda precisión en factores como `0.333333333333`. El service lo convierte con `new Decimal(input.conversionFactor)`.

### Tipos TypeScript exportados afectados

- `src/modules/inventory/types/index.ts` (si existe): agregar `InventoryItemUnitWithItem` y `MovementWithUnit`.
- Los tipos generados por Prisma (`InventoryItem`, `InventoryMovement`) se actualizan automáticamente tras `prisma generate`.

---

## 3. Impacto en servicios

### 3.1 `InventoryOperationsService` — `createDraftMovement()`

**Flujo actual:**
1. Valida ownership del ítem.
2. Calcula `resolvedUnitCost` = CPP actual del ítem para SALIDA.
3. Valida stock suficiente comparando `item.stockQuantity` con `quantity`.
4. Persiste `quantity` como ingresado.

**Flujo con UoM:**

```
Si unitId proporcionado:
  1. Cargar InventoryItemUnit (con companyId guard).
  2. Verificar que no tiene deletedAt.
  3. factor = new Decimal(unit.conversionFactor)
  4. quantityInUnit = new Decimal(input.quantity)
  5. quantityBase   = quantityInUnit.mul(factor)   ← stock se actualiza en base
Else (unitId ausente = unidad base implícita):
  1. Cargar baseUnit del ítem para obtener factor = 1
  2. quantityInUnit = quantityBase = new Decimal(input.quantity)
  3. factor = new Decimal(1)

Validación stock SALIDA: item.stockQuantity >= quantityBase  ← en base, no en input
```

**Signatura interna nueva** (no exportada, solo interna al service):

```typescript
// Devuelve { quantityBase, quantityInUnit, conversionSnapshot, unitId }
async function resolveQuantity(
  input: { quantity: number | string; unitId?: string },
  item: InventoryItem & { units: InventoryItemUnit[] },
): Promise<ResolvedQuantity>
```

**Persistencia del movimiento** — campos adicionales:

```typescript
data: {
  // existentes
  quantity:           quantityBase,              // UNIDAD BASE — sin cambio semántico
  unitCost:           resolvedUnitCost,           // costo por UNIDAD BASE
  totalCost:          resolvedUnitCost.mul(quantityBase),
  // nuevos
  unitId:             resolvedUnit.id ?? null,
  quantityInUnit:     quantityInUnit,
  conversionSnapshot: conversionSnapshot,
}
```

### 3.2 `InventoryAccountingService` — `postMovement()`

**El CPP no cambia de fórmula** — solo cambia que los inputs ya son en unidad base:

```typescript
// CPP con UoM — ANTES y DESPUÉS del cambio:
// qty = movement.quantity  ← SIEMPRE en unidad base (el service ops ya convirtió)
// unitCostSnapshot = movement.unitCost  ← costo por unidad BASE

// ENTRADA
// Si entra 1 Caja a Bs. 120, factor = 12 UN/CJ:
//   quantityBase      = 1 × 12 = 12 UN
//   unitCostBase      = 120 / 12 = Bs. 10 / UN
//   totalCost         = 12 × 10 = Bs. 120  ✓
//   nuevo CPP         = (stockActual × avgActual + 12 × 10) / (stockActual + 12)

// El service de operaciones calcula unitCostBase en createDraftMovement:
//   unitCostBase = new Decimal(inputUnitCost).div(factor)
// El service de contabilidad solo lee movement.unitCost ya en base — SIN CAMBIO.
```

**Implicación crítica**: `createDraftMovement` debe recibir `unitCost` como costo por la unidad
de entrada (Bs./Caja), no por la unidad base. La conversión a costo-base ocurre allí:

```typescript
// En InventoryOperationsService.createDraftMovement()
const unitCostInput = new Decimal(unitCost ?? 0);  // Bs. por unidad-proveedor
const unitCostBase  = unitCostInput.div(factor);   // Bs. por unidad-base  (R-5: Decimal)
const totalCost     = unitCostBase.mul(quantityBase);
```

`InventoryAccountingService.postMovement()` **no requiere cambios** en la lógica de CPP ni en la
generación de asientos — lee `movement.quantity` (base) y `movement.unitCost` (base), que ya
están correctamente convertidos desde DRAFT.

### 3.3 `InventoryAccountingService` — `voidPostedMovement()`

Sin cambios en lógica. El void revierte `movement.quantity` (unidad base) del stock. El campo
`conversionSnapshot` permanece inmutable como evidencia histórica.

### 3.4 `InventoryAccountingService` — `getInventoryValuation()`

Agregar `baseUnitAbbr` al `select` para display. Sin cambio en lógica de valoración
(`stockQuantity × averageCost` permanece en unidad base).

### 3.5 Nuevo servicio requerido: `InventoryUomService`

`src/modules/inventory/services/InventoryUomService.ts`

Responsabilidades:
- `createUnit(input, userId)`: crea `InventoryItemUnit`. Valida que si `isBase = true` no exista
  ya otra unidad base para el ítem. El primer `createUnit` de un ítem DEBE ser la unidad base.
- `updateUnit(input, userId)`: permite cambiar nombre/abreviatura. **Bloquea cambio de
  `conversionFactor` si hay movimientos POSTED con ese `unitId`** (ver riesgo en sección 6).
- `softDeleteUnit(unitId, companyId, userId)`: bloquea si hay movimientos POSTED o DRAFT que
  referencian esta unidad. Bloquea si `isBase = true`.
- `listUnits(itemId, companyId)`: findMany con companyId guard (ADR-004).

---

## 4. Estimado de tests nuevos

### Categorías y conteo estimado

| Categoría | Tests estimados | Casos principales |
|-----------|-----------------|-------------------|
| `InventoryUomService` — CRUD units | 18 | create base, create no-base, duplicate base guard, update name, update factor con movimientos POSTED (debe bloquear), soft-delete con movimientos activos (debe bloquear), soft-delete unidad base (debe bloquear), listUnits companyId isolation |
| `resolveQuantity()` (unit privada) | 12 | unidad base factor=1, unidad no-base factor entero, unidad no-base factor decimal (0.5), unitId de otra empresa (IDOR), unitId deletedAt (error), unitId NULL (usa base), cantidad cero (error), cantidad negativa (error) |
| `createDraftMovement` con UoM | 14 | ENTRADA caja→unidad (conversión y unitCost base correcto), SALIDA en unidad no-base (stock suficiente en base), SALIDA en unidad no-base (stock insuficiente en base), CPP correcto tras ENTRADA caja, idempotency key con unidad distinta (devuelve existente), AJUSTE en unidad no-base |
| `postMovement` con UoM | 10 | CPP mix: primera entrada en cajas, segunda en unidades, CPP resultante correcto; asiento usa cantidad base; void revierte cantidad base; Serializable P2034 manejo |
| CPP edge cases UoM | 8 | Entrada fracción: factor=0.5 (medio litro → 0.5 base), CPP con factor irracional (1/3), stock cero antes de entrada en unidad no-base, CPP tras void de entrada en caja |
| Schemas Zod | 6 | conversionFactor como string válido, como float (rechazar), isBase ausente (error), exactamente un isBase=true en array de units, factor <= 0 (error) |
| `getInventoryValuation` | 4 | incluye baseUnitAbbr en respuesta, valoración = stock_base × avg_base independiente de UoM |

**Total estimado: 72 tests nuevos**

### Casos edge críticos

**Fracciones en conversión:**
- Factor `0.5` (medio litro = 1 unidad base): entrada de 3 "medio litros" → `quantityBase = 3 × 0.5 = 1.5 UN`. Decimal.js lo maneja sin pérdida. Test debe verificar que `new Decimal("3").mul(new Decimal("0.5")).equals(new Decimal("1.5"))` y que el CPP resultante es correcto.
- Factor `1/3` no existe como fracción exacta en decimal. El sistema obliga a expresarlo como `0.3333333333` (10 decimales). El test debe documentar el error de redondeo acumulado esperado y que es menor a `0.0000000001` por unidad.

**CPP con unidades mixtas (caso más complejo):**
```
Estado inicial: stock=0, averageCost=0
ENTRADA 1: 2 Cajas a Bs. 120/Caja, factor=12 UN/CJ
  quantityBase = 24 UN, unitCostBase = 10 Bs/UN, totalCost = 240
  CPP nuevo = (0×0 + 24×10) / (0+24) = 10 Bs/UN  ✓

ENTRADA 2: 6 Unidades a Bs. 11/UN, factor=1
  quantityBase = 6 UN, unitCostBase = 11 Bs/UN, totalCost = 66
  CPP nuevo = (24×10 + 6×11) / (24+6) = (240+66)/30 = 306/30 = 10.20 Bs/UN  ✓

Test debe verificar CPP = new Decimal("10.20") exactamente con Decimal.js (no float).
```

**Ajuste en unidad no-base:**
- AJUSTE negativo en Cajas (factor=12): cantidad en base = `-qty_cajas × 12`. Verificar que el guard de stock insuficiente opera sobre la cantidad base.

---

## 5. Checklist impacto contable VEN-NIF

### ¿Cambian los asientos de entrada/salida de inventario?

**No cambian en estructura.** El asiento sigue siendo:
- ENTRADA: Débito Inventario / Crédito (CxP o contrapartida)
- SALIDA: Débito COGS / Crédito Inventario

Lo que cambia es el **insumo**: `totalCost` y `quantity` ya llegaron al `postMovement` convertidos
a unidad base. El asiento opera sobre los mismos campos de siempre.

El texto descriptivo del asiento puede mejorar para incluir la unidad del movimiento:
`"ENTRADA inventario — Producto X × 2 CJ (24 UN)"`. Es cosmético, no contable.

### ¿CPP sigue válido con múltiples unidades?

Sí. El CPP (VEN-NIF 2 / IAS 2 § 27) es un método de valoración sobre la masa total de inventario.
La fórmula `nuevo_avg = (Q_old × avg_old + Q_new × cost_new) / (Q_old + Q_new)` opera sobre
cantidades en unidad homogénea. Al garantizar que `quantity` en `InventoryMovement` sea siempre
en unidad base, la homogeneidad está asegurada. La norma no especifica la unidad de medida —
solo exige consistencia. Consistencia garantizada por diseño.

### ¿Se necesita ADR nuevo?

**Sí. ADR-018** debe documentar:
- Decisión de mantener el stock/CPP siempre en unidad base.
- Decisión de bloquear cambio de `conversionFactor` en unidades con movimientos POSTED.
- Decisión de snapshot inmutable del factor en `InventoryMovement.conversionSnapshot`.
- Decisión de rechazar conversiones entre magnitudes distintas (ver sección 6).

Ruta: `.claude/adr/ADR-018-uom-inventory.md`

### ¿Tocar ontología V8?

**No es necesario** en esta fase. La ontología V8 define los asientos contables (débito/crédito),
no las unidades físicas de los ítems. Los asientos de inventario (Inventario / COGS) no cambian.

Sin embargo, se recomienda agregar una nota en `ontologia-v8-indice.md` bajo la sección de
inventario: "Las cantidades en asientos de inventario están siempre expresadas en la unidad base
del ítem — ver ADR-018."

---

## 6. Riesgos y decisiones pendientes

### Riesgo 1: ¿Serializable sigue siendo necesario para CPP con UoM?

**Sí, obligatorio.** La lógica de CPP en `postMovement` es una lectura-modificación-escritura
sobre `InventoryItem.stockQuantity` y `InventoryItem.averageCost`. Con UoM, este patrón no
cambia — solo cambia el valor que se suma/resta. Una transacción concurrent que lea el mismo
`stockQuantity` y `averageCost` mientras otra transacción también los modifica producirá un CPP
incorrecto bajo Read Committed. Serializable SSI sigue siendo la única garantía correcta.

La conversión de unidades ocurre **antes** de la lectura del stock en la misma transacción, por
lo que no añade contención nueva. No se necesita lock adicional sobre `InventoryItemUnit`.

### Riesgo 2: ¿Qué pasa si se cambia el factor después de registrar movimientos?

**BLOQUEAR.** Este es el riesgo más alto de la fase.

Si el factor de "Caja" cambia de 12 a 10 después de que ya existen movimientos POSTED, los
históricos quedan con `conversionSnapshot = 12` pero el sistema mostraría el factor nuevo `10`
en consultas. La discrepancia rompería cualquier recálculo de auditoría.

**Decisión de diseño:**
- El campo `conversionFactor` en `InventoryItemUnit` es **inmutable** una vez que existen
  movimientos con `status IN (POSTED, VOIDED)` que referencien esa unidad.
- `InventoryUomService.updateUnit()` verifica esto antes de aplicar el cambio:

```typescript
const hasPostedMovements = await tx.inventoryMovement.count({
  where: {
    unitId: unitId,
    status: { in: ["POSTED", "VOIDED"] },
  },
});
if (hasPostedMovements > 0 && input.conversionFactor !== undefined) {
  throw new Error(
    "No se puede cambiar el factor de conversión: existen movimientos contabilizados con esta unidad. " +
    "Cree una nueva unidad con el factor correcto."
  );
}
```

- Si el usuario necesita corregir un factor, el flujo es: crear nueva unidad con el factor
  correcto, reasignar nuevos movimientos a la unidad nueva. Los movimientos históricos mantienen
  la unidad original con su `conversionSnapshot`.

- `conversionSnapshot` en `InventoryMovement` es un snapshot inmutable por diseño. Aunque
  `InventoryItemUnit.conversionFactor` se bloqueara (y así es), la snapshot en el movimiento
  es la fuente de verdad histórica.

### Riesgo 3: ¿Soportar o bloquear conversión entre magnitudes distintas?

**BLOQUEAR en esta fase.** 

Permitir conversión entre magnitudes distintas (peso ↔ volumen, ej. kg ↔ litros) requiere:
- Inferir la magnitud de cada unidad (tabla de tipos: masa, volumen, longitud, conteo).
- Validar que todas las unidades de un ítem son de la misma magnitud.
- Manejar el caso de ítems cuya unidad base es "unidad" (conteo), que puede parecer compatible
  con cualquier magnitud.

El costo de correcta implementación supera el beneficio en el contexto VEN-NIF donde los ítems
rara vez tienen ambigüedad de magnitud. La complejidad de validación también expone superficies
de error nuevas.

**Diseño propuesto para bloquear:** No se agrega un campo `magnitudeType` al modelo. El sistema
confía en que el usuario configure unidades coherentes. Si en el futuro se detecta necesidad real,
se diseña ADR-019 con un enum `MagnitudeType` y validación cruzada.

**Documentar en ADR-018**: conversión entre magnitudes distintas es responsabilidad del usuario,
el sistema no valida coherencia de magnitud en esta fase.

### Riesgo 4: Unidad base eliminada accidentalmente

Si el usuario intenta soft-delete de la unidad con `isBase = true`, el service debe bloquearlo
incondicionalmente — independientemente de si hay movimientos. No puede existir un ítem sin
unidad base.

### Riesgo 5: Migración de `unit String` en producción

El campo `unit` tiene datos en producción. La migración C (NOT NULL + DROP COLUMN) debe ejecutarse
solo después de confirmar que:
1. El backfill completó sin errores (verificar 0 ítems con `baseUnitId = NULL`).
2. Ningún servicio lee `InventoryItem.unit` directamente (búsqueda de código).
3. Al menos un ciclo de nómina completo ha corrido con el nuevo schema.

Recomendación: renombrar primero a `unit_deprecated` y dejar `NOT NULL` caer solo en la siguiente
fase de cleanup.

### Riesgo 6: `@@unique([itemId, isBase])` y el filtro parcial

PostgreSQL crea el index único normalmente para todos los valores de `isBase`. Esto significa
que solo puede existir **una fila con `isBase = false` por ítem**, lo que es incorrecto.

**Corrección necesaria**: el constraint debe ser un **partial index** solo sobre `isBase = true`:

```sql
CREATE UNIQUE INDEX "uq_inventory_item_unit_base"
  ON "InventoryItemUnit"("itemId")
  WHERE "isBase" = true;
```

Prisma no soporta partial indexes nativamente. Se debe crear vía `@@ignore` + migración SQL
manual, o usar `@@unique([itemId, isBase])` con la advertencia de que permite múltiples
`isBase = false` (lo cual Postgres sí permite: el unique sobre `(itemId, false)` solo aplica
a las filas con `false`, y puede haber N filas con el mismo `itemId` y `isBase = false`...

**Aclaración técnica**: `@@unique([itemId, isBase])` crea un index sobre la tupla `(itemId, isBase)`.
Para `isBase = false`, la tupla `("item-1", false)` sería duplicada si hay dos unidades
no-base para el mismo ítem. Esto bloquea la creación de más de una unidad no-base por ítem,
que es incorrecto.

**Solución correcta**: usar la migración manual con `WHERE "isBase" = true` (partial index)
y en el schema Prisma documentar que la constraint no puede expresarse en DSL. El `@@unique`
en el schema Prisma queda eliminado y se reemplaza por comentario:

```prisma
// Partial index gestionado via SQL: CREATE UNIQUE INDEX ... WHERE "isBase" = true
// Ver migración: 20260430_fase35f_uom_inventory_item_unit
```

La validación de "solo una unidad base" se refuerza en el service layer como segunda línea de
defensa.

---

## Estimado de esfuerzo

### Archivos modificados

| Archivo | Tipo de cambio |
|---------|---------------|
| `prisma/schema.prisma` | Nuevo modelo `InventoryItemUnit`, cambios en `InventoryItem` y `InventoryMovement`, relación en `Company` |
| `src/modules/inventory/schemas/inventory-item.schema.ts` | Eliminar `unit`, agregar `units: UomUnitInput[]` |
| `src/modules/inventory/schemas/inventory-movement.schema.ts` | Agregar `unitId?`, `quantityInUnit` |
| `src/modules/inventory/services/InventoryOperationsService.ts` | `createDraftMovement` + `resolveQuantity` helper |
| `src/modules/inventory/services/InventoryAccountingService.ts` | `getInventoryValuation` (display), sin cambio en CPP core |

### Archivos nuevos

| Archivo | Descripción |
|---------|-------------|
| `prisma/migrations/20260430_fase35f_uom_inventory_item_unit/migration.sql` | Migración A + B + C (3 scripts separados recomendados) |
| `src/modules/inventory/schemas/inventory-item-unit.schema.ts` | Zod schema para UoM |
| `src/modules/inventory/services/InventoryUomService.ts` | CRUD de unidades + `resolveQuantity` |
| `src/modules/inventory/services/__tests__/InventoryUomService.test.ts` | 18 tests UomService |
| `src/modules/inventory/services/__tests__/InventoryUomOperations.test.ts` | 26 tests integración ops+UoM |
| `src/modules/inventory/services/__tests__/InventoryUomAccounting.test.ts` | 22 tests CPP+UoM |
| `src/modules/inventory/services/__tests__/InventoryUomSchemas.test.ts` | 6 tests schemas Zod |
| `.claude/adr/ADR-018-uom-inventory.md` | Decisión arquitectónica UoM |

### Tests estimados

**72 tests nuevos** sobre una base actual de ~1466.  
Total proyectado post-fase: ~1538 tests.

### Recomendación de sub-fases

**Sub-fase A — Schema y migración** (1 sesión):
- Crear `InventoryItemUnit` en schema.
- Ejecutar migración A (schema-only, non-breaking).
- Ejecutar backfill B.
- Aplicar migración C (NOT NULL).
- `prisma generate`. 0 TS errors requeridos al final.

**Sub-fase B — Service layer** (1-2 sesiones):
- Implementar `InventoryUomService` con tests.
- Modificar `createDraftMovement` con `resolveQuantity`.
- Tests CPP con unidades mixtas.
- Phase gate: tsc + vitest GREEN.

**Sub-fase C — UI y cleanup** (1 sesión):
- Actualizar `InventoryItemForm` para gestionar unidades.
- Actualizar `MovementForm` para seleccionar unidad.
- Eliminar `unit` deprecated de schema.
- Actualizar `getInventoryValuation` display.

**Prerrequisito antes de iniciar Sub-fase A**: aprobación de este documento por el usuario y
creación de ADR-018.
