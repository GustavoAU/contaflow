# ADR-029: Adjuntos de Comprobante de Pago

**Estado:** Aceptado
**Fecha:** 2026-05-26
**Autor:** arch-agent
**Feature:** #13 del veredicto módulo Pagos — "Adjuntar Comprobante de Pago"
**Modelos afectados:** `PaymentRecord`, nuevo `PaymentAttachment`

---

## Contexto

`PaymentRecord` registra pagos vía medios digitales (PagoMóvil, Zelle, Cashea, Transferencia). En Venezuela, el comprobante bancario o captura de pantalla del pago es el único medio de prueba aceptado por el SENIAT ante una auditoría (PA-121, Art. 11). Actualmente ContaFlow no permite adjuntar ese comprobante al registro de pago, obligando al contador a gestionar el archivo por fuera del sistema.

Este ADR resuelve el almacenamiento, esquema, flujo de upload y controles de seguridad para la feature de adjuntos, cumpliendo R-2 (contenido a Object Storage, no a BD), R-6 (trazabilidad en AuditLog), ADR-003 (onDelete Restrict), ADR-004 (companyId guards) y ADR-006 (seguridad).

---

## Decisiones

### D-1: Backend de Storage — Vercel Blob

**Decisión:** Vercel Blob (`@vercel/blob`) con flujo client-side upload via `handleUpload` + `upload`.

**Justificación:**

- El proyecto ya está en Vercel SaaS tier. Vercel Blob es el único proveedor de storage que no requiere cuenta adicional, credenciales S3 separadas ni configuración de CORS en un servicio externo.
- Cloudflare R2 es más barato a escala pero introduce una cuenta y set de credenciales completamente ajenos al stack actual; diferir a post-lanzamiento si el volumen lo justifica.
- Supabase Storage introduce un proveedor fuera del stack (Neon + Vercel) sin ninguna ventaja técnica sobre Vercel Blob para este caso.
- Vercel Blob v2 soporta `handleUpload` (API route que emite un token de upload) + `upload` client-side. El archivo nunca transita por el servidor de Next.js, eliminando el riesgo de saturar el runtime con streams de archivos de hasta 5 MB.
- **Degradación graceful:** si `BLOB_READ_WRITE_TOKEN` no está configurado en `.env`, el sistema devuelve `{ enabled: false }` en el endpoint de check y la UI deshabilita el botón de adjuntar sin romper el formulario de pago. Esta degradación es idéntica al patrón de Upstash (`UPSTASH_REDIS_REST_URL` ausente → no-op).

**Descartado — Server Action con FormData stream:** Next.js App Router parsea el body del Server Action completo antes de ejecutar la función. Para archivos de 5 MB esto bloquea el runtime durante el parse y aumenta el tiempo de respuesta. El flujo client-side presigned elimina este problema.

### D-2: Schema de BD — Tabla separada `PaymentAttachment`

**Decisión:** Nueva tabla `PaymentAttachment` con FK a `PaymentRecord`. No campos inline en `PaymentRecord`.

**Justificación:**

- R-2 de CLAUDE.md exige "solo metadatos + contentHash (SHA-256) en BD". La tabla separada es la implementación natural de esta regla: cada adjunto es una entidad con su propio ciclo de vida.
- Campos inline (`attachmentUrl`, `attachmentHash` en `PaymentRecord`) solo soportan exactamente 1 adjunto. Un comprobante de PagoMóvil puede venir acompañado de una constancia bancaria adicional. La extensión a N adjuntos con campos inline requeriría una migración destructiva.
- La tabla separada es extensible a otros modelos (`InvoiceAttachment`, `ExpenseAttachment`) mediante el mismo patrón sin cambios en las tablas existentes.
- Un solo adjunto por `PaymentRecord` es suficiente para el lanzamiento. La tabla `PaymentAttachment` acepta múltiples filas por `paymentRecordId` desde el primer día; el límite de 1 adjunto activo se impone a nivel de aplicación y puede relajarse sin migración.

