-- M9: FiscalReport — metadata de PDFs fiscales en Vercel Blob (R-2 compliance)
-- Solo metadatos + contentHash en BD; el PDF vive en Object Storage

CREATE TABLE IF NOT EXISTS "FiscalReport" (
  "id"          TEXT        NOT NULL,
  "companyId"   TEXT        NOT NULL,
  "reportType"  TEXT        NOT NULL,
  "year"        INTEGER     NOT NULL,
  "month"       INTEGER     NOT NULL,
  "blobUrl"     TEXT        NOT NULL,
  "contentHash" TEXT        NOT NULL,
  "generatedBy" TEXT        NOT NULL,
  "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "FiscalReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiscalReport_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "FiscalReport_companyId_year_month_reportType_idx"
  ON "FiscalReport" ("companyId", "year", "month", "reportType");
