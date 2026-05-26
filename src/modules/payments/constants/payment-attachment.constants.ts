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
