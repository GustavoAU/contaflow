# ADR-009 — Declaración Mensual IVA (Forma 30 SENIAT)

- **Status**: DECIDED ✅
- **Date**: 2026-04-07
- **Author**: arch-agent
- **Applies to**: `src/modules/iva-declaration/` (módulo nuevo, Fase 19)

---

## Contexto y problema

La Forma 30 del SENIAT es la declaración mensual de IVA que todo contribuyente ordinario
venezolano debe presentar. ContaFlow ya persiste todos los datos fuente requeridos:
facturas (Invoice + InvoiceTaxLine), retenciones (Retencion), transacciones IGTF
(IGTFTransaction). Se requiere una arquitectura que:

1. Calcule los totales fiscales del período (año/mes) sin introducir riesgo de desync.
2. Provea un contrato de servicio determinístico, testeable con mocks de Prisma.
3. Exporte los datos en formato suficiente para que la UI renderice las secciones A/B/C/D/E
   de la Forma 30 y genere un PDF descargable.
4. Cumpla con ADR-002 (Decimal), ADR-004 (companyId en toda query), ADR-006 (seguridad).

---

## Decisiones

### D-1 — Persistencia: on-the-fly (sin modelo DeclaracionIVA)

**Decisión**: `DeclaracionIVAService.calculate()` ejecuta queries sobre Invoice,
InvoiceTaxLine, Retencion e IGTFTransaction en cada llamada. No se crea un modelo
`DeclaracionIVA` en Prisma para esta fase.

**Razonamiento**:

| Factor | On-the-fly | Modelo persistido |
|---|---|---|
| Desync con facturas anuladas | Imposible — siempre lee estado actual | Riesgo real si una factura se anula después de persistir la declaración |
| Auditoría | No aplica — no hay mutación | Requiere AuditLog + idempotencyKey |
| Complejidad de migración | Cero | Nueva tabla, índices, onDelete checks |
| Histórico de declaraciones presentadas | No cubre | Cubre |
| Rendimiento | Aceptable — consultas indexadas por (companyId, type, date) | Lectura O(1) del snapshot |

La Forma 30 es un reporte derivado 100% de datos ya auditados. El histórico de
declaraciones presentadas es un requerimiento de Fase futura (cuando se integre con el
portal SENIAT). Introducir persistencia ahora viola YAGNI y agrega riesgo de desync.

**Consecuencia**: si en el futuro se requiere persistir declaraciones presentadas, se creará
un modelo `DeclaracionIVAPresentada` con snapshot inmutable + AuditLog en un ADR separado.

---

### D-2 — Isolation level: Read Committed (no Serializable)

**Decisión**: `generarForma30Action` y `DeclaracionIVAService.calculate()` NO requieren
`$transaction` con `Serializable`.

**Razonamiento**: no hay escritura. El cálculo es un aggregate de lectura sobre tablas con
índices en `(companyId, type, date)`. El riesgo de phantom read en una declaración mensual
ya cerrada es mínimo — si se consulta un mes pasado, los datos son inmutables (facturas
soft-deleted tienen `deletedAt` no nulo y se excluyen). Read Committed es suficiente.

**Excepción**: si en el futuro `calculate()` se llama dentro de un `$transaction`
Serializable (p.ej. al persistir una `DeclaracionIVAPresentada`), acepta `tx` opcional como
parámetro — el caller inyecta el nivel de isolación.

---

### D-3 — Filtrado de facturas

Las facturas anuladas (`deletedAt IS NOT NULL`) se excluyen de todos los cálculos.
Las notas de crédito (`docType: NOTA_CREDITO`) reducen la base imponible de ventas
(tipo SALE) — se suman con signo negativo en sección A.
Las notas de débito (`docType: NOTA_DEBITO`) incrementan la base — se suman con signo
positivo, igual que una FACTURA.
Las facturas de compra con `docType: PLANILLA_IMPORTACION` se incluyen en sección B
con base separada (campo `importBase` en el resultado).

---

### D-4 — Mapeo de TaxLineType a secciones de la Forma 30

| TaxLineType en DB | Sección Forma 30 | Tasa |
|---|---|---|
| IVA_GENERAL | A1 (ventas) / B1 (compras) | 16% |
| IVA_REDUCIDO | A2 (ventas) / B2 (compras) | 8% |
| IVA_ADICIONAL | A3 adicional (ventas) / B3 adicional (compras) | 15% |
| EXENTO | A4 exento (ventas) / B4 exento (compras) | 0% |

