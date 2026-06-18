# MANUAL TÉCNICO DEL SISTEMA
# ContaFlow — Versión 1.0.0

**Providencia Administrativa SNAT/2024/000121**
Barquisimeto, Estado Lara — Venezuela — Año 2026

---

## I. INTRODUCCIÓN Y ALCANCE

ContaFlow es un Sistema Administrativo-Contable Web orientado a PYMES, medianas empresas y contadores particulares en Venezuela. Permite la emisión de facturas y documentos fiscales conforme a la normativa SENIAT (PA-0071, PA-121), la gestión de libros contables bajo VEN-NIF, el control de inventario, nómina LOTTT y reportes fiscales completos.

### Alcance del Manual
Este manual describe la arquitectura técnica interna, el modelo de datos fiscal, los mecanismos de seguridad e integridad, el proceso de transmisión electrónica al SENIAT y la infraestructura de despliegue del sistema ContaFlow v1.0.0.

---

## II. ARQUITECTURA DEL SISTEMA

### 2.1 Modelo de Despliegue

ContaFlow opera exclusivamente como **Software como Servicio (SaaS)** alojado en infraestructura cloud. El acceso se realiza únicamente a través de navegador web mediante conexión HTTPS. No existe instalación local en equipos del contribuyente.

```
CLIENTE (Navegador Web)
        │  HTTPS/TLS 1.3
        ▼
┌─────────────────────┐
│  Vercel Edge Network │  CDN + SSL/TLS automático
│  (Next.js App Router)│  Funciones serverless
└──────────┬──────────┘
           │
    ┌──────┴──────────────────────┐
    │                             │
    ▼                             ▼
┌─────────┐              ┌──────────────┐
│  Clerk  │              │  Neon        │
│  (Auth) │              │  PostgreSQL  │
│         │              │  Serverless  │
└─────────┘              └──────────────┘
    │                             │
    ▼                             ▼
┌─────────┐              ┌──────────────┐
│ Upstash │              │  QStash      │
│  Redis  │              │  (Cola msgs) │
│  (Rate  │              │  SENIAT TX   │
│ Limit)  │              └──────────────┘
└─────────┘
```

### 2.2 Capas de la Aplicación

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| Presentación | Next.js 16 App Router (React 19) | Interfaz de usuario, Server Components, Client Components |
| Lógica de Negocio | Server Actions (TypeScript) | Validación Zod 4, lógica fiscal, mutaciones |
| Acceso a Datos | Prisma ORM 7.4.1 | Queries tipadas, transacciones ACID |
| Base de Datos | PostgreSQL 16 (Neon Serverless) | Persistencia, integridad referencial |
| Autenticación | Clerk v7 | Identidad, sesiones, MFA |
| Cola de Mensajes | QStash (Upstash) | Transmisión diferida al SENIAT, reintentos |
| Rate Limiting | Upstash Redis Sliding Window | Control de abuso por operación fiscal |
| Monitoreo | Sentry v10 | Trazas de errores, spans de performance |

### 2.3 Flujo de Solicitud Típico

```
1. Navegador → HTTPS → Vercel Edge
2. Vercel → Clerk.verify() → Validar sesión activa
3. Server Action → Zod.safeParse() → Validar entrada
4. Server Action → companyMember.findFirst() → Verificar tenant
5. prisma.$transaction() → Mutación + AuditLog atómica
6. QStash.enqueue() → Encolar transmisión SENIAT (async)
7. Response → Cliente
```

---

## III. STACK TECNOLÓGICO

