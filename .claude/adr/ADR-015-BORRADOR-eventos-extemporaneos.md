# ADR-015 — Eventos Extemporáneos: Ajustes Retroactivos DESPUÉS del Cierre Formal del Ejercicio

**Status**: ACEPTADO — ALCANCE REDUCIDO por ADR-055 (2026-09-27)
**Prioridad**: MEDIA — con ADR-055 (ejercicio fiscal anual), los 12 meses del ejercicio quedan `OPEN`
en paralelo durante todo el año; este mecanismo ya NO es necesario para el caso que lo motivó
originalmente (ajustar "el mes de hace tres meses" mientras se prepara el cierre — ese mes simplemente
sigue abierto). El mecanismo de este ADR queda como respaldo exclusivo para correcciones DESPUÉS de que
`FiscalYearClose` ya existe para el año afectado (ej. hallazgo de auditoría SENIAT años después del
cierre formal). Ver `ADR-055-ejercicio-fiscal-anual.md` §Relación con ADR-015 para el razonamiento
completo.
**Referencia**: Feedback de contador real (audio WhatsApp 2026-04-25)
**Autor**: orchestrator-agent (compilación)

---

## Contexto del Problema

Un contador VEN-NIF necesita registrar eventos que ocurren DESPUÉS de cerrar un período:
- Facturas que llegan tarde (semana posterior al cierre)
- Decretos retroactivos de salario mínimo
- Sentencias laborales con ajustes de meses anteriores
- Auditorías SENIAT que generan Forma 30 rectificativa

**Cita textual del contador:**
> "Si el sistema es muy cuadrado y no te deja meter eso después de que cerraste, el contador te va a tirar el software por la cabeza."
> "Revísate eso de los retroactivos, que eso es clave para que alguien te lo compre aquí."

**Estado actual de ContaFlow:**
- ✅ ADR-005: "Nunca DELETE, solo VOID"
- ✅ R-3 (CLAUDE.md): "Período cerrado = bloqueo total" — nunca fue ADR-014; ese número corresponde a
  arquitectura de nómina/prestaciones, no relacionado. (Corregido 2026-09-27, ver ADR-055 — la
  referencia original a "ADR-014" en este documento era errónea, ADR-014 nunca trató este tema.)
- ❌ **Falta:** Mecanismo para registrar ajustes legales de períodos cerrados sin reabrir

---

## Decisión Propuesta

**Registrar ajustes EN OTRO PERÍODO con REFERENCIA CAUSAL al período afectado.**

### D-1: No Reabrir Período Cerrado (INVIOLABLE)
- Período cerrado queda inmutable (ADR-005 prevalece)
- Ajuste se registra en período ACTUAL
- Vinculación causal vía `AuditoryAdjustment`

### D-2: Forma30Declaration Versionada
- Cada versión es snapshot inmutable post-SUBMITTED
- Rectificativa crea nueva versión (v+1), no modifica anterior
- `status: AMENDED` marca versión anterior como corregida

### D-3: PayrollRetroactiveAdjustment No Reedita Run Original
- PayrollRun original status=PAID, nunca se modifica
- Diferencias se registran en NUEVO PayrollRun (mes de ajuste)
- Sistema calcula automáticamente diferencias por empleado

---

## Modelos Propuestos (para arch-agent revisión)

### Modelo 1: AuditoryAdjustment

```prisma
model AuditoryAdjustment {
  id              String    @id @default(cuid())
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)

  affectedYear    Int
  affectedMonth   Int
  discoveryDate   DateTime
  discoveryReason String

  correctionTransactionId String
  correctionTransaction   Transaction @relation(fields: [correctionTransactionId], references: [id], onDelete: Restrict)

  description     String
  createdAt       DateTime  @default(now())
  createdByUserId String

  @@index([companyId, affectedYear, affectedMonth])
  @@index([companyId, discoveryDate])
}
```

**Decisiones arch-agent pendientes:**
- ¿Permitir múltiples AuditoryAdjustment por (year, month)? Si sí: eliminar @unique
- ¿Forma30Declaration.referencedVersionId debe linkarse a AuditoryAdjustment?

### Modelo 2: Forma30Declaration

```prisma
model Forma30Declaration {
  id              String    @id @default(cuid())
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)

  declarationYear     Int
  declarationMonth    Int
  version             Int

  totalSalesGravada   Decimal  @db.Decimal(19,4)
  totalSalesExempt    Decimal  @db.Decimal(19,4)
  totalIvaGenerated   Decimal  @db.Decimal(19,4)
  totalIvaUsed        Decimal  @db.Decimal(19,4)
  totalIvaPayable     Decimal  @db.Decimal(19,4)

  status              DeclarationStatus
  submittedDate       DateTime?

  amendedReason       String?
  referencedVersionId String?
  referencedVersion   Forma30Declaration? @relation("AmendmentChain", fields: [referencedVersionId], references: [id])
  amendments          Forma30Declaration[] @relation("AmendmentChain")

  createdAt           DateTime  @default(now())
  createdByUserId     String
  lastModified        DateTime  @updatedAt

  @@unique([companyId, declarationYear, declarationMonth, version])
  @@index([companyId, status])
}

enum DeclarationStatus {
  DRAFT
  SUBMITTED
  AMENDED
  REJECTED
}
```

