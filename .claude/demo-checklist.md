# ContaFlow — Checklist Demo: Simulación 1 mes completo (Abril 2026)

> Ejecutar con Claude Code Desktop en sesión nueva.
> El seed ya cargó todos los datos base.

## Preparación (antes de empezar)

```bash
# 1. Asegurarse de que el seed base está aplicado
npx tsx prisma/seed.ts

# 2. Cargar datos del mes completo
npx tsx prisma/seed-demo.ts

# 3. Levantar la app
npm run dev
```

Entrar a: http://localhost:3000 → Empresa Demo C.A.

---

## Módulo 1 — Dashboard KPIs

- [ ] Abrir el Dashboard principal
- [ ] Verificar que aparecen las métricas del período:
  - CxC total y vencidas
  - CxP total
  - Ingresos del mes
  - Gastos del mes
- [ ] Verificar gráfico de flujo 30/60/90 días
- [ ] Verificar alertas de bajo stock (Mouse Inalámbrico tiene 8 uds, mín. 10)

---

## Módulo 2 — Libro de Ventas

- [ ] Ir a Facturas → Ventas
- [ ] Verificar las 6 facturas SALE:
  - 0001 Corporación Venezolana — Bs. 327,120 [PAID] (≈USD 600 × 470)
  - 0002 Inversiones Carabobo — Bs. 549,260 [PARTIAL] (pendiente Bs. 349,260)
  - 0003 Construcciones Andinas — Bs. 823,890 [UNPAID]
  - 0004 Pedro Rodríguez — Bs. 103,032 [PAID] (IVA 8%)
  - 0005 María Gutiérrez — Bs. 133,560 [PAID] (EXENTO)
  - 0006 Corporación Venezolana — Bs. 426,880 [UNPAID] (vencida +90d enero)
- [ ] Verificar Libro de Ventas PDF
- [ ] Verificar que aparece el panel de NC/ND en factura 0002

---

## Módulo 3 — Libro de Compras

- [ ] Ir a Facturas → Compras
- [ ] Verificar las 5 facturas PURCHASE:
  - C-0001 TechPro — Bs. 191,400 [PAID]
  - C-0002 Suministros Bolívar — Bs. 109,620 [UNPAID]
  - C-0003 Servicios Andinos — Bs. 263,320 [PARTIAL] (pendiente Bs. 120,000)
  - C-0004 Papelería Nacional — Bs. 44,080 [PAID]
  - C-0005 Servicios Andinos — Bs. 139,200 [UNPAID]
- [ ] Verificar Libro de Compras PDF

---

## Módulo 4 — Retenciones IVA

- [ ] Ir a Retenciones
- [ ] Verificar 3 retenciones IVA 75%:
  - RIV-2026-001 TechPro — Bs. 19,800 (75% de IVA Bs. 26,400)
  - RIV-2026-002 Servicios Andinos — Bs. 27,240 (75% de IVA Bs. 36,320)
  - RIV-2026-003 Servicios Andinos — Bs. 14,400 (75% de IVA Bs. 19,200)
- [ ] Descargar comprobante XML de una retención

---

## Módulo 5 — Declaración IVA (Forma 30)

- [ ] Ir a Fiscal → Declaración IVA
- [ ] Seleccionar Abril 2026
- [ ] Verificar totales calculados:
  - Débito Fiscal (ventas gravadas)
  - Crédito Fiscal (compras gravadas)
  - Retenciones IVA sufridas
  - IVA a pagar / crédito a favor
- [ ] Exportar Forma 30 PDF

---

## Módulo 6 — Conciliación Bancaria

> El seed cubre los **3 escenarios** requeridos: exacto, parcial, solo en banco, solo en sistema.

- [ ] Ir a Banco → Conciliación → seleccionar cuenta Banesco
- [ ] Verificar el estado de cuenta Abril 2026 (6 transacciones bancarias)

**Caso 1 — Coincidencia exacta** (auto-match esperado):
  - CREDIT BNS-001 ↔ SALE-0001 (Corporación Venezolana Bs. 327,120)
  - CREDIT BNS-002 ↔ SALE-0004 (Pedro Rodríguez Bs. 103,032)
  - DEBIT  BNS-003 ↔ PURCHASE C-0001 (TechPro Bs. 191,400)
  - CREDIT BNS-004 ↔ SALE-0005 (María Gutiérrez Bs. 133,560)
- [ ] Ejecutar auto-conciliación y confirmar que estos 4 se marcan automáticamente

**Caso 2 — Solo en banco** (sin factura/pago en el sistema):
  - DEBIT BNS-005 — Comisión Bancaria Abril Bs. 350
  - Acción: registrar gasto contable Bs. 350 (cta. 5125) y conciliar manualmente

