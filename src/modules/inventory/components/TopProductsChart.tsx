"use client";
// src/modules/inventory/components/TopProductsChart.tsx
// Gráfica de barras horizontal — top 10 productos por ingresos Bs. o unidades vendidas.
// Usa Recharts (ya instalado en el proyecto — analytics module).

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { RotationReportItem } from "../services/InventoryReportService";

type Metric = "revenueVes" | "unitsSold";

type Props = {
  data: RotationReportItem[];
  metric: Metric;
};

// Degradado de verde — el #1 es más oscuro, los siguientes más claros
const COLORS = ["#065f46", "#047857", "#059669", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#d1fae5", "#ecfdf5", "#f0fdf4"];

function truncate(s: string, max = 22) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function TopProductsChart({ data, metric }: Props) {
  const filtered = data
    .filter((d) => parseFloat(d[metric]) > 0)
    .sort((a, b) => parseFloat(b[metric]) - parseFloat(a[metric]))
    .slice(0, 10);

  if (filtered.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-zinc-400">
        Sin ventas registradas en el período
      </div>
    );
  }

  const chartData = filtered.map((d) => ({
    name: truncate(d.name),
    fullName: d.name,
    value: parseFloat(d[metric]),
  }));

  const isBs = metric === "revenueVes";
  const barHeight = 36;
  const totalHeight = Math.max(180, filtered.length * barHeight + 24);

  return (
    <ResponsiveContainer width="100%" height={totalHeight}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 48, left: 4, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-zinc-100 dark:stroke-zinc-800" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#71717a" }}
          tickFormatter={(v: number) =>
            isBs
              ? "Bs. " + v.toLocaleString("es-VE", { maximumFractionDigits: 0 })
              : v.toLocaleString("es-VE", { maximumFractionDigits: 1 })
          }
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fontSize: 12, fill: "#3f3f46" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          formatter={(v) => {
            const n = typeof v === "number" ? v : Number(v ?? 0);
            return [
              isBs
                ? "Bs. " + n.toLocaleString("es-VE", { minimumFractionDigits: 2 })
                : n.toLocaleString("es-VE", { minimumFractionDigits: 2 }) + " uds.",
              isBs ? "Ingresos" : "Unidades",
            ] as [string, string];
          }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i] ?? COLORS[COLORS.length - 1]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
