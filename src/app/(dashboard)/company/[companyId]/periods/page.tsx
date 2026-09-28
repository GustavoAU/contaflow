// src/app/(dashboard)/company/[companyId]/periods/page.tsx
import { getFiscalYearsAction } from "@/modules/accounting/actions/fiscal-year.actions";
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

  const fiscalYearsResult = await getFiscalYearsAction(companyId);
  const fiscalYears = fiscalYearsResult.success ? fiscalYearsResult.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ejercicios Fiscales</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Gestiona los ejercicios fiscales — abre, cierra y consulta el historial.
        </p>
      </div>

      <PeriodManager companyId={companyId} fiscalYears={fiscalYears} />
    </div>
  );
}
