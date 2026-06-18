# DIAGRAMAS DE FLUJO DE DATOS FISCALES
# ContaFlow — Versión 1.0.0

**Providencia Administrativa SNAT/2024/000121**
Barquisimeto, Estado Lara — Venezuela — Año 2026

---

## FLUJO 1: EMISIÓN DE FACTURA DE VENTA

### Descripción
Proceso completo desde que el usuario inicia la creación de una factura de venta hasta su transmisión al SENIAT y reflejo en la contabilidad.

```
┌─────────────────────────────────────────────────────────────────┐
│  ACTOR: Usuario (Contador / Administrativo)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. INICIO: Usuario accede a "Nueva Factura → Venta"            │
│     Sistema verifica: auth() + companyMember (role check)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. VALIDACIÓN DE ENTRADA (Servidor)                            │
│     Zod 4.safeParse():                                          │
│     ✔ RIF receptor: /^[JVEGCP]-\d{8}-?\d?$/i                   │
│     ✔ Líneas de detalle: descripción + cantidad + precio        │
│     ✔ Categoría fiscal: GRAVADA_GENERAL / REDUCIDA /            │
│       ADICIONAL_LUJO / EXENTA / EXONERADA                       │
│     ✔ Moneda: VES / USD / EUR / otras                           │
│     ✔ Período contable activo (status = OPEN)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
               Válido               Inválido
                    │                   │
                    │                   ▼
                    │     Error 400 → Cliente (mensaje Zod)
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. CÁLCULO FISCAL (Servidor — Decimal.js)                      │
│                                                                 │
│  Por cada línea:                                                │
│    base = precio × cantidad                                     │
│    IVA_GENERAL   = base × Decimal('0.16')   [si GRAVADA]        │
│    IVA_REDUCIDO  = base × Decimal('0.08')   [si REDUCIDA]       │
│    IVA_ADICIONAL = base × Decimal('0.15')   [si LUJO]           │
│    IVA_EXENTO    = Decimal('0')             [si EXENTA]         │
│                                                                 │
│  IGTF 3%: si moneda ≠ VES OR (esContribuyenteEspecial AND VES)  │
│    igtf = totalFactura × Decimal('0.03')                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. TRANSACCIÓN ATÓMICA: prisma.$transaction(Serializable)      │
│                                                                 │
│  4.1 CORRELATIVO:                                               │
│      seq = ControlNumberSequence.findUnique(companyId)          │
│      nextNum = seq.lastNumber + 1                               │
│      controlNumber = "00-" + nextNum.padStart(8,'0')            │
│      ControlNumberSequence.update(lastNumber = nextNum)         │
│                                                                 │
│  4.2 FACTURA:                                                   │
│      Invoice.create({                                           │
│        controlNumber, invoiceNumber, date,                      │
│        counterpartRif, counterpartName,                         │
│        status: ISSUED, currency                                 │
│      })                                                         │
│                                                                 │
│  4.3 LÍNEAS DE IMPUESTO:                                        │
│      InvoiceTaxLine.createMany([                                │
│        { taxType: IVA_GENERAL, base, amount },                  │
│        { taxType: IGTF, base, amount } -- si aplica             │
│      ])                                                         │
│                                                                 │
│  4.4 ASIENTO CONTABLE:                                          │
│      JournalEntry.create({                                      │
│        DR: Cuentas por Cobrar (1.1.2.01)                        │
│        CR: Ventas (4.1.1.01)                                    │
│        CR: IVA Débito Fiscal (2.1.3.01)                         │
│        CR: IGTF por Enterar (2.1.3.05) -- si aplica             │
│      })                                                         │
│                                                                 │
│  4.5 SENIAT SUBMISSION:                                         │
│      SeniatSubmission.create({                                  │
│        invoiceId, status: PENDING,                              │
│        payload: { rif, controlNumber, montos, hash }            │
│      })                                                         │
│                                                                 │
│  4.6 AUDIT LOG:                                                 │
│      AuditLog.create({                                          │
│        action: INVOICE_CREATE,                                  │
│        entityId: invoice.id,                                    │
│        ipAddress, userAgent,                                    │
│        newValue: { controlNumber, total, iva }                  │
│      })                                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. POST-COMMIT: Generación PDF y Encolamiento SENIAT           │
│                                                                 │
│  5.1 PDF:                                                       │
│      @react-pdf/renderer → buffer PDF                           │
│      DocumentSigningService.sign(buffer, cert_empresa)          │
│        → firma digital incrustada (PDF/A)                       │
│        → buf.fill(0) -- limpiar clave de memoria                │
│      SHA-256 hash del PDF → AuditLog.contentHash                │
│                                                                 │
│  5.2 TRANSMISIÓN SENIAT (async):                                │
│      QStash.publish(                                            │
│        url: /api/webhooks/seniat-report,                        │
│        body: SeniatSubmission.payload,                          │
│        retries: 3, backoff: exponential                         │
│      )                                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. RESPUESTA AL CLIENTE                                        │
│     → PDF disponible para descarga                             │
│     → Número de control: 00-XXXXXXXX                           │
│     → Toast: "Factura emitida correctamente"                   │
│     → Libro de Facturas actualizado                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                    (proceso asíncrono)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. TRANSMISIÓN AL SENIAT (webhook — async)                     │
│                                                                 │
│  POST /api/webhooks/seniat-report                               │
│    ├── Verificar firma HMAC-SHA256 QStash                       │
│    ├── SeniatSubmission.findById → status = PENDING?            │
│    │     NO (SENT/ACKNOWLEDGED) → descartar (idempotencia)      │
│    │     SÍ → continuar                                         │
│    ├── SeniatHttpAdapter.transmit(payload)                      │
│    │     ÉXITO → SeniatSubmission.update(status=SENT, sentAt)   │
│    │     FALLO → SeniatSubmission.update(status=FAILED,         │
│    │              retryCount++) → QStash reintenta              │
│    └── AuditLog.create({ action: SENIAT_TRANSMIT })             │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLUJO 2: EMISIÓN DE NOTA DE CRÉDITO

```
┌─────────────────────────────────────────────────────────────────┐
│  PRECONDICIÓN: Factura en status = ISSUED                       │
│  ACTOR: Contador / Administrativo                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Usuario selecciona factura → "Emitir Nota de Crédito"       │
│     Sistema carga factura original (read-only)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. VALIDACIÓN DE ENTRADA                                       │
│     ✔ Monto NC ≤ monto factura original                         │
│     ✔ Período contable activo (status = OPEN)                   │
│     ✔ Factura original pertenece a la empresa (companyId guard) │
│     ✔ relatedDocNumber derivado del servidor                    │
│       (NUNCA aceptado del cliente)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. TRANSACCIÓN ATÓMICA: prisma.$transaction()                  │
│                                                                 │
│  3.1 CORRELATIVO NC: mismo mecanismo Serializable               │
│      controlNumber_NC = "00-" + nextNum.padStart(8,'0')         │
│                                                                 │
│  3.2 NOTA DE CRÉDITO:                                           │
│      Invoice.create({                                           │
│        docType: NOTA_CREDITO,                                   │
│        relatedDocNumber: factura_original.controlNumber,        │
│        status: ISSUED                                           │
│      })                                                         │
│                                                                 │
│  3.3 ASIENTO CONTABLE REVERSIÓN:                                │
│      JournalEntry.create({                                      │
│        DR: Ventas (reversa)                                     │
│        DR: IVA Débito Fiscal (reversa IVA)                      │
│        CR: Cuentas por Cobrar                                   │
│      })                                                         │
│                                                                 │
│  3.4 SENIAT SUBMISSION:                                         │
│      SeniatSubmission.create({ status: PENDING })               │
│                                                                 │
│  3.5 AUDIT LOG:                                                 │
│      AuditLog.create({ action: CREDIT_NOTE_CREATE,              │
│        oldValue: { factura_original_id },                       │
│        newValue: { nc_id, controlNumber_NC } })                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. PDF NOTA DE CRÉDITO (firmado digitalmente)                  │
│     → Contiene número de control NC + referencia a factura      │
│     → QStash transmite al SENIAT (mismo flujo que factura)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLUJO 3: COMPROBANTE DE RETENCIÓN IVA

