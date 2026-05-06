# ADR-024: InvoiceLine + Integración Inventario + Módulo Gastos

- **Estado**: PROPOSED
- **Fecha**: 2026-05-06
- **Depende de**: ADR-001 (Serializable), ADR-002 (Decimal), ADR-003 (onDelete Restrict), ADR-004 (companyId isolation), ADR-006 (security hardening), ADR-018 (UoM), ADR-021 (Lot/Serial), ADR-022 (PaymentBatch pattern)
- **Afecta**: `Invoice`, `InventoryMovement`, `CompanySettings` (nuevo campo), nuevos modelos `InvoiceLine`, `Expense`, `ExpenseCategory`

---

## Contexto

### Brecha actual

El modelo `Invoice` tiene `InvoiceTaxLine` para los totales agregados de IVA por alícuota, pero no tiene líneas de detalle de producto/servicio. Esta ausencia bloquea:

- Reportes de ventas por producto (top sellers, margen por SKU)
- Conversión automática de `Order` → `Invoice` con líneas (hoy la conversión de Fase 28 solo copia los totales)
- Descuento automático de stock al facturar (requiere saber qué ítem y qué cantidad se facturó)
- Trazabilidad fiscal de Lot/Serial hasta la factura de venta (ADR-021 D-4 vincula `InventoryMovement` a `Invoice`, pero no a la línea específica)

### Restricción de compatibilidad

Las facturas SENIAT históricas (anteriores a esta fase) son válidas sin líneas de producto. La migración debe ser estrictamente no destructiva: `InvoiceLine` es opcional a nivel de `Invoice`.

### Estado del inventario existente

`InventoryMovement.invoiceId` (FK a `Invoice`) ya existe. El movimiento de salida de inventario hoy se crea manualmente en `InventoryOperationsService` como un `DRAFT` separado, que luego el contador contabiliza con `InventoryAccountingService.postMovement()`. Esta separación es intencional (modelo ADMINISTRATIVE opera / ACCOUNTANT contabiliza — ver `MovementStatus`).

---

## Decisiones

---

### D-1: InvoiceLine

#### D-1.1: Schema propuesto

```prisma
enum IvaLineRate {
  EXENTO        // 0% — sin IVA
  REDUCIDO_8    // 8% — alícuota reducida (Providencia 0057)
  GENERAL_16    // 16% — alícuota general estándar
  ADICIONAL_31  // 31% — 16% general + 15% adicional lujo (Art. 61 LIVA)
}

model InvoiceLine {
  id               String      @id @default(cuid())
  companyId        String
  company          Company     @relation(fields: [companyId], references: [id], onDelete: Restrict)
  invoiceId        String
  invoice          Invoice     @relation(fields: [invoiceId], references: [id], onDelete: Restrict)

  // Producto o servicio
  // inventoryItemId nullable — permite facturar servicios sin inventario
  inventoryItemId  String?
  inventoryItem    InventoryItem? @relation(fields: [inventoryItemId], references: [id], onDelete: Restrict)

  // Snapshot de SKU/nombre al momento de facturar — inmutable aunque el ítem cambie después
  skuSnapshot      String?     // null para servicios sin ítem registrado
  nameSnapshot     String      // obligatorio siempre

  // Descripción libre (anula nameSnapshot visualmente si está presente)
  description      String?

  // Cantidades y precios
  quantity         Decimal     @db.Decimal(19, 4)
  unitId           String?     // FK a InventoryItemUnit (unidad de venta — puede diferir de unidad base)
  unit             InventoryItemUnit? @relation(fields: [unitId], references: [id], onDelete: Restrict)

  // Precios en ambas monedas — snapshot inmutable al momento de emisión
  // unitPriceUsd: precio de referencia en USD (puede ser null si la factura es VES pura)
  unitPriceUsd     Decimal?    @db.Decimal(19, 4)
  unitPriceVes     Decimal     @db.Decimal(19, 4)

  // Alícuota aplicable a esta línea
  ivaRate          IvaLineRate @default(GENERAL_16)

  // Totales calculados por el servicio — nunca por el cliente
  // subtotal = quantity × unitPriceVes (sin IVA)
  subtotal         Decimal     @db.Decimal(19, 4)
  // ivaAmount = subtotal × ivaRate (0 si EXENTO)
  ivaAmount        Decimal     @db.Decimal(19, 4)
  // total = subtotal + ivaAmount
  total            Decimal     @db.Decimal(19, 4)

  // Para líneas de lujo: luxuryGroupId vincula IVA_ADICIONAL con su IVA_GENERAL
  // Reutiliza la misma semántica de InvoiceTaxLine (ver Z-2 en CLAUDE.md)
  luxuryGroupId    String?

  // Vínculo al movimiento de inventario generado (si aplica)
  inventoryMovementId String?  @unique
  inventoryMovement   InventoryMovement? @relation(fields: [inventoryMovementId], references: [id], onDelete: Restrict)

  lineNumber       Int         // orden de aparición en la factura (1-based)

  // Soft delete — necesario para correcciones pre-confirmación sin romper inventoryMovementId
  deletedAt        DateTime?
  deletedBy        String?

  createdAt        DateTime    @default(now())

  @@index([invoiceId])
  @@index([companyId, inventoryItemId])
  @@index([inventoryMovementId])
  @@index([invoiceId, deletedAt])
}
```

