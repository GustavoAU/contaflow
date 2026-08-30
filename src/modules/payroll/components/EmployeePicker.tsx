"use client";
// src/modules/payroll/components/EmployeePicker.tsx
// Selección de trabajadores para un proceso de nómina.
//
// Existe por una razón concreta: el calculador BLOQUEA las nóminas de monedas
// mixtas (C-01) porque sumar bolívares y dólares da un total que no es de
// ninguna de las dos. La action siempre aceptó procesar un subconjunto
// (`employeeIds`), pero el formulario mandaba a todos los activos, así que una
// empresa con sueldos en las dos monedas no podía procesar NADA.
//
// Vive en su propio archivo y no dentro de PayrollRunForm porque el formulario
// ya rozaba el límite del compilador: con este bloque inline, `next build`
// abortaba con "Zone Allocation failed" incluso con 8 GB de heap.

import type { RunEmployeeOption } from "./PayrollRunForm";

interface Props {
  employees: RunEmployeeOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectCurrency: (currency: string) => void;
  currencies: (RunEmployeeOption["currency"])[];
  mixed: boolean;
  /** Monedas mezcladas en la selección actual, ya formateadas. `null` si es válida. */
  invalidMix: string | null;
}

export function EmployeePicker({
  employees, selected, onToggle, onSelectCurrency, currencies, mixed, invalidMix,
}: Props) {
  if (employees.length === 0) return null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-800">Trabajadores a incluir</p>
          <p className="text-xs text-gray-500">
            {selected.size} de {employees.length} seleccionados
          </p>
        </div>
        {mixed && (
          <div className="flex gap-2">
            {currencies.map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => onSelectCurrency(cur!)}
                className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:ring-1 focus-visible:ring-blue-500"
              >
                Sólo {cur} ({employees.filter((e) => e.currency === cur).length})
              </button>
            ))}
          </div>
        )}
      </div>

      {mixed && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Hay sueldos en más de una moneda. Una nómina no puede mezclarlas —los
          totales no serían de ninguna de las dos—, así que hay que procesar una
          moneda por proceso.
        </p>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto">
        {employees.map((e) => (
          <label key={e.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
            <input
              type="checkbox"
              checked={selected.has(e.id)}
              onChange={() => onToggle(e.id)}
              className="h-4 w-4 accent-blue-600"
            />
            <span className="flex-1">{e.name}</span>
            <span className="font-mono text-xs text-gray-400">{e.currency}</span>
          </label>
        ))}
      </div>

      {invalidMix && (
        <p className="mt-2 text-xs font-medium text-red-600">
          La selección mezcla {invalidMix}. Elige una sola moneda.
        </p>
      )}
      {selected.size === 0 && (
        <p className="mt-2 text-xs font-medium text-red-600">
          Selecciona al menos un trabajador.
        </p>
      )}
    </div>
  );
}
