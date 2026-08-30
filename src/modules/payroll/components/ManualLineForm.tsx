"use client";
// src/modules/payroll/components/ManualLineForm.tsx
//
// Concepto puntual sobre un proceso en borrador: retención de ISLR, un bono de
// una vez, un descuento acordado.
//
// Existía la entrada `manualConcepts` en `createPayrollRunAction`, pero sólo al
// CREAR —cuando el contador todavía no conoce el importe— y ninguna pantalla la
// enviaba jamás. La retención de ISLR, cuya vía documentada era ésa, no podía
// introducirse en la aplicación.
//
// Vive en su propio archivo y no dentro de PayrollRunDetail: ese componente ya
// rozó el límite del compilador y `next build` aborta con "Zone Allocation
// failed" cuando se le añade JSX inline.

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addManualPayrollLineAction } from "../actions/payroll-run.actions";
import { currencySymbol } from "@/lib/format";

export interface ManualLineEmployee {
  id: string;
  name: string;
}

export interface ManualLineConcept {
  id: string;
  name: string;
  type: "EARNING" | "DEDUCTION" | "EMPLOYER_COST";
  salaryNature: "NO_SALARIAL" | "SALARIO_NORMAL" | "SALARIAL_ACCIDENTAL";
}

interface Props {
  companyId: string;
  runId: string;
  currency: string;
  employees: ManualLineEmployee[];
  concepts: ManualLineConcept[];
}

const TYPE_LABEL: Record<string, string> = {
  EARNING: "Asignación",
  DEDUCTION: "Deducción",
  EMPLOYER_COST: "Aporte patronal",
};

export function ManualLineForm({ companyId, runId, currency, employees, concepts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? "");
  const [amount, setAmount] = useState("");

  if (employees.length === 0 || concepts.length === 0) return null;

  const elegido = concepts.find((c) => c.id === conceptId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addManualPayrollLineAction(companyId, {
        runId, employeeId, conceptId, amount,
      });
      if (result.success) {
        toast.success("Concepto agregado al proceso");
        setAmount("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        + Agregar concepto
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-700">Agregar concepto al proceso</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          Para lo puntual de esta nómina: retención de ISLR, un bono de una vez, un
          descuento acordado. Lo que se repite cada mes va en las asignaciones
          fijas del trabajador.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Trabajador</span>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Concepto</span>
          <select
            value={conceptId}
            onChange={(e) => setConceptId(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          >
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {TYPE_LABEL[c.type] ?? c.type}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Monto <span className="font-normal text-gray-400">({currencySymbol(currency)})</span>
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            placeholder="0,00"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>

      {elegido && elegido.salaryNature !== "NO_SALARIAL" && (
        // Honestidad sobre lo que este proceso NO va a rehacer. Las cotizaciones
        // de este período salen del mes anterior (LOTTT Art. 107), así que
        // añadir una línea salarial ahora no las mueve: contará para el mes
        // siguiente. Si el contador quiere verlo reflejado ya, Recalcular.
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Este concepto tiene incidencia salarial. Las bases de cotización de esta
          nómina ya están calculadas sobre el mes anterior (LOTTT Art. 107), así
          que esta línea contará para el mes siguiente, no para éste. Si necesitas
          que entre ya, usa <strong>Recalcular</strong>.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="size-4 animate-spin" />}
          {isPending ? "Agregando…" : "Agregar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