**Adiciones a modelos existentes:**

```prisma
// En model Invoice — agregar:
lines              InvoiceLine[]

// En model InventoryItem — agregar:
invoiceLines       InvoiceLine[]

// En model InventoryItemUnit — agregar:
invoiceLines       InvoiceLine[]

// En model InventoryMovement — agregar:
invoiceLine        InvoiceLine?

// En model Company — agregar:
invoiceLines       InvoiceLine[]
```

#### D-1.2: Decisión sobre onDelete en InvoiceLine

`InvoiceTaxLine` usa `onDelete: Cascade` (schema actual, línea 499) porque es un detalle agregado que no tiene existencia independiente — su contenido es derivado de los datos de la factura y carece de significado sin ella. `InvoiceLine` es análoga: una línea de detalle sin factura es un registro huérfano sin uso contable ni fiscal.

**Decisión: `onDelete: Restrict` en la FK `invoiceId`.**

Razón: Las facturas SENIAT son objetos contables inmutables una vez emitidas. No existe caso de negocio donde se elimine una `Invoice` directamente (el proceso es `VOID` con contrapartida, no `DELETE`). Dado que `Invoice` nunca se borra en producción (usa `deletedAt`), la diferencia práctica entre `Cascade` y `Restrict` sobre `invoiceId` es nula. Sin embargo, `Restrict` es más seguro ante errores de código que intenten un delete incorrecto — fuerza al desarrollador a borrar las líneas explícitamente antes de borrar la factura, lo que en nuestro caso es imposible porque las facturas no se borran. `Restrict` refuerza el invariante sin efecto operacional.

Excepción documentada: `InvoiceTaxLine` mantiene `Cascade` por retrocompatibilidad. No propagar ese patrón a `InvoiceLine`.

#### D-1.3: Migración de la lógica de cálculo de impuestos

**Coexistencia, no reemplazo.**

`InvoiceTaxLine` permanece como el contrato fiscal con el SENIAT. Los libros de IVA (Libro de Ventas, Libro de Compras, formularios DP-31) leen `InvoiceTaxLine` — esta tabla no cambia.

`InvoiceLine` es la fuente de verdad del detalle comercial. Los totales de `InvoiceTaxLine` deben ser iguales a la sumatoria de `InvoiceLine` agrupada por `ivaRate`, pero esto se verifica en el servicio — no hay FK entre ambas tablas.

**Flujo de cálculo en `InvoiceService.create()` cuando se proveen líneas:**

