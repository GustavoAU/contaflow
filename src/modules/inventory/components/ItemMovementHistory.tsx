"use client";

// src/modules/inventory/components/ItemMovementHistory.tsx
// Panel de historial de movimientos + CPP card para un ítem dado.
// Se renderiza en un <tr> de ancho completo — el toggle vive en InventoryItemList.
// R-12: link al asiento contable generado al contabilizar (status POSTED + transactionId)

import Link from "next/link";

export type MovementRow = {
  id: string;
  type: string;
  status: string;
  quantity: unknown; // Decimal → string tras serialización
  unitCost: unknown;
  totalCost: unknown;
  date: unknown;
  reference: string | null;
  notes: string | null;
  transactionId: string | null; // R-12: ID del asiento generado al contabilizar
};

type Props = {
  companyId: string;   // para construir el link al asiento contable (R-12)
  itemName: string;
  sku: string;
  stockQuantity: string;
  averageCost: string;
  unit: string;
  movements: MovementRow[] | null; // null = cargando
  error: string | null;
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  ENTRADA: { label: "Entrada", color: "bg-green-100 text-green-800" },
  SALIDA: { label: "Salida", color: "bg-red-100 text-red-800" },
  AJUSTE: { label: "Ajuste", color: "bg-yellow-100 text-yellow-800" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-gray-100 text-gray-600" },
  POSTED: { label: "Contabilizado", color: "bg-blue-100 text-blue-700" },
  VOIDED: { label: "Anulado", color: "bg-red-50 text-red-400" },
};

function fmt(value: unknown, decimals = 2) {
  const n = parseFloat(String(value));
  return isNaN(n) ? "—" : n.toLocaleString("es-VE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function ItemMovementHistory({
  companyId,
  itemName,
  sku,
  stockQuantity,
  averageCost,
  unit,
  movements,
  error,
}: Props) {
  const stock = parseFloat(stockQuantity);
  const cpp = parseFloat(averageCost);
  const bookValue = stock * cpp;

  return (
    <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
      {/* CPP Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-indigo-200 bg-white px-3 py-2">
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide">Stock actual</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900">
            {fmt(stockQuantity, 2)}{" "}
            <span className="text-xs font-normal text-gray-400">{unit}</span>
          </p>
        </div>
        <div className="rounded-md border border-indigo-200 bg-white px-3 py-2">
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide">CPP vigente</p>
          <p className="mt-0.5 text-lg font-bold text-indigo-900">{fmt(averageCost, 4)}</p>
          <p className="text-xs text-indigo-400">Bs./u</p>
        </div>
        <div className="rounded-md border border-indigo-200 bg-white px-3 py-2">
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide">Valor en libros</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900">{fmt(bookValue, 2)}</p>
          <p className="text-xs text-gray-400">Bs. (stock × CPP)</p>
        </div>
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">SKU</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-gray-700">{sku}</p>
          <p className="text-xs text-gray-400 truncate">{itemName}</p>
        </div>
      </div>

      {/* Historial */}
      <div>
        <p className="mb-2 text-xs font-semibold text-indigo-700 uppercase tracking-wide">
          Historial de movimientos
        </p>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
        )}

        {movements === null && !error && (
          <p className="text-xs text-gray-400 py-4 text-center">Cargando historial...</p>
        )}

        {movements !== null && movements.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">
            Sin movimientos registrados para este producto.
          </p>
        )}

        {movements !== null && movements.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-indigo-100 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-right">Costo unit.</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Referencia</th>
                  <th className="px-3 py-2 text-center">Asiento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map((mov) => {
                  const typeInfo = TYPE_LABELS[mov.type] ?? { label: mov.type, color: "bg-gray-100 text-gray-600" };
                  const statusInfo = STATUS_LABELS[mov.status] ?? { label: mov.status, color: "bg-gray-100 text-gray-500" };
                  return (
                    <tr
                      key={mov.id}
                      className={`hover:bg-gray-50 ${mov.status === "VOIDED" ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                        {new Date(String(mov.date)).toLocaleDateString("es-VE")}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmt(mov.quantity, 2)}{" "}
                        <span className="text-gray-400">{unit}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-600">
                        {fmt(mov.unitCost, 4)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-gray-800">
                        {fmt(mov.totalCost, 2)}
                      </td>
                      <td className="px-3 py-2 text-gray-400 max-w-35 truncate">
                        {mov.reference ?? "—"}
                      </td>
                      {/* R-12: link al asiento contable — solo visible en POSTED */}
                      <td className="px-3 py-2 text-center">
                        {mov.status === "POSTED" && mov.transactionId ? (
                          <Link
                            href={`/company/${companyId}/transactions/${mov.transactionId}`}
                            className="text-blue-600 hover:underline text-xs font-medium"
                            title="Ver asiento contable"
                          >
                            Ver asiento →
                          </Link>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
