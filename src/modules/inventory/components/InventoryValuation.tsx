"use client";

// src/modules/inventory/components/InventoryValuation.tsx
// Widget de valoración del inventario a CPP — dominio ACCOUNTANT / WRITERS

export type ValuationItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stockQuantity: string;
  averageCost: string;
};

type Props = {
  items: ValuationItem[];
  totalValue: string;
};

export function InventoryValuation({ items, totalValue }: Props) {
  const total = parseFloat(totalValue);
  const itemCount = items.length;
  const zeroStockCount = items.filter((i) => parseFloat(i.stockQuantity) === 0).length;

  return (
    <div className="space-y-4">
      {/* Resumen ejecutivo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">
            Valor Total Inventario
          </p>
          <p className="mt-1 text-2xl font-bold text-blue-900">
            {total.toLocaleString("es-VE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="mt-0.5 text-xs text-blue-600">Bs. (CPP vigente)</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Productos activos
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{itemCount}</p>
          <p className="mt-0.5 text-xs text-gray-400">en el inventario</p>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            zeroStockCount > 0
              ? "border-red-200 bg-red-50"
              : "border-green-200 bg-green-50"
          }`}
        >
          <p
            className={`text-xs font-medium uppercase tracking-wide ${
              zeroStockCount > 0 ? "text-red-600" : "text-green-600"
            }`}
          >
            Stock agotado
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              zeroStockCount > 0 ? "text-red-900" : "text-green-900"
            }`}
          >
            {zeroStockCount}
          </p>
          <p
            className={`mt-0.5 text-xs ${
              zeroStockCount > 0 ? "text-red-600" : "text-green-600"
            }`}
          >
            {zeroStockCount > 0 ? "productos sin existencias" : "todos con existencias"}
          </p>
        </div>
      </div>

      {/* Detalle por producto */}
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">Sin productos en inventario.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">CPP</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">% del total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items
                .map((item) => {
                  const stock = parseFloat(item.stockQuantity);
                  const cpp = parseFloat(item.averageCost);
                  const valor = stock * cpp;
                  const pct = total > 0 ? (valor / total) * 100 : 0;
                  return { ...item, stock, cpp, valor, pct };
                })
                .sort((a, b) => b.valor - a.valor)
                .map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span
                        className={
                          item.stock === 0
                            ? "text-red-600 font-semibold"
                            : "text-gray-700"
                        }
                      >
                        {item.stock.toLocaleString("es-VE", { maximumFractionDigits: 2 })}{" "}
                        <span className="text-xs text-gray-400">{item.unit}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">
                      {item.cpp.toLocaleString("es-VE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                      {item.valor.toLocaleString("es-VE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${Math.min(item.pct, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 w-10 text-right">
                          {item.pct.toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-gray-700 text-right">
                  Total:
                </td>
                <td className="px-4 py-3 text-right font-mono text-base font-bold text-gray-900">
                  {total.toLocaleString("es-VE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-400">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
