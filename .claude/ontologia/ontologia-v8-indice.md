# Ontología Contable V8 — Índice y Secciones Clave

**Versión:** 8.0 — Fase 26B completada (1391 tests GREEN)
**Especialización:** Venezuela (VEN-NIF / COT / LOTTT)
**Propósito:** Documento fuente de verdad integral.

> ⚠️ El documento completo es extenso. Este índice apunta a las secciones más usadas.
> El archivo fuente original se recibe como attachment en las sesiones de trabajo.

---

## Índice de Secciones

| Sección | Título | Cuándo consultar |
|---------|--------|-----------------|
| **1** | Cimientos — Partida Doble | Siempre, antes de cualquier asiento |
| **2** | Inmutabilidad y Auditoría | Al crear cualquier mutation fiscal |
| **3** | Catálogo de Cuentas VEN-NIF | Al buscar código de cuenta |
| **4** | Matriz de Composición Contable | Al estructurar un asiento nuevo |
| **5** | Reglas de Validación Lógica | Al validar precondiciones de negocio |
| **6** | Multipaís (VEN/DIAN/AFIP) | Al agregar lógica condicional por jurisdicción |
| **23** | Matriz Composición (V4) | Operaciones + ejemplos completos |
| **24** | Catálogo Cuentas (V4) | Códigos + naturaleza + fase |
| **25** | Validaciones Lógica (V4) | Precondiciones + ejemplos de código |
| **26** | Multipaís (V4) | VEN/DIAN/AFIP |
| **27** | Dependencias Fases (V5) | Grafo de cascada entre módulos |
| **28** | Impactos por Cambio (V5) | Checklists "si cambio X, qué se rompe" |
| **29** | Observabilidad (V6) | Integridad en tiempo real |
| **31** | Diferencial Cambiario (V8) | Asiento automático ganancia/pérdida |
| **32** | IGTF Sombra (V8) | Estados DRAFT/DECLARED/AUDITED vinculado a PaymentRecord |
| **33** | Bonos No Salariales (V8) | isPresttacional = false |
| **34** | Backup Fiscal (V8) | Hash SHA256 + Object Storage + Background Jobs |
| **35** | Recuperación ante Desastres (V8) | Re-validación de integridad + Comunicación SENIAT |

---

## Reglas de Oro (Resumen Ejecutivo)

### 1. Partida Doble — SIEMPRE
```
Σ(Débitos) - Σ(Créditos) = 0
```

### 2. Naturaleza de Cuentas
- **Deudoras** (Activo, Gasto): aumentan por el Debe
- **Acreedoras** (Pasivo, Patrimonio, Ingreso): aumentan por el Haber

### 3. Inmutabilidad
```typescript
// ❌ PROHIBIDO
await prisma.journalEntry.delete({ where: { id } });

// ✅ CORRECTO
await prisma.invoice.update({
  where: { id },
  data: { status: 'VOIDED', voidedAt: new Date(), voidReason: '...' }
});
```

### 4. AuditLog DENTRO del mismo $transaction
```typescript
// ✅ CORRECTO — atómico
await prisma.$transaction([
  prisma.invoice.create({ ... }),
  prisma.auditLog.create({ ... })
]);
```

### 5. Tipos Fiscales VEN-NIF
```
IVA: General 16% | Reducido 8% | Adicional Lujo 15% | Exento/Exonerado 0%
IGTF: 3% si currency !== VES (o SPE + VES)
Retenciones IVA: 75%/100% (solo Contribuyentes Especiales)
Retenciones ISLR: Decreto 1808, tasas variables
```

---

## Catálogo Rápido de Cuentas (Más Usadas)

### Activo Circulante
| Código | Nombre |
|--------|--------|
| 1010 | Caja VES |
| 1015 | Caja USD |
| 1020 | Bancos Locales |
| 1025 | Bancos Extranjeros |
| 1030 | Clientes — Factura (CxC) |
| 1070 | IVA Retención por Recuperar 16% |
| 1080 | Retención ISLR por Recuperar |

