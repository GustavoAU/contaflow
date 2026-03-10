// src/app/(dashboard)/company/[companyId]/settings/page.tsx
import {
  getPeriodsAction,
  getActivePeriodAction,
} from "@/modules/accounting/actions/period.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PeriodManager } from "@/components/accounting/PeriodManager";
import { Toaster } from "@/components/ui/sonner";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function SettingsPage({ params }: Props) {
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
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Administra los períodos contables de tu empresa
        </p>
      </div>

      <PeriodManager
        companyId={companyId}
        userId={user.id}
        periods={periods}
        activePeriod={activePeriod}
      />

      <Toaster richColors position="top-right" />
    </div>
  );
}
