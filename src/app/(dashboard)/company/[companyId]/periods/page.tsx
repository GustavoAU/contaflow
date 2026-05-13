// src/app/(dashboard)/company/[companyId]/periods/page.tsx
import { getPeriodsAction, getActivePeriodAction } from "@/modules/accounting/actions/period.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PeriodManager } from "@/components/accounting/PeriodManager";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function PeriodsPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [periodsResult, activePeriodResult] = await Promise.all([
    getPeriodsAction(companyId),
    getActivePeriodAction(companyId),
  ]);

  const periods = periodsResult.success ? periodsResult.data : [];
  const activePeriod = activePeriodResult.success ? activePeriodResult.data : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Períodos Contables</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Gestiona los períodos contables mensuales — abre, cierra y consulta el historial.
        </p>
      </div>

      <PeriodManager
        companyId={companyId}
        userId={user.id}
        periods={periods}
        activePeriod={activePeriod}
      />
    </div>
  );
}
