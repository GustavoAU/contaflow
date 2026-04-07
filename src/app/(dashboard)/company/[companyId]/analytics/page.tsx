// src/app/(dashboard)/company/[companyId]/analytics/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardAnalyticsService } from "@/modules/analytics/services/DashboardAnalyticsService";
import { AnalyticsDashboard } from "@/modules/analytics/components/AnalyticsDashboard";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function AnalyticsPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { companyId } = await params;
  const currentYear = new Date().getFullYear();

  const [revenueExpense, ivaComposition, aging, bankRatio, bcvRates] = await Promise.all([
    DashboardAnalyticsService.getRevenueExpenseTrend(companyId, currentYear),
    DashboardAnalyticsService.getIvaComposition(companyId, currentYear),
    DashboardAnalyticsService.getAgingBuckets(companyId),
    DashboardAnalyticsService.getBankReconciliationRatio(companyId),
    DashboardAnalyticsService.getBcvRateTrend(companyId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analítica</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Indicadores financieros clave — {currentYear}
        </p>
      </div>

      <AnalyticsDashboard
        currentYear={currentYear}
        revenueExpense={revenueExpense}
        ivaComposition={ivaComposition}
        aging={aging}
        bankRatio={bankRatio}
        bcvRates={bcvRates}
      />
    </div>
  );
}
