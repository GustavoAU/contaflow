# Quick Reference para Claude Code — Guía Rápida de Decisiones Contables

**Propósito:** Cuando estés implementando una feature nueva, usa este documento para responder rápidamente: ¿qué validaciones, qué cuentas, qué reglas aplican?

---

## 🔴 Antes de Escribir Cualquier Código

### Checklist Pre-Implementación (2 minutos)

- [ ] ¿Es una operación que afecta dinero? → Siempre `Decimal.js`
- [ ] ¿Modifica un registro contable? → `$transaction` + `AuditLog` obligatorio
- [ ] ¿Genera un número (factura, comprobante)? → `Serializable` + `SELECT FOR UPDATE`
- [ ] ¿Requiere dividir IVA? → Segregar por alícuota (16/8/0)
- [ ] ¿Es multimoneda? → Aplicar tasa BCV + calcular diferencial
- [ ] ¿Afecta un período cerrado? → Guard: period.status === CLOSED
- [ ] ¿Hay riesgo IDOR? → Validar `companyId` explícitamente
- [ ] ¿Es específico de VEN-NIF? → Documentar con `// VEN-NIF only`

---

## 💰 Tabla Rápida: ¿Cuál es la Cuenta?

### Buscar por Operación

| Si quiero registrar... | Entonces debito | Y acredito | Fase |
|------------------------|-----------------|-----------|------|
| **Venta gravada 16%** | CxC (1030) | Ventas 16% (4010) + IVA 2215 | 12 |
| **Compra con IVA** | COGS/Gasto | CxP (2110) + IVA 1070 | 12 |
| **Pago al proveedor** | CxP (2110) | Bancos (1020) | 12 |
| **Cobro del cliente** | Bancos (1020) | CxC (1030) | 12 |
| **Retención IVA 75%** | IVA Ret (2230) | CxP (2110) — reduce deuda | 12 |
| **Gasto de nómina** | Gasto Nómina (6020) | Bancos (1020) + Pasivos | 27 |
| **Provisión prestaciones** | Gasto Prov Prest (6040) | Prestaciones a Pagar (2290) | 27 |
| **Costo de venta (Inventario)** | COGS (6010) | Inventario disminuye | 28 |
| **Depreciación activos** | Gasto Deprec (6100) | Depreciación Acum (1230) | 21 |
| **Ajuste inflación INPC** | Activos/Gastos | Ganancia/Pérdida | 22 |

### Buscar por Código de Cuenta

| Código | Nombre | Cuándo usarla |
|--------|--------|--------------|
| 1020 | Bancos Locales | Todas las entradas/salidas de efectivo |
| 1030 | Clientes — Factura | Toda factura de venta emitida |
| 1070 | IVA Ret por Recuperar | Crédito fiscal de compras |
| 1080 | Retención ISLR por Recuperar | Retención ISLR sufrida |
| 2110 | Proveedores | Toda factura de compra recibida |
| 2215 | IVA por Pagar 16% | Segregación obligatoria Providencia 0071 |
| 2217 | IVA por Pagar 8% | Alícuota reducida |
| 2230 | Retención IVA Recibida | Retención 75% que empresa debe al fisco |
| 2240 | Retención ISLR Recibida | Retención ISLR de clientes |
| 2270 | Retenciones Empleado por Pagar | IVSS 4% + FAOV 1% + ISLR empleado |
| 2280 | Aportes Patronales por Pagar | IVSS 10% + FAOV 2% |
| 2290 | Prestaciones Sociales por Pagar | Art 142 LOTTT — pasivo laboral |
| 4010 | Ventas Gravadas 16% | Principal de factura de venta |
| 6010 | Costo de Ventas | Asiento automático al facturar |
| 6020 | Gasto de Nómina | Salario base + bonificaciones |
| 6030 | Gasto Aportes Sociales | Aportes patronales (IVSS 10% + FAOV 2%) |
| 6040 | Gasto Provisión Prestaciones | Accrual mensual de prestaciones |

---

## ✅ Validaciones Críticas — Copy & Paste

### Validación 1: ¿Partida Doble Cuadra?

