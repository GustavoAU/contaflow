-- ADR-029: Adjuntos de comprobante de pago
-- Tabla PaymentAttachment — metadatos + contentHash en BD, contenido en Vercel Blob (R-2)
-- Análisis de riesgo: tabla nueva, 0 filas afectadas, rollback = DROP TABLE seguro

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
