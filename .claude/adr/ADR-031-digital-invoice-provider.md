# ADR-031 — Digital Invoice Provider (Imprenta Digital PA-102)

**Estado:** Aceptado  
**Fecha:** 2026-05-27  
**Autor:** Gustavo / ContaFlow

---

## Contexto

La Providencia Administrativa SNAT/2024/000102 (PA-102) exige que los sistemas de facturación en Venezuela obtengan el **número de control fiscal** desde una **Imprenta Digital Autorizada** por el SENIAT — no pueden generarlo internamente. El proveedor también genera el código QR que debe aparecer en el PDF de la factura.

ContaFlow actualmente genera correlativos internos (`ControlNumberSequence`). Esto sigue siendo válido para empresas que aún operan bajo el esquema de máquinas fiscales o en período de transición, pero para empresas que se registren como **Emisores Digitales** el flujo debe cambiar.

---

## Decisión

Introducir una capa de abstracción `DigitalInvoiceProvider` que:

1. Define un **contrato neutral** (interface TypeScript) independiente del proveedor
2. Implementa el patrón **Adapter** — cada proveedor (HKA, Edicom, futuro) es un adaptador
3. Introduce un `NullProvider` (no-op) para empresas no inscritas en facturación digital
4. Introduce un `MockProvider` para desarrollo y tests
5. La selección del proveedor es **por empresa** (`Company.digitalInvoiceProvider`)
6. Los correlativos internos (`ControlNumberSequence`) se mantienen sin cambios — siguen siendo la fuente de verdad para empresas en el esquema antiguo

### Flujo cuando la empresa tiene proveedor configurado

```
Usuario → createInvoiceAction
  │
  ├── 1. Validar datos (Zod)
  ├── 2. Verificar período abierto
  ├── 3. Llamar DigitalInvoiceProvider.submitInvoice()   ← NUEVO
  │       └── devuelve { controlNumber, qrCode, referenceId }
  │
  └── 4. $transaction Serializable:
          ├── Invoice.create (con controlNumber del proveedor)
          ├── InvoiceTaxLine.createMany
          ├── SeniatSubmission.create (SENT)
          └── AuditLog.create
```

Si el proveedor falla (timeout, 5xx), se activa **modo contingencia**:
- Se genera correlativo interno marcado como `CONTINGENCY`
- `Invoice.isContingency = true`
- La factura queda en cola para reenvío cuando el proveedor se recupere

### Flujo cuando la empresa NO tiene proveedor (NullProvider)

Mismo flujo que hoy: correlativo interno, `controlNumberSource = INTERNAL`.

---

## Cambios de Schema

### Nuevos enums

```prisma
enum DigitalInvoiceProviderType {
  NONE        // Esquema antiguo — correlativo interno
  HKA         // The Factory HKA
}

enum ControlNumberSource {
  INTERNAL    // Generado por ContaFlow (esquema pre-PA-102)
  HKA         // Generado por The Factory HKA
  CONTINGENCY // Emitido en contingencia (proveedor no disponible)
}
```

### Company (2 campos nuevos)

```prisma
digitalInvoiceProvider    DigitalInvoiceProviderType @default(NONE)
digitalInvoiceApiKeyEnc   String?  // AES-256-GCM con CERT_ENCRYPTION_SECRET
```

### Invoice (3 campos nuevos)

```prisma
controlNumberSource    ControlNumberSource @default(INTERNAL)
qrCodeData             String?             // URL o base64 del QR del proveedor
providerReferenceId    String?             // ID de la imprenta para reconciliación
isContingency          Boolean             @default(false)
```

---

## Estructura de archivos

```
src/lib/digital-invoice/
  provider.types.ts              ← interface DigitalInvoiceProvider + tipos
  providers/
    null.provider.ts             ← no-op (NONE)
    mock.provider.ts             ← dev/testing
    hka/
      hka.provider.ts            ← adapter HKA (stub hasta tener docs API)
      hka.types.ts               ← tipos específicos de la API HKA
  DigitalInvoiceFactory.ts       ← resuelve provider por empresa
  index.ts                       ← re-exports
```

---

## Consecuencias

**Positivas:**
- Cambiar de HKA a Edicom en el futuro = escribir un nuevo adaptador, no tocar lógica de negocio
- Los tests no necesitan un servidor HKA real (MockProvider)
- Empresas en transición siguen funcionando sin cambios (NullProvider)
- La facturación digital es opt-in por empresa — no breaking change

**Negativas / Trade-offs:**
- Una llamada HTTP externa antes de la transacción DB introduce latencia
- Si HKA no tiene idempotency keys en su API, hay riesgo de doble emisión en caso de timeout
- El modo contingencia requiere un proceso de reconciliación posterior

---

## Alternativas consideradas

- **Ser Imprenta Digital directamente**: Requiere fianza de millones de USD + auditoría SENIAT. Descartado.
- **Hardcodear HKA**: Impide cambiar de proveedor sin reescribir lógica. Descartado.
- **Tabla separada para credenciales del proveedor**: Más flexible pero innecesaria para la primera iteración con un solo proveedor por empresa.

---

## Referencias

- Providencia SNAT/2024/000102 (PA-102) — Facturación Digital
- Providencia SNAT/2008/0257 (PA-121) — Homologación de Sistemas
- ADR-019 — PA-121 Compliance (AuditLog IP/UA)
- ADR-001 — Serializable en correlativos (aplica a modo contingencia)
