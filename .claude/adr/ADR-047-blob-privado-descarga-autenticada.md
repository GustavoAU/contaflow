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
   - Sesión (Clerk) + límite `limiters.read` + membresía y rol `ROLES.ACCOUNTING` (`requireCompanyAction`).
   - `findFirst({ id, companyId })` (ADR-004): un `reportId` ajeno da **404**, no 403.
   - Cabeceras: `Content-Disposition: attachment`, `Cache-Control: private, no-store`,
     `X-Content-Type-Options: nosniff`, `X-Content-SHA256` (R-2).
   - La autenticación va **dentro de la ruta**, junto al `get()`, no en el middleware (recomendación de Vercel).
3. `FiscalReport.blobUrl` sigue guardando la URL del blob, que ahora **no sirve desde el navegador**; `get()`
   acepta URL o pathname. La acción devuelve al cliente la ruta de descarga, no `blob.url`.
4. `year`/`month`/`type` de `exportInvoiceBookPDFAction` se validan con Zod: entran en la ruta del blob.

## Consecuencias

- Un blob privado no tiene URL compartible: ver el libro exige sesión y rol en cada descarga.
- Con el store conectado al proyecto (`BLOB_STORE_ID`), el SDK autentica con **OIDC** en Vercel; en local usa
  `BLOB_READ_WRITE_TOKEN`. El token largo sigue haciendo falta para firmar tokens de cliente (adjuntos).
- Cada exportación crea un blob y una fila `FiscalReport` nuevos (historial con su hash); no hay limpieza.
  Si `fiscalReport.create` falla tras el `put` queda un blob huérfano, privado (sin fuga).

## Pendiente

- **Adjuntos de pago** (ADR-029): `upload()` con `access: "private"` usa el flujo *presigned*
  (`blob.generate-presigned-url`, verificado con `BLOB_WEBHOOK_PUBLIC_KEY`, ya presente en el entorno).
  Hay que cambiar la ruta de subida, añadir una ruta de descarga y pasar `analyzeReceiptAction` de
  `fetch(blobUrl)` a `get()`. Requiere probar contra el store real.
- Verificar en producción tras el deploy: exportar el mismo libro dos veces (dos filas) y descargarlo.
