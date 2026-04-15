-- Fase NOM-A: Configuración de Nómina
-- PayrollConfig — singleton por empresa (companyId @unique)
-- Sin Serializable: el @unique en companyId es suficiente para UPSERT seguro.
-- Sin deletedAt: la historia se mantiene en AuditLog (oldValue/newValue).

CREATE TYPE "PayrollSizeRange" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
CREATE TYPE "LottRegime" AS ENUM ('POST_2012', 'MIXED');
CREATE TYPE "PayrollPaymentCurrency" AS ENUM ('VES', 'USD', 'MIXED');
CREATE TYPE "PayrollFrequency" AS ENUM ('BIWEEKLY', 'MONTHLY');
CREATE TYPE "CestaTicketType" AS ENUM ('CARD', 'CASH', 'NONE');
CREATE TYPE "FideicomisoType" AS ENUM ('EXTERNAL_BANK', 'INTERNAL');

CREATE TABLE "PayrollConfig" (
  "id"                TEXT         NOT NULL,
  "companyId"         TEXT         NOT NULL,
  "sizeRange"         "PayrollSizeRange"         NOT NULL,
  "lottRegime"        "LottRegime"               NOT NULL,
  "ivssEnabled"       BOOLEAN      NOT NULL DEFAULT true,
  "incesEnabled"      BOOLEAN      NOT NULL DEFAULT true,
  "banavihEnabled"    BOOLEAN      NOT NULL DEFAULT true,
  "cestaTicketType"   "CestaTicketType"          NOT NULL,
  "paymentCurrency"   "PayrollPaymentCurrency"   NOT NULL,
  "frequency"         "PayrollFrequency"         NOT NULL,
  "fideicomiso"       "FideicomisoType"          NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PayrollConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollConfig_companyId_key" ON "PayrollConfig"("companyId");

ALTER TABLE "PayrollConfig"
  ADD CONSTRAINT "PayrollConfig_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
