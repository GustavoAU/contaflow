# ADR-014 — NOM-D: Prestaciones Sociales, Vacaciones, Utilidades, Liquidación Final

**Fecha:** 2026-04-15
**Estado:** DECIDIDO
**Contexto:** Fase NOM-D — módulo de beneficios laborales LOTTT Venezuela

---

## Dec. 1 — Schema de acumulación trimestral

**DECISIÓN:** Opción C — `BenefitBalance` (saldo corriente) + `BenefitAccrualLine` (evento por evento)

**RAZÓN:** La Opción A (una fila por quarter) es demasiado plana para representar el conjunto de eventos que afectan el saldo: accrual trimestral, intereses BCV, ajustes, anticipos y liquidación son de naturaleza distinta. La Opción B acopla el accrual al ciclo de PayrollRun, lo cual es incorrecto legalmente: el accrual trimestral (Art. 142 LOTTT) ocurre al cumplir cada trimestre de antigüedad, independientemente del ciclo de nómina.

**IMPLEMENTACIÓN:**
- `BenefitBalance`: saldo corriente desnormalizado para performance (proyección)
- `BenefitAccrualLine`: un registro por evento con `@@unique([benefitBalanceId, year, quarter, type])` — guard doble-accrual vía P2002
- `BenefitBalance.currentBalance` se actualiza dentro del mismo `$transaction` que crea `BenefitAccrualLine`

---

## Dec. 2 — Tasa BCV: rango de validación

**DECISIÓN:** Validar `> 0` con ceiling de `500%` anual en Zod. Tasa almacenada en tabla `BcvBenefitRate` (ADMIN-only). Nunca aceptada desde cliente en acciones de transacción.

**RAZÓN:** Tasa activa promedio BCV puede superar 200% en hiperinflación. Ceiling 500% actúa como límite de sanidad sin producir falsos negativos. Extiende ADR-006 D-3 a tasas laborales.

**IMPLEMENTACIÓN:**
```typescript
// Solo en acción de carga de tasa (ADMIN-only)
annualRate: z.number().positive().max(500)
// El servicio convierte: monthlyFactor = annualRate / 100 / 12
// postBenefitInterestAction(companyId, { year, month }) — sin campo rate
```

---

## Dec. 3 — Salario integral: snapshot vs tiempo real

**DECISIÓN:** Snapshot al momento del evento, almacenado en `BenefitAccrualLine`.

**RAZÓN:** Un cambio de salario posterior al accrual trimestral NO debe retroactivamente modificar prestaciones ya causadas. Principio de costo histórico (VEN-NIF). Idéntico al patrón `PayrollRunLine.salarySnapshotAmount` de ADR-013.

**IMPLEMENTACIÓN:**
```
Fórmula al momento del accrual:
  alicuota_util    = (payrollConfig.profitDays / 360) × dailyNormalWage
  alicuota_bon_vac = (payrollConfig.vacationBonusDays / 360) × dailyNormalWage
  integralDailyWage = dailyNormalWage + alicuota_util + alicuota_bon_vac
  accrualAmount    = integralDailyWage × accrualDays  // 5 días en año 1

Campos snapshot en BenefitAccrualLine:
  dailyNormalWage          Decimal @db.Decimal(19,4)  // snapshot
  profitDaysAliquot        Decimal @db.Decimal(19,4)  // snapshot
  vacationBonusDaysAliquot Decimal @db.Decimal(19,4)  // snapshot
  integralDailyWage        Decimal @db.Decimal(19,4)  // = suma de los tres
```

---

## Dec. 4 — Modelo Termination: denormalizado vs normalizado

**DECISIÓN:** Opción A — `Termination` desnormalizado con campos de monto por componente.

**RAZÓN:** La liquidación final es un documento laboral con valor legal inmutable al momento de la firma. Normalizar con FKs crea dependencias que complican `onDelete: Restrict`. FK nullable a `BenefitBalance` mantiene trazabilidad sin dependencias destructivas.

---

## Dec. 5 — Aislamiento de transacción en finalización

**DECISIÓN:** Read Committed suficiente para `finalizeTermination`. Serializable NO requerido.

**RAZÓN:** No genera número correlativo fiscal (ese es el caso Serializable per ADR-001). El guard de doble-finalización es el `updateMany` mutex (Dec. 6) que es atómico bajo Read Committed. Elevar a Serializable aumenta riesgo de serialization failures en Neon serverless sin beneficio de corrección.

---

## Dec. 6 — Double-finalization guard

**DECISIÓN:** `updateMany` mutex con estado intermedio `FINALIZING`.

**IMPLEMENTACIÓN:**
```typescript
const guard = await tx.termination.updateMany({
  where: { id, companyId, status: 'DRAFT' },
  data: { status: 'FINALIZING' },
});
if (guard.count === 0) throw new Error('Liquidación ya finalizada o no encontrada');
// Estados: DRAFT → FINALIZING → FINALIZED
// Si $transaction falla, queda en FINALIZING (visible para soporte)
```