```
1. Para cada InvoiceLine:
   - subtotal = quantity × unitPriceVes  (Decimal.js, sin float)
   - ivaAmount = subtotal × tasaDecimal(ivaRate)
   - total = subtotal + ivaAmount

2. Agrupar por ivaRate → derivar InvoiceTaxLine:
   - EXENTO       → TaxLineType.EXENTO,      rate = 0
   - REDUCIDO_8   → TaxLineType.IVA_REDUCIDO, rate = 8
   - GENERAL_16   → TaxLineType.IVA_GENERAL,  rate = 16
   - ADICIONAL_31 → dos TaxLines: IVA_GENERAL (16) + IVA_ADICIONAL (15), mismo luxuryGroupId

3. InvoiceTaxLine creadas desde las líneas — input.taxLines ya no se envía
   manualmente cuando se usan InvoiceLines.

4. totalAmountVes = SUM(InvoiceLine.total) — ya no se calcula desde taxLines.reduce()
```

**Compatibilidad hacia atrás:** Las facturas sin `InvoiceLine` (históricas, importadas por OCR, o facturas de compra donde no aplica el detalle) continúan usando `input.taxLines` directamente. `InvoiceService.create()` acepta ambos caminos:

```
Si input.lines presente y length > 0:
  → derivar taxLines desde lines (D-1 path)
Else:
  → usar input.taxLines directamente (path legacy — facturas históricas y compras)
```

**IGTF:** No cambia. Se calcula sobre la base total de la factura (`igtfBase`), independientemente de si hay líneas o no. `igtfBase = SUM(subtotales de líneas en moneda extranjera)` cuando hay líneas; sigue siendo campo explícito en el input cuando no las hay.

#### D-1.4: Cálculo de IVA adicional (lujo)

Cuando `ivaRate = ADICIONAL_31`, el servicio genera dos `InvoiceTaxLine`:
- Una con `taxType = IVA_GENERAL`, `rate = 16`, `base = subtotal`
- Una con `taxType = IVA_ADICIONAL`, `rate = 15`, `base = subtotal` (misma base — no sobre el subtotal+IVA general, ver `best-practices.md` §3.1)
- Ambas comparten el mismo `luxuryGroupId` (UUID generado por el servicio para esa factura)

En `InvoiceLine`, el campo `luxuryGroupId` identifica cuál grupo de líneas ADICIONAL_31 corresponde a cuál par de `InvoiceTaxLine`.

#### D-1.5: Nombre de migración sugerido

`20260506120000_fase37a_invoice_lines`

Riesgo de migración: BAJO. Solo agrega tabla nueva y campos de relación inversa opcionales. Sin backfill. Sin tocar filas existentes.

---

### D-2: Integración Inventario ↔ Factura

#### D-2.1: Stock control levels

Campo nuevo en `CompanySettings`. Este modelo no existe aún — se agrega en esta fase como tabla dedicada para configuración operacional (separada de `PayrollConfig` que es nómina, y de `Company` que está creciendo excesivamente).

```prisma
enum StockControlLevel {
  WARN     // permite facturar con stock negativo — muestra advertencia en UI
  CONFIRM  // requiere confirmación explícita del usuario si stock < cantidad
  BLOCK    // bloquea emisión si stock < cantidad solicitada en alguna línea
}

model CompanySettings {
  id               String            @id @default(cuid())
  companyId        String            @unique
  company          Company           @relation(fields: [companyId], references: [id], onDelete: Restrict)

  stockControlLevel StockControlLevel @default(WARN)

  // Futuras configuraciones operacionales van aquí (no en Company)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
}
```

```prisma
// En model Company — agregar:
settings           CompanySettings?
```

**Nombre de migración sugerido:** `20260506120001_fase37a_company_settings`

#### D-2.2: Dónde vive el descuento de stock — decisión

**Decisión: dentro de `InvoiceService`, en el mismo `$transaction` que la factura.**

Análisis de las dos opciones:

**Opción A — Inline en `InvoiceService` (ELEGIDA)**

El descuento de stock se crea como `InventoryMovement` con `status = DRAFT` dentro del mismo `$transaction` de la factura, vinculado vía `InvoiceLine.inventoryMovementId`.

