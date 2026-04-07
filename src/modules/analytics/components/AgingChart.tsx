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
import type { AgingBucketPoint } from "../services/DashboardAnalyticsService";

type Props = {
  data: AgingBucketPoint[];
};

export function AgingChart({ data }: Props) {
  const chartData = data.map((p) => ({
    bucket: p.bucket + " días",
    "CxC (Por Cobrar)": Number(p.cxcAmount),
    "CxP (Por Pagar)": Number(p.cxpAmount),
  }));

  const hasData = data.some((p) => Number(p.cxcAmount) > 0 || Number(p.cxpAmount) > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin facturas pendientes de cobro o pago
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
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
        <Bar dataKey="CxC (Por Cobrar)" fill="#3b82f6" stackId="a" radius={[3, 3, 0, 0]} />
        <Bar dataKey="CxP (Por Pagar)" fill="#f97316" stackId="b" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
