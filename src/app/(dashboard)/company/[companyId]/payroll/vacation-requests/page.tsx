// src/app/(dashboard)/company/[companyId]/payroll/vacation-requests/page.tsx
// Feature 8/10: vista del manager — todas las solicitudes pendientes + historial.
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { VacationRequestService } from "@/modules/payroll/services/VacationRequestService";
import { VacationRequestList } from "@/modules/payroll/components/VacationRequestList";

type Props = { params: Promise<{ companyId: string }> };

export default async function VacationRequestsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}/payroll`);

  const canApprove = canAccess(member.role, ROLES.ACCOUNTING);

  const pendingRequests = await VacationRequestService.listPending(companyId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Solicitudes de Vacaciones</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestión y aprobación de solicitudes del equipo
          </p>
        </div>
        <Link
          href={`/company/${companyId}/payroll`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Nómina
        </Link>
      </div>

      {pendingRequests.length === 0 ? (
        <div className="rounded-xl border border-green-100 bg-green-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-green-700">Sin solicitudes pendientes</p>
          <p className="mt-1 text-xs text-green-600">
            Todas las solicitudes de vacaciones han sido procesadas.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
            Pendientes de revisión ({pendingRequests.length})
          </h2>
          <VacationRequestList
            companyId={companyId}
            requests={pendingRequests}
            canApprove={canApprove}
          />
        </div>
      )}
    </div>
  );
}
