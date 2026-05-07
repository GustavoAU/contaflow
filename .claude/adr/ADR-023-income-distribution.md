# ADR-023 — IncomeDistribution: Distribución de Ingresos Multidestinatario (Fase 36D)

- **Estado**: DECIDIDO
- **Fecha**: 2026-05-06
- **Fase**: 36D (post-lanzamiento)
- **Depende de**: ADR-002 (Decimal), ADR-003 (onDelete Restrict), ADR-004 (companyId isolation), ADR-022 (PaymentBatch — patrón espejo)

---

## Contexto

Clientes distribuidores (cadenas de farmacias, cooperativas, empresas multi-sucursal) necesitan registrar un ingreso único y dividirlo automáticamente entre múltiples destinatarios a porcentajes fijos.

**Caso motivador**: Distribuidora recibe Bs. 10.135,00 en ventas. Necesita distribuir entre 8 sucursales (Farmacia Centro 40%, Farmacia Este 30%, etc.) y generar los comprobantes de retención correspondientes.

**Relación con Fase 36C**: ADR-023 es el **espejo inverso** de ADR-022 (PaymentBatch). Donde 36C distribuye un pago saliente entre múltiples facturas A/P, 36D distribuye un ingreso entrante entre múltiples destinatarios. Se reutiliza el mismo patrón: `DRAFT → APPLIED → VOID`, `Serializable`, idempotencyKey, auditoría separada.

---

## Decisiones

### D-1: Schema — Modelos principales

```prisma
enum IncomeDistributionStatus {
  DRAFT
  APPLIED
  VOID
}

model IncomeDistribution {
  id                  String                   @id @default(cuid())
  companyId           String
  company             Company                  @relation("IncomeDistributions", fields: [companyId], references: [id], onDelete: Restrict)

  referenceNumber     String?                  @unique @db.VarChar(50)
  description         String?                  @db.Text
  date                DateTime
  status              IncomeDistributionStatus @default(DRAFT)

  // Moneda y totales
  currencyCode        String                   @default("VES") @db.VarChar(3)
  totalAmountOriginal Decimal                  @db.Decimal(18, 2)
  totalAmountVes      Decimal                  @db.Decimal(18, 2)
  exchangeRate        Decimal                  @default(1) @db.Decimal(8, 6)

  // Cuenta de origen (obligatoria para generar asiento)
  originAccountId     String
  originAccount       Account                  @relation("IncomeDistributionOrigin", fields: [originAccountId], references: [id], onDelete: Restrict)

  // Asiento contable generado al aplicar
  transactionId       String?                  @unique
  transaction         Transaction?             @relation(fields: [transactionId], references: [id], onDelete: Restrict)

  idempotencyKey      String?                  @unique @db.VarChar(255)

  lines               IncomeDistributionLine[]
  audits              IncomeDistributionAudit[]

  deletedAt           DateTime?
  createdAt           DateTime                 @default(now())
  updatedAt           DateTime                 @updatedAt
  createdBy           String                   @db.VarChar(255)

  @@index([companyId, status])
  @@index([companyId, date])
  @@map("income_distributions")
}

model IncomeDistributionLine {
  id               String             @id @default(cuid())
  distributionId   String
  distribution     IncomeDistribution @relation(fields: [distributionId], references: [id], onDelete: Restrict)

  // Destinatario: empresa o sucursal registrada en el sistema
  recipientCompanyId String
  recipientCompany   Company          @relation("IncomeDistributionRecipients", fields: [recipientCompanyId], references: [id], onDelete: Restrict)

  // Cuenta contable destino (CxP del destinatario — obligatoria para asiento)
  accountId          String
  account            Account          @relation("IncomeDistributionLineAccounts", fields: [accountId], references: [id], onDelete: Restrict)

  percentageShare    Decimal          @db.Decimal(5, 2)
  amountVes          Decimal          @db.Decimal(18, 2)
  lineDescription    String?          @db.Text
  lineNumber         Int

  createdAt          DateTime         @default(now())

  @@unique([distributionId, recipientCompanyId])
  @@index([distributionId])
  @@map("income_distribution_lines")
}

model IncomeDistributionAudit {
  id             String             @id @default(cuid())
  distributionId String
  distribution   IncomeDistribution @relation(fields: [distributionId], references: [id], onDelete: Cascade)

  action         String             @db.VarChar(50) // CREATED | APPLIED | VOIDED

  changesSummary Json?

  userId         String             @db.VarChar(255)
  ipAddress      String?            @db.VarChar(45)
  userAgent      String?            @db.Text

  createdAt      DateTime           @default(now())

  @@index([distributionId])
  @@map("income_distribution_audits")
}
```