**SCHEMA_AUDITOR checklist:**

```
[x] Relación a tabla contable (PaymentRecord) tiene onDelete: Restrict — CONFORME
[x] onDelete: Cascade AUSENTE en tabla contable — CONFORME
[x] Sin campos monetarios — no aplica ADR-002
[x] Sin campos porcentaje — no aplica
[x] deletedAt DateTime? presente — soft delete — CONFORME
[x] idempotencyKey: no aplica (el blobKey es el identificador natural único, ver campo)
[x] Unicidad de negocio: @@unique([companyId, blobKey]) — incluye companyId — CONFORME (ADR-004)
[x] Índices en FKs frecuentes: @@index([companyId]), @@index([paymentRecordId]) — CONFORME
[x] AuditLog requerido: sí — upload y delete de adjunto son acciones financieras auditables (R-6)
[x] Riesgo de migración documentado — ver sección Migración
[x] Acción destructiva verifica companyMember.role (ADR-006 D-1) — ver D-5
[x] Sin campos de monto en Zod input — no aplica ADR-006 D-2
[x] Sin campo de tasa del cliente — no aplica ADR-006 D-3
[x] AuditLog append-only — no update/delete en AuditLog — CONFORME (ADR-006 D-4)
[x] Acción de upload es mutación financiera → rate limiting obligatorio (ADR-006 D-5)
```

**Schema Prisma — modelo `PaymentAttachment` listo para pegar:**

```prisma
// ADR-029: Adjunto de comprobante de pago
// Contenido en Vercel Blob — solo metadatos + contentHash en BD (R-2)
model PaymentAttachment {
  id              String        @id @default(cuid())
  companyId       String
  company         Company       @relation(fields: [companyId], references: [id], onDelete: Restrict)
  paymentRecordId String
  paymentRecord   PaymentRecord @relation(fields: [paymentRecordId], references: [id], onDelete: Restrict)
  // Metadatos del archivo
  fileName        String        // nombre original del archivo (ej. "comprobante-zelle.pdf")
  mimeType        String        // MIME validado: application/pdf | image/jpeg | image/png | image/webp
  sizeBytes       Int           // tamaño en bytes (máx. 5 242 880 — 5 MB)
  // Vercel Blob
  blobUrl         String        // URL pública de Vercel Blob (https://*.vercel-storage.com/...)
  blobKey         String        // pathname del blob (companyId/payments/paymentId/uuid.ext)
  // Integridad (R-2)
  contentHash     String        // SHA-256 hex del contenido del archivo (calculado client-side antes del upload)
  // Auditoría
  uploadedBy      String        // userId Clerk
  uploadedAt      DateTime      @default(now())
  // Soft delete — conservar en Blob para auditoría (D-6)
  deletedAt       DateTime?
  deletedBy       String?       // userId Clerk

  @@unique([companyId, blobKey])
  @@index([companyId])
  @@index([paymentRecordId])
}
```

**Cambio en `model PaymentRecord` (agregar relación inversa):**

```prisma
  // ADR-029: Adjuntos de comprobante de pago
  attachments     PaymentAttachment[]
```

**Cambio en `model Company` (agregar relación inversa):**

```prisma
  // ADR-029: Adjuntos de comprobante de pago
  paymentAttachments PaymentAttachment[]
```

### D-3: Flujo de Upload — Client-side con `handleUpload` (Presigned token)

**Decisión:** API route `/api/payments/attachments/upload` con `handleUpload` de `@vercel/blob`. El componente cliente usa `upload()` de `@vercel/blob/client` para subir directamente a Vercel Blob sin pasar el archivo por el servidor Next.js.

**Flujo exacto:**