| Componente | Tecnología | Versión | Propósito |
|---|---|---|---|
| Framework | Next.js App Router | 16.x | Server/Client rendering, routing |
| Lenguaje | TypeScript | 5.x | Tipado estático, seguridad en tiempo de desarrollo |
| Base de Datos | PostgreSQL (Neon Serverless) | 16 | Persistencia ACID |
| ORM | Prisma | 7.4.1 | Acceso tipado a BD, migraciones |
| Adaptador BD | @prisma/adapter-neon (WebSocket) | 7.4.1 | Pool de conexiones serverless para Neon |
| Autenticación | Clerk | v7 | Identidad, MFA, sesiones |
| Validación | Zod | 4.x | Esquemas de entrada en Server Actions |
| Aritmética Fiscal | Decimal.js | 10.x | Cálculos monetarios sin error de coma flotante |
| PDF | @react-pdf/renderer | 4.x | Generación de facturas y comprobantes PDF |
| Firma Digital | node:crypto + @peculiar/x509 | Node 20 / 1.x | RSA-2048, X.509, firma PDF |
| OCR | Google Gemini Vision | Flash | Lectura de facturas de proveedores |
| Cola | QStash (Upstash) | v2 | Transmisión SENIAT con reintentos |
| Rate Limiting | Upstash Redis | v2 | Sliding window por operación fiscal |
| Testing | Vitest | 4.x | 2.836 pruebas automatizadas |
| Monitoreo | Sentry | v10 | Observabilidad en producción |
| CI/CD | GitHub Actions | - | Integración continua, gate de calidad |

---

## IV. MÓDULOS FUNCIONALES

### 4.1 Módulo de Facturación Fiscal

**Documentos soportados:**
- Factura de Venta (FACTURA / SALE)
- Factura de Compra (FACTURA / PURCHASE)
- Nota de Crédito (NOTA_CREDITO)
- Nota de Débito (NOTA_DEBITO)
- Comprobante de Retención IVA (CR-XXXXXXXX)
- Comprobante de Retención ISLR (Decreto 1808)

**Características técnicas:**
- Número de control correlativo `00-XXXXXXXX` generado con transacción `SERIALIZABLE` en PostgreSQL, garantizando unicidad absoluta bajo concurrencia
- Número de correlativo de retención `CR-XXXXXXXX` con el mismo mecanismo
- IVA multi-alícuota: General 16% / Reducido 8% / Adicional Lujo 15% (total 31%) / Exento 0%
- IGTF 3% calculado en `PaymentRecord` según tipo de moneda y condición de Contribuyente Especial
- Exportación XML SENIAT compatible con el portal declaraciones.seniat.gob.ve
- PDF firmado digitalmente con certificado X.509 de la empresa emisora

### 4.2 Módulo Contable

- Libro Diario (`Transaction`) con validación de partida doble
- Libro Mayor (`JournalEntry`) — líneas débito/crédito por cuenta
- Plan de Cuentas VEN-NIF con códigos jerárquicos (1.x.x.x)
- Estados Financieros: Balance General, Estado de Resultados, Balance de Comprobación
- Ajuste por Inflación INPC (VEN-NIF 3) con transacciones `SERIALIZABLE`
- Cierre de Año Fiscal con bloqueo permanente del período (R-3)

### 4.3 Módulo de Retenciones

- Retención IVA 75% / 100% para Contribuyentes Especiales
- Retención ISLR Decreto 1808: 60+ tipos de concepto con alícuotas variables
- Comprobante PDF con código QR de verificación
- Enteramiento de retenciones con asiento contable automático (cuentas 2205/2110)

### 4.4 Módulo Fiscal / Forma 30

- Generación automática de Declaración Forma 30 IVA con todos los campos PA 0071
- Secciones A (débitos), B (créditos), C (retenciones), D (IGTF), E (cuota/saldo)
- Libro de Ventas y Libro de Compras en PDF + Excel, columnas exactas PA 0071
- Exportación XML compatible con el portal SENIAT

### 4.5 Módulo de Inventario

- Costeo Promedio Ponderado (CPP) conforme VEN-NIF 2
- Movimientos ENTRADA / SALIDA con asiento contable automático (COGS)
- Control de Lotes y Números de Serie
- Alertas de stock mínimo
- Soporte de Unidades de Medida múltiples
- **Lotes y Números de Serie** (Lot/Serial Tracking): `InventoryLot`, `InventorySerial`, `LotAllocation` — rastreo completo de lotes con fecha de vencimiento y números de serie unitarios
- **Unidades de Medida múltiples** (UoM): conversión entre unidades de compra y venta (Fase ADR-018)
- **COGS Automático Perpetuo**: al emitir factura de venta, el sistema genera automáticamente el asiento Dr COGS / Cr Inventario usando el costo promedio ponderado (CPP) de la línea

### 4.6 Módulo de Nómina (LOTTT)