Las facturas con `taxCategory: EXONERADA` se agrupan junto a EXENTO en A4/B4 para la
Forma 30 (SENIAT no distingue en la planilla impresa entre exento y exonerado).
Las facturas con `taxCategory: NO_SUJETA` se excluyen de todos los totales.
Las facturas con `taxCategory: IMPORTACION` se incluyen en B5 (importaciones).

Para el lujo (IVA_ADICIONAL): la base es la misma que IVA_GENERAL (linked por
`luxuryGroupId`). En el resultado se reportan: base del lujo, débito adicional 15%, y
débito general 16%, sin duplicar la base.

---

### D-5 — Retenciones IVA en la Forma 30

**Retenciones sufridas** (el cliente nos retuvo — campo `ivaRetentionAmount` en Invoice
de tipo SALE): se suman en sección C1.
**Retenciones practicadas** (nosotros retuvimos al proveedor — modelo Retencion con
`status != VOIDED` y `deletedAt IS NULL`): se suman en sección C2.

Solo aplican si `company.isSpecialContributor = true`. El servicio consulta este flag;
si es false, C1 y C2 son cero.

---

### D-6 — IGTF en la Forma 30

Se suma `igtfAmount` de `IGTFTransaction` filtradas por `(companyId, createdAt)` dentro del
período. El campo `createdAt` es DateTime — se filtra con `gte`/`lt` para el mes completo
en UTC. Se reporta en sección D: `igtfBase` e `igtfTotal`.

---

### D-7 — Rol de autorización en generarForma30Action

La Forma 30 es una operación de **lectura** — no destruye ni muta datos. Por lo tanto:
- VIEWER puede ejecutar `generarForma30Action` (lectura de reporte).
- Solo se requiere que `companyMember` exista (cualquier rol).
- Se aplica rate limiting con `limiters.fiscal` por ser una query costosa (aggregate
  de múltiples tablas). Esto sigue el espíritu de ADR-006 D-5 aunque no sea mutación.

---

### D-8 — PDF Export

El PDF de la Forma 30 se implementa en **Fase 19B** (subfase posterior). En Fase 19 (esta
ADR) solo se produce el `Forma30Result` JSON. El componente UI renderiza la tabla con las
secciones; el botón "Exportar PDF" queda como placeholder hasta Fase 19B.

---

## Contrato TypeScript completo

### Tipos de resultado

