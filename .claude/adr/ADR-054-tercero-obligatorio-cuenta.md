# ADR-054 — "Ter.": tercero obligatorio en una cuenta

**Estado:** Aceptado (decisión del dueño, 2026-09-26)
**Fecha:** 2026-09-26
**Relacionados:** ADR-053 (cuentas de título, mismo precedente de extensión Prisma), R-1, árbol [7] Schema Prisma, ADR-004/ADR-041 (aislamiento por companyId), ADR-007 (RLS)

## Contexto

Feedback real del dueño (transcrito de notas de voz, contador certificado explicando un plan de cuentas real): algunas
cuentas son "pote" — agregan movimientos que en realidad pertenecen a personas o entidades distintas ("Cuentas por
Cobrar Clientes" agrega deudas de clientes específicos; "Efectos por Cobrar" mezcla montos de varios terceros sin poder
decir cuánto es de cada quién hoy). La columna "Ter." del plan de cuentas real marca qué cuentas exigen indicar A QUIÉN
corresponde cada movimiento — confirmado explícitamente como obligatorio, no opcional, cuando la cuenta lo marca.

## Decisión

### Granularidad: por línea de asiento (`JournalEntry`), no por transacción completa

Comprobado en código ya en producción, no es hipotético: `PaymentGLService.postPaymentBatchGL` (ADR-022) arma **un solo
`Transaction`** para un lote de pago que cubre facturas de **proveedores distintos** — cada línea del lote genera su
propio par Dr CxP/Cr Banco dentro del MISMO asiento. Un campo de tercero a nivel de `Transaction` no podría representar
esto (un asiento, varios proveedores). El tercero vive en `JournalEntry`.

### Catálogo de terceros: 4 tipos, no 3

`Customer` y `Vendor` ya existen y ya cubren lo que pidió el dueño (RIF, nombre, dirección; `Vendor.isSpecialContributor`
ya determina retenciones ISLR/IVA — nada que agregar ahí). Los propios ejemplos del dueño ("Cuentas por Cobrar Empleado",
"Anticipos Trabajadores") agregan un tercer tipo ya existente: `Employee`. El único hueco real es **socio/accionista**,
que no encaja en Customer (no compra) ni Vendor (no factura) — se crea `Partner`, modelo mínimo (`id, companyId, name,
rif?, notes?`). Se descartó unificar Customer/Vendor en un solo modelo (alto radio de impacto — FKs entrantes desde
Invoice/Expense/grupos — sin ganancia para este feature) y descartado un `partyType`/`partyId` sin FK real (viola
`onDelete: Restrict` en tablas contables; `JournalEntry` es la tabla de mayor materialidad del sistema, no el lugar para
el patrón de bajo-riesgo que ya usa `ContactNote`).

`JournalEntry` gana 4 columnas nullable mutuamente excluyentes: `customerId`, `vendorId`, `partnerId`, `employeeId`, con
un `CHECK (num_nonnulls(...) <= 1)` a nivel SQL (Prisma DSL no expresa esto, igual que `company_country_iso3166_alpha3`).

### Obligatoriedad: dos capas

- **Gate de Prisma** (`src/lib/prisma-tercero-required-gate.ts`, mismo patrón que `prisma-postable-account-gate.ts`,
  ADR-053): intercepta `Transaction.create/update/upsert`, y por cada línea de `entries` cuya cuenta tenga
  `requiresThirdParty: true`, exige que esa línea traiga uno de los 4 campos poblado. Protege los 20+ servicios de
  auto-posting sin tocarlos. Fail-open ante fallo de infraestructura (mismo criterio que ADR-053).