- Cálculo completo: salario, bonificaciones, deudas de ley
- Aportes: IVSS 4% (trabajador) + 9%-11% (patronal), INCES, Banavih FAOV
- Prestaciones sociales (Art. 142 LOTTT) con capitalización mensual
- Vacaciones, utilidades, liquidación
- ARC (Retención ISLR sobre sueldos)
- TXT bancario para pagos masivos
- **Solicitudes de Vacaciones**: flujo PENDING → APPROVED/REJECTED/CANCELLED; cálculo de balance acumulado conforme LOTTT Art.190; aprobación por gerente con ManagerApprovalInbox; envío automático de recibo de pago por email post-aprobación
- **Préstamos a Empleados**: PENDING → aprobación ACCOUNTING/ADMIN; interés opcional (método francés); saldo en moneda mixta VES+USD
- **Reportes obligatorios exportables**: Excel IVSS/BANAVIH/INCES; TXT BANAVIH FAOV-Web (pipe-delimited); CSV MINTRA declaración trimestral; PDF Forma 14-100 Constancia de Trabajo individual
- **Campos Forma 14-02 IVSS**: `ivssNumber`, `payrollWorkerType` (OBRERO/EMPLEADO), `maritalStatus`, `dependents`
- **Alertas automáticas**: salario mínimo vencido (>30d), prestaciones por acumular (Art.142), intereses BCV pendientes (Art.143), empleados en período de prueba por vencer (Art.45)

### 4.7 Módulo de Activos Fijos

- VEN-NIF 16, tres métodos de depreciación: Línea Recta, Suma de Dígitos, Unidades de Producción
- Asiento de depreciación automático mensual
- Revaluación de activos (VEN-NIF)
- **N1 — Art. 66 LIVA: Reintegro IVA crédito fiscal en baja anticipada (<36 meses)**: `DisposeAssetModal` calcula `costo×16%×(36-meses)/36`; GL automático Dr Gasto IVA / Cr IVA CF; opción opt-out para el usuario
- **N2 — Moneda de adquisición**: campos `acquisitionCurrency` y `bcvRateAtAcquisition` para registrar la tasa BCV histórica al momento de la compra; badge visible en tabla
- **N3 — Historial INPC persistente**: modelo `FixedAssetINPCRestatement` con `@@unique([assetId,year,month])`; modal de historial por activo; previene gaps de período
- **N4 — Importación desde Gasto confirmado**: selección de gastos CONFIRMED del proveedor para pre-llenar 6 campos del activo (descripción, monto, RIF proveedor, fecha, factura, cuentas)
- **N5 — Advertencia salto de período**: detecta brecha en historial de depreciación y muestra alerta ámbar antes de aplicar
- **N6 — Factor INPC visible**: columna "Factor INPC" con badge en tabla de activos
- **FA-5 F3**: advertencia de deductibilidad SENIAT (Art. 76 LISLR) si faltan `facturaNumber` y `providerRif`

### 4.8 Módulo de Multimoneda

- USD, EUR, VES y otras divisas
- Tasa BCV obtenida automáticamente (BcvFetchService)
- Diferencial cambiario NIC 21 con asiento automático

### 4.9 Portales de Autoservicio

**Portal del Empleado** (`/employee/[token]`):
- Acceso público sin Clerk, autenticado mediante JWT HMAC-SHA256 (30 días)
- Muestra: datos del empleado, últimas 12 nóminas desglosadas, vacaciones acumuladas, préstamo activo con barra de progreso
- `generatePortalTokenAction` requiere rol ADMIN; guard cross-tenant ADR-004

**Portal del Cliente** (`/client-portal/[token]`):
- Acceso público sin Clerk, JWT HMAC-SHA256 (30 días)
- Muestra: facturas CxC pendientes, historial de pagos
- `generateClientPortalTokenAction` requiere rol ADMIN

### 4.10 Gestión Documental

Vista unificada de facturas y retenciones con:
- PDF on-demand por documento
- JWT share links de 7 días para auditorías SENIAT (`DOC_SHARE_SECRET`, endpoint `/api/doc/[token]` público)
- `AuditLog` con acción `DOC_SHARED` (R-6 — IP + UserAgent)
- Guard cross-tenant ADR-004

### 4.11 CRM Básico

- `ContactCategory`: LEAD / REGULAR / VIP en Clientes y Proveedores
- `ContactNote`: historial de interacciones por contacto con timestamp y autor
- Alerta `CLIENTES_INACTIVOS` en dashboard para clientes sin actividad reciente

