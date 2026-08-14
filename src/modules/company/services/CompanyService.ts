// src/modules/company/services/CompanyService.ts
//
// Contrato: ADR-043 (límite de empresas) + ADR-042 D-13 (escritura de `country`).
//
// Auditoría de seguridad MP-4: MEDIUM-1 y MEDIUM-3 eran el MISMO bug — invariantes
// que solo existían en el borde. El país lo validaba el action, el límite de plan lo
// contaba el action, y el servicio confiaba. El próximo caller (seed, importador,
// onboarding) rompía los dos a la vez. Aquí ambos invariantes viven en el servicio.

import type { Prisma, ScopeProfile } from "@prisma/client";
import prisma from "@/lib/prisma";
import { normalizeRifOrNull } from "@/lib/tax-config";
import { isSupportedCountry, type CountryCode } from "@/lib/countries";
import { seedExpenseCategories } from "@/modules/expenses/services/ExpenseService";

/**
 * Empresas propias (OWNER, no archivadas) que permite el plan base.
 *
 * ⚠️ AL SUBIR ESTE VALOR: quitar `withDbRetry` del call site de
 * `createCompanyAction` o dar `idempotencyKey` a la creación (ADR-043 D-3).
 * `withDbRetry` reintenta a ciegas una mutación no idempotente; hoy es seguro
 * SOLO porque con límite 1 el reintento choca contra este mismo guard.
 */
export const COMPANY_LIMIT_PER_USER = 1;

/**
 * Campos de `Company` que se vuelcan al `AuditLog`.
 *
 * Es una LISTA BLANCA, no un `omit`, y la diferencia importa: un campo sensible
 * nuevo queda fuera por defecto en vez de filtrarse hasta que alguien se acuerde.
 * Antes se hacía `findUniqueOrThrow` sin `select` y la fila entera —incluido
 * `digitalInvoiceApiKeyEnc` ("AES-256-GCM, nunca exponer al cliente")— acababa en
 * `oldValue`/`newValue`, que `AuditLogTable` renderiza con `JSON.stringify` y el
 * exportador mete en un PDF firmado. Misma clase que Z-5 (`encryptedP12`).
 */