```
1. Usuario selecciona archivo en el componente UploadAttachmentButton
2. Cliente calcula SHA-256 del archivo (SubtleCrypto.digest, client-side)
3. Cliente llama a la API route (handleUpload):
   POST /api/payments/attachments/upload
   Body: { filename, contentType, paymentRecordId, companyId }
4. La API route verifica:
   a. auth() — usuario autenticado (Clerk)
   b. companyMember.role !== VIEWER (ADR-006 D-1)
   c. paymentRecord.companyId === companyId — guard multi-tenant (ADR-004)
   d. paymentRecord.deletedAt IS NULL — no adjuntar a pagos anulados
   e. BLOB_READ_WRITE_TOKEN presente — si no, error 503 con mensaje claro
   f. contentType ∈ ALLOWED_MIME_TYPES
   g. sizeBytes <= MAX_SIZE_BYTES (5 242 880)
   h. limiters.fiscal rate limit (ADR-006 D-5)
5. handleUpload emite un token de upload firmado y un pathname prefijado:
   pathname = `{companyId}/payments/{paymentRecordId}/{uuid}.{ext}`
6. Cliente usa upload(url, file, { access: 'public', handleUploadUrl }) para subir
   directamente a Vercel Blob CDN
7. handleUpload.onUploadCompleted callback (llamado por Vercel Blob tras el upload):
   a. Recibe { blob: { url, pathname, size }, tokenPayload }
   b. Crea PaymentAttachment en BD dentro de $transaction (Read Committed):
      - companyId, paymentRecordId, fileName, mimeType, sizeBytes, blobUrl, blobKey, contentHash, uploadedBy
   c. AuditLog en el mismo $transaction:
      { entityName: "PaymentAttachment", action: "UPLOAD", entityId: attachment.id,
        newValue: { blobKey, fileName, contentHash },
        ipAddress, userAgent }
   d. Retorna el PaymentAttachment creado
```

**Justificación de presigned vs Server Action:**

El SDK `@vercel/blob` v0.21+ ofrece `handleUpload` en API routes y `upload` client-side como el patrón canónico para archivos en App Router. Los Server Actions con FormData parsean el body completo en memoria antes de ejecutar, lo que a 5 MB bajo concurrencia puede saturar el runtime serverless. El patrón presigned es el recomendado por Vercel para archivos > 4.5 MB (límite de payload de Edge Functions).

**No se necesita `bodySizeLimit` en `next.config.js`:** el archivo no transita por Next.js — va directamente del browser a Vercel Blob CDN. La API route de `handleUpload` solo recibe metadata JSON (< 1 KB).

### D-4: Seguridad del Upload

**Tipos MIME permitidos (lista exhaustiva — no extensible sin nuevo ADR):**

```typescript
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
```

**Tamaño máximo:** 5 242 880 bytes (5 MB exactos). Validado tanto en `handleUpload` (server) como en el componente UI antes de iniciar el upload (UX inmediata, no espera la API).

**Pathname multi-tenant (ADR-004):**
```
{companyId}/payments/{paymentRecordId}/{uuidv4}.{ext}
```
El prefijo `companyId` garantiza que cada empresa tiene un namespace aislado en Vercel Blob. No hay URL de adivinanza posible: el UUID es aleatorio por cada upload.

**Acceso a `blobUrl`:** La URL es pública en Vercel Blob (no hay auth nativa por URL). La seguridad se impone a nivel de la UI y la API: el componente que muestra el enlace solo se renderiza si el usuario pertenece a la empresa propietaria del `PaymentAttachment`. Nunca se expone `blobUrl` en una API pública sin verificar `companyId`.

**Verificación de integridad (contentHash):** El SHA-256 se calcula en el cliente con `SubtleCrypto.digest("SHA-256", fileBuffer)` antes del upload y se envía como `tokenPayload` en `handleUpload`. El callback `onUploadCompleted` persiste ese hash en `PaymentAttachment.contentHash`. Esto permite auditar que el archivo no fue alterado post-upload.

**Doble validación MIME:** El `handleUpload` valida `contentType` del request header. Adicionalmente, la API route verifica el magic bytes del archivo si el contenido pasa por el servidor (en `onUploadCompleted`, Vercel Blob provee el pathname y tamaño pero no el contenido — la validación de magic bytes se delega al tipo MIME del request, lo que es suficiente para este caso dado que Vercel Blob también valida el Content-Type en el upload directo).

