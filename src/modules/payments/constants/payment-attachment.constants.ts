// src/modules/payments/constants/payment-attachment.constants.ts
// Constantes de adjuntos — sin dependencias de servidor (seguro en Client Components)
// ADR-029

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// 4 MB: el archivo pasa por una Vercel Function (ADR-047), cuyo cuerpo admite como máximo 4,5 MB.
export const MAX_SIZE_BYTES = 4_194_304;
export const MAX_SIZE_MB = MAX_SIZE_BYTES / 1_048_576; // 4

const EXT_BY_MIME: Record<AllowedMimeType, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const LEAF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/;

// La ruta la fija el servidor (nunca el cliente) con este builder; isValidAttachmentPathname la verifica al leer.
export function buildAttachmentPathname(
  companyId: string,
  paymentRecordId: string,
  mimeType: AllowedMimeType,
  uuid: string,
): string {
  return `${companyId}/payments/${paymentRecordId}/${uuid}${EXT_BY_MIME[mimeType]}`;
}

// Fuera: controles, "/" y barra invertida (47, 92), invisibles o bidi (zero-width, RLO, BOM, soft hyphen,
// etiquetas Unicode) y surrogates sueltos (un surrogate huérfano rompe la serialización JSON del AuditLog).
function isUnsafeFileNameChar(code: number): boolean {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    code === 47 ||
    code === 92 ||
    code === 0x00ad ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

export function sanitizeAttachmentFileName(name: unknown): string {
  if (typeof name !== "string") return "comprobante";
  const kept = Array.from(name).filter((ch) => !isUnsafeFileNameChar(ch.codePointAt(0) ?? 0));
  return kept.slice(0, 200).join("").trim() || "comprobante";
}

// Con mimeType, la extensión de la ruta debe ser la de ese tipo: el mimeType que se guarda en BD sale de la extensión.
export function isValidAttachmentPathname(
  pathname: string,
  companyId: string,
  paymentRecordId: string,
  mimeType?: AllowedMimeType,
): boolean {
  const prefix = `${companyId}/payments/${paymentRecordId}/`;
  if (!pathname.startsWith(prefix)) return false;
  const leaf = pathname.slice(prefix.length);
  if (!LEAF_RE.test(leaf)) return false;
  return mimeType === undefined || leaf.endsWith(EXT_BY_MIME[mimeType]);
}

// Ruta autenticada por la que el navegador abre un comprobante: el blob es privado y su URL no sirve al cliente.
export function attachmentDownloadPath(companyId: string, attachmentId: string): string {
  return `/api/company/${companyId}/payments/attachments/${attachmentId}/download`;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
}

// El tipo declarado por el navegador (`file.type`) no prueba nada: se decide por los primeros bytes del archivo.
export function detectAttachmentMime(bytes: Uint8Array): AllowedMimeType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp"; // RIFF????WEBP
  }
  return null;
}