### 4.12 Presupuestos y Proyecciones

- Modelos: `Budget` + `BudgetLine` + `BudgetStatus` (DRAFT/ACTIVE/CLOSED)
- `BudgetService.compareWithActual()`: compara presupuestado vs ejecutado usando `journalEntry.groupBy` real
- `CashFlowProjectionService`: proyección de flujo de caja en 4 buckets (Vencido / 0-30d / 31-60d / 61-90d) desde CxC y CxP pendientes
- UI: BudgetList, BudgetDetail, CashFlowWidget; página `/budgets`

### 4.13 Asistente AI

- `FloatingAIAssistant`: panel flotante con badge de anomalías contables
- Endpoint `GET /api/company/[companyId]/anomaly-summary` con auth + IDOR + rol ACCOUNTING + rate limit `limiters.read` (120/min)
- `getAnomalySummaryAction` para análisis de inconsistencias: facturas sin asiento, retenciones sin enteramiento, inventario sin cuentas GL, etc.

### 4.14 Proveedor de Factura Digital (PA-102)

Fase 39 — ADR-031: interfaz neutral `DigitalInvoiceProvider` con implementaciones:
- `HKADigitalInvoiceProvider`: stub de integración HKA (pendiente documentación oficial)
- `MockDigitalInvoiceProvider`: para pruebas
- `NullDigitalInvoiceProvider`: desactiva la integración
- Seleccionado mediante variable de entorno `DIGITAL_INVOICE_PROVIDER=hka|mock|null`
- Campos en `Invoice`: `digitalProviderRef`, `isDigital`, `contingency`

### 4.15 Gestión de Suscripciones (Modelo SaaS)

- **Ciclo de vida**: suscripciones cripto (USDT) sin débito automático; renovación manual
- **`SubscriptionService`**: `getSubscriptionState` / `isWriteAllowed` / `assertWriteAllowed` (fail-open) / `runBillingLifecycle`
- **Gate central de escritura**: extensión `$extends` de Prisma que bloquea TODA escritura de modelos de negocio si la suscripción venció. Modelos exentos: Subscription, SubscriptionPayment, AuditLog, User, Company, etc.
- **Recordatorios**: email 7d y 3d antes de vencimiento (Resend), con caché diaria para no duplicar
- **WhatsApp**: stub Meta Cloud API (`lib/whatsapp.ts`), no-op sin env `WHATSAPP_*`
- **Cron**: `/api/cron/billing-lifecycle` (ejecución diaria 13:00)
- **Perfiles de suscripción** (`ScopeProfile`): SOLO ($69/mes o $59/año), EMPRESA ($79/mes o $65/año), DESPACHO (tiers: STARTER $119/5 RIFs, PRO $249/25 RIFs, UNLIMITED $359/∞ RIFs)

### 4.16 Modo Despacho Contable

- `ManagedClient` + `DespachoTier` (STARTER/PRO/UNLIMITED)
- `DespachoService`: `canAddManagedClient`, `addManagedClient`, `archiveManagedClient`, `listManagedClients`, `upgradeDespachoTier`
- Guards: R-6, ADR-004, VEN_RIF_REGEX
- UI: DespachoRifList, AddRifModal, DespachoTierCard; página `/despacho/rifs`
- Nav con progressive disclosure solo si `scopeProfile = DESPACHO`

---

## V. MODELO DE DATOS FISCAL

### 5.1 Entidades Fiscales Principales