```typescript
function validateDoubleEntry(lines: Line[]): void {
  const debits = lines
    .filter(l => l.isDebit)
    .reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
  const credits = lines
    .filter(l => !l.isDebit)
    .reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
  if (!debits.equals(credits)) {
    throw new Error(`Asiento descuadrado: débitos ${debits} != créditos ${credits}`);
  }
}
```

### Validación 2: ¿Período está abierto?

```typescript
const period = await prisma.accountingPeriod.findUnique({ where: { id: periodId } });
if (period.status === 'CLOSED') {
  throw new Error('Período cerrado — no se pueden registrar movimientos');
}
```

### Validación 3: ¿Retención IVA válida?

```typescript
if (retentionType === 'IVA' && !invoiceId) {
  throw new Error('Retención IVA requiere invoiceId (compra)');
}
if (retentionType === 'IVA' && ![0, 75, 100].includes(retentionRate)) {
  throw new Error('Tasa IVA debe ser 0, 75 o 100');
}
```

### Validación 4: ¿Moneda es USD/EUR?

```typescript
if (currency !== 'VES') {
  const igtfAmount = principal.times(0.03);
  // Registrar IGTF
}
```

---

## 🎯 Reglas de Oro — NUNCA Hacer

| ❌ NUNCA | ✅ SIEMPRE |
|---------|-----------|
| Usar `float` para dinero | Usar `Decimal.js` |
| `DELETE` en tabla fiscal | `VOID` + `voidedAt` + `voidReason` |
| Mutation sin `$transaction` | `$transaction` + `AuditLog` |
| Número correlativo sin `Serializable` | `Serializable` + `SELECT FOR UPDATE` |
| Asiento descuadrado | Validar `Σ(débitos) = Σ(créditos)` |
| Hardcodear IVA = 0.16 | Leer de config o enum |
| Ignorar período cerrado | Guard: `if (period.status === 'CLOSED') throw ...` |
| Confiar IDOR guard al cliente | Validar `companyId` en Service Layer |

---

## 🚨 Diagnóstico Rápido

### "El asiento no cuadra"
1. ¿Validaste con `validateDoubleEntry()`?
2. ¿Sumaste correctamente con `Decimal.js`? → Revisa `plus()`, `minus()`
3. ¿Falta una línea? → Chequea si hay retención o IVA no contabilizado

### "Nómina descuadrada"
1. ¿Incluiste todos los aportes patronales? → IVSS 10% + FAOV 2% = 12%
2. ¿Provisión = salario × 5/30? → No 2/12 (son equivalentes pero verificar)
3. ¿Retenciones del empleado están en su propia línea? → No se restan de gasto, se crean pasivo
4. ¿Bancos = neto pagado? → Solo salario neto, no incluir retenciones ni aportes

### "No puedo cerrar el período"
1. ¿Hay asientos DRAFT? → Todos deben estar POSTED
2. ¿Balance de Comprobación cuadra?
3. ¿Hay facturas sin emitir? → Todas deben estar POSTED

---

## 📊 Nómina — Fórmulas LOTTT

```
IVSS empleado:  4%  (tope: 5 salarios mínimos)
FAOV empleado:  1%
INCES empleado: 0.5% sobre utilidades
ISLR empleado:  Decreto 1808 tabla progresiva

IVSS patronal:  10%
FAOV patronal:  2%
INCES patronal: 2% (si ≥ 5 empleados)

Prestaciones (Art 142): Salario × 5 días / 30
Garantía trimestral (Art 148): Acumulado × TasaBCV × días / 360

Vacaciones (Art 190): 15 + (años − 1) días mínimo 15
Bono vacacional (Art 192): 7 + (años − 1) días mínimo 7

NÓMINA CORRECTA:
  Débito:  Gasto Nómina (SALARIO BRUTO 6020)
  Débito:  Gasto Aportes Patronales (6030)
  Débito:  Provisión Prestaciones (6040)
  Crédito: Bancos (neto pagado, 1020)
  Crédito: Retenciones Empleado (2270)
  Crédito: Aportes Patronales a Pagar (2280)
  Crédito: Prestaciones a Pagar (2290)
```

---

**Última actualización:** 2026-04-25