**Adiciones a modelos existentes:**
```prisma
// En Company:
incomeDistributions     IncomeDistribution[]     @relation("IncomeDistributions")
incomeDistributionLines IncomeDistributionLine[] @relation("IncomeDistributionRecipients")

// En Account:
incomeDistributionOrigins IncomeDistribution[]     @relation("IncomeDistributionOrigin")
incomeDistributionLines   IncomeDistributionLine[] @relation("IncomeDistributionLineAccounts")

// En Transaction:
incomeDistribution IncomeDistribution?
```

**Justificación vs borrador original:**
- `originAccountId` es campo explícito (NOT NULL) — el draft original intentaba inferir la cuenta por tipo (`CAJA`), lo que falla si el usuario no tiene esa cuenta configurada. Al requerirla en el form, la UI puede hacer un select de cuentas disponibles.
- `accountId` en `IncomeDistributionLine` es NOT NULL — cada línea necesita una cuenta CxP para generar el asiento válido.
- `transactionId` vincula el asiento generado en `applyDistribution` para trazabilidad contable (idéntico al patrón de `InventoryMovement.transactionId`).
- `IncomeDistributionAudit` separada, igual que `PaymentBatchAudit` en ADR-022, para no contaminar el `AuditLog` genérico.

---

### D-2: Validaciones (Zod + service layer)

**Validaciones Zod (en schema):**
```typescript
// V-1: Suma de porcentajes = 100%
// V-2: Sin destinatarios duplicados
// V-3: Al menos 2 líneas
// V-4: exchangeRate > 0
// V-5: totalAmountOriginal > 0
```

**Validaciones en service (post-cálculo):**
```typescript
// V-6: sum(lines.amountVes) === distribution.totalAmountVes (con tolerancia de ±0.01 por redondeo)
// V-7: Cada amountVes > 0
```

**Manejo de redondeo:**
Igual que PaymentBatch: la última línea absorbe el residuo para garantizar `sum(amountVes) === total`.
```typescript
// Líneas 1..N-1: ROUND_DOWN para evitar overflow
// Línea N: total - accumulated (sin redondeo adicional)
```

---

### D-3: Operaciones del service layer

Patrón de funciones plain (consistente con `PaymentBatchService`, `InventoryAccountingService`):

```typescript
export async function createDistribution(input, userId, ipAddress, userAgent)
// → DRAFT. Idempotente por idempotencyKey (SHA256). Serializable.

export async function applyDistribution(distributionId, companyId, userId, ipAddress, userAgent)
// → DRAFT → APPLIED. Genera Transaction + entries. Serializable + P2034 retry (3 intentos).

export async function voidDistribution(distributionId, companyId, notes, userId, ipAddress, userAgent)
// → APPLIED/DRAFT → VOID. Si APPLIED: genera contra-asiento. Serializable.
```

**Asiento contable en `applyDistribution`:**
```
Débito:  originAccount        totalAmountVes
Crédito: line[0].account      line[0].amountVes
Crédito: line[1].account      line[1].amountVes
...
Crédito: line[N].account      line[N].amountVes
```

