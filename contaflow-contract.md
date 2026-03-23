# ContaFlow — Contratos Vigentes

_Fuente de verdad compartida entre Chat ARCH y Chat IMPL._
_Actualizar después de cada sesión de ARCH._

---

## Fase 12B — Contratos

### 18.1 — BillingMode + getNextControlNumber (ARCH PENDIENTE ⏳)

**Estado: PENDIENTE — llevar a Chat ARCH antes de implementar**

#### Schema (decidido en context.md, pendiente formalizar)

```prisma
enum BillingMode {
  FORMATO_LIBRE
  MAQUINA_FISCAL
}

model Company {
  // ... campos existentes ...
  billingMode BillingMode @default(FORMATO_LIBRE)
}
```

Migración: `npx prisma migrate dev --name add_billing_mode`

#### ⚠️ Contrato de getNextControlNumber — REQUIERE DECISIÓN ARCH

**Problema de concurrencia:** Dos requests simultáneos pueden generar el mismo
número de control (race condition con `SELECT MAX() + 1`).

**Decisión requerida de ARCH:**

- Isolation level: `Serializable` obligatorio
- Formato del número: ¿`"00-XXXXXXXX"` con cero-padding a 8 dígitos?
- ¿Contador en tabla separada (`ControlNumberSequence`) o derivado de `MAX`?
- ¿Resetea por período contable o es global por empresa?

**Firma tentativa (confirmar con ARCH):**

```typescript
// src/modules/invoices/services/InvoiceService.ts
getNextControlNumber(
  companyId: string,
  invoiceType: InvoiceType  // SALE | PURCHASE tienen secuencias separadas?
): Promise<string>
// Debe ejecutarse DENTRO de $transaction con Serializable
// El llamador es responsable de pasar el tx client
```

---

### 18.2 — PDF Export (ARCH PENDIENTE ⏳)

**Estado: PENDIENTE — decisión de librería requerida**

**Opciones para decidir en ARCH:**
| Librería | Pro | Contra |
|----------|-----|--------|
| `@react-pdf/renderer` | React-like API, tipos TS | Bundle grande, no SSR nativo |
| `jspdf` + `jspdf-autotable` | Liviano, tabular | API imperativa, menos tipado |
| `puppeteer` | Fidelidad exacta al HTML | Solo en servidor, no edge |

**Recomendación preliminar:** `@react-pdf/renderer` — coherente con el stack React
y permite reutilizar la estructura del Excel export que ya existe.

**Contrato pendiente de ARCH:**

```typescript
// src/modules/invoices/services/InvoicePDFService.ts
generateInvoiceBookPDF(
  companyId: string,
  periodId: string,
  invoiceType: InvoiceType
): Promise<Buffer>
```

**Formato requerido (SENIAT):**

- Encabezado: nombre empresa, RIF, período
- Columnas: idénticas al Excel export existente
- Totales al pie de cada página
- Número de página: "Página X de Y"
- Firma digital: NO (Fase 24)

---

### 18.3 — Efectos de Cascada en TaxCategory (SIN SCHEMA, IMPL READY ✅)

**Estado: LISTO PARA IMPL — no requiere cambio de schema**

**Contrato de comportamiento UI:**

- Trigger: usuario cambia `taxCategory` en `InvoiceForm`
- Si nuevo valor es `EXENTA | EXONERADA | NO_SUJETA`:
  1. Mostrar `AlertDialog` de confirmación (shadcn/ui)
  2. Si confirma: `resetField("taxLines")` → una línea `EXENTO` con base vacía
  3. Si cancela: revertir select al valor anterior (usar `useRef` para guardar valor previo)
- Si nuevo valor es `IMPORTACION`:
  1. Mostrar campo `importFormNumber` como `required`
  2. El campo ya existe en schema (`importFormNumber String?`)

**Sin cambios de DB. Sin cambios de Service. Solo UI + validación Zod.**

---

### 18.4 — Vinculación Retencion ↔ Invoice (ARCH PENDIENTE ⏳)

**Estado: PENDIENTE — cambio de schema requerido**

**Schema propuesto (confirmar con ARCH):**

```prisma
model Retencion {
  // ... campos existentes ...
  invoiceId String?
  invoice   Invoice? @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
}
```

Migración: `npx prisma migrate dev --name link_retention_invoice`

**Contrato de Service pendiente:**

```typescript
// Agregar a RetentionService
linkRetentionToInvoice(retentionId: string, invoiceId: string, companyId: string): Promise<Retencion>
getRetentionsByInvoice(invoiceId: string, companyId: string): Promise<Retencion[]>
```

---

### 18.5 — Comprobantes de Retención PDF (DEPENDE de 18.2)

**Estado: BLOQUEADO — esperar decisión de librería PDF de 18.2**

**Contrato tentativo:**

```typescript
// src/modules/retentions/services/RetentionVoucherService.ts
generateVoucher(retentionId: string, companyId: string): Promise<Buffer>
getNextVoucherNumber(companyId: string, periodId: string): Promise<string>
// getNextVoucherNumber requiere Serializable — mismo patrón que controlNumber
```

---

### 18.6 — Validación RIF (SIN SCHEMA, IMPL READY ✅)

**Estado: LISTO PARA IMPL — solo Zod, sin cambios de schema ni service**

**Contrato Zod (agregar a schemas existentes):**

```typescript
// Regex oficial SENIAT: J, V, E, G, C, P seguido de 8 dígitos y dígito verificador opcional
const rifSchema = z.string().regex(/^[JVEGCP]-\d{8}-?\d?$/i, {
  error: "RIF inválido. Formato: J-12345678-9",
});

// Aplicar en:
// - CreateInvoiceSchema campo counterpartRif
// - RetentionSchema campo providerRif
```

---

## Decisiones Arquitectónicas Globales Pendientes

### Idempotencia en Actions de creación fiscal

**Estado: PENDIENTE ARCH**
Campos a agregar en schema:

```prisma
model Invoice {
  idempotencyKey String? @unique
}
model Retencion {
  idempotencyKey String? @unique
}
```

Lógica en Action: verificar si ya existe registro con ese `idempotencyKey` antes de crear.

### Soft Delete en entidades fiscales

**Estado: PENDIENTE ARCH**
Entidades candidatas: `Invoice`, `Retencion`, `IGTFTransaction`, `Account`
Campo a agregar: `deletedAt DateTime?`
Implicación: todos los queries deben agregar `where: { deletedAt: null }`

### RLS (Row Level Security)

**Estado: DISEÑO PENDIENTE — Fase 13**
⚠️ Neon con PgBouncer en modo `transaction` rompe `SET LOCAL`.
Requiere usar conexión directa (no pooled) de Neon para RLS.
Decisión arquitectónica bloqueante: ¿conexión directa para todas las queries o solo las que necesitan RLS?

---

## Contratos Cerrados ✅

### Singleton PrismaClient + Neon Adapter (resuelto 2025-XX-XX)

- Runtime: `@prisma/adapter-pg` con URL pooled (`-pooler`)
- Migraciones CLI: `DATABASE_URL_DIRECT` en `prisma.config.ts` (sin pooler)
- Pendiente Fase 13: evaluar migración a `@neondatabase/serverless` bajo carga
