# Módulo Caja Chica (Fondo Fijo) — Especificación VEN-NIF

**Versión:** 1.0
**Estado:** 📋 ESPECIFICACIÓN — Listo para implementación
**Fase propuesta:** Post-lanzamiento (Fase 35D)
**Dependencias:** Fase 12+ (Facturación base)

---

## 1. Contexto Contable

**Caja Chica (Fondo Fijo):** Fondo de efectivo para gastos menores, inmediatos, que no requieren cheque o transferencia bancaria.

**Marco legal:**
- COT Art. 89 — exige comprobante para toda erogación
- Providencia 0071 SENIAT — requiere registro en Libro Diario
- NCVIF Art. 8 — separación de cajas según naturaleza

**Diferencia clave:** Caja Chica ≠ Caja General
- Caja General: todas las entradas/salidas por ventas/compras
- Caja Chica: solo gastos operativos menores, fondos fijos

**Impacto contable:**
- Sin caja chica: 100+ asientos menores por gastos, saturación del Libro Diario
- Con caja chica: 1 asiento inicial (depósito) + 1 asiento mensual (reembolso) + N vouchers

---

## 2. Modelo de Datos — Schema Prisma

```prisma
model CajaCaja {
  id          String         @id @default(cuid())
  companyId   String
  company     Company        @relation(fields: [companyId], references: [id], onDelete: Restrict)
  name        String
  accountId   String
  account     Account        @relation(fields: [accountId], references: [id], onDelete: Restrict)
  currency    Currency       @default(VES)
  maxBalance  Decimal        @db.Decimal(19, 4)
  status      CajaCajaStatus @default(ACTIVE)
  createdAt   DateTime       @default(now())
  createdBy   String
  closedAt    DateTime?
  closedBy    String?

  deposits        CajaCajaDeposit[]
  movements       CajaCajaMovement[]
  reimbursements  CajaCajaReimbursement[]

  @@unique([companyId, accountId])
  @@index([companyId, status])
}

enum CajaCajaStatus { ACTIVE  INACTIVE  CLOSED }

model CajaCajaDeposit {
  id                   String        @id @default(cuid())
  companyId            String
  cajaCajaId           String
  cajaCaja             CajaCaja      @relation(fields: [cajaCajaId], references: [id], onDelete: Restrict)
  date                 DateTime
  amount               Decimal       @db.Decimal(19, 4)
  description          String
  supportingDocumentId String?
  journalEntryId       String?       @unique
  status               DepositStatus @default(PENDING)
  voidedAt             DateTime?
  voidReason           String?
  createdAt            DateTime      @default(now())
  createdBy            String

  @@index([companyId, cajaCajaId])
}

enum DepositStatus { PENDING  POSTED  VOIDED }

model CajaCajaMovement {
  id                   String          @id @default(cuid())
  companyId            String
  cajaCajaId           String
  cajaCaja             CajaCaja        @relation(fields: [cajaCajaId], references: [id], onDelete: Restrict)
  date                 DateTime
  voucherNumber        String          // "CCC-2026-00001"
  concept              String
  description          String?
  expenseAccountId     String
  expenseAccount       Account         @relation("CajaCajaExpenseAccount", fields: [expenseAccountId], references: [id], onDelete: Restrict)
  amount               Decimal         @db.Decimal(19, 4)
  currency             Currency        @default(VES)
  supportingDocumentId String?
  notes                String?
  status               MovementStatus  @default(PENDING)
  approvedAt           DateTime?
  approvedBy           String?
  reimbursedAt         DateTime?
  voidedAt             DateTime?
  voidReason           String?
  createdAt            DateTime        @default(now())
  createdBy            String

  @@unique([companyId, voucherNumber])
  @@index([companyId, cajaCajaId])
  @@index([status, date])
}

enum MovementStatus { PENDING  APPROVED  REIMBURSED  VOIDED }

model CajaCajaReimbursement {
  id                      String               @id @default(cuid())
  companyId               String
  cajaCajaId              String
  cajaCaja                CajaCaja             @relation(fields: [cajaCajaId], references: [id], onDelete: Restrict)
  monthYear               String               // "2026-04"
  reimbursementNumber     String               // "REIMB-2026-00001"
  totalExpensesConverted  Decimal              @db.Decimal(19, 4)
  journalEntryId          String?              @unique
  status                  ReimbursementStatus  @default(DRAFT)
  postedAt                DateTime?
  postedBy                String?
  voidedAt                DateTime?
  voidReason              String?
  createdAt               DateTime             @default(now())
  createdBy               String

  @@unique([companyId, reimbursementNumber])
  @@index([companyId, cajaCajaId])
}

enum ReimbursementStatus { DRAFT  POSTED  VOIDED }
```

