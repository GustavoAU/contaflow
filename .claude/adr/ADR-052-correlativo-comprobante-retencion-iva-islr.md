# ADR-052 — Correlativo del comprobante de retención: IVA continuo, ISLR independiente

**Estado:** Aceptado e implementado (2026-09-22) — rama `fix/retencion-correlativo-continuo`
**Fecha:** 2026-09-22
**Relacionados:** Z-1 (correlativos de documentos fiscales), R-6 (trazabilidad), [[correlativos-por-count]] (memoria — anti-patrón de numeración), ADR-049 (integridad de montos, precedente de revisión fiscal en el módulo de facturación)

## Contexto

Una tester (contadora en formación) revisando el manual de usuario cuestionó el formato del correlativo del comprobante de
retención de IVA. Gustavo trasladó la duda a un contador real. Comparando la respuesta contra el código actual
(`src/modules/retentions/services/RetentionService.ts`, `getNextVoucherNumber`) aparecen dos discrepancias reales, no de forma
sino de fondo:

```ts
// Prov. 0049: AAAAMM + 8 dígitos secuenciales con reinicio mensual.
export async function getNextVoucherNumber(tx, companyId, date = new Date()): Promise<string> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const seq = await tx.retentionSequence.upsert({
    where: { companyId_year_month: { companyId, year, month } },
    create: { companyId, year, month, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  const mm = String(month).padStart(2, "0");
  return `${year}${mm}${String(seq.lastNumber).padStart(8, "0")}`;
}
```

`RetentionSequence` (`prisma/schema.prisma`) es única por `(companyId, year, month)` — cada mes nuevo arranca `lastNumber` en 1.
Este mismo número se usa como `Retencion.voucherNumber` sin importar si `type` es `IVA`, `ISLR` o `AMBAS` (enum `RetentionType`).

**Respuesta del contador (2026-09-22), textual y traducida a requisitos:**

| # | Pregunta | Respuesta | Implicación |
|---|---|---|---|
| 5 | Formato y longitud | `AAAAMM` + 8 dígitos = **14 caracteres**. Ej: `20260900000001` | El formato actual **ya es correcto** — no cambia. |
| 6 | ¿Se reinicia el contador de IVA? | **No** — "es un conteo continuo, solo cambia el año y el mes cuando el año y el mes cambian [en el prefijo]". El de ISLR sí se puede reiniciar cada mes | **Bug real**: hoy el contador de IVA se reinicia a 1 cada mes (`companyId_year_month` como clave única de incremento) |
| 7 | ¿Aplica igual al ISLR? | El de ISLR **sí se reinicia cada mes** | El comportamiento actual de "reinicio mensual" es correcto, pero solo debería aplicar a ISLR, no a IVA |
| 8 | ¿Un solo número para IVA+ISLR o cada uno el suyo? | **"Cada uno lleva su correlativo correspondiente"** — independientes | **Bug real**: hoy `Retencion` tiene un único `voucherNumber` compartido entre ambos impuestos |

También se confirmó (preguntas 1-4, asiento diario de ventas) que el criterio de "un asiento por factura vs. resumen diario" es un
tema aparte, de arquitectura del Libro Diario — no se toca en este ADR, queda para uno propio si se decide seguir adelante.

## Decisión propuesta

### 1. Dos secuencias independientes, no una compartida

- **IVA**: contador continuo por empresa, **nunca se reinicia**. El prefijo `AAAAMM` en el número impreso refleja el período de
  emisión (el mes/año en que se genera el comprobante), pero **no particiona el contador** — es puramente de presentación.
- **ISLR**: contador que se reinicia cada mes, igual al mecanismo actual — pero en su **propia** fila/tabla, desacoplado de IVA.

Diseño de esquema propuesto (nombres provisionales):

```prisma
// Reemplaza RetentionSequence para IVA — una fila por empresa, jamás se particiona por período.
model IvaRetentionSequence {
  id         String   @id @default(cuid())
  companyId  String   @unique
  company    Company  @relation(fields: [companyId], references: [id], onDelete: Restrict)
  lastNumber Int      @default(0)
  updatedAt  DateTime @updatedAt
}

// Igual al RetentionSequence de hoy, pero solo para ISLR — se mantiene el reinicio mensual.
model IslrRetentionSequence {
  id         String   @id @default(cuid())
  companyId  String
  company    Company  @relation(fields: [companyId], references: [id], onDelete: Restrict)
  year       Int
  month      Int
  lastNumber Int      @default(0)
  updatedAt  DateTime @updatedAt

  @@unique([companyId, year, month])
}
```