### Pasivo Circulante
| Código | Nombre |
|--------|--------|
| 2110 | Proveedores — Factura (CxP) |
| 2215 | IVA por Pagar 16% |
| 2217 | IVA por Pagar 8% |
| 2219 | IVA por Pagar Lujo 15% |
| 2230 | Retención IVA Recibida |
| 2240 | Retención ISLR Recibida |
| 2250 | IGTF por Pagar |
| 2260 | Salarios por Pagar |
| 2270 | Retenciones Empleado por Pagar |
| 2280 | Aportes Patronales por Pagar |
| 2290 | Prestaciones Sociales por Pagar |

### Ingresos
| Código | Nombre |
|--------|--------|
| 4010 | Ventas Gravadas 16% |
| 4012 | Ventas Gravadas 8% |
| 4020 | Ventas Exentas |

### Gastos
| Código | Nombre |
|--------|--------|
| 6010 | Costo de Ventas |
| 6020 | Gasto de Nómina |
| 6030 | Gasto Aportes Sociales Patronales |
| 6040 | Gasto Provisión Prestaciones Sociales |
| 6100 | Gasto Depreciación |
| 6110 | Gasto Ajuste Inflación (INPC) |

---

## Nuevas Secciones V8 — Resumen

### Sección 31: Diferencial Cambiario Automático
```
Factura USD 1,000 @ tasa 480 VES → devengo VES 480,000
Pago recibido @ tasa 490 VES → flujo real VES 490,000
Asiento automático en pago:
  Débito:  Bancos (monto recibido real)   490,000
  Crédito: CxC (monto original)                    480,000
  Crédito: Ganancia Diferencial Cambiario           10,000
```

### Sección 32: IGTF Sombra
- Vinculado a `PaymentRecord`, NO a `Invoice`
- Estados: DRAFT → DECLARED → AUDITED
- @@unique([paymentRecordId]) — 1 IGTF por pago, evita doble-cálculo
- Declaración mensual al BCV: sumar todos los DRAFT del mes → marcar DECLARED

### Sección 33: Bonos No Salariales
- `isPresttacional = false` → bono NO afecta cálculo de prestaciones (Art. 142 LOTTT)
- Base de prestaciones = solo salario base (no bonos libres)

### Sección 34: Backup Fiscal Inmutable
- PDF/JSON → Object Storage (S3/R2), NO en BD
- BD guarda solo: URL + SHA256 hash + metadata
- Background job (QStash/Inngest) genera reporte sin timeout de Server Action
- Verificación: recalcular hash → comparar con stored hash

### Sección 35: Recuperación ante Desastres
- Hash no coincide: determinar causa (schema change vs corrupción)
- Transacción incompleta: archivo existe sin hash → recalcular; hash existe sin archivo → re-generar
- Descuadre post-cierre: asiento de corrección en mes actual (NO reabrir período cerrado)
- Comunicación SENIAT: template documentado para incidentes de integridad

---

## ADR-015 (Borrador) — Eventos Extemporáneos

Ver: `.claude/adr/ADR-015-BORRADOR-eventos-extemporaneos.md`

**TL;DR:** Cuando un contador necesita ajustar un período cerrado:
- No reabrir el período
- Crear `AuditoryAdjustment` en el período ACTUAL
- Vincular causalmente al período afectado
- Para Forma 30: versioning (v1 → v2 rectificativa)
- Para nómina: `PayrollRetroactiveAdjustment` en nuevo run

---

## Checklist Contable Pre-Implementación

1. ✅ ¿Afecta partida doble? → Validar que todo asiento cuadre
2. ✅ ¿Usa dinero? → Siempre Decimal.js, nunca float
3. ✅ ¿Es mutation fiscal? → `$transaction` obligatorio + AuditLog
4. ✅ ¿Genera numero correlativo? → Serializable + SELECT FOR UPDATE
5. ✅ ¿Implica retenciones? → Revisar cascada ISLR/IVA
6. ✅ ¿Es multimoneda? → Tasa BCV del día + diferencial cambiario (Sección 31)
7. ✅ ¿Aplica a nómina? → Revisar LOTTT, aportes, prestaciones
8. ✅ ¿Requiere período cerrado? → Guard en Service Layer
9. ✅ ¿Tiene riesgo de IDOR? → Validar companyId explícitamente
10. ✅ ¿Es reportable a SENIAT? → Segregación por alícuota / código ISLR
11. ✅ ¿Pago en divisas? → Crear IGTFShadowTransaction (Sección 32)
12. ✅ ¿Genera reporte fiscal? → Hash SHA256 + Object Storage (Sección 34)