### D-5: Autorización y Guards (ADR-006 D-1)

**Upload (acción de creación):**
- `companyMember.role !== VIEWER` — obligatorio
- Roles permitidos: OWNER, ADMIN, ACCOUNTANT, ADMINISTRATIVE

**Delete de adjunto (soft delete):**
- `companyMember.role ∈ [OWNER, ADMIN, ACCOUNTANT]` — ADMINISTRATIVE y VIEWER no pueden eliminar adjuntos
- Justificación: eliminar un comprobante de auditoría es una acción con consecuencias fiscales

**Límite de 1 adjunto activo por `PaymentRecord`:** verificado en `handleUpload` antes de emitir el token. Si ya existe un `PaymentAttachment` con `deletedAt IS NULL` para ese `paymentRecordId`, la API retorna 409 con mensaje "Este pago ya tiene un comprobante adjunto. Elimine el actual antes de subir uno nuevo."

### D-6: Comportamiento al Anular un PaymentRecord

**Decisión:** Conservar el adjunto en Vercel Blob y en BD cuando un `PaymentRecord` se anula (`deletedAt` set).

**Justificación:** Los comprobantes son evidencia de auditoría (PA-121). Un comprobante del pago anulado puede ser requerido por el SENIAT para probar que el pago ocurrió y luego fue revertido. Eliminar el archivo eliminaría evidencia.

**Consecuencia:** El `PaymentAttachment` permanece en BD con `deletedAt IS NULL` aunque el `PaymentRecord` padre tenga `deletedAt` no nulo. La UI debe mostrar los adjuntos marcando visualmente que el pago fue anulado. El acceso al `blobUrl` permanece activo indefinidamente en Vercel Blob (no hay TTL en blobs públicos).

**Sin cascada en BD:** `onDelete: Restrict` en `PaymentAttachment.paymentRecordId` previene borrado físico del `PaymentRecord` si tiene adjuntos activos. El soft delete del `PaymentRecord` (setter de `deletedAt`) no afecta los adjuntos.

---

## Contrato entre módulos — `PaymentAttachmentService`

**Archivo owner:** `src/modules/payments/services/PaymentAttachmentService.ts`