Pros:
- Atomicidad total: si la factura falla, el movimiento no existe. Si el movimiento falla, la factura no existe. Sin estados intermedios inconsistentes.
- Auditabilidad directa: `InventoryMovement.invoiceId` + `InvoiceLine.inventoryMovementId` crean trazabilidad bidireccional completa.
- Consistente con el patrón existente: `InventoryMovement` ya tiene `invoiceId` (Fase 28D).
- El BLOCK en `StockControlLevel.BLOCK` es una validación pre-`$transaction` — no requiere rollback.

Contras:
- La transacción de factura crece (incluye reads de stock + writes del movimiento). En Neon serverless, las transacciones largas tienen costo de conexión.
- Rompe parcialmente la separación ADMINISTRATIVE/ACCOUNTANT: hoy `InvoiceService` (dominio ACCOUNTANT) no toca `InventoryMovement` (dominio ADMINISTRATIVE).

Mitigación del contra principal (transacción larga en Neon):
- El `$transaction` de factura ya incluye: Invoice, InvoiceTaxLine, InvoiceLine, AuditLog, SeniatSubmission (ADR-019). Agregar N movimientos de inventario (uno por línea con ítem) es incremental, no un cambio de orden de magnitud.
- El movimiento se crea en `DRAFT`. No ejecuta `InventoryAccountingService.postMovement()` (que genera asiento contable). El posting queda para el flujo ACCOUNTANT habitual.
- La lectura de stock (`InventoryItem.stockQuantity`) para validar WARN/CONFIRM/BLOCK ocurre fuera de la `$transaction`, antes de iniciarla.

**Opción B — Evento/hook separado (DESCARTADA)**

Un job QStash o un evento interno dispara el descuento de stock después de que la factura se confirma.

Por qué se descarta:
- Ventana de inconsistencia: entre que la factura existe y el movimiento se crea, hay un intervalo donde el stock no refleja la venta. En un contexto de `BLOCK`, un segundo usuario podría facturar el mismo stock.
- Complejidad operacional: requiere dead-letter handling, reintentos, y reconciliación entre facturas y movimientos pendientes. No justificado para el tamaño actual.
- QStash ya se usa para SENIAT (ADR-019) — no debe convertirse en el bus de todo.

**Opción B sería revisable** si ContaFlow escala a facturación masiva (>100 facturas/min) y la contención en `InventoryItem.stockQuantity` se convierte en cuello de botella medible. Ese punto de inflexión requeriría métricas de `P2034` (ver `DECISIONS.md` — Advisory locks pendientes).

#### D-2.3: Flujo detallado del descuento de stock

```
Pre-$transaction (fuera de tx):
  1. Para cada InvoiceLine con inventoryItemId:
     a. Leer InventoryItem.stockQuantity (Read Committed — no requiere Serializable)
     b. Evaluar StockControlLevel:
        - BLOCK: si stockQuantity < quantity → retornar error al cliente (sin abrir tx)
        - CONFIRM: si stockQuantity < quantity → ya debe venir flag de confirmación
          del cliente en el input; sin flag → retornar error solicitando confirmación
        - WARN: continuar siempre

Dentro del $transaction (Read Committed — igual al nivel actual de InvoiceService.create()):
  2. Si CONFIRM con stock insuficiente confirmado:
     → SELECT FOR UPDATE en InventoryItem (serializa accesos concurrentes — ver R-1)
     ```typescript
     await tx.$executeRaw`
       SELECT id FROM "InventoryItem"
       WHERE id = ${itemId} AND "companyId" = ${companyId}
       FOR UPDATE
     `;
     ```
  3. Crear Invoice + InvoiceLines + InvoiceTaxLines + AuditLog + SeniatSubmission
  4. Para cada InvoiceLine con inventoryItemId:
     a. Crear InventoryMovement:
        - type: SALIDA
        - status: DRAFT
        - itemId: line.inventoryItemId
        - quantity: line.quantity (en unidad base — convertida via resolveQuantity() si unitId != baseUnitId)
        - quantityInUnit: line.quantity (cantidad en la unidad de venta)
        - unitCost: InventoryItem.averageCost (snapshot CPP vigente)
        - totalCost: quantity × unitCost
        - invoiceId: invoice.id
        - date: invoice.date
        - conversionSnapshot: factor de conversión al momento de la factura (ADR-018 D-3)
        - idempotencyKey: SHA256(invoiceId | lineId | itemId)
     b. Actualizar InvoiceLine.inventoryMovementId = movement.id
  5. (Solo WARN/CONFIRM con negativo confirmado) — el stock puede quedar negativo:
     esto es el comportamiento esperado y queda registrado en el InventoryMovement.
```

