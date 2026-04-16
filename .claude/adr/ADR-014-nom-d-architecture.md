# ADR-014-NOM-D — Decisiones Arquitectónicas Finales (Validadas 2026-04-16)

**Fecha:** 2026-04-16
**Estado:** VALIDADO — GO IMPLEMENTATION
**Referencia:** ADR-014-nom-d-prestaciones.md (8 decisiones preexistentes) + sesión de validación 2026-04-16

---

## Resumen Ejecutivo

| Decisión | Elección | Status |
|---|---|---|
| Liquidación | Manual wizard (DRAFT→FINALIZING→FINALIZED) | ✅ VALIDADO |
| Intereses BCV | BcvBenefitRate(companyId, year, month) + FK snapshot | ✅ EXCELENTE |
| Serializable SSI | Read Committed (@@unique + mutex) — Serializable solo ADR-001 | ✅ CORRECTO |
| Timeline | Scope completo, 3-4 semanas | ✅ REALISTA |
| RFC adicional | ADR-014 suficiente — no redundante | ✅ ENTENDIDO |

---

## 1. Liquidación: Manual Wizard con 3 Estados

**Decisión:** DRAFT → FINALIZING → FINALIZED

**Justificación:**
- Liquidación es documento legal con firma del trabajador (LOTTT Art. 102–105)
- Automático crearía asientos sin revisión humana → riesgo legal
- Usuario revisa montos en DRAFT antes de confirmar
- FINALIZING = estado intermedio visible para soporte si falla la transacción

**Implementación:**
```typescript
// DRAFT → FINALIZING mutex (guard doble-finalización)
const guard = await tx.termination.updateMany({
  where: { id, companyId, status: 'DRAFT' },
  data: { status: 'FINALIZING' },
});
if (guard.count === 0) throw new Error('Liquidación ya finalizada o en proceso');

// FINALIZING → FINALIZED (en el mismo $transaction)
await tx.termination.update({
  where: { id },
  data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedByUserId: userId },
});
```

---

## 2. Intereses BCV: Tabla + Snapshot Inmutable

**Decisión:** Tabla `BcvBenefitRate(companyId, year, month)` — INSERT ADMIN-only — snapshot `appliedRate` en `BenefitAccrualLine`

**Validación Zod (ADMIN action):**
```typescript
annualRate: z.number().positive().max(500)
// 500% ceiling para hiperinflación venezolana (ADR-014 Dec. 2)
```

**Acciones de interés NO reciben `rate`:**
```typescript
// postBenefitInterestAction(companyId, { year, month })  ← sin rate
// Service fetches from BcvBenefitRate table — CRITICAL-3
```

---

## 3. Serializable SSI: Read Committed Suficiente

**Decisión:** NO Serializable para NOM-D. Solo ADR-001 (correlativos fiscales).

**Razón — accrueQuarter:**
- `@@unique([benefitBalanceId, year, quarter, type])` previene insert duplicado (P2002)
- Race condition → P2002 → catch → skip → no corrección incorrecta
- Serializable sería overkill y aumentaría serialization failures en Neon serverless

**Razón — finalizeTermination:**
- `updateMany({ where: { status: 'DRAFT' } })` es atómico bajo Read Committed (row-level lock interno)
- `count === 0` detecta si otro proceso ganó la race
- Suficiente para liquidación (operación rara, no concurrente en la práctica)

---

## 4. Timeline y Scope

**Scope completo** — sin recorte.

| Servicio | Tests estimados |
|---|---|
| BenefitAccrualService ✅ | ~15 |
| VacationService | ~12 |
| ProfitSharingService | ~10 |
| TerminationService | ~8 |
| Server Actions (5-6) | ~10 |
| UI + Rutas | ~5 |
| **Total** | **~60** |

Sin presión de cliente específico. NOM-D es requisito legal pre-launch.

---

## 5. ADR-014 Suficiente — Sin RFC Adicional

`ADR-014-nom-d-prestaciones.md` documenta las 8 decisiones técnicas preexistentes. Este documento recoge las decisiones de sesión adicionales. No se requiere RFC separado.

---

## Referencias

- **ADR-014-nom-d-prestaciones.md** — 8 decisiones técnicas detalladas
- **ADR-006** — Security hardening (D-3: tasas configurables pero validadas)
- **ADR-001** — Serializable SSI solo para correlativos fiscales
- **LOTTT Venezuela** — Arts. 92, 102–105, 131–132, 142–143, 190–192
- **VEN-NIF / NIC 19** — Causación periódica de beneficios laborales