```typescript
import type { PaymentAttachment } from "@prisma/client";

// ─── Tipos de entrada/salida ─────────────────────────────────────────────────

/**
 * Payload que llega del callback onUploadCompleted de Vercel Blob.
 * El campo contentHash es el SHA-256 calculado client-side y enviado
 * como tokenPayload en el flujo de handleUpload.
 */
export type AttachmentUploadPayload = {
  companyId: string;
  paymentRecordId: string;
  fileName: string;
  mimeType: string;         // ya validado antes de llegar aquí
  sizeBytes: number;        // ya validado antes de llegar aquí
  blobUrl: string;          // URL pública retornada por Vercel Blob
  blobKey: string;          // pathname del blob (companyId/payments/paymentId/uuid.ext)
  contentHash: string;      // SHA-256 hex calculado client-side
  uploadedBy: string;       // userId Clerk
  ipAddress: string | null; // R-6
  userAgent: string | null; // R-6
};

export type AttachmentSummary = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobUrl: string;
  contentHash: string;
  uploadedBy: string;
  uploadedAt: Date;
  deletedAt: Date | null;
};

// ─── Métodos exportados ───────────────────────────────────────────────────────

/**
 * Persiste los metadatos del adjunto tras un upload exitoso a Vercel Blob.
 * Llamado exclusivamente desde onUploadCompleted en la API route.
 *
 * Precondiciones:
 *   - paymentRecord con id = payload.paymentRecordId existe y
 *     pertenece a payload.companyId (verificado en handleUpload antes de emitir token)
 *   - No existe PaymentAttachment activo (deletedAt IS NULL) para ese paymentRecordId
 *     (verificado en handleUpload antes de emitir token — double-check aquí con upsert)
 *
 * Proceso (dentro de $transaction Read Committed):
 *   1. Crear PaymentAttachment con los metadatos del payload
 *   2. AuditLog en el mismo $transaction:
 *      { entityName: "PaymentAttachment", action: "UPLOAD", entityId: attachment.id,
 *        newValue: { blobKey, fileName, contentHash },
 *        ipAddress: payload.ipAddress, userAgent: payload.userAgent }
 *
 * Postcondiciones:
 *   - PaymentAttachment persistido con contentHash para auditoría (R-2)
 *   - AuditLog registrado (R-6)
 *
 * Errores de negocio:
 *   - P2002 en @@unique([companyId, blobKey]): "El comprobante ya fue registrado"
 *     (idempotencia ante doble invocación del webhook de Blob)
 */
async function persistAttachmentMetadata(
  payload: AttachmentUploadPayload
): Promise<PaymentAttachment>;

/**
 * Retorna los adjuntos activos de un pago, verificando ownership multi-tenant.
 *
 * Precondiciones:
 *   - paymentRecordId existe y pertenece a companyId (ADR-004)
 *
 * Postcondiciones:
 *   - Solo adjuntos con deletedAt IS NULL
 *   - Ordenados por uploadedAt ASC
 *   - Read Committed — sin correlativo, sin riesgo TOCTOU
 *
 * Notas:
 *   - NUNCA llamar sin companyId — viola ADR-004
 */
async function getAttachmentsByPaymentRecord(
  paymentRecordId: string,
  companyId: string
): Promise<AttachmentSummary[]>;

/**
 * Soft-deletes un adjunto. El blob permanece en Vercel Blob (D-6 — evidencia de auditoría).
 *
 * Precondiciones:
 *   - attachmentId existe y pertenece a companyId (ADR-004)
 *   - deletedAt IS NULL (no re-deletear)
 *   - companyMember.role ∈ [OWNER, ADMIN, ACCOUNTANT] — verificado en la action, no aquí
 *
 * Proceso (dentro de $transaction Read Committed):
 *   1. Update PaymentAttachment: deletedAt = now(), deletedBy = deletedByUserId
 *   2. AuditLog en el mismo $transaction:
 *      { entityName: "PaymentAttachment", action: "DELETE", entityId: attachmentId,
 *        oldValue: { blobKey, fileName },
 *        newValue: { deletedAt: now().toISOString() },
 *        ipAddress, userAgent }
 *
 * Postcondiciones:
 *   - PaymentAttachment.deletedAt !== null
 *   - Blob sigue existiendo en Vercel Blob (no se llama a del() del SDK)
 *   - AuditLog registrado (R-6)
 *
 * Errores de negocio:
 *   - "Comprobante no encontrado o no pertenece a esta empresa"
 *   - "El comprobante ya fue eliminado"
 */
async function softDeleteAttachment(
  attachmentId: string,
  companyId: string,
  deletedByUserId: string,
  ipAddress: string | null,
  userAgent: string | null
): Promise<void>;
```

---

## Contrato de API Route — `handleUpload`

**Archivo owner:** `src/app/api/payments/attachments/upload/route.ts`

