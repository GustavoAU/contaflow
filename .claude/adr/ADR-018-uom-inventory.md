# ADR-018 — Unidades de Medida Múltiples (UoM) para Inventario

**Estado:** DECIDIDO  
**Fecha:** 2026-04-30  
**Fase:** 35F  

---

## Contexto

El módulo de inventario (Fase 28D) usaba un campo `unit String` libre en `InventoryItem`
(ej. "unidad", "kg", "litro"). Este diseño impedía registrar movimientos en unidades distintas
a la base (ej. comprar por Cajas y vender por Unidades) y no ofrecía conversión automática.

PYMEs venezolanas compran frecuentemente en unidades de presentación (Caja, Paca, Bulto) y
venden por unidad individual. Sin UoM, el sistema obliga a ajustar manualmente las cantidades
antes de ingresar cada movimiento.

---

## Decisiones

### D-1: Stock y CPP siempre en unidad base

Todo `InventoryItem` tiene exactamente una unidad base (`isBase = true`, `conversionFactor = 1`).
`stockQuantity` y `averageCost` en `InventoryItem` están **siempre en unidad base**, sin excepción.

La conversión ocurre en el service layer (`InventoryOperationsService.resolveQuantity()`) antes
de modificar el stock. `InventoryAccountingService.postMovement()` no requiere cambios en la
lógica de CPP — recibe `movement.quantity` ya en unidad base.

**Alternativa rechazada:** guardar stock en unidad de entrada y convertir en reporting. Rechazada
porque rompería el CPP: no es posible promediar cantidades expresadas en unidades distintas.

### D-2: `conversionFactor` es inmutable post-posting

Si existen movimientos con `status IN (POSTED, VOIDED)` que referencien una `InventoryItemUnit`,
el campo `conversionFactor` **no puede cambiar**. `InventoryUomService.updateUnit()` verifica
esta condición antes de persistir.

**Razón:** cambiar el factor retroactivamente invalidaría los `conversionSnapshot` almacenados en
los movimientos históricos, haciendo imposible auditar la cantidad real que entró/salió.

**Flujo correcto para corrección de factor:** crear una nueva unidad con el factor correcto y
asignar los movimientos futuros a esa unidad. Los movimientos históricos retienen la unidad
original con su snapshot.

### D-3: `conversionSnapshot` inmutable en `InventoryMovement`

Cada `InventoryMovement` almacena una copia inmutable del factor de conversión al momento del
movimiento (`conversionSnapshot Decimal(19,10)`). Esta snapshot es la fuente de verdad histórica
para auditoría, independientemente de cambios futuros en `InventoryItemUnit.conversionFactor`.

### D-4: Partial index para unicidad de unidad base

`@@unique([itemId, isBase])` en Prisma DSL crearía un index sobre `(itemId, false)` que solo
permite **una** unidad no-base por ítem — incorrecto. La constraint correcta es un partial index
PostgreSQL solo sobre `isBase = true`:

```sql
CREATE UNIQUE INDEX "uq_inventory_item_unit_base"
  ON "InventoryItemUnit"("itemId")
  WHERE "isBase" = true;
```

Prisma no soporta partial indexes en DSL. El index se gestiona vía migración SQL manual.
El schema Prisma documenta este hecho con un comentario. El service layer (`createUnit`) añade
una segunda línea de defensa: verifica existencia de unidad base antes de persistir.

### D-5: Conversión entre magnitudes distintas no validada (esta fase)

El sistema no valida coherencia de magnitud (peso ↔ volumen ↔ conteo). Es responsabilidad del
usuario configurar unidades coherentes para cada ítem.

Implementar validación de magnitudes requeriría un enum `MagnitudeType` y lógica de validación
cruzada cuyo costo supera el beneficio en el contexto actual (PYMEs con ítems de magnitud
unívoca). Si se detecta necesidad real post-lanzamiento, se diseña un ADR específico.

### D-6: `conversionFactor` como `string` en Zod

El factor se recibe como `string` en los schemas Zod y se convierte con `new Decimal(input.conversionFactor)`
en el service. Razón: JavaScript `number` pierde precisión en factores como `0.333333333333`.
El regex Zod valida formato: `/^\d+(\.\d+)?$/`.

Strings peligrosos validados explícitamente:
- `"Infinity"` / `"-Infinity"` → rechazados por el regex (no coinciden con `\d+`)
- `"NaN"` → rechazado por el regex
- `"1e999"` → rechazado por el regex (no coincide con `\d+(\.\d+)?`)
- `"-1"` → rechazado por el regex (requiere dígito inicial, no signo)
- `"0"` → rechazado por validación adicional `conversionFactor > 0` en el service

### D-7: Soft delete y bloqueos

`softDeleteUnit()` bloquea incondicionalmente si:
1. `isBase = true` — un ítem no puede quedar sin unidad base
2. Existen movimientos `DRAFT` o `POSTED` con `unitId` apuntando a esta unidad

`AuditLog` es obligatorio en `createUnit`, `updateUnit` y `softDeleteUnit` dentro del mismo
`$transaction`.

### D-8: Denormalización `baseUnitName` / `baseUnitAbbr` en `InventoryItem`

Para evitar JOINs en listas y reportes de inventario, `InventoryItem` almacena el nombre y
abreviatura de la unidad base como campos denormalizados. El service layer los sincroniza al
crear o actualizar la unidad base.

Tradeoff aceptado: la unidad base raramente cambia de nombre. Si cambia, el service actualiza
ambos campos en la misma transacción.

---

## Impacto en normas VEN-NIF

El CPP (VEN-NIF 2 / IAS 2 § 27) exige cantidades homogéneas. Al garantizar que `quantity` en
`InventoryMovement` sea siempre en unidad base, la homogeneidad está asegurada por diseño.
La norma no especifica la unidad de medida — solo exige consistencia. **Cumple.**

Los asientos de inventario (Débito Inventario / Crédito CxP; Débito COGS / Crédito Inventario)
no cambian en estructura. Solo cambian los insumos numéricos (cantidad y costo ya convertidos
a unidad base antes de llegar a `postMovement`).

---

## Archivos afectados

| Archivo | Tipo |
|---------|------|
| `prisma/schema.prisma` | Nuevo modelo `InventoryItemUnit`, cambios en `InventoryItem`, `InventoryMovement`, `Company` |
| `prisma/migrations/20260430_fase35f_uom_a/migration.sql` | Schema-only, no-breaking |
| `prisma/migrations/20260430_fase35f_uom_b/migration.sql` | Backfill datos existentes |
| `prisma/migrations/20260430_fase35f_uom_c/migration.sql` | NOT NULL constraints |
| `src/modules/inventory/services/InventoryUomService.ts` | Nuevo — CRUD de unidades |
| `src/modules/inventory/services/InventoryOperationsService.ts` | Modificado — `resolveQuantity()` |
| `src/modules/inventory/schemas/inventory-item-unit.schema.ts` | Nuevo — Zod schemas |
