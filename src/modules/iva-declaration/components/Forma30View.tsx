"use client";

// src/modules/iva-declaration/components/Forma30View.tsx

import { useState, useTransition } from "react";
import { Decimal } from "decimal.js";
import { generarForma30Action, type Forma30ActionResult } from "../actions/generarForma30.action";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function fmt(d: Decimal): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(d.toNumber());
}

function Row({ label, base, tax }: { label: string; base: Decimal; tax?: Decimal }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 text-sm text-zinc-600">{label}</td>
      <td className="py-2 pr-4 text-right font-mono text-sm">{fmt(base)}</td>
      {tax !== undefined && (
        <td className="py-2 text-right font-mono text-sm font-medium">{fmt(tax)}</td>
      )}
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b bg-zinc-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
      </div>
      <div className="p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b text-xs text-zinc-400">
              <th className="pb-1 text-left font-normal">Concepto</th>
              <th className="pb-1 text-right font-normal">Base Imponible</th>
              <th className="pb-1 text-right font-normal">Impuesto</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function SectionSimple({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b bg-zinc-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
      </div>
      <div className="p-4">
        <table className="w-full">
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function SimpleRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 text-sm text-zinc-600">{label}</td>
      <td className="py-2 text-right font-mono text-sm font-medium">{value}</td>
    </tr>
  );
}

interface Props {
  companyId: string;
}

export function Forma30View({ companyId }: Props) {
  const currentDate = new Date();
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [result, setResult] = useState<Forma30ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCalcular() {
    setError(null);
    startTransition(async () => {
      const res = await generarForma30Action(companyId, year, month);
      if (res.success) {
        setResult(res.data);
      } else {
        setError(res.error);
        setResult(null);
      }
    });
  }

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentDate.getFullYear() - i);

  return (
    <div className="space-y-6">
      {/* Selector de período */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-white p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500">Año</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500">Mes</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            {MESES.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleCalcular}
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {isPending ? "Calculando…" : "Calcular Forma 30"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="space-y-4">
          {/* Encabezado */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Declaración IVA — {MESES[result.month - 1]} {result.year}
              </h2>
              <div className="mt-1 flex gap-3 text-xs text-zinc-400">
                {!result.periodExists && (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700">
                    Período no registrado
                  </span>
                )}
                {result.fiscalYearClosed && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                    Ejercicio {result.year} cerrado
                  </span>
                )}
                {result.isSpecialContributor && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">
                    Contribuyente especial
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Sección A — Débitos */}
          <Section title="A — Débitos Fiscales (Ventas)">
            <Row label="A1. Ventas alícuota general (16%)" base={result.seccionA.general.base} tax={result.seccionA.general.tax} />
            <Row label="A2. Ventas alícuota reducida (8%)" base={result.seccionA.reducida.base} tax={result.seccionA.reducida.tax} />
            <Row label="A3. Ventas alícuota adicional lujo (15%)" base={result.seccionA.adicionalLujo.base} tax={result.seccionA.adicionalLujo.tax} />
            <Row label="A4. Ventas exentas y exoneradas" base={result.seccionA.exentasExoneradas.base} />
            <Row label="A5. Exportaciones" base={result.seccionA.exportaciones.base} />
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="py-2 pr-4 text-sm">Total Débitos Fiscales</td>
              <td />
              <td className="py-2 text-right font-mono text-sm">{fmt(result.seccionA.totalDebitosFiscales)}</td>
            </tr>
          </Section>

          {/* Sección B — Créditos */}
          <Section title="B — Créditos Fiscales (Compras)">
            <Row label="B1. Compras alícuota general (16%)" base={result.seccionB.general.base} tax={result.seccionB.general.tax} />
            <Row label="B2. Compras alícuota reducida (8%)" base={result.seccionB.reducida.base} tax={result.seccionB.reducida.tax} />
            <Row label="B3. Compras alícuota adicional lujo (15%)" base={result.seccionB.adicionalLujo.base} tax={result.seccionB.adicionalLujo.tax} />
            <Row label="B4. Compras exentas y exoneradas" base={result.seccionB.exentasExoneradas.base} />
            <Row label="B5. Importaciones" base={result.seccionB.importaciones.base} tax={result.seccionB.importaciones.tax} />
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="py-2 pr-4 text-sm">Total Créditos Fiscales</td>
              <td />
              <td className="py-2 text-right font-mono text-sm">{fmt(result.seccionB.totalCreditosFiscales)}</td>
            </tr>
          </Section>

          {/* Sección C — Retenciones */}
          <SectionSimple title="C — Retenciones IVA">
            <SimpleRow label="C1. Retenciones IVA sufridas (clientes nos retuvieron)" value={fmt(result.seccionC.retencionesIvaSufridas)} />
            <SimpleRow label="C2. Retenciones IVA practicadas (retuvimos a proveedores)" value={fmt(result.seccionC.retencionesIvaPracticadas)} />
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="py-2 pr-4 text-sm">Total Retenciones</td>
              <td className="py-2 text-right font-mono text-sm">{fmt(result.seccionC.totalRetenciones)}</td>
            </tr>
          </SectionSimple>

          {/* Sección D — IGTF */}
          <SectionSimple title="D — IGTF">
            <SimpleRow label="Base IGTF" value={fmt(result.seccionD.igtfBase)} />
            <SimpleRow label="Total IGTF pagado" value={fmt(result.seccionD.igtfTotal)} />
          </SectionSimple>

          {/* Sección E — Cuota */}
          <div className={`rounded-lg border-2 p-4 ${result.seccionE.esSaldoAFavor ? "border-blue-300 bg-blue-50" : "border-zinc-300 bg-zinc-50"}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-700">
                  E — {result.seccionE.esSaldoAFavor ? "Saldo a Favor (Crédito Fiscal)" : "Cuota a Pagar"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Débitos − Créditos − Retenciones
                </p>
              </div>
              <p className={`font-mono text-xl font-bold ${result.seccionE.esSaldoAFavor ? "text-blue-700" : "text-zinc-900"}`}>
                {result.seccionE.esSaldoAFavor ? "−" : ""}{fmt(result.seccionE.cuotaPeriodo.abs())}
              </p>
            </div>
          </div>

          <p className="text-right text-xs text-zinc-300">
            Calculado: {result.calculatedAt.toLocaleString("es-VE")}
          </p>
        </div>
      )}
    </div>
  );
}
