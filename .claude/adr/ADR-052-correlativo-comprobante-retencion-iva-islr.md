# ADR-052 — Correlativo del comprobante de retención: IVA continuo, ISLR independiente

**Estado:** Propuesto — pendiente confirmación del dueño en 2 puntos (ver "Preguntas abiertas")
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

## Preguntas abiertas — necesito la decisión del dueño antes de tocar el schema

1. **¿Hay comprobantes de retención reales ya emitidos en producción bajo el esquema viejo (reinicio mensual)?** Si sí, la
   migración de arranque del contador continuo de IVA no puede empezar en 0 sin criterio — hay que decidir con qué valor
   sembrarlo (candidato: el total histórico de retenciones IVA/AMBAS de la empresa, calculado UNA SOLA VEZ en la migración, no
   como mecanismo permanente — ver la advertencia de [[correlativos-por-count]] sobre no derivar correlativos vivos de `count()`).
   Si es data de prueba/alpha sin comprobantes reales entregados a terceros, se puede resetear limpio sin backfill.
2. **¿El negocio necesita imprimir DOS comprobantes PDF separados** (uno de retención de IVA, otro de ISLR) cuando
   `type === AMBAS`, ya que legalmente son dos documentos distintos con su propio correlativo? Hoy `RetentionVoucherPDFService`
   genera un solo PDF con un solo `voucherNumber`. Si la respuesta es sí, este ADR se queda corto y hace falta diseñar el
   split de UI/PDF antes de implementar; si es no (por ahora basta con que cada número quede bien guardado y trazable, aunque
   el PDF actual solo muestre uno), la implementación es mucho más acotada.

## Fuera de alcance

- El asiento diario consolidado de ventas (preguntas 1-4 al contador) — arquitectura de Libro Diario, ADR propio si se decide.
- Cualquier cambio a las tasas o al cálculo de la retención misma (`RetentionService.calculateIvaRetention`, etc.) — no está en
  cuestión, solo la numeración del comprobante.