```typescript
// src/modules/iva-declaration/types/forma30.types.ts

import { Decimal } from "decimal.js";

/** Una fila de base imponible + impuesto para una alícuota dada */
export interface TaxLineRow {
  /** Base imponible en VES */
  base: Decimal;
  /** Monto de IVA (débito fiscal para ventas, crédito fiscal para compras) */
  tax: Decimal;
}

/** Sección A — Débitos Fiscales (Ventas) */
export interface SeccionA {
  /** A1: Ventas gravadas alícuota general 16% */
  general: TaxLineRow;
  /** A2: Ventas gravadas alícuota reducida 8% */
  reducida: TaxLineRow;
  /**
   * A3: Ventas gravadas alícuota adicional lujo (15%).
   * La base es la misma que en A1 para los productos de lujo — no se duplica.
   * Se reporta por separado para distinguir el débito adicional.
   */
  adicionalLujo: TaxLineRow;
  /** A4: Ventas exentas y exoneradas (IVA = 0) */
  exentasExoneradas: { base: Decimal };
  /** A5: Exportaciones (si aplica) */
  exportaciones: { base: Decimal };
  /** Suma total de débitos fiscales (A1.tax + A2.tax + A3.tax) */
  totalDebitosFiscales: Decimal;
}

/** Sección B — Créditos Fiscales (Compras) */
export interface SeccionB {
  /** B1: Compras gravadas alícuota general 16% */
  general: TaxLineRow;
  /** B2: Compras gravadas alícuota reducida 8% */
  reducida: TaxLineRow;
  /** B3: Compras gravadas alícuota adicional lujo 15% */
  adicionalLujo: TaxLineRow;
  /** B4: Compras exentas y exoneradas */
  exentasExoneradas: { base: Decimal };
  /** B5: Importaciones (PLANILLA_IMPORTACION) */
  importaciones: TaxLineRow;
  /** Suma total de créditos fiscales (B1.tax + B2.tax + B3.tax + B5.tax) */
  totalCreditosFiscales: Decimal;
}

/** Sección C — Retenciones IVA */
export interface SeccionC {
  /**
   * C1: Retenciones IVA sufridas (clientes nos retuvieron).
   * Solo aplica si company.isSpecialContributor = true.
   * Fuente: Invoice(type=SALE).ivaRetentionAmount
   */
  retencionesIvaSufridas: Decimal;
  /**
   * C2: Retenciones IVA practicadas (nosotros retuvimos a proveedores).
   * Solo aplica si company.isSpecialContributor = true.
   * Fuente: Retencion.ivaRetention WHERE status != VOIDED AND deletedAt IS NULL
   */
  retencionesIvaPracticadas: Decimal;
  /** Total retenciones = C1 + C2 */
  totalRetenciones: Decimal;
}

/** Sección D — IGTF */
export interface SeccionD {
  /** Monto base sobre el que se calculó el IGTF (suma de IGTFTransaction.amount) */
  igtfBase: Decimal;
  /** Total IGTF pagado en el período (suma de IGTFTransaction.igtfAmount) */
  igtfTotal: Decimal;
}

/** Sección E — Cuota del período o saldo a favor */
export interface SeccionE {
  /**
   * Cuota neta del período.
   * Fórmula: totalDebitosFiscales - totalCreditosFiscales - totalRetenciones
   * Positivo → monto a pagar al SENIAT.
   * Negativo → saldo a favor (crédito fiscal trasladable al período siguiente).
   */
  cuotaPeriodo: Decimal;
  /** true si cuotaPeriodo < 0 (contribuyente tiene saldo a favor) */
  esSaldoAFavor: boolean;
}

/** Resultado completo de la Forma 30 SENIAT */
export interface Forma30Result {
  /** Empresa */
  companyId: string;
  /** Año fiscal (ej. 2026) */
  year: number;
  /** Mes 1-12 */
  month: number;
  /**
   * Indica si el período tiene un AccountingPeriod registrado.
   * Si false, los datos pueden estar incompletos (período no abierto formalmente).
   */
  periodExists: boolean;
  /**
   * Indica si el contribuyente es especial.
   * Determina si las secciones C1/C2 aplican.
   */
  isSpecialContributor: boolean;
  /** Sección A — Débitos Fiscales */
  seccionA: SeccionA;
  /** Sección B — Créditos Fiscales */
  seccionB: SeccionB;
  /** Sección C — Retenciones IVA */
  seccionC: SeccionC;
  /** Sección D — IGTF */
  seccionD: SeccionD;
  /** Sección E — Cuota o saldo a favor */
  seccionE: SeccionE;
  /** Timestamp en que se calculó el resultado (UTC) */
  calculatedAt: Date;
}
```

---

### Contrato de DeclaracionIVAService

```typescript
// src/modules/iva-declaration/services/DeclaracionIVAService.ts

import type { PrismaClient } from "@prisma/client";
import type { Forma30Result } from "../types/forma30.types";

export class DeclaracionIVAService {
  /**
   * Calcula la Forma 30 SENIAT para un período mensual dado.
   *
   * Precondiciones:
   *   - companyId debe corresponder a una Company activa
   *   - year: entero 4 dígitos (ej. 2026)
   *   - month: 1-12
   *   - tx es opcional — se usa cuando el caller ya tiene una transacción abierta.
   *     Si no se provee, el método usa el cliente Prisma singleton.
   *
   * Postcondiciones:
   *   - Retorna Forma30Result con todos los campos calculados usando Decimal.js
   *   - Facturas con deletedAt != null se excluyen de todos los cálculos
   *   - Retenciones con status VOIDED o deletedAt != null se excluyen
   *   - Si no hay datos para el período, los montos son Decimal(0) — no lanza error
   *
   * Isolation level: Read Committed (no requiere Serializable — solo lectura).
   * No ejecuta $transaction internamente. Si el caller necesita Serializable,
   * debe pasar el tx explícito.
   *
   * Complejidad: O(n) sobre facturas del período — indexado por (companyId, type, date).
   *
   * @param companyId  ID de la empresa (multitenancy ADR-004)
   * @param year       Año fiscal 1-9999
   * @param month      Mes 1-12
   * @param tx         Cliente Prisma opcional (para uso dentro de $transaction)
   */
  static async calculate(
    companyId: string,
    year: number,
    month: number,
    tx?: PrismaClient
  ): Promise<Forma30Result>;
}
```

