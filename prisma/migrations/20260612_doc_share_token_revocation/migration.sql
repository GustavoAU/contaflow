-- M6: DocShareToken — jti + revokedAt para revocación de share links
-- Aplicar en Neon SQL Editor (TCP 5432 bloqueado por VPN)

CREATE TABLE "DocShareToken" (
  "id"        TEXT        NOT NULL,
  "companyId" TEXT        NOT NULL,
  "jti"       TEXT        NOT NULL,
  "docType"   TEXT        NOT NULL,
  "docId"     TEXT        NOT NULL,
  "createdBy" TEXT        NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "DocShareToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocShareToken_jti_key" UNIQUE ("jti")
);

CREATE INDEX "DocShareToken_companyId_createdAt_idx" ON "DocShareToken" ("companyId", "createdAt" DESC);
CREATE INDEX "DocShareToken_docId_idx" ON "DocShareToken" ("docId");

ALTER TABLE "DocShareToken"
  ADD CONSTRAINT "DocShareToken_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
