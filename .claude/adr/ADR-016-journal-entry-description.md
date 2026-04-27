# ADR-016 — Glosa Analítica en JournalEntry (`description String?`)

**Estado:** APROBADO  
**Fecha:** 2026-04-26  
**Autor:** Claude (sesión c820c43e) + revisión Gustavo  
**Fase:** Fase 35E

---

## Contexto

El `Libro Mayor` muestra actualmente `entry.transaction.description` en cada línea de `JournalEntry`. Un contador real señaló que esto genera problemas de credibilidad fiscal: la misma descripción genérica (ej: "Venta de mercancía factura #100") aparece en todas las líneas del Mayor — IVA, COGS, Clientes, Inventario — cuando cada línea debe explicar su rol específico en la operación.

Esto NO es cosmético: un auditor fiscal espera ver "IVA 16% sobre venta — factura #100" en la línea del IVA, no la glosa de la operación completa.

---

## Decisión

Agregar `description String?` a `JournalEntry`:

```prisma
model JournalEntry {
  id            String      @id @default(cuid())
  amount        Decimal     @db.Decimal(19, 4)
  description   String?     // Glosa analítica por línea — rol específico en la operación
  transactionId String
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Restrict)
  accountId     String
  account       Account     @relation(fields: [accountId], references: [id])
}
```

- **Nullable** para retrocompatibilidad con entradas históricas sin glosa
- **Generada automáticamente** por cada Service en el momento de crear los entries
- **Fallback en UI:** `entry.description ?? entry.transaction.description`
- Ningún módulo queda bloqueado si omite el campo temporalmente

---

## Alternativas rechazadas

| Alternativa | Motivo de rechazo |
|---|---|
| Usar solo `transaction.description` | Genera credibilidad fiscal rota — mismo texto en todas las líneas |
| Campo NOT NULL con default vacío | Rompe retrocompatibilidad + no hay default semántico útil |
| Vista calculada en query | No persiste la intención del operador — pierde auditoría |
| Diferir a post-launch | Rechazado explícitamente por el usuario: un contador real lo señaló como crítico |

---

## Consecuencias

### Positivas
- Libro Mayor con credibilidad fiscal: cada línea muestra su rol en la operación
- Retrocompatibilidad: entradas existentes muestran `transaction.description` como fallback
- Audit trail enriquecido: la glosa es parte del registro inmutable

### Negativas / Costos
- 14 puntos de creación de `JournalEntry` requieren actualización (mapeados abajo)
- Una migración de schema necesaria

---

## Implementación — Los 14 puntos

### 1. `src/modules/accounting/services/TransactionService.ts` (~línea 157)
- Array `entries` pre-construido antes de `entries: { create: entries }`
- Agregar campo `description?: string` al tipo de entrada
- Los callers (InvoiceService, etc.) pasan la description

### 2. `src/modules/payroll/services/PayrollRunService.ts` (~línea 438)
Templates de aprobación de PayrollRun:
- Gasto nómina: `"Nómina [periodLabel] — salario bruto — [N] empleados"`
- Pasivo neto: `"Nómina [periodLabel] — neto a pagar empleados"`
- IVSS patronal: `"Nómina [periodLabel] — aporte IVSS [%] patronal"`
- FAOV patronal: `"Nómina [periodLabel] — aporte FAOV [%] patronal"`
- INCES: `"Nómina [periodLabel] — aporte INCES [%]"`
- Retenciones empleado: `"Nómina [periodLabel] — retenciones empleado (IVSS+FAOV+ISLR)"`

### 3. `src/modules/payroll/services/BenefitAccrualService.ts` (~líneas 237-248, 398-408)
- Gasto accrual trimestral: `"Accrual prestaciones LOTTT Art.142 — [periodo]"`
- Pasivo accrual trimestral: `"Pasivo prestaciones — [periodo]"`
- Gasto intereses BCV: `"Intereses BCV sobre prestaciones — [periodo]"`
- Pasivo intereses BCV: `"Pasivo intereses prestaciones — [periodo]"`

