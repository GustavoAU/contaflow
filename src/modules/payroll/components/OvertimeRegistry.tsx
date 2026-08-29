"use client";
// src/modules/payroll/components/OvertimeRegistry.tsx
// LOTTT Art. 183 — registro de horas extraordinarias.
//
// Los cuatro campos que pide el artículo (trabajador, horas, trabajo efectuado y
// remuneración especial pagada) son las cuatro columnas de la tabla. El aviso de
// arriba no es decorativo: sin registro conforme a la Ley se presumen ciertos los
// alegatos del trabajador, y esa es la razón por la que esta pantalla existe.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  createOvertimeAction,
  deleteOvertimeAction,
} from "../actions/overtime.actions";
import type { OvertimeEntryRow } from "../services/OvertimeService";
import { todayLocalISO } from "@/lib/today";

interface EmployeeOption {
  id: string;
  name: string;
  // `null` = jornada sin declarar en la ficha -> se calcula como DIURNA.
  workShift: "DIURNA" | "NOCTURNA" | "MIXTA" | null;
}

interface Props {
  companyId: string;
  initial: OvertimeEntryRow[];
  employees: EmployeeOption[];
}

const EMPTY = {
  employeeId: "",
  // `new Date().toISOString()` da el dia SIGUIENTE en husos negativos a partir
  // de las 20:00: en Venezuela (UTC-4) el registro nacia con fecha de manana.
  workedOn: todayLocalISO(),
  hours: "",
  kind: "DIURNA" as "DIURNA" | "NOCTURNA",
  workPerformed: "",
  authorized: false,
  authorizationRef: "",
};

