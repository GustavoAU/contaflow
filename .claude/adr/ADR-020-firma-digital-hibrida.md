# ADR-020 — Firma Digital Híbrida (Demo + Oficial)

## Estado: DECIDIDO

## Contexto

PA 121 exige firma electrónica avanzada en documentos fiscales (facturas, NC, ND),
conforme a la Ley sobre Mensajes de Datos y Firmas Electrónicas (Decreto N° 1.204).

Los certificados oficiales emitidos por proveedores acreditados (PSC World, SUSCERTE
u otros autorizados por el Estado venezolano) tienen costo y requieren burocracia
administrativa — fricción de onboarding inaceptable para el mercado PYME objetivo.

## Decisión

**Modelo híbrido con dos modalidades:**

1. **Certificado Demo (autofirmado):** Generado automáticamente por ContaFlow al
   activarse el módulo. RSA-2048, SHA-256, validez 2 años. CommonName = nombre de la
   empresa, OU = RIF. El firmante legal es la **empresa emisora**, no ContaFlow.
   Costo: $0. Sin burocracia.

2. **Certificado Oficial (.p12):** Cargado por el ADMIN en formato PKCS#12.
   Emitido por proveedor acreditado. Mismo flujo de firma — solo cambia el certificado.

La lógica de firma es **idéntica** en ambos casos. La migración de demo → oficial
no requiere cambios en el código de facturación.

### Decisiones técnicas

| Componente | Decisión |
|---|---|
| Crypto | `node-forge` — RSA-2048, SHA-256, PKCS#12 parse/create |
| Cifrado de clave privada | AES-256-GCM. Key = SHA-256(companyId + CERT_ENCRYPTION_SECRET) |
| IV | 12 bytes aleatorios prepended al buffer cifrado |
| Auth tag | 16 bytes GCM prepended after IV |
| Aislamiento | Un certificado por empresa. companyId guard en toda operación |
| Thumbprint | SHA-256 del DER del certificado (64 chars hex) |
| Firma PDF | RSA-SHA256 incrustada como bloque verificable al final del PDF |
| Almacenamiento | `encryptedP12 Bytes` en `CompanyCertificate`. SELECT explícito obligatorio |

## Consecuencias

### Positivas
- Onboarding inmediato: $0, sin burocracia, sin pasos manuales
- Cumplimiento PA 121 desde el primer documento emitido
- Upgrade transparente a certificado oficial cuando el cliente lo necesite
- La firma identifica a la **empresa**, no a ContaFlow (correcto legalmente)

### Riesgos y mitigaciones
- **`CERT_ENCRYPTION_SECRET` es punto único de fallo.** Rotar esta variable requiere
  un script de re-cifrado de todos los `CompanyCertificate` existentes (pendiente).
  Documentar el procedimiento antes de ir a producción.
- **Clave privada en memoria.** Mitigado con `buf.fill(0)` inmediatamente post-uso
  en `DocumentSigningService`. Prohibido loguear o retornar datos del cert.
- **Firma detached, no PAdES.** La firma RSA-SHA256 se incrusta como bloque al final
  del PDF. No es PAdES-compliant (no usa `/ByteRange`). Upgrade a PAdES completo
  requiere librería especializada (p.ej. `@signpdf/signpdf`) — evaluar post-lanzamiento.

## Alternativas descartadas

- **Firma de plataforma (ContaFlow firma por todos):** El firmante legal sería
  ContaFlow, no la empresa emisora — no cumple Ley de Mensajes de Datos (Art. 16).
- **Solo .p12 oficial:** Elimina el mercado PYME. La burocracia de SUSCERTE puede
  tardar semanas.
- **Solo @peculiar/x509:** Dependencia adicional innecesaria. `node-forge` cubre
  tanto la generación de certificados como el parseo PKCS#12.

## Zonas de Peligro (Z-5)

- `encryptedP12` NUNCA en SELECT al cliente — `select` explícito siempre
- `buf.fill(0)` post-descifrado en `DocumentSigningService` — nunca omitir
- `CERT_ENCRYPTION_SECRET` nunca en logs ni respuestas de la API
- Solo `ADMIN` puede gestionar certificados (`ROLES.ADMIN_ONLY`)