**Nota sobre la separación ADMINISTRATIVE/ACCOUNTANT:** El movimiento creado está en `DRAFT`. Esta fase no genera el asiento contable. El flujo de posteo (`InventoryAccountingService.postMovement()`) permanece separado y sigue siendo responsabilidad del ACCOUNTANT. La integración aquí solo automatiza la creación del `DRAFT` que anteriormente era manual.

#### D-2.4: Lot/Serial tracking en InvoiceLine

Cuando `InventoryItem.trackingType = LOT` o `SERIAL`:
- La UI debe solicitar los lotes/seriales al momento de emitir la factura
- Los `InventoryMovementLot` / `InventoryMovementSerial` se crean en el mismo `$transaction`
- Ver ADR-021 para reglas de validación de disponibilidad

Si `trackingType = NONE`: no se requieren lotes ni seriales.

#### D-2.5: Aislamiento multi-tenant

Antes de leer `InventoryItem.stockQuantity`, verificar:
```
inventoryItem.companyId === invoice.companyId
```
Sin esta verificación, un cliente malicioso podría bloquear el stock de otra empresa pasando un `inventoryItemId` ajeno. Este check va en el service layer antes de la validación de stock.

---

### D-3: Módulo Gastos

#### D-3.1: Schema Expense

```prisma
enum ExpenseStatus {
  DRAFT      // registrado pero no confirmado — editable
  CONFIRMED  // confirmado — genera asiento contable (si accountId configurado)
  VOIDED     // anulado — nunca DELETE
}

// Nota: se reutiliza el enum Currency existente — no se crea ExpenseCurrency propio.
// Crear un enum paralelo con los mismos valores es duplicación pura; si se agrega COP u otra
// moneda habría que actualizar dos enums. Currency ya cubre todos los casos actuales y futuros.

model Expense {
  id              String          @id @default(cuid())
  companyId       String
  company         Company         @relation(fields: [companyId], references: [id], onDelete: Restrict)

  // Proveedor — una de las dos opciones es obligatoria (validación Zod)
  vendorId        String?
  vendor          Vendor?         @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  supplierName    String?         // texto libre si el proveedor no está registrado

  // Detalle del gasto
  concept         String          // descripción del gasto (obligatorio)
  categoryId      String
  category        ExpenseCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)

  // Montos — siempre Decimal (ADR-002)
  amount          Decimal         @db.Decimal(19, 4)
  currency        Currency        @default(VES)
  // exchangeRate: obligatorio si currency != VES, null si VES
  exchangeRate    Decimal?        @db.Decimal(19, 6)
  // amountVes: siempre calculado = amount × exchangeRate (o amount si VES)
  amountVes       Decimal         @db.Decimal(19, 4)

  // IVA (opcional)
  hasIva          Boolean         @default(false)
  ivaAmount       Decimal?        @db.Decimal(19, 4)

  // Deducibilidad ISLR (Decreto 1808 / LISLR)
  isDeductible    Boolean         @default(true)

  // Factura del proveedor (opcional — el gasto puede no tener factura)
  invoiceNumber   String?
  invoiceDate     DateTime?       @db.Date

  // Comprobante digital — URL a Object Storage (R-2: nunca en BD)
  attachmentUrl   String?

  // Contabilidad — nullable hasta que el ACCOUNTANT lo configura
  // Cuando confirmado: genera Transaction + JournalEntry usando expenseAccountId
  transactionId   String?         @unique
  transaction     Transaction?    @relation(fields: [transactionId], references: [id], onDelete: Restrict)
  // Cuenta de gastos — puede ser distinta a la de la categoría (override por gasto)
  expenseAccountId String?
  expenseAccount   Account?       @relation("ExpenseAccount", fields: [expenseAccountId], references: [id], onDelete: Restrict)

  status          ExpenseStatus   @default(DRAFT)
  idempotencyKey  String          @unique

  // Soft delete
  deletedAt       DateTime?
  deletedBy       String?

  createdAt       DateTime        @default(now())
  createdBy       String
  updatedAt       DateTime        @updatedAt

  @@index([companyId])
  @@index([companyId, categoryId])
  @@index([companyId, status])
  @@index([companyId, invoiceDate])
  @@index([companyId, deletedAt])
}
```