```
Invoice {
  id              String   @id
  companyId       String   -- aislamiento multi-tenant
  invoiceNumber   String   -- número de factura
  controlNumber   String   -- 00-XXXXXXXX (SENIAT)
  docType         InvoiceDocType  -- FACTURA / NOTA_CREDITO / NOTA_DEBITO
  type            InvoiceType     -- SALE / PURCHASE
  date            DateTime
  counterpartRif  String   -- RIF del cliente/proveedor
  counterpartName String
  currency        Currency
  status          InvoiceStatus   -- DRAFT / ISSUED / VOID
  taxLines        InvoiceTaxLine[]
  seniatSubmission SeniatSubmission?
  auditLogs       AuditLog[]
  deletedAt       DateTime?  -- VOID lógico, nunca DELETE físico
}

InvoiceTaxLine {
  taxType   TaxLineType  -- IVA_GENERAL / IVA_REDUCIDO / IVA_ADICIONAL / EXENTO
  base      Decimal      -- base imponible (Decimal.js, nunca float)
  amount    Decimal      -- monto de impuesto
}

SeniatSubmission {
  id          String
  invoiceId   String  @unique
  status      SeniatStatus  -- PENDING / SENT / FAILED / ACKNOWLEDGED
  payload     Json
  retryCount  Int
  sentAt      DateTime?
}

AuditLog {
  id              String
  companyId       String
  userId          String
  action          String
  entityType      String
  entityId        String
  oldValue        Json?
  newValue        Json?
  ipAddress       String   -- capturado desde x-forwarded-for
  userAgent       String
  createdAt       DateTime @default(now())
}

Retencion {
  id              String
  voucherNumber   String   -- CR-XXXXXXXX
  companyId       String
  type            RetencionType  -- IVA / ISLR
  status          RetencionStatus
  ivaAmount       Decimal
  islrAmount      Decimal?
  totalRetention  Decimal
}

AccountingPeriod {
  id        String
  companyId String
  year      Int
  month     Int
  status    PeriodStatus  -- OPEN / CLOSED
}
```

### 5.2 Restricciones de Integridad

- `onDelete: Restrict` en TODAS las tablas contables — previene eliminación de registros padre con hijos fiscales
- `@@unique([companyId, controlNumber])` en `Invoice` — unicidad de número de control por empresa
- `@@unique([companyId, voucherNumber])` en `Retencion` — unicidad de comprobante
- `idempotencyKey String? @unique` en `Invoice` y `Retencion` — previene creaciones duplicadas

---

## VI. MECANISMOS DE INTEGRIDAD FISCAL

### 6.1 Prohibición de Eliminación Física

```
POLÍTICA: NEVER DELETE → VOID
```

Ningún registro fiscal puede eliminarse físicamente. El sistema implementa:
- Campo `deletedAt DateTime?` para anulación lógica
- Campo `status = VOID` en entidades fiscales
- No existe ninguna instrucción `prisma.invoice.delete()` en el código fuente
- `onDelete: Restrict` bloquea eliminaciones accidentales en cascada

### 6.2 Corrección Exclusivamente vía NC/ND

Las facturas emitidas solo pueden corregirse mediante Nota de Crédito o Nota de Débito derivadas del documento original. El sistema:
- Conserva inalterados todos los datos de la factura original
- Genera el documento correctivo con referencia al original (`relatedDocNumber`)
- Calcula el `relatedDocNumber` en el servidor, nunca aceptado del cliente

### 6.3 Aritmética Exacta

**Todos** los cálculos monetarios y fiscales usan `Decimal.js`. El tipo `number` de JavaScript/TypeScript está **prohibido** para variables de dinero en todo el código fuente:

```typescript
// ❌ PROHIBIDO
const iva: number = base * 0.16;

// ✅ IMPLEMENTADO
const iva = base.multipliedBy(new Decimal('0.16'));
```

### 6.4 Atomicidad Transaccional

Toda mutación financiera se ejecuta dentro de `prisma.$transaction()`, garantizando que:
- El documento fiscal
- Sus líneas de impuesto
- El asiento contable (JournalEntry)
- El registro de auditoría (AuditLog)
- El `SeniatSubmission`

…se crean o fallan de forma atómica (ACID).

### 6.5 Bloqueo de Períodos Cerrados

Un período contable con `status = CLOSED` genera un error 403 inmediato ante cualquier intento de mutación financiera. No existe excepción a esta regla, salvo ajustes extemporáneos que se registran en el período actual con referencia al período histórico (ADR-015).

### 6.6 Correlativos con Aislamiento Serializable

Los números de control y comprobantes se generan con nivel de aislamiento `SERIALIZABLE` en PostgreSQL:

```typescript
await prisma.$transaction(async (tx) => {
  const seq = await tx.controlNumberSequence.findUniqueOrThrow({
    where: { companyId_invoiceType: { companyId, invoiceType } }
  });
  await tx.controlNumberSequence.update({ ... lastNumber: seq.lastNumber + 1 });
  return `00-${String(seq.lastNumber + 1).padStart(8, '0')}`;
}, { isolationLevel: 'Serializable' });
```

