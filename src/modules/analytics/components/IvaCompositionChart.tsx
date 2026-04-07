"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { IvaCompositionItem } from "../services/DashboardAnalyticsService";

const LABEL_MAP: Record<string, string> = {
  IVA_GENERAL: "IVA General 16%",
  IVA_REDUCIDO: "IVA Reducido 8%",
  IVA_ADICIONAL: "IVA Adicional 15%",
  EXENTO: "Exento / Exonerado",
};

const COLORS = ["#3b82f6", "#f59e0b", "#8b5cf6", "#6b7280"];

type Props = {
  data: IvaCompositionItem[];
};

export function IvaCompositionChart({ data }: Props) {
  const chartData = data
    .filter((d) => Number(d.totalAmount) > 0)
    .map((d) => ({
      name: LABEL_MAP[d.taxType] ?? d.taxType,
      value: Number(d.totalAmount),
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin líneas de IVA registradas
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) =>
            typeof value === "number"
              ? value.toLocaleString("es-VE", { minimumFractionDigits: 2 }) + " Bs."
              : String(value)
          }
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
