"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { createExportJobAction } from "../actions/export.actions";
import { Button } from "@/components/ui/button";
import { DownloadIcon, LoaderIcon, HistoryIcon } from "lucide-react";

type Props = {
  companyId: string;
};

export function ExportForm({ companyId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [allHistory, setAllHistory] = useState(false);

  // Default: last 12 months
  const today = new Date();
  const defaultDateTo = today.toISOString().split("T")[0];
  const defaultDateFrom = new Date(
    today.getFullYear() - 1,
    today.getMonth(),
    today.getDate()
  )
    .toISOString()
    .split("T")[0];

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJobId(null);

    startTransition(async () => {
      const payload = allHistory
        ? { companyId, allHistory: true }
        : { companyId, allHistory: false, dateFrom, dateTo };

      const result = await createExportJobAction(payload);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJobId(result.data.jobId);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold text-lg">Nueva exportación</h2>

        {/* Toggle: rango de fechas vs todo el historial */}
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allHistory}
            onChange={(e) => setAllHistory(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-primary"
          />
          <HistoryIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Todo el historial</span>
        </label>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {!allHistory && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="dateFrom">
                Desde
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="dateTo">
                Hasta
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {allHistory
            ? "El ZIP incluirá todo el historial: libros IVA, asientos, retenciones, activos, Forma 30, empleados, nóminas, inventario y gastos."
            : "Rango máximo: 366 días. El ZIP incluye libros IVA, asientos contables, retenciones, activos fijos, Forma 30, empleados, nóminas, inventario y gastos."}
        </p>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {jobId && (
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 flex items-center justify-between gap-2">
            <span>Exportación lista.</span>
            <a
              href={`/api/export/download?jobId=${jobId}`}
              className="inline-flex items-center gap-1 font-medium underline hover:no-underline"
              download
            >
              <DownloadIcon className="h-4 w-4" />
              Descargar ZIP
            </a>
          </div>
        )}

        <Button type="submit" disabled={isPending} className="w-full sm:w-auto" aria-busy={isPending}>
          {isPending ? (
            <>
              <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <DownloadIcon className="mr-2 h-4 w-4" />
              {allHistory ? "Exportar todo el historial" : "Generar y descargar"}
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
