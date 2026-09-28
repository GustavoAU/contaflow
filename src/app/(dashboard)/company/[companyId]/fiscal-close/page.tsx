// src/app/(dashboard)/company/[companyId]/fiscal-close/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getFiscalYearCloseHistoryAction, getFiscalConfigAction } from "@/modules/fiscal-close/actions/fiscal-close.actions";
import { getFiscalYearsAction } from "@/modules/accounting/actions/fiscal-year.actions";
import { FiscalYearCloseManager } from "@/modules/fiscal-close/components/FiscalYearCloseManager";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function FiscalClosePage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [historyResult, configResult, fiscalYearsResult] = await Promise.all([
    getFiscalYearCloseHistoryAction(companyId),
    getFiscalConfigAction(companyId),
    getFiscalYearsAction(companyId),
  ]);

  const history = historyResult.success ? historyResult.data : [];
  const isConfigured =
    configResult.success &&
    configResult.data.resultAccountId !== null &&
    configResult.data.retainedEarningsAccountId !== null;

  // ADR-055: el ejercicio a cerrar es el OPEN más ANTIGUO (a lo sumo 2 abiertos a la
  // vez, D-9) — no "el año en curso": el ejercicio activo sigue abierto en paralelo
  // mientras se cierra el anterior. Sin ningún OPEN → null (estado vacío en el
  // manager: "abre un ejercicio primero").
  const fiscalYears = fiscalYearsResult.success ? fiscalYearsResult.data : [];
  const openFiscalYears = fiscalYears.filter((fy) => fy.status === "OPEN");
  const yearToClose =
    openFiscalYears.length > 0
      ? Math.min(...openFiscalYears.map((fy) => fy.year))
      : null;

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

    </div>
  );
}
