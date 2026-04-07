"use client";

import { useState } from "react";
import { RevenueExpenseChart } from "./RevenueExpenseChart";
import { IvaCompositionChart } from "./IvaCompositionChart";
import { AgingChart } from "./AgingChart";
import { BankReconciliationChart } from "./BankReconciliationChart";
import { BcvRateChart } from "./BcvRateChart";
import type {
  MonthlyRevExpPoint,
  IvaCompositionItem,
  AgingBucketPoint,
  BankReconciliationRatio,
  BcvRatePoint,
} from "../services/DashboardAnalyticsService";

type Props = {
  currentYear: number;
  revenueExpense: MonthlyRevExpPoint[];
  ivaComposition: IvaCompositionItem[];
  aging: AgingBucketPoint[];
  bankRatio: BankReconciliationRatio;
  bcvRates: BcvRatePoint[];
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-5 dark:bg-zinc-950">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </div>
  );
}

export function AnalyticsDashboard({
  currentYear,
  revenueExpense,
  ivaComposition,
  aging,
  bankRatio,
  bcvRates,
}: Props) {
  const [selectedYear] = useState(currentYear);

  return (
    <div className="space-y-6">
      {/* ── Fila superior: Ingresos/Gastos + Tasa BCV ──────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title={`Ingresos vs Gastos — ${selectedYear}`}>
            <RevenueExpenseChart data={revenueExpense} />
          </ChartCard>
        </div>
        <ChartCard title="Evolución Tasa BCV — USD/VES">
          <BcvRateChart data={bcvRates} currency="USD" />
        </ChartCard>
      </div>

      {/* ── Fila media: IVA + Conciliación ─────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        <ChartCard title="Composición IVA">
          <IvaCompositionChart data={ivaComposition} />
        </ChartCard>
        <ChartCard title="Ratio de Conciliación Bancaria">
          <BankReconciliationChart data={bankRatio} />
        </ChartCard>
      </div>

      {/* ── Fila inferior: Envejecimiento CxC/CxP ──────────────────────────── */}
      <ChartCard title="Envejecimiento Cartera CxC / CxP">
        <AgingChart data={aging} />
      </ChartCard>
    </div>
  );
}