Generado vía `tx.transaction.create({ entries: { create: [...] } })` — idéntico al patrón de `InventoryAccountingService.postMovement()`. **Nunca** `tx.journalEntry.create` directo.

**Numbering**: `DIST-${String(count + 1).padStart(6, "0")}` — generado en `applyDistribution` igual que los correlativos de inventario.

---

### D-4: Aislamiento multi-tenant

- Guard `companyId` en **todas** las queries: `findFirst({ where: { id, companyId } })` — nunca solo `findUnique({ where: { id } })`
- `recipientCompanyId` puede ser la misma empresa (distribución interna) o empresa diferente — ambos son `Company` registrados en el sistema
- La autorización verifica acceso del usuario a `companyId` (empresa origen), no a `recipientCompanyId`

---

### D-5: Idempotencia

`idempotencyKey = SHA256(companyId | date.toISO() | totalAmountVes | sorted(lines.recipientCompanyId:percentageShare))`

En `createDistribution`: si ya existe registro con esa key → retorna el existente sin error (mismo patrón que `PaymentBatch`).

---

### D-6: IP/UA tracking (R-6)

Las actions deben capturar IP/UA y propagarlos al service:
```typescript
const h = await headers();
const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
```

`IncomeDistributionAudit.ipAddress` + `.userAgent` deben recibir estos valores — nunca `""` hardcodeado.

---

### D-7: Migración — workflow manual obligatorio

`prisma migrate dev` está ROTO en este proyecto (shadow DB falla). Workflow obligatorio:

```bash
# 1. Crear migration SQL manualmente
# prisma/migrations/YYYYMMDD_fase36d_income_distribution/migration.sql

# 2. Aplicar
npx prisma db execute --file prisma/migrations/YYYYMMDD_fase36d_income_distribution/migration.sql

# 3. Marcar como aplicada
npx prisma migrate resolve --applied YYYYMMDD_fase36d_income_distribution

# 4. Regenerar tipos
npx prisma generate

# 5. Reiniciar dev server
```

Ver `feedback_prisma_migrate_dev_broken.md` en memoria del proyecto.

---

## Impacto en otros módulos

| Módulo | Cambio | Impacto |
|--------|--------|---------|
| `Company` | 2 nuevas relaciones | Low — opcionales |
| `Account` | 2 nuevas relaciones | Low — opcionales |
| `Transaction` | Nueva relación `incomeDistribution` | Low — opcional |
| Schema Prisma | 3 nuevos modelos + 1 enum | Medium — migración requerida |

---

## Estructura del módulo

```
src/modules/income-distribution/
├── actions/
│   ├── income-distribution.actions.ts   (create + apply + void en un archivo)
├── services/
│   └── IncomeDistributionService.ts     (plain functions, no class)
├── schemas/
│   └── income-distribution.schema.ts
├── components/
│   ├── IncomeDistributionForm.tsx
│   ├── IncomeDistributionList.tsx
│   └── VoidDistributionModal.tsx
└── __tests__/
    ├── IncomeDistributionService.test.ts
    └── income-distribution.actions.test.ts
```

---

## Decisiones pospuestas

| Tema | Razón | Cuándo |
|------|-------|--------|
| IGTF en distribuciones USD | Requiere consulta contable VEN-NIF | Fase 36E |
| Contra-asiento en `voidDistribution` cuando APPLIED | Lógica de reversal compleja; MVP: solo DRAFT → VOID sin asiento | Fase 36E |
| Correlativo `referenceNumber` auto-generado | ¿Serializable obligatorio? — sí, misma regla Z-1 | Al implementar |

---

## Referencias

- **ADR-022**: PaymentBatch — patrón base que se reutiliza (espejo inverso)
- **ADR-001**: Correlativos Serializable — aplica a `referenceNumber`
- **ADR-002**: Decimal.js obligatorio
- **ADR-003**: onDelete Restrict
- **ADR-004**: companyId isolation
- **Fase 36C**: Implementación de referencia
