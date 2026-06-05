"use client";
// src/modules/payroll/components/EmployeeHistoricalImportDialog.tsx
// Feature 4: importar saldos históricos de vacaciones y prestaciones del sistema anterior.
// Prestaciones históricas usan BenefitBalance.initialBalance (ya existe en DB).
// Vacaciones históricas usan Employee.initialVacationDays (nuevo campo).

import { useState, useTransition } from "react";
import { ArchiveIcon, XIcon } from "lucide-react";
import { setInitialVacationBalanceAction } from "../actions/vacation-request.actions";
import { setInitialBenefitBalanceAction } from "../actions/nom-d.actions";

type Props = {
  companyId: string;
  employeeId: string;
  employeeName: string;
  currentVacationDays?: number;
  currentPrestacionesVES?: string;
};

export function EmployeeHistoricalImportDialog({
  companyId,
  employeeId,
  employeeName,
  currentVacationDays = 0,
  currentPrestacionesVES = "0",
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [vacationDays, setVacationDays] = useState(
    currentVacationDays > 0 ? String(currentVacationDays) : ""
  );
  const [prestacionesVES, setPrestacionesVES] = useState(
    currentPrestacionesVES !== "0" ? currentPrestacionesVES : ""
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const tasks: Promise<{ success: boolean; error?: string }>[] = [];

      if (vacationDays) {
        tasks.push(
          setInitialVacationBalanceAction(companyId, {
            employeeId,
            initialVacationDays: vacationDays,
          })
        );
      }

      if (prestacionesVES) {
        tasks.push(
          setInitialBenefitBalanceAction(companyId, {
            employeeId,
            initialBalance: prestacionesVES,
            initialInterestBalance: "0",
          })
        );
      }

      if (tasks.length === 0) {
        setError("Ingrese al menos un saldo inicial");
        return;
      }

      const results = await Promise.all(tasks);
      const failed = results.find((r) => !r.success);
      if (failed) {
        setError(failed.error ?? "Error al guardar saldos");
      } else {
        setSuccess(true);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
      >
        <ArchiveIcon className="h-4 w-4" />
        Importar saldos anteriores
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-zinc-800">Saldos del sistema anterior</h3>
                <p className="text-xs text-zinc-500 mt-0.5">{employeeName}</p>
              </div>
              <button
                onClick={() => { setOpen(false); setSuccess(false); setError(null); }}
                aria-label="Cerrar"
              >
                <XIcon className="h-4 w-4 text-zinc-400" />
              </button>
            </div>

            <p className="text-xs text-zinc-500 rounded border border-blue-100 bg-blue-50 px-3 py-2">
              Ingrese los saldos acumulados que el empleado traía del sistema anterior.
              Estos se suman a los días causados y prestaciones calculados por ContaFlow.
            </p>

            {success ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                Saldos iniciales registrados correctamente.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">
                    Días de vacaciones pendientes (del sistema anterior)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={vacationDays}
                    onChange={(e) => setVacationDays(e.target.value)}
                    placeholder="ej. 25.5"
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">
                    Prestaciones sociales acumuladas en Bs. (del sistema anterior)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={prestacionesVES}
                    onChange={(e) => setPrestacionesVES(e.target.value)}
                    placeholder="ej. 15000.00"
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                </div>

                {error && (
                  <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded border px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    aria-busy={isPending}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isPending ? "Guardando…" : "Guardar saldos"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
