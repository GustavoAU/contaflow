"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { BcvRatePoint } from "../services/DashboardAnalyticsService";

type Props = {
  data: BcvRatePoint[];
  currency?: string;
};

export function BcvRateChart({ data, currency = "USD" }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sin tasas BCV registradas
      </div>
    );
  }

  const chartData = data.map((p) => ({
    fecha: p.date.slice(5), // "MM-DD"
    tasa: Number(p.rate),
    fechaCompleta: p.date,
  }));

  const lastRate = chartData.at(-1)?.tasa ?? 0;
  const firstRate = chartData.at(0)?.tasa ?? 0;
  const delta = lastRate - firstRate;
  const deltaSign = delta >= 0 ? "+" : "";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">
          {lastRate.toLocaleString("es-VE", { minimumFractionDigits: 2 })} Bs.
        </span>
        <span className="text-sm text-muted-foreground">
          1 {currency} —{" "}
          <span className={delta >= 0 ? "text-destructive" : "text-green-600"}>
            {deltaSign}
            {delta.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
          </span>{" "}
          vs inicio período
        </span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
          <XAxis
            dataKey="fecha"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip
            labelFormatter={(_label, payload) => {
              const full = (payload?.[0]?.payload as { fechaCompleta?: string })?.fechaCompleta;
              return full ?? String(_label ?? "");
            }}
            formatter={(value) =>
              typeof value === "number"
                ? value.toLocaleString("es-VE", { minimumFractionDigits: 2 }) + " Bs."
                : String(value)
            }
          />
          <Line
            type="monotone"
            dataKey="tasa"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            name={`${currency}/VES`}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