```
┌─────────────────────────────────────────────────────────────────┐
│  PRECONDICIÓN: Empresa es Contribuyente Especial                │
│  ACTOR: Contador                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. SELECCIÓN DE FACTURA A RETENER                              │
│     Factura de compra con IVA → seleccionar porcentaje:         │
│     ● 75% (porcentaje estándar)                                 │
│     ● 100% (bienes inmuebles, casos especiales)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. CÁLCULO AUTOMÁTICO (Decimal.js)                             │
│                                                                 │
│  ivaFactura   = InvoiceTaxLine.amount [IVA_GENERAL]             │
│  retencion75  = ivaFactura × Decimal('0.75')                    │
│  retencion100 = ivaFactura × Decimal('1.00')                    │
│                                                                 │
│  El sistema aplica el porcentaje seleccionado por el contador   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. TRANSACCIÓN ATÓMICA                                         │
│                                                                 │
│  3.1 CORRELATIVO RETENCIÓN (Serializable):                      │
│      voucherNumber = "CR-" + nextSeq.padStart(8,'0')            │
│                                                                 │
│  3.2 RETENCION:                                                 │
│      Retencion.create({                                         │
│        voucherNumber,                                           │
│        type: IVA,                                               │
│        ivaRetentionPct: 75 / 100,                               │
│        ivaRetentionAmount: montoRetenido,                       │
│        status: ISSUED                                           │
│      })                                                         │
│                                                                 │
│  3.3 ASIENTO CONTABLE:                                          │
│      JournalEntry.create({                                      │
│        DR: IVA Crédito Fiscal (cuenta 1.1.5.01)                 │
│        CR: Retenciones IVA por Enterar (cuenta 2.1.3.02)        │
│      })                                                         │
│                                                                 │
│  3.4 ACTUALIZAR FACTURA:                                        │
│      Invoice.update({                                           │
│        ivaRetentionAmount: montoRetenido,                       │
│        ivaRetentionVoucher: voucherNumber                       │
│      })                                                         │
│                                                                 │
│  3.5 AUDIT LOG:                                                 │
│      AuditLog.create({ action: RETENTION_IVA_ISSUED,            │
│        ipAddress, userAgent })                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. PDF COMPROBANTE CR-XXXXXXXX                                 │
│     Datos incluidos:                                            │
│     ● Número CR-XXXXXXXX                                        │
│     ● RIF y nombre del proveedor                                │
│     ● Datos de la factura original                              │
│     ● Base imponible, IVA factura, monto retenido, %            │
│     ● Código QR de verificación                                 │
│     ● Período fiscal                                            │
│     ● Firma digital de la empresa                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLUJO 4: COMPROBANTE DE RETENCIÓN ISLR

```
┌─────────────────────────────────────────────────────────────────┐
│  ACTOR: Contador                                                │
│  BASE LEGAL: Decreto 1808 (Retenciones ISLR)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. SELECCIÓN DE CONCEPTO DE PAGO                               │
│                                                                 │
│  El contador selecciona el concepto del Decreto 1808:           │
│  ● Honorarios profesionales (3%)                                │
│  ● Comisiones mercantiles (3%)                                  │
│  ● Arrendamiento inmueble (5%)                                  │
│  ● Servicios de publicidad (3%)                                 │
│  ● [60+ conceptos adicionales]                                  │
│                                                                 │
│  El sistema sugiere automáticamente el concepto según           │
│  la descripción de la factura (IA asistente)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. CÁLCULO AUTOMÁTICO (Decimal.js)                             │
│                                                                 │
│  baseRetencion = montoFactura × pctSubjeto                      │
│  montoRetenido = baseRetencion × pctRetencion                   │
│                                                                 │
│  Ejemplo: factura $1.000, concepto honorarios 3%:               │
│    baseRetencion = $1.000 × 1.00 = $1.000                       │
│    montoRetenido = $1.000 × 0.03 = $30                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. TRANSACCIÓN ATÓMICA                                         │
│                                                                 │
│  Retencion.create({ type: ISLR, islrAmount, islrRetentionPct }) │
│  JournalEntry.create({                                          │
│    DR: Gasto por Servicio                                       │
│    CR: Proveedor / CxP                                          │
│    CR: Retenciones ISLR por Enterar (cuenta 2.1.3.03)           │
│  })                                                             │
│  AuditLog.create({ action: RETENTION_ISLR_ISSUED })             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. PDF COMPROBANTE ISLR                                        │
│     ● Número correlativo                                        │
│     ● Concepto Decreto 1808                                     │
│     ● Base y porcentaje de retención                            │
│     ● Monto retenido en Bs. y/o divisas                         │
│     ● Código QR de verificación                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLUJO 5: TRANSMISIÓN AL SENIAT (QStash)

