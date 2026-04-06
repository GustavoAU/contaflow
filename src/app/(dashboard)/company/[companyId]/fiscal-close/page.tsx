// src/app/(dashboard)/company/[companyId]/fiscal-close/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { getFiscalYearCloseHistoryAction, getFiscalConfigAction } from "@/modules/fiscal-close/actions/fiscal-close.actions";
import { FiscalYearCloseManager } from "@/modules/fiscal-close/components/FiscalYearCloseManager";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function FiscalClosePage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [historyResult, configResult] = await Promise.all([
    getFiscalYearCloseHistoryAction(companyId),
    getFiscalConfigAction(companyId),
  ]);

  const history = historyResult.success ? historyResult.data : [];
  const isConfigured =
    configResult.success &&
    configResult.data.resultAccountId !== null &&
    configResult.data.retainedEarningsAccountId !== null;

  // Año a cerrar = año en curso (o el último no cerrado)
  const currentYear = new Date().getFullYear();
  const closedYears = new Set(history.map((h) => h.year));
  const yearToClose = closedYears.has(currentYear) ? currentYear - 1 : currentYear;

  // Serializar Decimals para el client component
  const serializedHistory = history.map((r) => ({
    ...r,
    totalRevenue: r.totalRevenue.toString(),
    totalExpenses: r.totalExpenses.toString(),
    netResult: r.netResult.toString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cierre de Ejercicio Económico</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Genera los asientos de cierre de cuentas de resultado y apropiación del ejercicio (VEN-NIF)
        </p>
      </div>

      <FiscalYearCloseManager
        companyId={companyId}
        yearToClose={yearToClose}
        isConfigured={isConfigured}
        history={serializedHistory}
      />

      <Toaster richColors position="top-right" />
    </div>
  );
}