---

## 3. Flujo Operativo

### Caso 1: Crear Caja Chica
```
UI → createCajaCajaAction
Sistema crea CajaCaja(status=ACTIVE)
Saldo inicial = 0
```

### Caso 2: Depósito Inicial
```
Asiento automático:
  Débito:  1010 (Caja VES)    VES 50,000,000
  Crédito: 1020 (Bancos)                      VES 50,000,000
```

### Caso 3: Registrar Gasto (Voucher)
```
Crea CajaCajaMovement(status=PENDING)
NO crea asiento contable aún (se crea al reembolsar)
Saldo caja disponible se reduce en tiempo real
Requiere soporte si monto > VES 500,000
```

### Caso 4: Aprobar Gasto (ADMIN only)
```
PENDING → APPROVED
Verifica: soporte obligatorio si > 500K, período OPEN
```

### Caso 5: Reembolso Mensual
```
Asiento borrador automático:
  Débito:  Cuenta Gasto del movimiento (N líneas)
  Crédito: 1010 (Caja VES)   (total de todos los gastos)

Todos los movimientos APPROVED → REIMBURSED
```

### Caso 6: Postear Asiento (Contador)
```
Valida: partida doble cuadra, período OPEN, rol ADMIN
JournalEntry(status=POSTED)
CajaCajaReimbursement.status → POSTED
```

---

## 4. Validaciones Clave

| Regla | Descripción |
|-------|-------------|
| Sobregiro | Saldo disponible >= monto gasto |
| Soporte obligatorio | Si monto > VES 500,000 → soporte requerido |
| Voucher único | @@unique([companyId, voucherNumber]) |
| Período abierto | Guard en toda mutation |
| Aprobación ADMIN | Aprobar/Postear/Anular → ADMIN only (ADR-006 D-1) |
| Amount ceiling | MAX VES 10,000,000,000 (ADR-006 D-2) |
| Rate limit | checkRateLimit(limiters.fiscal) (ADR-006 D-5) |

---

## 5. Servicios

```
src/modules/cajachica/
├── __tests__/
│   ├── CajaCajaService.test.ts
│   ├── CajaCajaDepositService.test.ts
│   ├── CajaCajaMovementService.test.ts
│   └── CajaCajaReimbursementService.test.ts
├── components/
│   ├── CajaCajaList.tsx
│   ├── CajaCajaMovementForm.tsx
│   ├── CajaCajaMovementList.tsx
│   └── CajaCajaBalanceCard.tsx
├── services/
│   ├── CajaCajaService.ts          (create, getCurrentBalance, getWithBalance)
│   ├── CajaCajaDepositService.ts   (createDeposit, void, listByBox)
│   ├── CajaCajaMovementService.ts  (createMovement, approve, void, listPending, sumApproved)
│   └── CajaCajaReimbursementService.ts (createMonthly, post, void)
├── actions/
│   └── cajachica.actions.ts
└── schemas/
    └── cajachica.schema.ts
```

---

## 6. Reporte Dashboard

```
┌─────────────────────────────────────┐
│ CAJA CHICA OPERATIVA                │
├─────────────────────────────────────┤
│ Saldo Total Depositado:   VES 50M   │
│ Gastos APPROVED (Pend.): VES 2M     │
│ Saldo Disponible:         VES 48M   │
│ % Utilizado:                   4%   │
├─────────────────────────────────────┤
│ Últimos Gastos:                     │
│ CCC-2026-00001 │ Café      350K     │
│ CCC-2026-00002 │ Taxi      250K     │
└─────────────────────────────────────┘
```

---

**Nota:** ContaFlow sin Caja Chica está incompleto para el mercado VEN-NIF. Reduce saturación del Libro Diario de 100+ asientos a 2/mes y cumple Providencia 0071 SENIAT (soportes auditables).