```
EMISIÓN DE FACTURA/NC/ND (sincrónico)
              │
              ▼
SeniatSubmission.create({ status: PENDING })
              │
              ▼
QStash.publish({ url, payload, retries: 3 })
              │
     ─────────┼─────────────────────────────────
    │         │         │
  t=0s      t=30s     t=120s  (backoff exponencial QStash)
    │         │         │
    ▼         ▼         ▼
POST /api/webhooks/seniat-report
    │
    ├── [1] Verificar firma HMAC-SHA256
    │         NO VÁLIDA → HTTP 401 → fin
    │         VÁLIDA → continuar
    │
    ├── [2] Rate limit (limiters.fiscal)
    │         EXCEDIDO → HTTP 429 → QStash reintenta
    │         OK → continuar
    │
    ├── [3] Idempotencia:
    │         SeniatSubmission.status ∈ {SENT, ACKNOWLEDGED}?
    │         SÍ → HTTP 200 (descartar silenciosamente)
    │         NO → continuar
    │
    ├── [4] SeniatHttpAdapter.transmit(payload)
    │         │
    │    ┌────┴────┐
    │   ÉXITO    FALLO
    │    │         │
    │    ▼         ▼
    │  status=    status=FAILED
    │  SENT       retryCount++
    │  sentAt=now QStash reintentará
    │    │
    │    ▼
    └── [5] AuditLog.create({ action: SENIAT_TRANSMIT,
                              ipAddress, responseCode })
```