**Queries internas que debe ejecutar `calculate()`**:

```typescript
// Rango del período:
const periodStart = new Date(year, month - 1, 1);     // primer día del mes, 00:00 local
const periodEnd   = new Date(year, month, 1);          // primer día del mes siguiente (exclusive)

// 1. Company flag
const company = await db.company.findUnique({
  where: { id: companyId },
  select: { isSpecialContributor: true },
});

// 2. AccountingPeriod existence check
const period = await db.accountingPeriod.findUnique({
  where: { companyId_year_month: { companyId, year, month } },
  select: { id: true },
});

// 3. Facturas de VENTA con sus taxLines
const saleInvoices = await db.invoice.findMany({
  where: {
    companyId,                              // ADR-004: siempre incluir companyId
    type: "SALE",
    date: { gte: periodStart, lt: periodEnd },
    deletedAt: null,
  },
  select: {
    docType: true,
    ivaRetentionAmount: true,
    taxLines: {
      select: { taxType: true, base: true, amount: true },
    },
  },
});

// 4. Facturas de COMPRA con sus taxLines
const purchaseInvoices = await db.invoice.findMany({
  where: {
    companyId,
    type: "PURCHASE",
    date: { gte: periodStart, lt: periodEnd },
    deletedAt: null,
  },
  select: {
    docType: true,
    taxLines: {
      select: { taxType: true, base: true, amount: true },
    },
  },
});

// 5. Retenciones practicadas (solo si isSpecialContributor)
const retenciones = isSpecialContributor
  ? await db.retencion.findMany({
      where: {
        companyId,
        invoiceDate: { gte: periodStart, lt: periodEnd },
        status: { not: "VOIDED" },
        deletedAt: null,
      },
      select: { ivaRetention: true },
    })
  : [];

// 6. IGTF del período
const igtfRows = await db.iGTFTransaction.findMany({
  where: {
    companyId,
    createdAt: { gte: periodStart, lt: periodEnd },
  },
  select: { amount: true, igtfAmount: true },
});
```

**Regla de signo para NOTA_CREDITO**: al agregar taxLines de facturas SALE, si
`docType === "NOTA_CREDITO"`, el signo de `base` y `amount` se invierte (reduce los
débitos). Todas las operaciones de suma/resta usan `Decimal.js` — nunca `+` nativo.

---

### Contrato de generarForma30Action

```typescript
// src/modules/iva-declaration/actions/generarForma30.action.ts

import type { Forma30Result } from "../types/forma30.types";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Server Action para calcular la Forma 30 SENIAT de un período mensual.
 *
 * Flujo de autorización (obligatorio, en este orden):
 *   1. auth() — obtener userId de Clerk; si no autenticado → error 401
 *   2. checkRateLimit(limiters.fiscal, userId) — proteger contra abuso de queries costosas
 *   3. safeParse(GenerarForma30Schema, { companyId, year, month }) — validar input
 *   4. companyMember lookup — verificar que userId pertenece a companyId (cualquier rol)
 *   5. DeclaracionIVAService.calculate(companyId, year, month)
 *
 * Nota sobre FiscalYearClose: NO se bloquea si el año fiscal NO está cerrado.
 * La Forma 30 es mensual y el contribuyente puede necesitar la declaración de meses
 * anteriores dentro de un ejercicio aún abierto (declaración mensual es independiente
 * del cierre anual). Se añade el campo `fiscalYearClosed` en el resultado para que
 * la UI pueda mostrar una advertencia informativa si el año está abierto.
 *
 * @param companyId  ID de la empresa
 * @param year       Año 2020-2099
 * @param month      Mes 1-12
 */
export async function generarForma30Action(
  companyId: string,
  year: number,
  month: number
): Promise<ActionResult<Forma30Result & { fiscalYearClosed: boolean }>>;
```

**Schema Zod de input** (sin campos de tasa — ADR-006 D-3):