export default function OvertimeRegistry({ companyId, initial, employees }: Props) {
  const [rows, setRows] = useState<OvertimeEntryRow[]>(initial);
  const [form, setForm] = useState(EMPTY);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createOvertimeAction(companyId, {
        employeeId: form.employeeId,
        workedOn: form.workedOn,
        hours: Number(form.hours),
        kind: form.kind,
        workPerformed: form.workPerformed,
        authorized: form.authorized,
        authorizationRef: form.authorizationRef || null,
      });
      if (result.success) {
        setRows((prev) => [result.data, ...prev]);
        setForm({ ...EMPTY, workedOn: form.workedOn });
        toast.success("Horas registradas");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteOvertimeAction(companyId, id);
      if (result.success) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        toast.success("Registro eliminado");
      } else {
        toast.error(result.error);
      }
    });
  }

  const selected = employees.find((e) => e.id === form.employeeId);

  return (
    <div className="space-y-6">
      {/* Por qué existe esta pantalla — Art. 183, segundo aparte. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>El registro es obligatorio.</strong> Si no existe o no se lleva
          conforme a la Ley, el Art. 183 presume ciertos —hasta prueba en
          contrario— los alegatos del trabajador sobre las horas extraordinarias
          laboradas y sobre lo que se le pagó por ellas. Estas horas se cargan
          solas al procesar la nómina del período.
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="ot-emp" className="mb-1 block text-sm font-medium text-gray-700">
              Trabajador
            </label>
            <select
              id="ot-emp"
              required
              value={form.employeeId}
              onChange={(e) => set("employeeId", e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <option value="">Selecciona…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            {selected && selected.workShift && selected.workShift !== "DIURNA" && (
              // Art. 113 + Art. 173: el divisor del salario hora cambia con la
              // jornada, así que la hora extra de esta persona vale más.
              <p className="mt-1 text-xs text-gray-500">
                Jornada {selected.workShift.toLowerCase()}: la hora se divide entre{" "}
                {selected.workShift === "NOCTURNA" ? "7" : "7,5"} y no entre 8.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ot-date" className="mb-1 block text-sm font-medium text-gray-700">
              Fecha laborada
            </label>
            <input
              id="ot-date"
              type="date"
              required
              value={form.workedOn}
              onChange={(e) => set("workedOn", e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="ot-hours" className="mb-1 block text-sm font-medium text-gray-700">
              Horas
            </label>
            <input
              id="ot-hours"
              type="number"
              min="0.5"
              max="10"
              step="0.5"
              required
              value={form.hours}
              onChange={(e) => set("hours", e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="ot-kind" className="mb-1 block text-sm font-medium text-gray-700">
              Tipo
            </label>
            <select
              id="ot-kind"
              value={form.kind}
              onChange={(e) => set("kind", e.target.value as "DIURNA" | "NOCTURNA")}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <option value="DIURNA">Diurna — recargo 50% (Art. 118)</option>
              <option value="NOCTURNA">Nocturna — recargo 95% (Arts. 117 + 118)</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="ot-work" className="mb-1 block text-sm font-medium text-gray-700">
            Trabajo efectuado
          </label>
          <input
            id="ot-work"
            type="text"
            required
            minLength={5}
            maxLength={500}
            placeholder="Ej. Cierre de inventario de fin de mes"
            value={form.workPerformed}
            onChange={(e) => set("workPerformed", e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            El Art. 183 lo exige por nombre: &ldquo;los trabajos efectuados en esas horas&rdquo;.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="flex cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={form.authorized}
                onChange={(e) => set("authorized", e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              <span className="text-sm">Con permiso de la Inspectoría del Trabajo</span>
            </label>
            {!form.authorized && (
              // Art. 182: sin permiso, el recargo se DUPLICA.
              <p className="mt-1 text-xs text-amber-700">
                Sin permiso, el Art. 182 obliga a pagarlas con el <strong>doble del
                recargo</strong>: 100% en lugar de 50%. Se calculará así.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ot-ref" className="mb-1 block text-sm font-medium text-gray-700">
              N° de permiso o de notificación{" "}
              {form.authorized
                ? <span className="text-red-600">(obligatorio)</span>
                : <span className="text-gray-400">(opcional)</span>}
            </label>
            <input
              id="ot-ref"
              type="text"
              maxLength={120}
              // Obligatorio en cuanto se declara el permiso: afirmarlo baja el
              // pago un 33%, así que la afirmación tiene que traer su respaldo.
              required={form.authorized}
              value={form.authorizationRef}
              onChange={(e) => set("authorizationRef", e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus-visible:ring-1 focus-visible:ring-blue-500"
            />
            {form.authorized && (
              <p className="mt-1 text-xs text-gray-500">
                El del permiso de la Inspectoría, o el de la notificación si fue
                un caso imprevisto y urgente (Art. 182).
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Registrando…" : "Registrar horas"}
        </button>
      </form>

      <div className="rounded-lg border bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
            Sin horas extraordinarias registradas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Fecha</th>
                  <th scope="col" className="px-3 py-2 text-left">Trabajador</th>
                  <th scope="col" className="px-3 py-2 text-right">Horas</th>
                  <th scope="col" className="px-3 py-2 text-left">Tipo</th>
                  <th scope="col" className="px-3 py-2 text-left">Trabajo efectuado</th>
                  <th scope="col" className="px-3 py-2 text-left">Permiso</th>
                  <th scope="col" className="px-3 py-2 text-right">Pagado</th>
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.workedOn}</td>
                    <td className="px-3 py-2 font-medium">{r.employeeName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.hours}</td>
                    <td className="px-3 py-2">{r.kind === "DIURNA" ? "Diurna" : "Nocturna"}</td>
                    <td className="px-3 py-2 text-gray-600">{r.workPerformed}</td>
                    <td className="px-3 py-2">
                      {r.authorized ? (
                        <>
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                            Autorizadas
                          </span>
                          {/* El N° es la prueba de lo que la fila afirma: sin él
                              el badge es una declaración sin respaldo. */}
                          {r.authorizationRef && (
                            <span className="mt-0.5 block font-mono text-xs text-gray-500">
                              {r.authorizationRef}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          Sin permiso — recargo doble
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.paidAmount ?? <span className="text-gray-400">Por pagar</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* Ya pagadas no se borran: el registro debe conservar la
                          remuneración especial (Art. 183). */}
                      {!r.payrollRunId && (
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          disabled={isPending}
                          aria-label={`Eliminar registro del ${r.workedOn}`}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-red-500"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