**Adiciones a modelos existentes:**

```prisma
// En model Company — agregar:
expenses           Expense[]
expenseCategories  ExpenseCategory[]

// En model Vendor — agregar:
expenses           Expense[]

// En model Account — agregar:
expensesAsAccount  Expense[]  @relation("ExpenseAccount")

// En model Transaction — agregar:
expense            Expense?
```

#### D-3.2: ExpenseCategory — tabla vs enum

**Decisión: tabla gestionada por empresa (`ExpenseCategory`), con categorías semilla predefinidas.**

Análisis de las dos opciones:

**Opción A — Enum hardcoded (DESCARTADA)**

```
SERVICIOS | ALQUILER | SUELDOS | PUBLICIDAD | OTROS
```

Por qué se descarta:
- Las categorías de gastos en Venezuela varían por industria y por las cuentas del Catálogo Único de Cuentas que cada empresa usa. Una farmacia tiene "Productos vencidos", una consultora tiene "Viáticos y pasajes".
- Un enum implica un cambio de código para agregar una categoría. Viola SOLID-O (ADR implícito desde CLAUDE.md).
- El reporte de ISLR Decreto 1808 agrupa por tipo de pago (honorarios, arrendamiento, fletes) — estas categorías fiscales son del modelo `Retencion`, no de `ExpenseCategory`. Mezclarlas crearía confusión semántica.

**Opción B — Tabla por empresa con seed (ELEGIDA)**

```prisma
model ExpenseCategory {
  id          String    @id @default(cuid())
  companyId   String
  company     Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)
  name        String
  description String?
  // Cuenta contable por defecto para esta categoría
  // Override posible a nivel de Expense.expenseAccountId
  accountId   String?
  account     Account?  @relation("ExpenseCategoryAccount", fields: [accountId], references: [id], onDelete: Restrict)
  isDefault   Boolean   @default(false)  // categorías semilla — el usuario puede agregar más
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  expenses    Expense[]

  @@unique([companyId, name])
  @@index([companyId])
  @@index([companyId, deletedAt])
}
```

```prisma
// En model Account — agregar:
expenseCategoryDefaults ExpenseCategory[] @relation("ExpenseCategoryAccount")
```

**Categorías semilla (insertadas en la migración vía seed o en onboarding):**

| name | description | isDefault |
|------|-------------|-----------|
| Servicios Básicos | Electricidad, agua, internet, teléfono | true |
| Alquiler | Arrendamiento de local, oficina o galpón | true |
| Honorarios Profesionales | Contabilidad, legal, consultoría | true |
| Publicidad y Propaganda | Marketing, redes sociales, impresos | true |
| Transporte y Fletes | Envíos, mensajería, transporte de mercancía | true |
| Sueldos y Salarios | Pagos de nómina no procesados por módulo Nómina | true |
| Gastos de Oficina | Papelería, útiles, suministros | true |
| Mantenimiento y Reparaciones | Equipos, vehículos, instalaciones | true |
| Otros Gastos Operativos | Gastos no clasificados en otras categorías | true |

Las semillas tienen `isDefault = true`. El usuario puede agregar categorías propias (`isDefault = false`) y puede renombrar las suyas, pero no las semilla (restricción de UI — el servicio no bloquea esto a nivel DB).

**Nombre de migración sugerido:** `20260506120002_fase37b_expenses`

---

## SCHEMA_AUDITOR Checklist

