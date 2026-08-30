"use client";
// src/modules/payroll/components/RecurringConceptPanel.tsx
//
// Asignaciones fijas del trabajador: lo que se repite en cada nómina mientras
// esté vigente. El caso que las motiva es el pago en divisas — salario en
// bolívares (base de cotizaciones) y el resto en dólares como bono no salarial.

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createRecurringConceptAction,
  endRecurringConceptAction,
} from "../actions/employee-recurring-concept.actions";
import type { RecurringConceptRow } from "../services/EmployeeRecurringConceptService";
import { currencySymbol, formatAmount } from "@/lib/format";

export interface ConceptOption {
  id: string;
  code: string;
  name: string;
  salaryNature: RecurringConceptRow["salaryNature"];
}

interface Props {
  companyId: string;
  employeeId: string;
  rows: RecurringConceptRow[];
  concepts: ConceptOption[];
  canWrite: boolean;
  /** Hoy en la zona del país, en ISO. Se calcula en el servidor: derivarlo aquí
   *  con `new Date()` da mañana después de las 20:00 en Venezuela. */
  todayISO: string;
}

const NATURE_LABEL: Record<string, string> = {
  NO_SALARIAL: "No salarial",
  SALARIO_NORMAL: "Salario normal",
  SALARIAL_ACCIDENTAL: "Salarial accidental",
};

const NATURE_STYLE: Record<string, string> = {
  NO_SALARIAL: "bg-zinc-100 text-zinc-700",
  SALARIO_NORMAL: "bg-emerald-100 text-emerald-800",
  SALARIAL_ACCIDENTAL: "bg-amber-100 text-amber-800",
};

export function RecurringConceptPanel({
  companyId, employeeId, rows, concepts, canWrite, todayISO,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"VES" | "USD">("USD");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO);
  const [notes, setNotes] = useState("");

  const elegido = concepts.find((c) => c.id === conceptId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createRecurringConceptAction(companyId, {
        employeeId, conceptId, amount, currency, effectiveFrom,
        notes: notes.trim() || undefined,
      });
      if (result.success) {
        toast.success("Asignación fija registrada");
        setAmount("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleEnd(id: string) {
    startTransition(async () => {
      const result = await endRecurringConceptAction(companyId, { id, effectiveTo: todayISO });
      if (result.success) {
        toast.success("Asignación cerrada");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const vigentes = rows.filter((r) => !r.effectiveTo || r.effectiveTo >= todayISO);
  const cerradas = rows.filter((r) => r.effectiveTo && r.effectiveTo < todayISO);

  return (
    <div className="space-y-6">
      {canWrite && concepts.length > 0 && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border bg-white p-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">Nueva asignación fija</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Se aplica sola en cada proceso de nómina mientras esté vigente. Si la
              moneda no es la del proceso, se convierte a la tasa BCV del período y
              se guarda el importe original.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Concepto</span>
              <select
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              >
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Desde</span>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                required
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Monto</span>
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

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Moneda</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "VES" | "USD")}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="USD">USD — dólares</option>
                <option value="VES">VES — bolívares</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">
              Nota <span className="font-normal text-gray-400">(opcional)</span>
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {elegido && elegido.salaryNature !== "NO_SALARIAL" && (
            // El contador debe saber en qué se está metiendo: un concepto con
            // incidencia salarial engorda la base de IVSS, FAOV e INCES.
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>{elegido.name}</strong> tiene incidencia salarial
              ({NATURE_LABEL[elegido.salaryNature]}): este monto entrará en la base
              de cotizaciones de IVSS, FAOV e INCES.
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            aria-busy={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {isPending ? "Guardando…" : "Agregar asignación"}
          </button>
        </form>
      )}

      <Tabla
        titulo="Vigentes"
        rows={vigentes}
        canWrite={canWrite}
        onEnd={handleEnd}
        isPending={isPending}
        vacia="Sin asignaciones fijas. El sueldo se procesa solo."
      />

      {cerradas.length > 0 && (
        <Tabla
          titulo="Cerradas"
          rows={cerradas}
          canWrite={false}
          onEnd={handleEnd}
          isPending={isPending}
          vacia=""
        />
      )}
    </div>
  );
}

function Tabla({ titulo, rows, canWrite, onEnd, isPending, vacia }: {
  titulo: string;
  rows: RecurringConceptRow[];
  canWrite: boolean;
  onEnd: (id: string) => void;
  isPending: boolean;
  vacia: string;
}) {
  if (rows.length === 0 && !vacia) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-700">{titulo}</h3>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-gray-500">{vacia}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Concepto</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th className="px-3 py-2 text-left font-medium">Vigencia</th>
                {canWrite && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.conceptName}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${NATURE_STYLE[r.salaryNature] ?? ""}`}>
                      {NATURE_LABEL[r.salaryNature] ?? r.salaryNature}
                    </span>
                    {r.notes && <p className="mt-0.5 text-xs text-gray-500">{r.notes}</p>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    <span className="opacity-60">{currencySymbol(r.currency)}</span>{" "}
                    {formatAmount(r.amount)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {r.effectiveFrom} → {r.effectiveTo ?? "indefinida"}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onEnd(r.id)}
                        disabled={isPending}
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cerrar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
