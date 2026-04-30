-- Fase 35I: Firma Digital Híbrida (ADR-020)
-- CompanyCertificate: almacena el certificado X.509 cifrado por empresa

CREATE TABLE "CompanyCertificate" (
    "id"           TEXT        NOT NULL,
    "companyId"    TEXT        NOT NULL,
    "commonName"   TEXT        NOT NULL,
    "serialNumber" TEXT        NOT NULL,
    "encryptedP12" BYTEA       NOT NULL,
    "thumbprint"   TEXT        NOT NULL,
    "issuedBy"     TEXT        NOT NULL,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "isSelfSigned" BOOLEAN     NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"    TEXT        NOT NULL,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyCertificate_companyId_key" ON "CompanyCertificate"("companyId");
CREATE INDEX "CompanyCertificate_companyId_idx" ON "CompanyCertificate"("companyId");

ALTER TABLE "CompanyCertificate"
    ADD CONSTRAINT "CompanyCertificate_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
