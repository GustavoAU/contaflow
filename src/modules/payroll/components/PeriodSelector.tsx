// src/modules/payroll/components/PeriodSelector.tsx
// Fase NOM-E: Selector de período reutilizable para reportes legales.
// mode="month" → selector mes/año (IVSS, Banavih)
// mode="quarter" → selector trimestre/año (INCES)
"use client";

type MonthProps = {
  mode: "month";
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
};

type QuarterProps = {
  mode: "quarter";
  year: number;
  quarter: number;
  onChange: (year: number, quarter: number) => void;
};

type Props = MonthProps | QuarterProps;

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const QUARTERS = ["I Trimestre", "II Trimestre", "III Trimestre", "IV Trimestre"];

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export function PeriodSelector(props: Props) {
  return (
    <div className="flex items-center gap-3">
      {/* Año */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">Año</label>
        <select
          value={props.year}
          onChange={(e) => {
            const yr = Number(e.target.value);
            if (props.mode === "month") props.onChange(yr, props.month);
            else props.onChange(yr, props.quarter);
          }}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Mes o Trimestre */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500">
          {props.mode === "month" ? "Mes" : "Trimestre"}
        </label>
        {props.mode === "month" ? (
          <select
            value={props.month}
            onChange={(e) => props.onChange(props.year, Number(e.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={props.quarter}
            onChange={(e) => props.onChange(props.year, Number(e.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            {QUARTERS.map((q, i) => (
              <option key={i + 1} value={i + 1}>
                {q}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