`getNextVoucherNumber` se separa en `getNextIvaVoucherNumber` (upsert por `companyId` solamente, `increment: 1`, arma
`${year}${mm}${lastNumber.padStart(8,"0")}` con el year/mes ACTUALES solo para el prefijo) y `getNextIslrVoucherNumber`
(idéntico al mecanismo de hoy, sobre la tabla nueva). Ambas mantienen la precondición de `Serializable` que ya exige el
comentario original — el patrón de upsert+increment sobre una fila de secuencia dedicada es el correcto según
[[correlativos-por-count]] (nunca derivar de `count()`/`findFirst` sobre la propia tabla de eventos).

### 2. `Retencion` necesita un segundo campo de comprobante

`voucherNumber` pasa a significar **exclusivamente el comprobante de IVA**. Se agrega `islrVoucherNumber String?`, poblado solo
cuando `type` es `ISLR` o `AMBAS`. Todo call-site que hoy lee `voucherNumber` asumiendo que cubre "la retención" en general
(PDF, reconciliación, `exportRetentionVoucherPDFAction`, etc.) hay que auditarlo — son al menos 8 archivos (`RetentionService.ts`,
`retention.actions.ts`, `RetentionVoucherPDFService.ts` y sus tests).

## Preguntas abiertas — resueltas por Gustavo (2026-09-22)

1. **¿Hay comprobantes de retención reales ya emitidos en producción?** No — confirmado. Los 10 registros de `Retencion` en la
   BD son datos de prueba de alpha. Se resetea limpio: `RetentionSequence` se elimina por completo, sin backfill ni migración
   de datos históricos.
2. **¿Dos PDF separados para AMBAS?** No es necesario — "por lo general se generan los dos comprobantes por separado en todos
   los sistemas que he manejado, pero si los quieres hacer los dos en un solo PDF no hay problema... con tal cada uno tenga su
   secuencia en los correlativos". Se implementó UN solo PDF que imprime ambos números por separado y rotulados (`N° Comprobante
   IVA:` / `N° Comprobante ISLR:`) cuando `type === AMBAS` — más simple que dos documentos y cumple el requisito real (cada
   correlativo independiente y trazable).

## Implementación (resumen — ver commit `bc92650`)

- Esquema: `IvaRetentionSequence` (`companyId` único, contador continuo) e `IslrRetentionSequence` (idéntico al mecanismo viejo,
  reinicio mensual) reemplazan a `RetentionSequence`. `Retencion.islrVoucherNumber` + `Invoice.islrRetentionVoucher` nuevos, con
  índice único parcial propio `(companyId, islrVoucherNumber)`.
- `RetentionService.ts`: `getNextIvaVoucherNumber` / `getNextIslrVoucherNumber` reemplazan a `getNextVoucherNumber`. Cubiertos
  con tests de secuencia real (tabla fake con estado, no un mock de valor fijo — ver [[correlativos-por-count]]) que prueban
  que IVA nunca reinicia y que ISLR sí.
- `retention.actions.ts`: cada `type` pide solo el/los correlativo(s) que le corresponden. Hallazgo durante la implementación
  (no estaba en el diseño original): `Transaction` tiene `@@unique([companyId, number])`, y como IVA/ISLR son ahora secuencias
  independientes pueden coincidir en el mismo valor numérico en el mismo período — el `number` del asiento de emisión (antes
  `RET-${voucherNumber}`) necesitó prefijo de tipo (`RET-IVA-...`/`RET-ISLR-...`) para no chocar en P2002.
- Migración aplicada contra la BD real vía Neon MCP (HTTP 443 — VPN bloquea TCP 5432, `prisma db execute`/`migrate resolve`
  fallan P1001; ver memoria "migraciones-neon-vpn-http"). RLS ENABLE+FORCE+policy verificado con `verify-rls.mjs` (93 tablas,
  0 sin cobertura) y `verify-drift.mjs` (94=94, sin drift).
- 131/131 tests en `src/modules/retentions`, `tsc --noEmit` 0 errores.

## Fuera de alcance

- El asiento diario consolidado de ventas (preguntas 1-4 al contador) — arquitectura de Libro Diario, ADR propio si se decide.
- Cualquier cambio a las tasas o al cálculo de la retención misma (`RetentionService.calculateIvaRetention`, etc.) — no está en
  cuestión, solo la numeración del comprobante.
