-- Fase 28A: Expansión de roles — agregar OWNER y ADMINISTRATIVE al enum UserRole
-- Aplicar con: npx prisma migrate deploy (DATABASE_URL_DIRECT)

-- PostgreSQL no permite ALTER TYPE ... ADD VALUE dentro de una transacción
-- en versiones < 12. Neon usa PG 16+, así que esto es seguro en una tx.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMINISTRATIVE';

-- Nota: Los ADMIN existentes mantienen su rol.
-- Los nuevos propietarios recibirán OWNER al crear empresa (CompanyService.createCompany).
-- No se migra data histórica porque no existe campo createdBy en Company
-- que permita identificar unívocamente al creador original.