export const AUDITABLE_COMPANY_FIELDS = {
  id: true,
  name: true,
  rif: true,
  country: true,
  address: true,
  status: true,
  plan: true,
  scopeProfile: true,
  isSpecialContributor: true,
  telefono: true,
  email: true,
  ciiu: true,
  actividad: true,
  paymentTermDays: true,
  resultAccountId: true,
  retainedEarningsAccountId: true,
  inflationBaseYear: true,
  inflationBaseMonth: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

export type CreateCompanyInput = {
  name: string;
  userId: string;
  /** OBLIGATORIO y tipado: un `string` no typechequea contra `CountryCode` (ADR-042 D-13) */
  country: CountryCode;
  /** OBLIGATORIO: ya lo exige `CreateCompanySchema` (recordatorios de renovación) */
  telefono: string;
  rif?: string | null;
  address?: string | null;
  scopeProfile?: ScopeProfile | null;
  /** R-6 */
  ipAddress: string | null;
  /** R-6 */
  userAgent: string | null;
};

/** Error de negocio del límite de plan — el action lo mapea a su mensaje. */
export class PlanLimitError extends Error {
  readonly isPlanLimit = true;
  constructor() {
    super("PLAN_LIMIT");
    this.name = "PlanLimitError";
  }
}

export class CompanyService {
  /**
   * Crea una empresa y vincula al usuario como OWNER.
   *
   * PRECONDICIÓN: `tx` DEBE venir de `withSerializableRetry` (ADR-043 D-1). El
   * guard de límite es un predicado sobre filas que aún no existen (write skew) y
   * NO se sostiene en Read Committed: sin predicate locking, dos transacciones
   * concurrentes cuentan 0 y ambas insertan.
   */
  static async createCompany(tx: Prisma.TransactionClient, input: CreateCompanyInput) {
    // ADR-042 D-13: la escritura es la ÚLTIMA frontera que puede negarse. En
    // lectura `getFiscalConfig` lanza, pero el guard de actions cae a VEN por
    // necesidad — así que un valor basura persistido ya no lo detecta nadie.
    if (!isSupportedCountry(input.country)) {
      throw new Error(`País no soportado: "${input.country}"`);
    }

    // ADR-043 D-1: el guard vive DENTRO de la transacción. Contarlo en el action
    // era la misma vulnerabilidad de MEDIUM-1 con otro nombre.
    const ownedCount = await tx.companyMember.count({
      where: {
        userId: input.userId,
        role: "OWNER",
        company: { status: { not: "ARCHIVED" } },
      },
    });
    if (ownedCount >= COMPANY_LIMIT_PER_USER) throw new PlanLimitError();

    // MEDIUM-2: canonicalizar ANTES de buscar y de guardar. El @unique de Postgres
    // compara strings crudos, así que sin esto "J-12345678-9" y "j-123456789"
    // entrarían como dos empresas distintas con la misma identidad fiscal.
    const normalizedRif = normalizeRifOrNull(input.rif ?? undefined);

    if (normalizedRif) {
      const existing = await tx.company.findUnique({
        where: { rif: normalizedRif },
        select: { id: true },
      });
      // LOW-4: sin interpolar el RIF. `Company.rif` es único GLOBAL, así que el
      // mensaje anterior confirmaba que un RIF arbitrario ya es cliente de
      // ContaFlow — un oráculo cross-tenant.
      if (existing) throw new Error("Ese RIF ya está registrado.");
    }

    const created = await tx.company.create({
      data: {
        name: input.name,
        rif: normalizedRif,
        address: input.address ?? null,
        telefono: input.telefono,
        status: "ACTIVE",
        scopeProfile: input.scopeProfile ?? null,
        country: input.country,
        members: { create: { userId: input.userId, role: "OWNER" } },
      },
      select: AUDITABLE_COMPANY_FIELDS,
    });

    // Fase 37B: seed de categorías de gastos para la empresa nueva
    await seedExpenseCategories(created.id, tx);

    await tx.auditLog.create({
      data: {
        companyId: created.id,
        entityId: created.id,
        entityName: "Company",
        action: "CREATE",
        userId: input.userId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        newValue: created as object,
      },
    });

    return created;
  }

  /**
   * Actualiza los datos fiscales SENIAT de la empresa (PA-121).
   */
  static async updateSeniatData(
    companyId: string,
    userId: string,
    data: {
      name: string;
      rif: string | null;
      address: string | null;
      telefono: string | null;
      email: string | null;
      ciiu: string | null;
      actividad: string | null;
      isSpecialContributor: boolean;
    },
    net: { ipAddress: string | null; userAgent: string | null },
  ) {
    // MEDIUM-2: canonicalizar antes de comparar y de persistir (ver createCompany).
    data = { ...data, rif: normalizeRifOrNull(data.rif) };

    if (data.rif) {
      const existing = await prisma.company.findUnique({
        where: { rif: data.rif },
        select: { id: true },
      });
      // LOW-4: mismo oráculo que en createCompany — el RIF es único global.
      if (existing && existing.id !== companyId) {
        throw new Error("Ese RIF ya está registrado.");
      }
    }

    const old = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: AUDITABLE_COMPANY_FIELDS,
    });

    return prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data,
        select: AUDITABLE_COMPANY_FIELDS,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: companyId,
          entityName: "Company",
          action: "UPDATE",
          userId,
          ipAddress: net.ipAddress,
          userAgent: net.userAgent,
          oldValue: old as object,
          newValue: updated as object,
        },
      });

      return updated;
    });
  }

  /**
   * Archiva una empresa — no la elimina físicamente.
   * Regla: no se puede archivar si tiene un período abierto.
   */
  static async archiveCompany(
    companyId: string,
    userId: string,
    net: { ipAddress: string | null; userAgent: string | null },
  ) {
    // Verificar que no haya período abierto
    const activePeriod = await prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
    });

    if (activePeriod) {
      throw new Error(
        "No se puede archivar una empresa con un período contable abierto. Cierra el período primero."
      );
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: AUDITABLE_COMPANY_FIELDS,
    });
    if (!company) throw new Error("Empresa no encontrada.");
    if (company.status === "ARCHIVED") throw new Error("La empresa ya está archivada.");

    const archived = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: { status: "ARCHIVED" },
        select: AUDITABLE_COMPANY_FIELDS,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: companyId,
          entityName: "Company",
          action: "ARCHIVE",
          userId,
          ipAddress: net.ipAddress,
          userAgent: net.userAgent,
          oldValue: company as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return archived;
  }

  /**
   * Reactiva una empresa archivada.
   */
  static async reactivateCompany(
    companyId: string,
    userId: string,
    net: { ipAddress: string | null; userAgent: string | null },
  ) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: AUDITABLE_COMPANY_FIELDS,
    });
    if (!company) throw new Error("Empresa no encontrada.");
    if (company.status === "ACTIVE") throw new Error("La empresa ya está activa.");

    const reactivated = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: { status: "ACTIVE" },
        select: AUDITABLE_COMPANY_FIELDS,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: companyId,
          entityName: "Company",
          action: "REACTIVATE",
          userId,
          ipAddress: net.ipAddress,
          userAgent: net.userAgent,
          oldValue: company as object,
          newValue: updated as object,
        },
      });

      return updated;
    });

    return reactivated;
  }
}