---

## FLUJO 6: ACCESO SENIAT PARA FISCALIZACIÓN

```
┌─────────────────────────────────────────────────────────────────┐
│  ACTOR: Fiscal del SENIAT                                       │
│  PRECONDICIÓN: ADMIN de empresa creó usuario con rol SENIAT     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Inicio de sesión con credenciales del rol SENIAT            │
│     Clerk.verify() → sesión activa                              │
│     auth().sessionClaims.role = "SENIAT"                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. ACCESO RESTRINGIDO — Solo puede ver:                        │
│                                                                 │
│  ┌─────────────────────────────┐                                │
│  │ INFORME DE AUDITORÍA        │  getInvoiceAuditReportAction() │
│  │ DE FACTURAS                 │                                │
│  │ ● Todas las facturas        │  Incluye:                      │
│  │   emitidas (ISSUED + VOID)  │  - Número de control           │
│  │ ● Por rango de fechas       │  - RIF cliente                 │
│  │ ● Por tipo de documento     │  - Montos e IVA                │
│  │                             │  - Retenciones                 │
│  │                             │  - Fecha y estado              │
│  └─────────────────────────────┘                                │
│                                                                 │
│  ┌─────────────────────────────┐                                │
│  │ INFORME DE AUDITORÍA        │  getCashAuditReportAction()    │
│  │ DE CAJA                     │                                │
│  │ ● Movimientos de caja       │  Incluye:                      │
│  │ ● Por período               │  - Usuario que realizó la op.  │
│  │                             │  - Fecha y hora                │
│  │                             │  - IP del acceso               │
│  │                             │  - Monto, moneda, tipo         │
│  └─────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. RESTRICCIONES DEL ROL SENIAT                                │
│                                                                 │
│  ❌ NO puede crear facturas                                      │
│  ❌ NO puede anular documentos                                   │
│  ❌ NO puede modificar ningún registro                           │
│  ❌ NO puede ver datos de otras empresas (companyId guard)       │
│  ❌ NO puede acceder a nómina, activos, inventario               │
│  ✅ SOLO lectura de informes fiscales de auditoría               │
│                                                                 │
│  Todo acceso del rol SENIAT genera AuditLog con IP y timestamp  │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLUJO 7: CIERRE DE PERÍODO CONTABLE

```
┌─────────────────────────────────────────────────────────────────┐
│  ACTOR: Contador / OWNER                                        │
│  PRECONDICIÓN: Período en status = OPEN                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Usuario solicita cierre del período                         │
│     2FA step-up: re-autenticación requerida (Clerk)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. VALIDACIONES PRE-CIERRE                                     │
│     ✔ No hay facturas en estado DRAFT en el período             │
│     ✔ La Forma 30 del período fue generada (warning si no)      │
│     ✔ No hay retenciones IVA/ISLR sin enterar (warning)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. TRANSACCIÓN (Serializable)                                  │
│     AccountingPeriod.update({ status: CLOSED })                 │
│     AuditLog.create({ action: PERIOD_CLOSE, ipAddress })        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. EFECTOS POST-CIERRE                                         │
│     ● Toda mutación en el período → ERROR 403 inmediato         │
│     ● Los ajustes extemporáneos se registran en el período       │
│       actual con referencia al período histórico (ADR-015)      │
│     ● El cierre es PERMANENTE — no puede revertirse             │
│       sin un asiento de ajuste en el período actual             │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLUJO 8: GENERACIÓN DE FORMA 30 IVA