### Modelo 3: PayrollRetroactiveAdjustment

```prisma
model PayrollRetroactiveAdjustment {
  id              String    @id @default(cuid())
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)

  originalPayrollRunId  String
  originalPayrollRun    PayrollRun @relation("OriginalRun", fields: [originalPayrollRunId], references: [id], onDelete: Restrict)

  adjustmentReason      String
  applicableFromDate    DateTime
  discoveryDate         DateTime

  adjustmentPayrollRunId String
  adjustmentPayrollRun    PayrollRun @relation("AdjustmentRun", fields: [adjustmentPayrollRunId], references: [id], onDelete: Restrict)

  employeeCount          Int
  totalDifferenceAmount  Decimal @db.Decimal(19,4)

  createdAt              DateTime @default(now())
  createdByUserId        String
  description            String

  @@unique([originalPayrollRunId])
  @@index([companyId, discoveryDate])
}
```

---

## Impacto en ADRs Existentes

| ADR | Relación |
|-----|----------|
| ADR-005 (Inmutabilidad) | NO conflicto — ajuste en otro período respeta "nunca DELETE ni MODIFY" |
| R-3 (CLAUDE.md, período cerrado) | ACLARACIÓN — período cerrado ≠ absolutamente refractario; permite ajustes via AuditoryAdjustment |
| ADR-007 (RLS) | EXTENSIÓN — incluir 3 modelos nuevos en lista de tablas RLS |
| ADR-006 (Security) | APLICAR — role check en new actions (admin/accountant para registrar ajuste) |
| **ADR-055 (Ejercicio Fiscal Anual)** | **REDUCE EL ALCANCE** — con los 12 meses del ejercicio abiertos en paralelo durante todo el año, el caso de uso original ("ajustar hace 3 meses mientras preparo el cierre") ya no necesita este mecanismo: ese mes sigue OPEN. Este ADR queda vigente solo para correcciones DESPUÉS de que el ejercicio ya tiene `FiscalYearClose` formal. |

---

## Tasking para Implementación (si se aprueba)

### Fase 1: Schema + Services
- [ ] Crear 3 modelos Prisma
- [ ] Crear migración
- [ ] AuditoryAdjustmentService, Forma30Service actualizado, PayrollAdjustmentService
- [ ] Tests unitarios

### Fase 2: Actions
- [ ] registerAuditoryAdjustmentAction
- [ ] createAmendedDeclarationAction
- [ ] registerPayrollRetroactiveAction

### Fase 3: UI
- [ ] Histórico de ajustes por período
- [ ] Editor de Forma 30 versiones
- [ ] Visualizador de retroactivos de nómina

---

## Preguntas para arch-agent

1. **¿Aprobado incluir en próxima fase o post-launch?**
2. **¿Bloquea YAGNI o es "must-have" para MVP Venezuela?**
   - Sin esto: software es académicamente correcto, prácticamente inutilizable para el 80% de contadores venezolanos
   - **Actualización 2026-09-27 (ADR-055)**: con el ejercicio fiscal anual, este "80%" de casos de ajuste retroactivo ya no depende de este mecanismo — solo el caso post-cierre-formal (más raro) lo sigue necesitando. Prioridad revisada a MEDIA.
3. **¿RLS: incluir 3 modelos nuevos en misma migración que se haga?**

## Decisión Requerida

- ✅ APROBADO: crear ADR-015 formal e incorporar en roadmap — **con alcance reducido, ver header**
- ⏳ DIFERIDO: post-launch, máxima prioridad en feedback de primer cliente — **revisado a prioridad MEDIA por ADR-055**
- ❌ RECHAZADO: documentar por qué

**Recomendación del orchestrator:** DIFERIDO post-launch — el mecanismo de `AuditoryAdjustment` puede implementarse como primera fase post-lanzamiento al recibir el primer feedback de un contador real. **(2026-09-27: sigue diferido; su prioridad bajó porque ADR-055 resuelve la mayoría de los casos reales que lo motivaban.)**

---

**Referencias:**
- Feedback audio WhatsApp contador VEN-NIF (2026-04-25)
- `.claude/ontologia/ontologia-v8.md` Sección 35
- ADR-005, ADR-007
- **ADR-055** (2026-09-27) — reduce el alcance de este ADR, ver header y sección "Impacto en ADRs Existentes"