| Item | InvoiceLine | CompanySettings | Expense | ExpenseCategory |
|------|-------------|-----------------|---------|-----------------|
| onDelete: Restrict en todas las FK a tablas contables | ✅ | ✅ | ✅ | ✅ |
| onDelete: Cascade ausente | ✅ | ✅ | ✅ | ✅ |
| Campos monetarios en Decimal @db.Decimal(19,4) | ✅ | N/A | ✅ | N/A |
| Campos de porcentaje en Decimal @db.Decimal(5,2) | N/A | N/A | N/A | N/A |
| Entidades fiscales con deletedAt | ✅ (via Invoice) | N/A | ✅ | ✅ |
| idempotencyKey en entidades de creación | N/A (parent Invoice tiene) | N/A | ✅ | N/A |
| Unicidad de negocio incluye companyId | ✅ | @@unique companyId | ✅ | ✅ |
| Índices en FKs frecuentes | ✅ | N/A | ✅ | ✅ |
| AuditLog requerido | ✅ (via Invoice parent) | N/A | ✅ | N/A |
| Riesgo de migración documentado | ✅ | ✅ | ✅ | ✅ |

---

## Consecuencias

### Positivas

1. **Reportes de ventas por producto** desbloqueados: top sellers, utilidad bruta por SKU, rotación de inventario.
2. **Conversión automática Order → Invoice** puede ahora propagar `OrderItem` → `InvoiceLine` con IDs de inventario (Fase 28 actualmente solo copia totales).
3. **Descuento automático de stock al facturar** sin fricción manual — el DRAFT de movimiento se crea junto con la factura.
4. **Trazabilidad Lot/Serial hasta la factura** — `InvoiceLine.inventoryMovementId` → `InventoryMovementLot`/`InventoryMovementSerial`.
5. **Módulo de gastos** completa el ciclo contable para PYMEs venezolanas: ingresos (facturas de venta) + gastos operativos + nómina.

### Negativas / Tradeoffs

1. **Transacción de factura más larga**: Neon cobra por conexión activa. Mitigado porque el movimiento queda en `DRAFT` (sin asiento contable ni CPP update).
2. **Complejidad en `InvoiceService.create()`**: la función tiene ahora dos caminos (con líneas / sin líneas). El path legacy debe estar cubierto por tests.
3. **`CompanySettings` añade una query adicional** al inicio de facturación (leer `stockControlLevel`). Mitigado con una query `select` mínima.
4. **`ExpenseCategory` por empresa** implica que el onboarding debe insertar las categorías semilla. El proceso de creación de empresa (`CompanyService`) debe extenderse.

---

## Riesgos

### R-1: Carrera entre validación de stock y escritura (CONFIRM path)

La lectura de `stockQuantity` para validar ocurre fuera de la `$transaction`. En `CONFIRM`, otro hilo podría consumir el mismo stock entre la validación y la escritura: el usuario confirmó disponibilidad pero el stock queda negativo.

**Mitigación OBLIGATORIA en implementación:** `SELECT ... FOR UPDATE` en `InventoryItem` dentro del `$transaction` para el path `CONFIRM` con stock insuficiente confirmado (ver D-2.3, paso 2). Serializa el acceso concurrente al mismo ítem.

En `WARN`, el stock negativo es explícitamente permitido por diseño — no aplica `SELECT FOR UPDATE`.

En `BLOCK`, la validación pre-tx es suficiente porque rechaza la operación antes de abrir la transacción. Para alta concurrencia extrema (>100 facturas/min mismo ítem) evaluar advisory locks (`DECISIONS.md`) — no es el caso actual.

### R-2: Derivación de InvoiceTaxLine desde InvoiceLine — pérdida de precisión por redondeo

Cuando múltiples líneas comparten la misma alícuota, la base agregada en `InvoiceTaxLine` debe ser exactamente la suma de los subtotales de las líneas. Con Decimal.js esto es exacto, pero si en el futuro algún consumidor convierte a `number`, se introduce error.

**Mitigación:** `FiscalCalculator` (si existe) y `InvoiceService` deben usar Decimal.js en toda la cadena. Regla R-5 de CLAUDE.md aplica sin excepción.

### R-3: Facturas de compra con InvoiceLine (tipo PURCHASE)

Un proveedor emite una factura de compra. ¿Deben registrarse `InvoiceLine` en facturas PURCHASE?