```typescript
// Método: POST
// Auth: Clerk auth() — obligatorio
// Descripción: Emite token de upload a Vercel Blob (D-3)
//
// Body JSON (request del cliente):
// {
//   filename: string,          // nombre original del archivo
//   contentType: string,       // MIME type declarado por el cliente
//   paymentRecordId: string,   // ID del PaymentRecord al que se adjunta
//   companyId: string,         // ID de la empresa (companyId del contexto UI)
//   contentHash: string,       // SHA-256 hex calculado client-side — persistido como tokenPayload
// }
//
// Validaciones que la route ejecuta ANTES de llamar a handleUpload():
//   1. auth() — 401 si no autenticado
//   2. companyMember.role !== VIEWER — 403 si VIEWER
//   3. PaymentRecord.companyId === companyId — 403 si no coincide (ADR-004)
//   4. PaymentRecord.deletedAt IS NULL — 400 "No se puede adjuntar a un pago anulado"
//   5. BLOB_READ_WRITE_TOKEN — 503 "Adjuntos no disponibles en esta configuración"
//   6. contentType ∈ ALLOWED_MIME_TYPES — 400 "Tipo de archivo no permitido"
//   7. limiters.fiscal rate limit — 429 si excede límite (ADR-006 D-5)
//   8. Máximo 1 adjunto activo por paymentRecordId — 409 "Ya existe un comprobante adjunto"
//
// handleUpload config:
//   access: 'public'
//   addRandomSuffix: false  (el pathname ya incluye UUID)
//   allowedContentTypes: ALLOWED_MIME_TYPES
//   maximumSizeInBytes: 5_242_880
//   pathname: `{companyId}/payments/{paymentRecordId}/{uuidv4()}.{ext}`
//   tokenPayload: JSON.stringify({ companyId, paymentRecordId, contentHash, uploadedBy: userId })
//
// onUploadCompleted: llama a PaymentAttachmentService.persistAttachmentMetadata()
//
// Respuesta exitosa (200): { url: string, blobKey: string }
// El cliente no necesita llamar a ninguna acción adicional — el webhook llama a persistAttachmentMetadata
```

---

## Contrato de Server Action — `deleteAttachmentAction`

**Archivo owner:** `src/modules/payments/actions/payment.actions.ts` (agregar al archivo existente)

```typescript
// Signature:
async function deleteAttachmentAction(
  companyId: string,
  attachmentId: string
): Promise<{ success: true } | { success: false; error: string }>

// Precondiciones verificadas en la action:
//   - auth() → userId
//   - companyMember.role ∈ [OWNER, ADMIN, ACCOUNTANT] — ADMINISTRATIVE y VIEWER bloqueados (ADR-006 D-1)
//   - limiters.fiscal rate limit (ADR-006 D-5)
//   - ipAddress + userAgent capturados para AuditLog (R-6)
//
// Delega a: PaymentAttachmentService.softDeleteAttachment()
// Llama a: revalidatePath(`/company/${companyId}/payments`) post-delete
```

---

## Migración

**Nombre:** `20260526_payment_attachments`

**SQL:**

```sql
-- Tabla PaymentAttachment
CREATE TABLE "PaymentAttachment" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "paymentRecordId" TEXT NOT NULL,
  "fileName"        TEXT NOT NULL,
  "mimeType"        TEXT NOT NULL,
  "sizeBytes"       INTEGER NOT NULL,
  "blobUrl"         TEXT NOT NULL,
  "blobKey"         TEXT NOT NULL,
  "contentHash"     TEXT NOT NULL,
  "uploadedBy"      TEXT NOT NULL,
  "uploadedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3),
  "deletedBy"       TEXT,

  CONSTRAINT "PaymentAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttachment_companyId_blobKey_key" UNIQUE ("companyId", "blobKey"),
  CONSTRAINT "PaymentAttachment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentAttachment_paymentRecordId_fkey"
    FOREIGN KEY ("paymentRecordId") REFERENCES "PaymentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PaymentAttachment_companyId_idx" ON "PaymentAttachment"("companyId");
CREATE INDEX "PaymentAttachment_paymentRecordId_idx" ON "PaymentAttachment"("paymentRecordId");
```

**Análisis de riesgo:**

| Factor | Evaluación |
|---|---|
| Filas afectadas | 0 — tabla nueva, sin backfill |
| Rollback | `DROP TABLE "PaymentAttachment"` — seguro si no hay filas |
| Bloqueo de tabla | `CREATE TABLE` no bloquea tablas existentes |
| `PaymentRecord` | No se modifica la tabla, solo se agrega la relación inversa en Prisma (sin SQL) |
| `Company` | No se modifica la tabla, solo se agrega la relación inversa en Prisma (sin SQL) |
| `sizeBytes INTEGER` | Cubre hasta 2 147 483 647 bytes — suficiente para el límite de 5 MB |
| Índices | Dos índices nuevos creados en tabla nueva — sin impacto en tablas existentes |