```
┌─────────────────────────────────────────────────────────────────┐
│  ACTOR: Contador                                                │
│  FRECUENCIA: Una vez al mes                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Seleccionar mes y año del período                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. DeclaracionIVAService.calculate(companyId, year, month)     │
│                                                                 │
│  SECCIÓN A (DÉBITOS FISCALES):                                  │
│     Sumar InvoiceTaxLine WHERE:                                 │
│       invoice.type = SALE                                       │
│       invoice.date BETWEEN inicio y fin de mes                  │
│       invoice.status = ISSUED                                   │
│     Por alícuota: GENERAL / REDUCIDA / ADICIONAL / EXENTA       │
│     totalDebitosFiscales = Σ(IVA_GENERAL) + Σ(IVA_REDUCIDA)    │
│                          + Σ(IVA_ADICIONAL)                     │
│                                                                 │
│  SECCIÓN B (CRÉDITOS FISCALES):                                 │
│     Sumar InvoiceTaxLine WHERE:                                 │
│       invoice.type = PURCHASE                                   │
│       [mismo período y estado]                                  │
│     totalCreditosFiscales = Σ(IVA crédito)                      │
│                                                                 │
│  SECCIÓN C (RETENCIONES):                                       │
│     retencionesIvaSufridas  = Σ(Retencion.ivaRetentionAmount    │
│                                WHERE type=IVA, como proveedor)  │
│     retencionesIvaPracticadas = Σ(Retencion.ivaRetentionAmount  │
│                                  WHERE type=IVA, como agente)   │
│                                                                 │
│  SECCIÓN D (IGTF):                                              │
│     igtfBase  = Σ(InvoiceTaxLine.base WHERE taxType=IGTF)       │
│     igtfTotal = Σ(InvoiceTaxLine.amount WHERE taxType=IGTF)     │
│                                                                 │
│  SECCIÓN E (CUOTA / SALDO A FAVOR):                             │
│     cuotaPeriodo = débitos - créditos - retenciones             │
│     Si cuotaPeriodo < 0: saldoAFavor = |cuotaPeriodo|           │
│     Si cuotaPeriodo > 0: impuestoPagar = cuotaPeriodo           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. EXPORTACIÓN                                                 │
│     → PDF Forma 30 (descargable, todas las secciones)           │
│     → Excel para verificación                                   │
│     → XML SENIAT para carga en declaraciones.seniat.gob.ve      │
└─────────────────────────────────────────────────────────────────┘
```

---

## RESUMEN DE CONTROLES DE SEGURIDAD POR FLUJO

| Flujo | Auth | CompanyId Guard | Rate Limit | AuditLog | Serializable | Decimal.js |
|---|---|---|---|---|---|---|
| Emisión Factura | ✅ | ✅ | ✅ fiscal | ✅ | ✅ correlativo | ✅ |
| Nota de Crédito | ✅ | ✅ | ✅ fiscal | ✅ | ✅ correlativo | ✅ |
| Retención IVA | ✅ | ✅ | ✅ fiscal | ✅ | ✅ correlativo | ✅ |
| Retención ISLR | ✅ | ✅ | ✅ fiscal | ✅ | ✅ correlativo | ✅ |
| Transmisión SENIAT | N/A (webhook) | ✅ | ✅ | ✅ | N/A | N/A |
| Acceso SENIAT | ✅ | ✅ | ✅ | ✅ | N/A | N/A |
| Cierre Período | ✅ + 2FA | ✅ | N/A | ✅ | ✅ | N/A |
| Forma 30 | ✅ | ✅ | N/A | N/A (solo lectura) | N/A | ✅ |

---

## 6. Flujo de Ciclo de Vida de Suscripción

```
Empresa registrada
      │
      ▼
¿Tiene Subscription activa?
  │ NO → [Demo: sin corte, sin recordatorios]
  │ SÍ
  ▼
¿expiresAt > hoy?
  │ SÍ → [Operación normal]
  │ NO
  ▼
runBillingLifecycle() [Cron diario 13:00]
  ├── Subscription.status → EXPIRED
  ├── ¿Recordatorio enviado hoy? → No duplicar
  ├── [7d antes] → Email "Vence en 7 días"
  └── [3d antes] → Email "Vence en 3 días"
      │
      ▼
Billing Gate ($extends Prisma)
  ├── Operación de escritura detectada
  ├── companyId extraído del payload
  ├── isWriteAllowed(companyId) → cache 30s
  │     │ ALLOWED → continuar
  │     └── BLOCKED → throw "READ_ONLY_MESSAGE"
  └── Modelos EXEMPT (Subscription/AuditLog/Company/User/...) → siempre pasan
```

---

*ContaFlow v1.0.0 — Diagramas de Flujo de Datos Fiscales — Providencia Administrativa SNAT/2024/000121*
*Barquisimeto, Estado Lara — Venezuela — 2026*
