"use client";

const MONTHS = [
  "","Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

type SerializedINPCRate = {
  id: string;
  year: number;
  month: number;
  indexValue: string;
  source: string | null;
  createdAt: string;
};

type Props = {
  rates: SerializedINPCRate[];
};

export function INPCRateTable({ rates }: Props) {
  if (rates.length === 0) {
    return (
      <p className="text-center text-sm text-gray-500 py-6">
        No hay índices INPC cargados. Use el formulario para agregar el primero.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
          <tr>
            <th className="px-4 py-3 text-left">Período</th>
            <th className="px-4 py-3 text-right">Índice INPC</th>
            <th className="px-4 py-3 text-left">Fuente</th>
            <th className="px-4 py-3 text-left">Cargado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rates.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">
                {MONTHS[r.month]} {r.year}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-800">
                {r.indexValue}
              </td>
              <td className="px-4 py-3 text-gray-500">{r.source ?? "BCV"}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">
                {new Date(r.createdAt).toLocaleDateString("es-VE")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
