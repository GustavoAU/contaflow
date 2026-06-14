"use client";

// src/modules/iva-declaration/components/Forma30View.tsx

import { useState, useTransition } from "react";
import { generarForma30Action, getRetencionesSufridas, type Forma30ActionResult, type RetenciónSufridaRow } from "../actions/generarForma30.action";
import { exportForma30PDFAction } from "../actions/exportForma30PDF.action";
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon } from "lucide-react";
import { fmtDate } from "@/lib/format";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function fmt(s: string): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(s));
}

function isZero(s: string): boolean {
  return parseFloat(s) === 0;
}

function NumCell({ value, colSpan, bold }: { value: string; colSpan?: number; bold?: boolean }) {
  const zero = isZero(value);
  return (
    <td
      colSpan={colSpan}
      className={`py-2 text-right text-sm tabular-nums [font-variant-numeric:tabular-nums] ${bold ? "font-semibold" : "font-medium"} font-mono ${zero ? "text-zinc-300" : ""}`}
    >
      {fmt(value)}
    </td>
  );
}

function Row({ label, base, tax }: { label: string; base: string; tax?: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className={`py-2 pr-4 text-sm ${isZero(base) && (tax === undefined || isZero(tax)) ? "text-zinc-400" : "text-zinc-600"}`}>
        {label}
      </td>
      <td className={`py-2 pr-4 text-right font-mono text-sm tabular-nums [font-variant-numeric:tabular-nums] ${isZero(base) ? "text-zinc-300" : ""}`}>
        {fmt(base)}
      </td>
      {tax !== undefined && (
        <NumCell value={tax} bold />
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
              <th className="pb-1 text-right font-normal">Base Imponible (Bs.)</th>
              <th className="pb-1 text-right font-normal">Impuesto (Bs.)</th>
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
  const zero = isZero(value);
  return (
    <tr className="border-b last:border-0">
      <td className={`py-2 pr-4 text-sm ${zero ? "text-zinc-400" : "text-zinc-600"}`}>{label}</td>
      <td className={`py-2 text-right font-mono text-sm font-medium tabular-nums [font-variant-numeric:tabular-nums] ${zero ? "text-zinc-300" : ""}`}>
        {fmt(value)}
      </td>
    </tr>
  );
}

interface Props {
  companyId: string;
  activePeriodMonth?: number;
  activePeriodYear?: number;
}

export function Forma30View({ companyId, activePeriodMonth, activePeriodYear }: Props) {
  const currentDate = new Date();
  const [year, setYear] = useState(activePeriodYear ?? currentDate.getFullYear());
  const [month, setMonth] = useState(activePeriodMonth ?? currentDate.getMonth() + 1);
  const [creditoAnterior, setCreditoAnterior] = useState("0");
  const [result, setResult] = useState<Forma30ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isExporting, startExportTransition] = useTransition();
  const [isLoadingC1, startC1Transition] = useTransition();
  const [showC1Detail, setShowC1Detail] = useState(false);
  const [c1Detail, setC1Detail] = useState<RetenciónSufridaRow[] | null>(null);
  const [c1DetailError, setC1DetailError] = useState<string | null>(null);

  function handleCalcular() {
    setError(null);
    const credito = parseFloat(creditoAnterior) || 0;
    startTransition(async () => {
      const res = await generarForma30Action(companyId, year, month, credito);
      if (res.success) {
        setResult(res.data);
      } else {
        setError(res.error);
        setResult(null);
      }
    });
  }

  function handleToggleC1Detail() {
    if (!result) return;
    const next = !showC1Detail;
    setShowC1Detail(next);
    if (next && c1Detail === null) {
      setC1DetailError(null);
      startC1Transition(async () => {
        const res = await getRetencionesSufridas(companyId, result.year, result.month);
        if (res.success) setC1Detail(res.data);
        else setC1DetailError(res.error);
      });
    }
  }

  function handleExportarPDF() {
    if (!result) return;
    startExportTransition(async () => {
      const credito = parseFloat(creditoAnterior) || 0;
      const res = await exportForma30PDFAction(companyId, result.year, result.month, credito);
      if (res.success) {
        const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `forma30-${result.year}-${String(result.month).padStart(2, "0")}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setError(res.error);
      }
    });
  }

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentDate.getFullYear() - i);

  // Prorrateo: hay ventas exentas/exoneradas Y también créditos fiscales de compras gravadas
  const showProrrateoAlert = result
    && parseFloat(result.seccionA.exentasExoneradas.base) > 0
    && parseFloat(result.seccionB.totalCreditosFiscales) > 0;

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
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500">
            Crédito fiscal período anterior (Bs.)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={creditoAnterior}
            onChange={(e) => setCreditoAnterior(e.target.value)}
            placeholder="0.00"
            className="w-40 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
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
            <button
              onClick={handleExportarPDF}
              disabled={isExporting}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {isExporting ? "Generando PDF…" : "Exportar PDF"}
            </button>
          </div>

          {/* Alerta de prorrateo */}
          {showProrrateoAlert && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">Prorrateo de créditos fiscales:</span>{" "}
              Este período tiene ventas exentas/exoneradas y compras con IVA. Según el Art. 34 de la Ley del IVA,
              los créditos fiscales deben prorratearse en función del porcentaje de ventas gravadas sobre el total.
              Verifica el cálculo antes de presentar la declaración.
            </div>
          )}

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
              <NumCell value={result.seccionA.totalDebitosFiscales} bold />
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
              <NumCell value={result.seccionB.totalCreditosFiscales} bold />
            </tr>
          </Section>

          {/* Sección C — Retenciones */}
          <SectionSimple title="C — Retenciones IVA">
            {/* C1 con drill-down */}
            <tr className="border-b last:border-0">
              <td className={`py-2 pr-4 text-sm ${isZero(result.seccionC.retencionesIvaSufridas) ? "text-zinc-400" : "text-zinc-600"}`}>
                C1. Retenciones IVA sufridas (clientes nos retuvieron)
                {!isZero(result.seccionC.retencionesIvaSufridas) && (
                  <button
                    type="button"
                    onClick={handleToggleC1Detail}
                    disabled={isLoadingC1}
                    className="ml-2 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                    aria-expanded={showC1Detail}
                  >
                    {showC1Detail
                      ? <ChevronDownIcon className="h-3 w-3" />
                      : <ChevronRightIcon className="h-3 w-3" />}
                    {isLoadingC1 ? "Cargando…" : showC1Detail ? "Ocultar" : "Ver comprobantes"}
                  </button>
                )}
              </td>
              <td className={`py-2 text-right font-mono text-sm font-medium tabular-nums [font-variant-numeric:tabular-nums] ${isZero(result.seccionC.retencionesIvaSufridas) ? "text-zinc-300" : ""}`}>
                {fmt(result.seccionC.retencionesIvaSufridas)}
              </td>
            </tr>
            {/* Detalle drill-down C1 */}
            {showC1Detail && (
              <tr>
                <td colSpan={2} className="pb-3 pt-1">
                  {c1DetailError && (
                    <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{c1DetailError}</p>
                  )}
                  {c1Detail && c1Detail.length === 0 && (
                    <p className="rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
                      No se encontraron comprobantes con retención IVA en este período.
                    </p>
                  )}
                  {c1Detail && c1Detail.length > 0 && (
                    <div className="overflow-x-auto rounded-md border border-blue-100">
                      <table className="w-full text-xs">
                        <thead className="bg-blue-50">
                          <tr className="text-zinc-500">
                            <th className="px-3 py-1.5 text-left font-medium">N° Factura</th>
                            <th className="px-3 py-1.5 text-left font-medium">N° Control</th>
                            <th className="px-3 py-1.5 text-left font-medium">Cliente</th>
                            <th className="px-3 py-1.5 text-left font-medium">RIF</th>
                            <th className="px-3 py-1.5 text-left font-medium">Fecha</th>
                            <th className="px-3 py-1.5 text-right font-medium">IVA Retenido (Bs.)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {c1Detail.map((row) => (
                            <tr key={row.id} className="bg-white hover:bg-blue-50/40">
                              <td className="px-3 py-1.5 font-mono">{row.invoiceNumber}</td>
                              <td className="px-3 py-1.5 font-mono text-zinc-400">{row.controlNumber ?? "—"}</td>
                              <td className="max-w-45 truncate px-3 py-1.5">{row.counterpartName}</td>
                              <td className="px-3 py-1.5 font-mono text-zinc-500">{row.counterpartRif}</td>
                              <td className="px-3 py-1.5 text-zinc-500">{fmtDate(new Date(row.date))}</td>
                              <td className="px-3 py-1.5 text-right font-mono font-semibold text-blue-700 tabular-nums">
                                {fmt(row.ivaRetentionAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-blue-100 bg-blue-50">
                          <tr>
                            <td colSpan={5} className="px-3 py-1.5 text-zinc-400">
                              <FileTextIcon className="mr-1 inline h-3 w-3" />
                              {c1Detail.length} comprobante{c1Detail.length !== 1 ? "s" : ""}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-bold text-blue-800 tabular-nums">
                              {fmt(result.seccionC.retencionesIvaSufridas)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </td>
              </tr>
            )}
            <SimpleRow label="C2. Retenciones IVA practicadas (retuvimos a proveedores)" value={result.seccionC.retencionesIvaPracticadas} />
            <tr className="border-t bg-zinc-50 font-semibold">
              <td className="py-2 pr-4 text-sm">Total Retenciones</td>
              <NumCell value={result.seccionC.totalRetenciones} bold />
            </tr>
          </SectionSimple>

          {/* Sección D — IGTF */}
          <SectionSimple title="D — IGTF">
            <SimpleRow label="Base IGTF" value={result.seccionD.igtfBase} />
            <SimpleRow label="Total IGTF pagado" value={result.seccionD.igtfTotal} />
          </SectionSimple>

          {/* Sección E — Cuota */}
          <div className={`rounded-lg border-2 p-4 ${result.seccionE.esSaldoAFavor ? "border-blue-300 bg-blue-50" : "border-zinc-300 bg-zinc-50"}`}>
            <div className="space-y-3">
              {!isZero(result.seccionE.creditoFiscalPeriodoAnterior) && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">E1. Crédito fiscal período anterior</span>
                  <span className="font-mono font-medium text-blue-700 tabular-nums [font-variant-numeric:tabular-nums]">
                    − Bs. {fmt(result.seccionE.creditoFiscalPeriodoAnterior)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-700">
                    E — {result.seccionE.esSaldoAFavor ? "Saldo a Favor (Crédito Fiscal)" : "Cuota a Pagar"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Débitos − Créditos − Retenciones{!isZero(result.seccionE.creditoFiscalPeriodoAnterior) ? " − Crédito Anterior" : ""}
                  </p>
                </div>
                <p className={`font-mono text-xl font-bold tabular-nums [font-variant-numeric:tabular-nums] ${result.seccionE.esSaldoAFavor ? "text-blue-700" : "text-zinc-900"}`}>
                  {result.seccionE.esSaldoAFavor ? "−" : ""}Bs. {fmt(result.seccionE.cuotaPeriodo)}
                </p>
              </div>
              {result.seccionE.esSaldoAFavor && !isZero(result.seccionE.excedenteCreditoFiscal) && (
                <div className="flex items-center justify-between border-t border-blue-200 pt-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-800">
                      E2. Excedente de Crédito Fiscal a Trasladar
                    </p>
                    <p className="mt-0.5 text-xs text-blue-500">
                      Ingresa este valor como &quot;Crédito fiscal período anterior&quot; en el mes siguiente
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-lg font-bold text-blue-800 tabular-nums [font-variant-numeric:tabular-nums]">
                      Bs. {fmt(result.seccionE.excedenteCreditoFiscal)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreditoAnterior(result.seccionE.excedenteCreditoFiscal)}
                      className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                    >
                      Usar como crédito anterior
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-right text-xs text-zinc-300">
            Calculado: {new Date(result.calculatedAt).toLocaleString("es-VE")}
          </p>
        </div>
      )}
    </div>
  );
}