- **Validación rica en `TransactionService`** (Libro Diario manual): mensaje específico por línea ("La línea 3 usa la
  cuenta X, que requiere indicar un tercero"), donde el gate solo puede dar un mensaje genérico.

### Auto-derivación obligatoria desde el día uno (no diferible)

Si se marca la cuenta de `CompanySettings.arAccountId` (Cuentas por Cobrar, la que postean automáticamente facturación y
cobros) como `requiresThirdParty: true` sin que los servicios que la postean aporten el tercero, el gate bloquearía
facturación y cobros el mismo día. Por eso esta fase incluye, no como opcional:
- `PaymentGLService.postPaymentRecordGL` → `customerId` (ya disponible desde la factura vinculada).
- `PaymentGLService.postVendorPaymentRecordGL`/`postPaymentBatchGL` → `vendorId` por línea (el `select` de facturas ya
  se hace por línea, se añade `vendorId` al mismo).
- `InvoiceGLPostingService.postInvoice/postCreditNote` → `customerId?`/`vendorId?` opcionales, poblados desde la factura.

### Importador de plan de cuentas

Mismo patrón que `isPostable`/`isBudgetable`: columna "Ter." → `Account.requiresThirdParty`. "SI" (case/espacios
tolerados) → true; cualquier otro valor o ausencia → false.

## Consecuencias

- 2 migraciones: `Partner` (tabla nueva + RLS `company_isolation`, ADR-007 A1-bis) y `Account.requiresThirdParty` +
  4 columnas nullable + 4 índices + CHECK en `JournalEntry`. Ambas additivas, default seguro, cero backfill, cero
  cambio de comportamiento hasta que una cuenta real se marque `Ter.=SI`.
- RLS en `Partner` es defensa en profundidad (ADR-044): el aislamiento real sigue siendo `companyId` explícito en cada
  query (`PartnerService`) + `requireCompanyAction` en las Server Actions (ADR-041).

## Auditoría (security-agent + ledger-agent, 2026-09-27)

Ambos agentes, en paralelo, encontraron el MISMO hallazgo CRÍTICO independientemente: **los constructores de
asientos de anulación/reverso (`TransactionService.voidTransaction`, `PaymentGLService.reversePaymentRecordGL`,
`reversePaymentBatchGL`) reconstruían la línea espejo tomando solo `accountId`/`amount`/`description` del original,
sin copiar el tercero.** Efecto: en cuanto se marque `Ter.=SI` sobre `arAccountId`/`apAccountId` — el ejemplo
insignia del propio ADR — **anular/revertir cualquier asiento contra esa cuenta queda bloqueado para siempre** por
el gate (viola R-1/R-3, "VOID siempre debe ser posible"). Corregido: las 3 funciones ahora copian
`customerId`/`vendorId`/`partnerId`/`employeeId` de la línea original a la línea de reverso, con test de regresión
en cada una (mutación verificada: revertir el fix hace caer el test específico).

**Barrido obligatorio (CLAUDE.md — "bug = clase de bug")**: el mismo patrón (`original.entries.map` sin copiar
tercero) apareció en 2 sitios más de caja chica — `CajaCajaService.ts` (reapertura) y
`CajaCajaDepositService.ts` (reversión de depósito) — corregidos con el mismo fix, aunque hoy son inalcanzables
(ninguna cuenta de caja chica está marcada `Ter.=SI`; caja chica es "fase 2" explícito arriba). Sweep exhaustivo
(`grep .entries.map(` en todo `src/`) confirma que no queda ninguna otra instancia sin corregir.

**Limitación estructural — CERRADA 2026-09-27 (rama `feat/diferencial-cambiario-por-tercero`)**: `ExchangeDifferentialService.ts`
posteaba UNA línea de revaluación mensual de diferencial cambiario contra `arAccountId`/`apAccountId` que agregaba
el movimiento neto de TODAS las facturas en divisas del período — sin "un" tercero al que atribuirle esa línea. Se
decidió la opción (b) del análisis original (partir la revaluación por tercero) por ser la solución real, no un
parche: `ExchangeDifferentialService.calculate()` ahora resuelve el cliente/proveedor de cada factura (vínculo
directo o por RIF, batch — mismo mecanismo que el resto del ADR), `aggregate()` agrupa el movimiento neto por
tercero (`cxcByParty`/`cxpByParty`), y `post()` postea UNA línea CxC por cliente y UNA línea CxP por proveedor en
vez del neto agregado sin dueño. `netCxCMovement`/`netCxPMovement` se conservan intactos para el preview de UI. De
paso se extrajo `src/lib/party-resolver.ts` (resolución por vínculo-o-RIF, simple y batch) como fuente única — ya
era la tercera copia casi idéntica de la misma lógica (InvoiceGLPostingService, PaymentGLService, ahora
ExchangeDifferentialService), y se refactorizaron los dos usos anteriores para consumirla en vez de triplicarla.
tsc 0, 6 shards verdes, mutación verificada en el agrupamiento por tercero y en la resolución por RIF.

Hallazgos NO bloqueantes, documentados para más adelante: (1) el tercero resuelto por fallback-RIF no queda
distinguido en el asiento del resuelto por vínculo explícito — útil para trazabilidad de reconciliación, no es un
bug; (2) el lookup de RIF pre-existente en `InvoiceService.ts` (snapshot de dirección/CE, H-1/H-2, anterior a este
ADR) no normaliza el RIF antes de buscar — de nuevo no es bug (la ruta de auto-derivación de GL re-resuelve por su
cuenta si esta pega en falso), solo una oportunidad de simplificar. Ambos quedan fuera de esta fase.

## Fuera de alcance (fase 2, explícito)

- Auto-derivación en el resto de los 20+ servicios de auto-posting (activos fijos, caja chica, distribución de
  ingresos, prestaciones/vacaciones) — se activa cuenta por cuenta, bajo demanda, según cuáles marque el dueño
  realmente con `Ter.=SI` (YAGNI).
- Reporte "saldo por tercero de una cuenta pote" — el dato queda capturado desde esta fase, pero el reporte agregado
  (la razón de negocio original del feature: "¿cuánto le debe Fulano?") es un consumidor nuevo, no parte de este ADR.
- Backfill de `JournalEntry` históricos contra una cuenta que se marca `Ter.=SI` por primera vez — el gate protege
  escrituras nuevas únicamente, mismo criterio que ADR-053.
- Caso de un tercero sin registro formal en el catálogo (ej. una retención histórica con RIF en texto libre) — a partir
  de este feature, Customer/Vendor/Partner/Employee es la fuente de verdad hacia adelante.