---

## Dec. 7 — Asiento contable de prestaciones: por trimestre (causación periódica)

**DECISIÓN:** Un asiento por `BenefitAccrualLine` de tipo `QUARTERLY_ACCRUAL` y `BCV_INTEREST` al momento del evento (causación periódica).

**RAZÓN:** Bajo VEN-NIF (equivalente NIC 19) y principio de devengado, las prestaciones son un pasivo que se acumula con el tiempo de servicio. No reconocerlas hasta la liquidación viola el devengado y subestima el pasivo en estados financieros intermedios.

**Asientos por tipo:**
```
QUARTERLY_ACCRUAL:
  DB  Gastos de Personal — Prestaciones Soc.  [accrualAmount]
  CR  Prestaciones Sociales por Pagar          [accrualAmount]

BCV_INTEREST:
  DB  Gastos Financieros — Intereses Prest.   [interestAmount]
  CR  Prestaciones Sociales por Pagar          [interestAmount]

LIQUIDATION (en Termination):
  DB  Prestaciones Sociales por Pagar          [benefitsTotal]
  DB  Vacaciones por Pagar                     [vacationTotal]
  DB  Utilidades por Pagar                     [profitTotal]
  CR  Sueldos y Salarios por Pagar / Bancos    [totalNetAmount]
  CR  Deducciones por Pagar                    [deductionsAmount]
```

**PayrollConfig — 4 cuentas contables adicionales requeridas:**
- `benefitsExpenseAccountId` (EXPENSE)
- `benefitsPayableAccountId` (LIABILITY)
- `vacationPayableAccountId` (LIABILITY)
- `profitSharingPayableAccountId` (LIABILITY)

---

## Dec. 8 — Fracciones de vacaciones y utilidades: meses completos

**DECISIÓN:** Meses completos de servicio. Fracción de mes: 15+ días = mes completo; <15 días = descartado.

**RAZÓN:** Estándar de práctica laboral venezolana refrendado por jurisprudencia TSJ Sala Social. Criterio más favorable al trabajador sin generar conflicto legal.

**Fórmulas:**
```
// Vacaciones fraccionadas (Art. 192 LOTTT)
diasVacAnuales   = 15 + (añosAntiguedad - 1)  // mínimo legal, 1 día/año adicional
diasVacFracc     = round((diasVacAnuales / 12) × mesesServicioAño, 2)
montoVacFracc    = diasVacFracc × dailyNormalWage (snapshot)

// Bono vacacional fraccionado (Art. 192 LOTTT)
diasBonoAnuales  = 7 + (añosAntiguedad - 1)
diasBonoFracc    = round((diasBonoAnuales / 12) × mesesServicioAño, 2)

// Utilidades fraccionadas (Art. 132 LOTTT)
mesesAñoFiscal   = mesesCompletos(inicioAñoFiscal, terminationDate)
diasUtilConfig   = payrollConfig.profitDays   // 15–120
diasUtilFracc    = round((diasUtilConfig / 12) × mesesAñoFiscal, 2)
basePromedio     = promedio SalaryHistory en el año fiscal (snapshot)
montoUtilFracc   = diasUtilFracc × (basePromedio / 30)
```

---

## Seguridad — Findings críticos implementados (ADR-006 extendido)

| Finding | Mitigación |
|---|---|
| Double-accrual | `@@unique([benefitBalanceId, year, quarter, type])` + P2002 |
| IDOR finalizeTermination | `findFirst({ where: { id, companyId } })` siempre |
| Tasa BCV del cliente | Solo en `BcvBenefitRate` tabla (ADMIN-only), nunca en acción de transacción |
| Double-finalization | `updateMany` mutex + estado FINALIZING |
| Profit days 0/999 | Zod: `.int().min(15).max(120)` |
| Vacation days sin ceiling | Zod: `vacationDays: .max(90)`, `bonusDays: .max(90)` |
| dailyWage del cliente | Nunca en ningún schema de acción NOM-D |
| Termination de TERMINATED | Guard `employee.status === 'ACTIVE'` en TerminationService.create() |
| Rate limit faltante | `checkRateLimit(userId, limiters.fiscal)` en todas las acciones write |
| Período contable guard | `accountingPeriod.findFirst({ where: { status: 'OPEN' } })` en accrueQuarter |
| AuditLog faltante | `tx.auditLog.create` en todo `$transaction` |

## Fixes NOM-B residuales (MEDIUM) — implementados antes de NOM-D

- `terminationDate >= hireDate` — guard en `EmployeeService.terminate()`
- `initialSalaryAmount` ceiling 999_999_999 — en `CreateEmployeeSchema`
- `addSalary` bloqueado para empleados TERMINATED — en `EmployeeService.addSalary()`