En caso de conflicto de concurrencia (P2034), el sistema captura el error y retorna mensaje de negocio: "Error transitorio — intenta de nuevo."

---

## VII. TRANSMISIÓN ELECTRÓNICA AL SENIAT

### 7.1 Arquitectura QStash

```
Emisión Factura
      │
      ▼
prisma.$transaction()
  ├── Invoice.create()
  ├── SeniatSubmission.create(status=PENDING)
  └── AuditLog.create()
      │
      ▼ (mismo request, post-commit)
SeniatReportingService.enqueue()
      │
      ▼
QStash.publish(url=/api/webhooks/seniat-report, body=payload)
      │
      ▼ (ejecución diferida + reintentos con backoff)
POST /api/webhooks/seniat-report
  ├── Verificar firma QStash (HMAC-SHA256)
  ├── Verificar idempotencia (status IN [SENT, ACKNOWLEDGED])
  ├── SeniatHttpAdapter.transmit(payload)
  └── SeniatSubmission.update(status=SENT/FAILED)
```

### 7.2 Idempotencia de Transmisión

El webhook handler verifica el estado de `SeniatSubmission` antes de procesar:

```
Si status IN [SENT, ACKNOWLEDGED] → descartar silenciosamente
Si status = PENDING → transmitir
Si status = FAILED y retryCount < 3 → reintentar
```

Esto garantiza **exactamente una entrega por documento fiscal** (exactly-once delivery), incluso ante reintentos automáticos de QStash.

### 7.3 Payload de Transmisión

```json
{
  "sistema": "ContaFlow",
  "version": "1.0.0",
  "rif_emisor": "J-XXXXXXXXX-X",
  "tipo_documento": "FACTURA",
  "numero_control": "00-00000001",
  "fecha_emision": "2026-01-15",
  "rif_receptor": "J-XXXXXXXXX-X",
  "nombre_receptor": "Cliente ABC",
  "moneda": "VES",
  "monto_total": "1000.00",
  "base_imponible": "862.07",
  "iva": "137.93",
  "timestamp_sistema": "2026-01-15T14:32:00.000Z",
  "hash_integridad": "sha256:..."
}
```

---

## VIII. FIRMA ELECTRÓNICA DIGITAL

### 8.1 Arquitectura de Certificados

ContaFlow implementa un modelo híbrido de dos niveles:

**Nivel 1 — Certificado Demo (operación inmediata):**
- Generado automáticamente al crear la empresa
- Par de claves RSA-2048 generado con `node:crypto`
- Certificado X.509 autofirmado con `@peculiar/x509`
- `CommonName` = Nombre de la empresa, `SerialNumber` = RIF
- Costo: $0 — disponible desde el día 1

**Nivel 2 — Certificado Oficial (producción):**
- Cargado por el ADMIN en formato `.p12`
- Proveedor acreditado: PSC World, SUSCERTE u otro autorizado
- Cifrado con AES-256-GCM antes de almacenar en base de datos
- La clave privada nunca toca el disco del servidor — procesada y cifrada en memoria

### 8.2 Proceso de Firma de Documentos

```
PDF Generado
      │
      ▼
CertificateService.getActive(companyId)
  └── Descifrar encryptedP12 (AES-256-GCM)
      │
      ▼
DocumentSigningService.sign(pdfBuffer, privateKey)
  └── Firma incrustada en PDF (PDF/A)
      │
      ▼
AuditLog ← thumbprint SHA-256 del certificado
SeniatSubmission ← thumbprint registrado
      │
      ▼
buf.fill(0)  ← clave privada borrada de memoria
```

### 8.3 Modelo CompanyCertificate

```
CompanyCertificate {
  id            String
  companyId     String  @unique
  commonName    String
  serialNumber  String  (RIF)
  encryptedP12  Bytes   (AES-256-GCM)
  thumbprint    String  (SHA-256)
  issuedBy      String
  expiresAt     DateTime
  isSelfSigned  Boolean
  createdAt     DateTime
}
```

**Nota de seguridad:** El campo `encryptedP12` nunca es incluido en consultas al cliente. Todos los SELECT que incluyen CompanyCertificate excluyen explícitamente este campo.

