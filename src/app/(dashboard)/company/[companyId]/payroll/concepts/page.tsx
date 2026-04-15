// src/app/(dashboard)/company/[companyId]/payroll/concepts/page.tsx
// Fase NOM-B: Catálogo de conceptos de nómina con seed automático

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollConceptService } from "@/modules/payroll/services/PayrollConceptService";
import ConceptList from "@/modules/payroll/components/ConceptList";

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function ConceptsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  // Solo ACCOUNTING o superior
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No tienes acceso al catálogo de conceptos.
      </div>
    );
  }

  // Seed automático (idempotente)
  await PayrollConceptService.seedDefaults(companyId);
  const concepts = await PayrollConceptService.list(companyId);
  const canWrite = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Conceptos de Nómina</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Catálogo de asignaciones y deducciones configurables
          </p>
        </div>
        <Link
          href={`/company/${companyId}/payroll`}
          className="text-sm text-gray-500 hover:underline"
        >
          ← Nómina
        </Link>
      </div>

      <ConceptList companyId={companyId} initial={concepts} canWrite={canWrite} />
    </div>
  );
}
