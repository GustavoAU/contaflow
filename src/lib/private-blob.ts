// src/lib/private-blob.ts
// Acceso al store de Vercel Blob PRIVADO (ADR-047). Es el ÚNICO lugar que decide la credencial: cuando se pase a
// OIDC (sin token estático) solo cambia `credentials()`.
import { del, get, put } from "@vercel/blob";

const credentials = () => ({ token: process.env.BLOB_READ_WRITE_TOKEN });

export function isPrivateBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function putPrivateBlob(pathname: string, body: Buffer, contentType: string) {
  return put(pathname, body, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
    ...credentials(),
  });
}

// get() con PATHNAME, no con la URL guardada: la petición queda anclada a NUESTRO store.
export function getPrivateBlob(pathname: string, abortSignal?: AbortSignal) {
  return get(pathname, { access: "private", abortSignal, ...credentials() });
}

export function deletePrivateBlob(url: string) {
  return del(url, credentials());
}
