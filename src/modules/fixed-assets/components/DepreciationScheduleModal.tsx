"use client";

import { useEffect, useState, useTransition } from "react";
import { getDepreciationScheduleAction } from "../actions/fixed-asset.actions";
import { formatAmount } from "@/lib/format";

type Props = {
  assetId: string;
  companyId: string;
  onClose: () => void;
};

type ScheduleData = Awaited<ReturnType<typeof getDepreciationScheduleAction>>;

export function DepreciationScheduleModal({ assetId, companyId, onClose }: Props) {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const r = await getDepreciationScheduleAction(assetId, companyId);
      if (r.success) setData(r);
      else setError(r.error);
    });
  }, [assetId, companyId]);

  // Bloquear scroll del body mientras el modal está abierto
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const MONTHS = [
    "", "Ene","Feb","Mar","Abr","May","Jun",
    "Jul","Ago","Sep","Oct","Nov","Dic",
  ];

  const schedule = data?.success ? data.data : null;
  const postedMap = new Map(
    (schedule?.posted ?? []).map((p) => [`${p.periodYear}-${p.periodMonth}`, p])
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900">
            Tabla de Depreciación
            {schedule?.asset && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                — {(schedule.asset as { name?: string }).name ?? ""}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {isPending && <p className="text-sm text-gray-500 text-center py-8">Cargando...</p>}
          {error && <p className="text-sm text-red-600 text-center py-8">{error}</p>}
          {schedule && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white text-xs font-semibold text-gray-500 uppercase border-b">
                <tr>
                  <th className="py-2 text-left">Período</th>
                  <th className="py-2 text-right">Cuota</th>
                  <th className="py-2 text-right">Acumulado</th>
                  <th className="py-2 text-right">Valor Libros</th>
                  <th className="py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedule.projected.map((row) => {
                  const key = `${row.year}-${row.month}`;
                  const posted = postedMap.get(key);
                  return (
                    <tr key={key} className={posted ? "bg-green-50" : ""}>
                      <td className="py-1.5 text-gray-700">
                        {MONTHS[row.month]} {row.year}
                      </td>
                      <td className="py-1.5 text-right font-mono text-gray-800">
                        {formatAmount(Number(row.amount))}
                      </td>
                      <td className="py-1.5 text-right font-mono text-orange-700">
                        {formatAmount(Number(row.accumulated))}
                      </td>
                      <td className="py-1.5 text-right font-mono font-semibold text-gray-900">
                        {formatAmount(Number(row.bookValue))}
                      </td>
                      <td className="py-1.5 text-center">
                        {posted ? (
                          <span className="text-xs text-green-700 font-medium">Registrado</span>
                        ) : (
                          <span className="text-xs text-gray-400">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-gray-100 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