### 4. `src/modules/payroll/services/BenefitAdvanceService.ts` (~líneas 129-140)
- Débito pasivo: `"Anticipo prestaciones — empleado [NOMBRE/ID]"`
- Crédito banco: `"Pago anticipo prestaciones — empleado [NOMBRE/ID]"`

### 5. `src/modules/payroll/services/VacationService.ts` (~líneas 158-168)
- Gasto: `"Accrual vacaciones LOTTT Art.190 — [periodo]"`
- Pasivo: `"Pasivo vacaciones — [periodo]"`

### 6. `src/modules/payroll/services/ProfitSharingService.ts` (~líneas 189-200)
- Gasto: `"Accrual utilidades LOTTT Art.131 — [año]"`
- Pasivo: `"Pasivo utilidades — [año]"`

### 7. `src/modules/payroll/services/TerminationService.ts` (~línea 530)
- Array `journalEntries` pre-construido — agregar description por componente
- Concepto general: `"Liquidación final — [empleado] — [fecha]"`
- Por componente específico: template por vacaciones/prestaciones/utilidades

### 8. `src/modules/inventory/services/InventoryAccountingService.ts` (~línea 113)
- ENTRADA inventario: `"ENTRADA inventario — [item.name] — factura #[ref]"`
- COGS salida: `"COGS — Costo venta [item.name] — factura #[ref]"`
- Inventario salida: `"SALIDA inventario — [item.name] — factura #[ref]"`
- AJUSTE: `"AJUSTE inventario — [item.name] — [motivo]"`

### 9. `src/modules/inflation/services/INPCService.ts` (~líneas 401-406)
- Cuenta no monetaria: `"Reexpresión INPC — [account.name] — factor [X.XX] — [periodo]"`
- Diferencial INPC: `"Diferencial reexpresión INPC — [periodo]"`
- REPOMO: `"REPOMO — posición monetaria neta — [periodo]"`

### 10. `src/modules/fixed-assets/services/FixedAssetService.ts` (~líneas 250-262)
- Gasto depreciación: `"Depreciación: [asset.name] — método [method] — [mes/año]"`
- Depreciación acumulada: `"Dep. Acumulada: [asset.name] — [mes/año]"`

### 11-12. `src/modules/fiscal-close/services/FiscalYearCloseService.ts` (~líneas 217, 359)
- Cierre ingresos/gastos (createMany): `"Cierre año [año] — [account.name]"`
- Cuenta resultado: `"Resultado del ejercicio [año]"`
- Apropiación resultado: `"Apropiación resultado — año [año]"`
- Utilidades retenidas: `"Traslado a utilidades retenidas — año [año]"`

---

## Cambio en UI — Libro Mayor

**Archivo:** `src/modules/accounting/actions/report.actions.ts`  
**Función:** `getLedgerAction` (~línea 228)

```typescript
// ANTES
description: entry.transaction.description,

// DESPUÉS
description: entry.description ?? entry.transaction.description,
```

**Archivo:** `src/app/(dashboard)/company/[companyId]/reports/ledger/page.tsx`  
No requiere cambio — ya renderiza `entry.description` directamente.

---

## Branch

`feat/fase-35e-journal-description`

## Migración

```bash
npx prisma migrate dev --name add_journal_entry_description
```

---

## Estado de implementación

- ✅ ADR aprobado
- ✅ Schema modificado (`description String?` en JournalEntry)
- ✅ Migración aplicada (`20260427_add_journal_entry_description`)
- ✅ Servicios actualizados (10 archivos, 14 puntos de creación)
- ✅ Libro Mayor actualizado (`entry.description ?? entry.transaction.description`)
- ✅ TSC 0 errores | 1443 tests GREEN
- Branch: `feat/fase-35e-journal-description` (pendiente merge a main)
