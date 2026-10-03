"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { BankReconciliationRatio } from "../services/DashboardAnalyticsService";

type Props = {
  data: BankReconciliationRatio;
};

export function BankReconciliationChart({ data }: Props) {
  if (data.total === 0) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        Sin transacciones bancarias importadas
      </div>
    );
  }

  const chartData = [
    { name: "Conciliadas", value: data.reconciled },
    { name: "Pendientes", value: data.unreconciled },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
          >
            <Cell fill="#22c55e" />
            <Cell fill="#e5e7eb" />
          </Pie>
          <Tooltip formatter={(value) => `${value} transacciones`} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      <p className="text-2xl font-bold tabular-nums">
        {data.ratioPercent}
        <span className="text-muted-foreground text-base font-normal">%</span>
      </p>
      <p className="text-muted-foreground text-xs">
        {data.reconciled} de {data.total} transacciones conciliadas
      </p>
    </div>
  );
}