**Caso 3 — Coincidencia parcial** (monto difiere → NO auto-match):
  - DEBIT BNS-006 — Papelería Nacional Bs. **44,480** vs factura C-0004 Bs. **44,080** (Bs. 400 comisión interbancaria)
  - Acción: conciliar manualmente BNS-006 + C-0004, crear asiento ajuste Bs. 400

**Caso 4 — Solo en sistema** (PaymentRecord sin transacción bancaria):
  - PagoMóvil Bs. 200,000 de Inversiones Carabobo (SALE-0002) registrado el 07/04 — ref. 00112345678901
  - No aparece en el estado de cuenta (pago en tránsito)
  - Acción: marcar como pendiente de confirmar con el banco

---

## Módulo 7 — Nómina

- [ ] Ir a Nómina → Empleados
- [ ] Verificar 3 empleados activos con historial salarial
- [ ] Ir a Nómina → Configuración → verificar PayrollConfig
- [ ] Ejecutar proceso de nómina Abril 2026 (mensual)
- [ ] Revisar recibo de cada empleado
- [ ] Verificar conceptos: Salario, IVSS Obrero/Patronal, INCES, Banavih
- [ ] Verificar asiento contable causado

---

## Módulo 8 — Nómina: Prestaciones Sociales (NOM-D)

- [ ] Ir a Nómina → Prestaciones Sociales
- [ ] Calcular garantía trimestral (si corresponde)
- [ ] Verificar BenefitBalance de cada empleado

---

## Módulo 9 — Activos Fijos

- [ ] Ir a Activos Fijos
- [ ] Verificar: Computadora Dell Inspiron 15 (Bs. 8,000, 36 meses)
- [ ] Registrar depreciación mensual de Abril 2026
- [ ] Verificar asiento de depreciación generado:
  - DEBE: 5115 Depreciación Activos
  - HABER: 1510 Dep. Acumulada

---

## Módulo 10 — Inventario

- [ ] Ir a Inventario
- [ ] Verificar 3 ítems:
  - PROD-001 Cable HDMI (45 uds, min. 10) ✅
  - PROD-002 Teclado Mecánico (18 uds, min. 5) ✅
  - PROD-003 Mouse Inalámbrico (8 uds, min. 10) ⚠️ LOW_STOCK
- [ ] Verificar alerta de bajo stock en PROD-003
- [ ] Ir a Inventario → Reportes → Stock valorizado

---

## Módulo 11 — Ajuste por Inflación

- [ ] Ir a Fiscal → Ajuste Inflación
- [ ] Verificar tasas INPC (enero–marzo 2026 cargadas)
- [ ] Ejecutar preview de ajuste para Abril 2026

---

## Módulo 12 — Reportes NOM-E

- [ ] Ir a Nómina → Reportes Legales
- [ ] Generar Forma 14-02 IVSS (después de correr nómina)
- [ ] Generar reporte Banavih
- [ ] Generar reporte INCES
- [ ] Generar ARC/ISLR (Tarifa 1)

---

## Módulo 13 — Asistente IA

- [ ] Ir a Asistente Contable
- [ ] Mensaje: `¿Cuál es el IVA a pagar en Abril 2026?`
  - Esperar respuesta contextual
- [ ] Mensaje: `auditar el período actual`
  - Debe activar modo auditoría
  - Debe detectar: CxC vencida +90 días (factura 0006 de enero)
  - Puede detectar: retenciones sin factura (si hay alguna)
- [ ] Mensaje: `¿Qué retenciones ISLR aplican para pagos a Servicios Informáticos Andinos?`

---

## Módulo 14 — Notificaciones y Audit Log

- [ ] Verificar NotificationBell (campana en header)
- [ ] Ir a Audit Log → verificar operaciones registradas

---

## Bugs a monitorear durante el demo

- [ ] ¿Aparecen los cálculos IVA correctamente en Forma 30?
- [ ] ¿El libro de ventas muestra las facturas EXENTAS separadas?
- [ ] ¿La alerta LOW_STOCK aparece en el dashboard?
- [ ] ¿El asistente IA detecta la factura 0006 vencida?
- [ ] ¿La conciliación auto-match funciona con los montos exactos?

---

## Post-demo: Issues a corregir

Anotar aquí durante el demo:

-
-
-

---

## Datos de acceso

- URL: http://localhost:3000
- Empresa: Empresa Demo C.A. (RIF J-12345678-9)
- Usuario: gustavou2186@gmail.com
- Período activo: Abril 2026
