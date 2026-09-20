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

export const MAX_SIZE_BYTES = 5_242_880; // 5 MB
export const MAX_SIZE_MB = MAX_SIZE_BYTES / 1_048_576; // 5

const EXT_BY_MIME: Record<AllowedMimeType, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const LEAF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/i;

// handleUpload firma el token con el pathname que envía el cliente e ignora el del servidor:
// el cliente lo arma con este builder y el servidor valida lo recibido con isValidAttachmentPathname.
export function buildAttachmentPathname(
  companyId: string,
  paymentRecordId: string,
  mimeType: AllowedMimeType,
  uuid: string,
): string {
  return `${companyId}/payments/${paymentRecordId}/${uuid}${EXT_BY_MIME[mimeType]}`;
}

export function sanitizeAttachmentFileName(name: string | undefined): string {
  const cleaned = Array.from(name ?? "")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code !== 47 && code !== 92; // sin controles ni separadores de ruta
    })
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned || "comprobante";
}

export function isValidAttachmentPathname(
  pathname: string,
  companyId: string,
  paymentRecordId: string,
): boolean {
  const prefix = `${companyId}/payments/${paymentRecordId}/`;
  return pathname.startsWith(prefix) && LEAF_RE.test(pathname.slice(prefix.length));
}
