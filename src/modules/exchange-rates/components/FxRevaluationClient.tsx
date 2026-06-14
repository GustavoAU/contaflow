"use client";

// src/modules/exchange-rates/components/FxRevaluationClient.tsx
// ADR-027: Formulario interactivo para calcular y registrar el diferencial cambiario.

import { useState, useTransition } from "react";
import {
  TrendingUpIcon,
  TrendingDownIcon,
  Loader2Icon,
  AlertTriangleIcon,
  CheckCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  calculateFxDifferentialAction,
  postFxDifferentialAction,
  type FxDiffPreview,
} from "../actions/fx-differential.actions";

type RateByCurrency = {
  USD: string | null;
  EUR: string | null;
};

type Props = {
  companyId: string;
  latestRates: RateByCurrency;
  hasGLConfig: boolean;
  openPeriodId: string | null;
};

function fmt(n: string): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(n));
}

function DiffBadge({ diff }: { diff: string }) {
  const val = parseFloat(diff);
  if (val > 0)
    return (
      <span className="inline-flex items-center gap-1 text-green-700 font-medium">
        <TrendingUpIcon className="h-3.5 w-3.5" />+{fmt(diff)}
      </span>
    );
  if (val < 0)
    return (
      <span className="inline-flex items-center gap-1 text-red-600 font-medium">
        <TrendingDownIcon className="h-3.5 w-3.5" />
        {fmt(diff)}
      </span>
    );
  return <span className="text-zinc-400">—</span>;
}