---

## IX. REGISTRO DE AUDITORÍA

### 9.1 Captura de Eventos

El sistema registra automáticamente en `AuditLog`:

| Campo | Origen | Descripción |
|---|---|---|
| `userId` | Clerk session | ID del usuario autenticado |
| `companyMemberId` | DB lookup | Membresía del usuario en la empresa |
| `action` | Constante | `INVOICE_CREATE`, `PAYMENT_RECORD`, etc. |
| `entityType` | Constante | `Invoice`, `Retencion`, `Transaction`, etc. |
| `entityId` | Resultado DB | ID del registro afectado |
| `oldValue` | Snapshot pre-mutación | JSON del estado anterior |
| `newValue` | Snapshot post-mutación | JSON del estado nuevo |
| `ipAddress` | Request headers | `x-forwarded-for` ?? `x-real-ip` |
| `userAgent` | Request headers | Navegador y sistema operativo |
| `createdAt` | `@default(now())` | Timestamp del servidor |

### 9.2 Inmutabilidad

- Solo se usa `auditLog.create()` — no existe `auditLog.update()` ni `auditLog.delete()` en ningún archivo del sistema
- El AuditLog es completamente **append-only**
- 44+ operaciones fiscales y financieras cubiertas

### 9.3 Cobertura de Operaciones Auditadas

Creación/anulación de facturas, NC/ND, retenciones, pagos, registros IGTF, movimientos de inventario, cierres de período, cierres de ejercicio, nóminas, desembolso de préstamos, operaciones de activos fijos, miembros de empresa, datos SENIAT de empresa, firma de documentos, generación de certificados.

---

## X. SEGURIDAD Y CONTROL DE ACCESO

### 10.1 Autenticación

- **Clerk v7** verifica la sesión antes de cualquier lógica de negocio
- `auth()` llamado al inicio de toda Server Action
- Soporte de MFA (Multi-Factor Authentication) mediante Clerk
- 2FA step-up para operaciones críticas: cierre de ejercicio, eliminación de miembro, datos SENIAT, archivado de empresa

### 10.2 Autorización Multi-Tenant

```typescript
// Guard IDOR — presente en TODAS las Server Actions críticas
const member = await prisma.companyMember.findFirst({
  where: { companyId, userId }
});
if (!member) throw new Error("Sin acceso a esta empresa");
```

### 10.3 Roles del Sistema

| Rol | Privilegios |
|---|---|
| OWNER | Todos los módulos + billing + datos SENIAT |
| ADMIN | Todos los módulos + gestión de miembros |
| ACCOUNTANT | Contabilidad, facturación, nómina, inventario |
| ADMINISTRATIVE | Facturación, ventas, compras (configurable) |
| VIEWER | Solo lectura |
| SENIAT | Solo lectura de informes de auditoría fiscal |

### 10.4 Rate Limiting

| Limitador | Ventana | Límite | Fail | Operaciones |
|---|---|---|---|---|
| `limiters.fiscal` | 1 minuto | 30 req | Closed | Crear facturas, retenciones, correlativos, pagos, IGTF |
| `limiters.ocr` | 1 minuto | 10 req | Open | OCR de documentos (Gemini Vision) |
| `limiters.read` | 1 minuto | 120 req | Open | Lecturas de render: libros, métricas, dashboard, exportaciones |

Implementado con Upstash Redis Sliding Window. En ausencia de Redis, el sistema opera en modo permisivo (fail-open) para no interrumpir operaciones fiscales.

### 10.5 Validación de Entrada

- **Zod 4** con `.safeParse()` obligatorio en TODAS las Server Actions
- Tasas fiscales (IVA, IGTF, ISLR) definidas como constantes en el servidor — nunca aceptadas del cliente
- RIF validado con regex: `/^[JVEGCP]-\d{8}-?\d?$/i`
- Sanitización de campos de texto libre

### 10.6 Headers de Seguridad

Configurados en `middleware.ts`:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: script-src 'nonce-{nonce}' 'strict-dynamic'
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## XI. INFRAESTRUCTURA Y DISPONIBILIDAD

### 11.1 Plataforma de Despliegue

