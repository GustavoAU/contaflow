// src/lib/private-blob.ts
// Acceso al store de Vercel Blob PRIVADO (ADR-047). Es el ÚNICO lugar que elige la credencial.
//
// En Vercel (VERCEL=1) el SDK usa OIDC: VERCEL_OIDC_TOKEN se renueva solo y BLOB_STORE_ID dice qué store, así que el proyecto
// no necesita ningún secreto de larga vida. Fuera de Vercel (desarrollo local, scripts) un token OIDC dura 12 h y solo se
// renueva con el CLI de Vercel, por eso allí se usa el token estático de .env.local. Un `token` explícito GANA sobre OIDC.
import { del, get, put } from "@vercel/blob";

const onVercel = () => Boolean(process.env.VERCEL);

const credentials = () => (onVercel() ? {} : { token: process.env.BLOB_READ_WRITE_TOKEN });

export function isPrivateBlobConfigured(): boolean {
  return onVercel() ? Boolean(process.env.BLOB_STORE_ID) : Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

type PutOptions = {
  // Con sufijo aleatorio no hay colisión de ruta al repetir un nombre (exportar el mismo libro dos veces).
  addRandomSuffix?: boolean;
};

export function putPrivateBlob(pathname: string, body: Buffer, contentType: string, options: PutOptions = {}) {
  return put(pathname, body, {
    access: "private",
    contentType,
    addRandomSuffix: options.addRandomSuffix ?? false,
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