---

## Variables de Entorno Requeridas

Agregar a `.env.example`:

```env
# ADR-029: Adjuntos de comprobante de pago — Vercel Blob
# Obtener en: Vercel Dashboard → Storage → Blob → Connect to project
# Si no está configurado, los adjuntos quedan deshabilitados (degradación graceful)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

**Nota:** En producción Vercel, `BLOB_READ_WRITE_TOKEN` se inyecta automáticamente al conectar un Blob store al proyecto desde el Dashboard. No requiere configuración manual en el CI.

---

## Configuración `next.config.js`

No se requiere cambio en `bodySizeLimit`. El archivo no transita por Next.js — va directamente del browser a Vercel Blob CDN. La API route de `handleUpload` solo recibe metadata JSON (< 1 KB), dentro de los límites por defecto de Next.js App Router (4.5 MB para Edge, ilimitado para Node.js runtime).

La API route `/api/payments/attachments/upload/route.ts` debe usar Node.js runtime (no Edge), porque `handleUpload` del SDK de Vercel Blob requiere acceso al token de entorno y realiza llamadas al servicio de Blob que no están disponibles en Edge Runtime:

```typescript
export const runtime = "nodejs";
```

---

## Consecuencias

### Positivas

- Cumple R-2: el contenido del comprobante nunca entra a PostgreSQL/Neon — solo metadatos y hash.
- Cumple R-6: AuditLog con IP/UA en cada upload y delete.
- Aislamiento multi-tenant por pathname: `{companyId}/payments/...` — sin posibilidad de colisión entre empresas.
- Degradación graceful: sin `BLOB_READ_WRITE_TOKEN` el sistema no rompe — solo deshabilita el botón.
- Extensible sin migración: el límite de 1 adjunto activo es una regla de aplicación, no una constraint de BD. Puede relajarse a N adjuntos sin schema change.
- El modelo `PaymentAttachment` puede replicarse para `InvoiceAttachment`, `ExpenseAttachment` con el mismo patrón.
- El comprobante sobrevive al void del pago (D-6) — cumple requisito de evidencia de auditoría PA-121.

### Negativas / Consideraciones

- `blobUrl` es una URL pública sin autenticación nativa de Vercel Blob. La seguridad es por oscuridad (pathname con UUID) + control de acceso a nivel de UI. Post-lanzamiento, evaluar Vercel Blob `access: 'private'` con tokens de descarga firmados si se requiere mayor control (ej. datos sensibles).
- El callback `onUploadCompleted` de Vercel Blob puede fallar si el servidor Next.js está caído justo en ese momento. En ese caso el blob existe en Vercel pero no hay `PaymentAttachment` en BD. Mitigación: el `@@unique([companyId, blobKey])` permite reintentar `onUploadCompleted` de forma idempotente si Vercel Blob reintenta el callback.
- SHA-256 calculado client-side: el servidor no re-verifica el hash descargando el blob (implicaría un GET adicional). La integridad es declarativa. Si se requiere verificación server-side del hash, agregar un job de background post-upload (diferido a post-lanzamiento).
- El free tier de Vercel Blob es 1 GB. Para una empresa con 500 pagos/mes y comprobantes de ~200 KB promedio, el consumo es ~100 MB/mes. El tier gratuito cubre ~10 meses. El tier Pro de Vercel Blob es $0.023/GB/mes — costo marginal en SaaS.

---

## ADRs relacionados

- ADR-001: Serializable para correlativos — no aplica (no hay correlativo en adjuntos)
- ADR-002: Decimal para dinero — no aplica (no hay campos monetarios en PaymentAttachment)
- ADR-003: onDelete Restrict en tablas contables — aplicado en FK a PaymentRecord y Company
- ADR-004: companyId obligatorio en findMany/findFirst — aplicado en todos los métodos del servicio
- ADR-006: Security controls — D-1 (role guard), D-4 (AuditLog append-only), D-5 (rate limiting)
