"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { MonthlyRevExpPoint } from "../services/DashboardAnalyticsService";

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type Props = {
  data: MonthlyRevExpPoint[];
};

export function RevenueExpenseChart({ data }: Props) {
  const chartData = data.map((p) => ({
    mes: MONTH_LABELS[p.month - 1],
    Ingresos: Number(p.revenue),
    Gastos: Number(p.expenses),
  }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin datos para el período seleccionado
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
        <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) =>
            v >= 1_000_000
              ? `${(v / 1_000_000).toFixed(1)}M`
              : v >= 1_000
                ? `${(v / 1_000).toFixed(0)}K`
                : String(v)
          }
        />
        <Tooltip
          formatter={(value) =>
            typeof value === "number"
              ? value.toLocaleString("es-VE", { minimumFractionDigits: 2 }) + " Bs."
              : String(value)
          }
        />
        <Legend />
        <Bar dataKey="Ingresos" fill="#22c55e" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Gastos" fill="#ef4444" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