| Componente | Proveedor | Región |
|---|---|---|
| Aplicación Web | Vercel | us-east-1 |
| Base de Datos | Neon Serverless PostgreSQL | us-east-2 (AWS) |
| Redis / Rate Limiting | Upstash | us-east-1 |
| Cola de mensajes | QStash (Upstash) | Distribuido |
| Autenticación | Clerk | Distribuido (edge) |
| Monitoreo | Sentry | Distribuido |

### 11.2 Disponibilidad y Recuperación

- **RTO** (Recovery Time Objective): < 4 horas
- **RPO** (Recovery Point Objective): < 1 hora
- **PITR** (Point-in-Time Recovery): Neon conserva 7 días de historial de backup
- **Certificados SSL/TLS**: renovación automática mediante Let's Encrypt / Vercel

### 11.3 Escalabilidad

Vercel ejecuta Next.js como funciones serverless. El escalado es automático según la carga. Neon Serverless escala a cero en inactividad y escala hacia arriba ante demanda sin intervención manual.

---

## XII. PRUEBAS AUTOMATIZADAS

### 12.1 Cobertura

El sistema cuenta con **2.836 pruebas automatizadas** en estado GREEN ejecutadas con Vitest 4 en entorno Node.js.

| Área | Pruebas |
|---|---|
| Servicios de negocio (unit tests) | 1.700+ |
| Server Actions (integration tests) | 800+ |
| Componentes UI (jsdom) | 250+ |
| Tests de seguridad (IDOR, race conditions) | 80+ |

### 12.2 Gate de Calidad CI/CD

Toda fusión al branch principal (`main`) requiere:
- `tsc --noEmit = exit 0` (0 errores de TypeScript)
- `vitest run = 0 failures` (0 pruebas fallidas)
- Revisión de código en GitHub Actions

### 12.3 Cobertura de Escenarios de Seguridad

Las pruebas incluyen específicamente:
- Intentos de acceso cross-tenant (IDOR)
- Condiciones de carrera en correlativos (race conditions)
- Validación de alícuotas IVA que el cliente intente modificar
- Inyección de valores monetarios como `number` en lugar de `Decimal`
- Operaciones en períodos cerrados

---

## XIII. GLOSARIO TÉCNICO

| Término | Definición |
|---|---|
| ACID | Atomicidad, Consistencia, Aislamiento, Durabilidad — propiedades de transacciones BD |
| SERIALIZABLE | Nivel de aislamiento más estricto de PostgreSQL — evita phantom reads |
| Decimal.js | Librería de aritmética de precisión arbitraria para cálculos monetarios |
| Server Action | Función TypeScript que se ejecuta exclusivamente en el servidor (Next.js) |
| Multi-tenant | Arquitectura donde múltiples empresas comparten la misma instancia con datos aislados |
| QStash | Cola de mensajes con garantía de entrega y reintentos automáticos con backoff |
| AES-256-GCM | Estándar de cifrado simétrico con autenticación integrada |
| RSA-2048 | Algoritmo de clave asimétrica para firma digital |
| X.509 | Estándar internacional para certificados de clave pública |
| PDF/A | Estándar ISO para PDF de archivo a largo plazo |
| SHA-256 | Función hash criptográfica de 256 bits para integridad de documentos |
| IDOR | Insecure Direct Object Reference — vulnerabilidad de acceso no autorizado a recursos |
| ScopeProfile | Perfil de uso: SOLO (contador independiente), EMPRESA (empresa), DESPACHO (bufete/contador con múltiples RIFs) |
| ManagedClient | RIF de empresa gestionada por un despacho en el modelo multi-RIF |
| DespachoTier | Nivel del plan Despacho: STARTER/PRO/UNLIMITED según cantidad de RIFs gestionados |
| Billing Gate | Extensión Prisma que bloquea escrituras de negocio si la suscripción está vencida |
| DigitalInvoiceProvider | Interfaz neutral para integración con proveedores de factura electrónica (HKA, etc.) |
| Portal del Empleado | Microsite JWT sin Clerk para consulta de recibos de pago y datos laborales |
| limiters.read | Rate limiter de 120 req/min (fail-open) para operaciones de lectura y reportes |

---

*ContaFlow v1.0.0 — Manual Técnico — Providencia Administrativa SNAT/2024/000121*
*Barquisimeto, Estado Lara — Venezuela — 2026*
