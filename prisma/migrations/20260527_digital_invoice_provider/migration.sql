-- Fase 39: Facturación Digital PA-102 (ADR-031)
-- Agrega soporte para Imprenta Digital (HKA) en Company e Invoice.

-- Nuevos enums
CREATE TYPE "DigitalInvoiceProviderType" AS ENUM ('NONE', 'HKA');
CREATE TYPE "ControlNumberSource" AS ENUM ('INTERNAL', 'HKA', 'CONTINGENCY');

-- Company: configuración del proveedor de facturación digital
ALTER TABLE "Company"
  ADD COLUMN "digitalInvoiceProvider"  "DigitalInvoiceProviderType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "digitalInvoiceApiKeyEnc" TEXT;

-- Invoice: trazabilidad del origen del número de control y QR
ALTER TABLE "Invoice"
  ADD COLUMN "controlNumberSource"  "ControlNumberSource" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "qrCodeData"           TEXT,
  ADD COLUMN "providerReferenceId"  TEXT,
  ADD COLUMN "isContingency"        BOOLEAN NOT NULL DEFAULT false;
