// src/app/(dashboard)/company/[companyId]/payroll/legal-thresholds/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { LegalThresholdService } from "@/modules/payroll/services/LegalThresholdService";
import LegalThresholdsPanel from "@/modules/payroll/components/LegalThresholdsPanel";

type Props = { params: Promise<{ companyId: string }> };

export default async function LegalThresholdsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ALL)) redirect("/");

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);
  const thresholds = await LegalThresholdService.list(companyId);
  const lastSalMin = thresholds.find((t) => t.type === "SALARY_MIN_VES");
  const salMinStale = !lastSalMin ||
    (Date.now() - new Date(lastSalMin.effectiveFrom).getTime()) > 180 * 24 * 60 * 60 * 1000;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Topes Legales</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Histórico de salario mínimo y Unidad Tributaria vigentes por decreto
          </p>
        </div>
        <Link
          href={`/company/${companyId}/payroll`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Nómina
        </Link>
      </div>
      <LegalThresholdsPanel
        companyId={companyId}
        initialThresholds={thresholds}
        isAdmin={isAdmin}
        salMinStale={salMinStale}
      />
    </div>
  );
}