```typescript
// src/modules/iva-declaration/schemas/generarForma30.schema.ts

import { z } from "zod";

export const GenerarForma30Schema = z.object({
  companyId: z.string().cuid({ error: "companyId inválido" }),
  year: z
    .number()
    .int()
    .min(2020, { error: "Año mínimo: 2020" })
    .max(2099, { error: "Año máximo: 2099" }),
  month: z
    .number()
    .int()
    .min(1, { error: "Mes mínimo: 1" })
    .max(12, { error: "Mes máximo: 12" }),
});

export type GenerarForma30Input = z.infer<typeof GenerarForma30Schema>;
```

---

## SCHEMA_AUDITOR checklist — Decisión D-1 (sin nuevo modelo)

| Item | Estado |
|---|---|
| Relaciones a tablas contables con onDelete: Restrict | N/A — sin nuevo modelo |
| onDelete: Cascade ausente en tablas contables | N/A |
| Campos monetarios Decimal(19,4) | Aplica en Forma30Result — Decimal.js en memoria |
| Campos de porcentaje Decimal(5,2) | N/A |
| Entidades fiscales tienen deletedAt | N/A — Invoice y Retencion ya lo tienen |
| Entidades de creación tienen idempotencyKey | N/A — lectura pura |
| Unicidad con companyId | N/A |
| Índices en FKs frecuentes | Existentes: (companyId, type, date) en Invoice |
| AuditLog requerido | No — lectura pura, sin mutación |
| Análisis de riesgo de migración | Sin migración — decisión D-1 |
| Acción destructiva verifica role (ADR-006 D-1) | Solo lectura — cualquier role permitido |
| Campos de monto en Zod con .max() | No hay campos de monto en el schema de input |
| Tasa fiscal nunca desde el cliente (ADR-006 D-3) | Cumple — schema solo acepta companyId, year, month |
| AuditLog append-only (ADR-006 D-4) | N/A — no hay escritura a AuditLog |
| Rate limiting en mutación financiera (ADR-006 D-5) | Aplicado como medida de protección de query costosa |

---

## Consecuencias

**Positivo**:
- Sin migración de DB — cero riesgo de regresión en schema.
- Los datos de la Forma 30 siempre reflejan el estado real de las facturas (no hay
  snapshot que se desactualice).
- Contrato de servicio determinístico y completamente testeable con mocks de Prisma.
- Separación clara: `DeclaracionIVAService` es un cálculo puro; `generarForma30Action`
  gestiona seguridad y rate limiting.

**Negativo / Restricciones**:
- No hay historial de declaraciones "presentadas" al SENIAT. Si se requiere en el futuro
  (integración con portal SENIAT), se creará `DeclaracionIVAPresentada` en un ADR separado.
- Queries sobre Invoice pueden ser lentas para empresas con >50.000 facturas/mes. El índice
  existente `(companyId, type, date)` cubre el caso; si se detectan p99 > 2s, se evaluará
  materializar la vista como tabla separada.
- La distinción exento/exonerado se colapsa en A4/B4 (igual que en la planilla impresa del
  SENIAT). Si SENIAT modifica la Forma 30 para distinguirlos, se requiere cambio en
  `SeccionA` y `SeccionB`.

---

## Módulo owner

```
src/modules/iva-declaration/
  types/
    forma30.types.ts          ← Forma30Result y sub-interfaces (este ADR)
  schemas/
    generarForma30.schema.ts  ← GenerarForma30Schema (este ADR)
  services/
    DeclaracionIVAService.ts  ← calculate() (implementación Fase 19)
  actions/
    generarForma30.action.ts  ← generarForma30Action (implementación Fase 19)
  components/                 ← UI — fuera del dominio arch-agent
  __tests__/
    DeclaracionIVAService.test.ts
    generarForma30.action.test.ts
```

---

## Referencias

- ADR-001: Serializable para correlativos — no aplica (lectura pura)
- ADR-002: Decimal.js para dinero — aplica a todos los campos de Forma30Result
- ADR-004: companyId en toda query — aplicado en los 6 queries de calculate()
- ADR-006: D-3 (sin tasas del cliente), D-5 (rate limiting como protección de query)
- CLAUDE.md: Fiscal VEN-NIF — tasas IVA 16%/8%/15%, IGTF 3%, retenciones 75%/100%
