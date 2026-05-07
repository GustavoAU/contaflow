-- Migration: 20260507_role_permissions
-- Permisos granulares por rol: grants adicionales sobre el rol base.
-- Permite a ADMIN dar acceso a módulos extra por empresa (p.ej. ADMINISTRATIVE → accounting).

CREATE TABLE "RolePermission" (
    "id"        TEXT        NOT NULL,
    "companyId" TEXT        NOT NULL,
    "role"      "UserRole"  NOT NULL,
    "module"    TEXT        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RolePermission_companyId_role_module_key"
    ON "RolePermission"("companyId", "role", "module");

CREATE INDEX "RolePermission_companyId_idx"
    ON "RolePermission"("companyId");

ALTER TABLE "RolePermission"
    ADD CONSTRAINT "RolePermission_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