export function FxRevaluationClient({
  companyId,
  latestRates,
  hasGLConfig,
  openPeriodId,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const [revalRate, setRevalRate] = useState(latestRates.USD ?? "");
  const [revaluationDate, setRevaluationDate] = useState(today);
  const [preview, setPreview] = useState<FxDiffPreview | null>(null);
  const [isCalc, startCalc] = useTransition();
  const [isPost, startPost] = useTransition();

  function handleCurrencyChange(v: "USD" | "EUR") {
    setCurrency(v);
    setRevalRate(latestRates[v] ?? "");
    setPreview(null);
  }

  function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    startCalc(async () => {
      const result = await calculateFxDifferentialAction({
        companyId,
        currency,
        revalRate,
        revaluationDate,
      });
      if (result.success) {
        setPreview(result.data);
        if (!result.data.hasData) {
          toast.info("No hay facturas en moneda extranjera pendientes de revaluar.");
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  function handlePost() {
    startPost(async () => {
      const result = await postFxDifferentialAction({
        companyId,
        currency,
        revalRate,
        revaluationDate,
        periodId: openPeriodId ?? undefined,
      });
      if (result.success) {
        toast.success(
          `Asiento de revaluación registrado: ${result.data.transactionNumber}`
        );
        setPreview(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  const canPost =
    hasGLConfig &&
    preview?.hasData &&
    (parseFloat(preview.totalFxGain) > 0 || parseFloat(preview.totalFxLoss) > 0);

  return (
    <div className="space-y-6">
      {!hasGLConfig && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Configure las cuentas de Ganancia y Pérdida Cambiaria en{" "}
            <a href={`/company/${companyId}/settings`} className="underline">
              Configuración → Libro Mayor
            </a>{" "}
            antes de registrar asientos.
          </span>
        </div>
      )}

      {/* ── Parámetros de revaluación ─────────────────────────────────────── */}
      <form onSubmit={handleCalculate} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="currency">Moneda</Label>
            <Select value={currency} onValueChange={handleCurrencyChange}>
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD — Dólar estadounidense</SelectItem>
                <SelectItem value="EUR">EUR — Euro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="revalRate">Tasa de revaluación (VES)</Label>
            <Input
              id="revalRate"
              type="number"
              step="0.0001"
              min="0.0001"
              value={revalRate}
              onChange={(e) => {
                setRevalRate(e.target.value);
                setPreview(null);
              }}
              placeholder="Ej: 45.5000"
            />
            <p className="text-xs text-muted-foreground">
              Tasa de cierre del período (BCV)
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="revaluationDate">Fecha de revaluación</Label>
            <Input
              id="revaluationDate"
              type="date"
              value={revaluationDate}
              max={today}
              onChange={(e) => {
                setRevaluationDate(e.target.value);
                setPreview(null);
              }}
            />
          </div>
        </div>

        <Button type="submit" variant="outline" disabled={isCalc || isPost || !revalRate}>
          {isCalc ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <RefreshCwIcon className="h-4 w-4" />
          )}
          {isCalc ? "Calculando..." : "Calcular diferencial"}
        </Button>
      </form>

      {/* ── Resultado del cálculo ─────────────────────────────────────────── */}
      {preview && (
        <div className="space-y-4">
          {!preview.hasData ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <CheckCircleIcon className="h-4 w-4 shrink-0" />
              No hay facturas en {currency} con saldo pendiente. No se generará asiento.
            </div>
          ) : (
            <>
              {/* Resumen */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Facturas analizadas", value: String(preview.lines.length), mono: false },
                  { label: "Mov. neto CxC", value: fmt(preview.netCxCMovement), mono: true },
                  { label: "Ganancia cambiaria", value: fmt(preview.totalFxGain), mono: true, green: true },
                  { label: "Pérdida cambiaria", value: fmt(preview.totalFxLoss), mono: true, red: true },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border bg-white p-3 space-y-0.5"
                  >
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p
                      className={`text-sm font-semibold ${item.mono ? "font-mono" : ""} ${
                        item.green ? "text-green-700" : item.red ? "text-red-600" : "text-zinc-800"
                      }`}
                    >
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Tabla detalle */}
              <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-zinc-50">
                    <tr className="text-xs text-zinc-500">
                      <th className="px-4 py-3 text-left font-medium">Factura</th>
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
                      <th className="px-4 py-3 text-right font-medium">Saldo ({currency})</th>
                      <th className="px-4 py-3 text-right font-medium">VES orig.</th>
                      <th className="px-4 py-3 text-right font-medium">VES reval.</th>
                      <th className="px-4 py-3 text-right font-medium">Diferencial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.lines.map((l) => (
                      <tr key={l.invoiceId} className="hover:bg-zinc-50/50">
                        <td className="px-4 py-2.5 font-mono text-xs text-zinc-700">
                          {l.invoiceNumber}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-600">
                          {l.invoiceType === "SALE" ? "Venta" : "Compra"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-zinc-700">
                          {parseFloat(l.outstandingForeign).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-zinc-600">
                          {fmt(l.vesAtOriginal)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-zinc-600">
                          {fmt(l.vesAtReval)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <DiffBadge diff={l.differential} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Asiento resultante */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-2">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  Asiento contable generado
                </p>
                <div className="space-y-1 text-sm">
                  {parseFloat(preview.netCxCMovement) !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-zinc-600">
                        {parseFloat(preview.netCxCMovement) > 0 ? "Dr" : "Cr"} Cuentas por Cobrar
                      </span>
                      <span className="font-mono">
                        {fmt(String(Math.abs(parseFloat(preview.netCxCMovement))))}
                      </span>
                    </div>
                  )}
                  {parseFloat(preview.netCxPMovement) !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-zinc-600">
                        {parseFloat(preview.netCxPMovement) > 0 ? "Cr" : "Dr"} Cuentas por Pagar
                      </span>
                      <span className="font-mono">
                        {fmt(String(Math.abs(parseFloat(preview.netCxPMovement))))}
                      </span>
                    </div>
                  )}
                  {parseFloat(preview.totalFxGain) > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Cr Ganancia Cambiaria</span>
                      <span className="font-mono">{fmt(preview.totalFxGain)}</span>
                    </div>
                  )}
                  {parseFloat(preview.totalFxLoss) > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Dr Pérdida Cambiaria</span>
                      <span className="font-mono">{fmt(preview.totalFxLoss)}</span>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={handlePost}
                disabled={isPost || isCalc || !canPost}
                aria-busy={isPost}
                className="w-full sm:w-auto"
              >
                {isPost && <Loader2Icon className="animate-spin" />}
                {isPost ? "Registrando..." : "Registrar asiento de revaluación"}
              </Button>
              {!hasGLConfig && (
                <p className="text-xs text-red-500">
                  Configure las cuentas de diferencial cambiario antes de registrar.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <p className="text-xs text-zinc-400">
        Revaluación según NIC 21 / VEN-NIF BA-5. Solo se consideran facturas en moneda
        extranjera con saldo pendiente (UNPAID / PARTIAL). Verifique la tasa oficial BCV
        antes de registrar el asiento.
      </p>
    </div>
  );
}