**Decisión diferida:** Para PURCHASE, `InvoiceLine` es opcional. La integración con inventario en facturas de compra (ENTRADA de stock al recibir factura de proveedor) es una fase separada. Hoy el flujo de compras va por `Order` → `InventoryMovement ENTRADA` → `Invoice PURCHASE`. No se rompe ese flujo en este ADR.

### R-4: Migración de facturas históricas sin líneas

Las facturas existentes sin `InvoiceLine` son válidas. Ningún código debe asumir `invoice.lines.length > 0` sin verificar. La UI de detalle de factura debe manejar el caso `lines = []` (mostrar solo totales de `InvoiceTaxLine`).

---

## Fases de implementación sugeridas

### Fase 37A — InvoiceLine + Stock control (sprint independiente)

**Alcance:**
1. Migración `20260506120000_fase37a_invoice_lines`
2. Migración `20260506120001_fase37a_company_settings`
3. Nuevo enum `IvaLineRate` en schema
4. `InvoiceService.create()` — path con líneas + derivación de `InvoiceTaxLine`
5. Validación de stock (lectura pre-tx) + creación de `InventoryMovement DRAFT` dentro de tx
6. Tests: path con líneas, path sin líneas (legacy), WARN/CONFIRM/BLOCK con diferentes stocks
7. UI: form de nueva factura con líneas de producto (fuera de alcance de este ADR — dominio de ui-agent)

**Prerequisitos:** Ninguno. ADR-018 (UoM) y ADR-021 (Lot/Serial) ya están implementados.

**Phase gate:** `tsc --noEmit` + `vitest run` GREEN antes de merge.

### Fase 37B — Módulo Gastos (sprint independiente)

**Alcance:**
1. Migración `20260506120002_fase37b_expenses`
2. `ExpenseService` — create, confirm, void, list (paginado cursor-based)
3. Seed de `ExpenseCategory` en onboarding (modificar `CompanyService.createCompany()`)
4. `ExpenseActions` — con auth, rate limiting `limiters.fiscal`, AuditLog en mismo `$transaction`
5. Tests: DRAFT→CONFIRMED, CONFIRMED→VOIDED, stock de categorías, aislamiento multi-tenant
6. UI: fuera de alcance de este ADR

**Prerequisitos:** Fase 37A no es prerequisito — pueden desarrollarse en paralelo.

### Fase 37C — Order → Invoice con líneas (post 37A)

Convertir `Order.items` (que ya tienen `inventoryItemId` via `OrderItem`) en `InvoiceLine` al ejecutar la conversión. Hoy `convertOrderToInvoice()` solo copia totales.

**Prerequisito:** Fase 37A completa.

---

## Referencias

- **ADR-001**: Correlativos con Serializable — no aplica a InvoiceLine (sin correlativo propio)
- **ADR-002**: Decimal obligatorio — aplica a todos los campos monetarios
- **ADR-003**: onDelete Restrict — aplicado en todas las FK de este ADR
- **ADR-004**: companyId isolation — verificación de `inventoryItem.companyId` en D-2.5
- **ADR-006**: Security hardening — rate limiting, role checks, AuditLog
- **ADR-018**: UoM — `InvoiceLine.unitId` referencia `InventoryItemUnit`; `resolveQuantity()` para conversión a unidad base
- **ADR-021**: Lot/Serial — `InventoryMovementLot`/`InventoryMovementSerial` creados en mismo `$transaction` cuando trackingType != NONE
- **ADR-022**: PaymentBatch — patrón de referencia para `ExpenseService` (plain functions, no class)
- **CLAUDE.md Z-2**: Cálculo de impuestos — `luxuryGroupId` en `InvoiceLine` sigue la misma semántica que en `InvoiceTaxLine`
- **CLAUDE.md R-5**: Cero flotantes — Decimal.js en toda la cadena de cálculo de líneas
- **CLAUDE.md R-6**: Trazabilidad de red — `AuditLog.ipAddress` + `userAgent` en todas las mutaciones
- **DECISIONS.md**: Workflow manual de migraciones (prisma migrate dev roto)
