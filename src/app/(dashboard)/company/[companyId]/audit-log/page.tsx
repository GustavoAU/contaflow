// src/app/(dashboard)/company/[companyId]/audit-log/page.tsx
// Registro de auditoría — solo OWNER y ADMIN

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import prisma from "@/lib/prisma";
import { AuditLogService } from "@/modules/audit/services/AuditLogService";
import { AuditLogTable } from "@/modules/audit/components/AuditLogTable";

type Props = { params: Promise<{ companyId: string }> };

export default async function AuditLogPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY)) redirect(`/company/${companyId}`);

  const [initialData, entityNames] = await Promise.all([
    AuditLogService.list({ companyId, page: 1, pageSize: 25 }),
    AuditLogService.getDistinctEntityNames(companyId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registro de Auditoría</h1>
        <p className="mt-1 text-sm text-gray-500">
          Historial completo de cambios en los datos de la empresa. Solo visible para OWNER y ADMIN.
        </p>
      </div>

      <AuditLogTable
        companyId={companyId}
        entityNames={entityNames}
        initialData={initialData}
      />
    </div>
  );
}
