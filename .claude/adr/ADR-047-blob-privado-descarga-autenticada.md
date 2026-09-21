# ADR-047 — Vercel Blob privado: escritura con `access: "private"` y descarga por ruta autenticada

**Estado:** Aceptado (libro fiscal) · Pendiente (adjuntos de pago)
**Fecha:** 2026-09-20
**Relacionados:** ADR-029 (adjuntos de pago), R-2 (reportes fiscales a Object Storage con `contentHash`), ADR-004 (aislamiento por `companyId`)

## Contexto

El store de producción `contaflow-blob` se creó el 2026-05-26 como **privado**. El código escribía con
`access: "public"`. En Vercel Blob el modo lo fija el **store**, no la llamada, y un store privado rechaza
el acceso público. Comprobado el 2026-09-20 contra el store real (con autorización de Gustavo):

| Prueba | Resultado |
|---|---|
| `list` | 0 blobs: nunca se había subido nada |
| `put(..., { access: "public" })` | **Falla:** *Cannot use public access on a private store. The store is configured with private access.* |
| `put(..., { access: "private" })` | Funciona; URL `*.private.blob.vercel-storage.com`, no pública |
| `get(pathname, { access: "private" })` | 200 con el contenido |

Consecuencia: el PDF del Libro de Ventas/Compras y los comprobantes de pago **no habían podido funcionar
nunca** (`FiscalReport` y `PaymentAttachment` vacías en producción). Era una tercera causa, independiente de
las dos ya corregidas (el middleware bloqueaba el callback; `handleUpload` ignoraba el pathname del servidor).

## Decisión

1. **Escribir** con `access: "private"` y `addRandomSuffix: true` (evita el error por ruta repetida al re-exportar).
2. **Entregar** solo a través de una ruta propia que autentica y hace stream con `get()`:
   `GET /api/company/[companyId]/fiscal-reports/[reportId]/download`.
   - Sesión (Clerk) + límite `limiters.read` con clave `user:{userId}` (el `companyId` de la URL aún no está
     autorizado: rotarlo no debe eludir el límite) + membresía y rol `ROLES.ACCOUNTING` (`requireCompanyAction`).
   - `findFirst({ id, companyId })` (ADR-004): un `reportId` ajeno da **404**, no 403.
   - Cabeceras: `Content-Disposition: attachment`, `Cache-Control: private, no-store`,
     `X-Content-Type-Options: nosniff`, `X-Content-SHA256` (R-2).
   - La autenticación va **dentro de la ruta**, junto al `get()`, no en el middleware (recomendación de Vercel).
3. `FiscalReport.blobUrl` sigue guardando la URL del blob, que ahora **no sirve desde el navegador**. La ruta
   deriva el **pathname** de esa URL, exige el prefijo `fiscal/{companyId}/` (si no, 404 + Sentry) y llama a
   `get(pathname)`: así la petición queda anclada a nuestro store y no a cualquier host `*.blob.vercel-storage.com`.
   La acción devuelve al cliente la ruta de descarga, no `blob.url`. `abortSignal` y `maxDuration = 30` acotan el stream.
4. `year`/`month`/`type` de `exportInvoiceBookPDFAction` se validan con Zod: entran en la ruta del blob.

## Consecuencias

- Un blob privado no tiene URL compartible: ver el libro exige sesión y rol en cada descarga.
- **Credencial hoy: el token largo `BLOB_READ_WRITE_TOKEN`, pasado explícitamente** (`token:` en `put`/`get`).
  El SDK resuelve así: token explícito, luego OIDC (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`), luego el token del
  entorno; mientras se pase `token:`, OIDC NO se usa. Es lo que se probó contra el store real. Objetivo: quitar
  el `token:` explícito y, al migrar los adjuntos al flujo *presigned*, eliminar `BLOB_READ_WRITE_TOKEN`
  (`handleUpload` lo exige; `handleUploadPresigned` funciona con OIDC). Probar en Preview antes.
- Cada exportación crea un blob y una fila `FiscalReport` nuevos (historial con su hash); no hay limpieza.
  Si `fiscalReport.create` falla tras el `put` queda un blob huérfano, privado (sin fuga).

## Addendum 2026-09-20 — comprobantes de pago (ADR-029)

Se descartó migrar al flujo *presigned* (subida directa navegador→CDN + callback público de Vercel): exigía una ruta
pública en el middleware, verificar firmas de webhook y dependía de semánticas del SDK que ya nos habían fallado tres
veces (ruta pública bloqueada por Clerk, pathname del servidor ignorado por `handleUpload`, store privado). En su lugar:

- **Subida por el servidor**: `POST /api/payments/attachments/upload` (multipart, con sesión de Clerk; ya NO es ruta
  pública). El servidor valida membresía/rol (`requireCompanyAction`, ADR-041), pago de la empresa y no anulado, **el tipo
  por los bytes** (`detectAttachmentMime`; `file.type` no prueba nada), calcula el **SHA-256** (R-2, antes lo enviaba el
  navegador), fija la ruta (`{companyId}/payments/{pagoId}/{uuid}.{ext}`) y registra en BD en la misma petición. Si el
  registro falla, borra el blob (sin fila no queda huérfano). Un fallo del store no deja nada en la BD.
- **Descarga**: `GET /api/company/[companyId]/payments/attachments/[attachmentId]/download` (mismo patrón que el libro:
  Clerk + límite por usuario + membresía + `findFirst({id, companyId, deletedAt: null})` + `get()` por pathname con
  verificación de prefijo; tipo servido desde la lista permitida, `nosniff`, `private, no-store`).
  `AttachmentSummary` ya no expone `blobUrl` al navegador. `analyzeReceiptAction` lee con `get()` en vez de `fetch(blobUrl)`.
- **Coste asumido: tope de 4 MB** (antes 5): una Vercel Function admite 4,5 MB de cuerpo. La alternativa que conserva
  5 MB es la subida directa con callback público, descartada por robustez.
- `src/lib/private-blob.ts` es el único sitio que elige credencial: el paso a OIDC se hace ahí.

## Addendum 2026-09-21 — OIDC en Vercel (rama `chore/blob-oidc`)

`src/lib/private-blob.ts` elige la credencial por entorno: en Vercel (`VERCEL=1`) NO pasa `token`, así que el SDK usa OIDC
(`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`); fuera de Vercel usa el token estático de `.env.local` (un token OIDC local dura 12 h y
solo se renueva con el CLI de Vercel). El libro fiscal (exportar y descargar) y los comprobantes ya pasan por ese helper: es el único
sitio que toca el SDK. Un `token` explícito GANA sobre OIDC y en Vercel OIDC no tiene reintento con el token del entorno: si el store
no autoriza OIDC para el proyecto da 403 (por eso se prueba en Preview antes de quitar nada). Con OIDC funcionando, se borra
`BLOB_READ_WRITE_TOKEN` de las variables de Vercel (Production y Preview) y desaparece el aviso "Needs Attention".

## Pendiente

- **Probar OIDC en Preview** (rama `chore/blob-oidc`): exportar y descargar el libro PDF y subir/abrir un comprobante, y leer
  los logs de Vercel. Si da 403, en el store → pestaña Projects → menú del proyecto → *Upgrade to OIDC* (ojo: puede revocar el
  token estático que se usa en local; entonces el desarrollo local pasaría a `vercel env pull` + sesión del CLI) y repetir.
- Con OIDC verificado: borrar `BLOB_READ_WRITE_TOKEN` de Vercel (Production y Preview), redesplegar y comprobar en producción.
- Probar los comprobantes de pago en producción (Pagos → adjuntar un PDF y una imagen).
