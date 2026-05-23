"use client";
// src/modules/inventory/components/InventoryReportsView.tsx
// Panel de reportes de inventario — tabs: Existencias | Movimientos
// Roles: OWNER, ADMIN, ACCOUNTANT

import { useState, useTransition } from "react";
import { RefreshCw, AlertTriangle, TrendingDown, TrendingUp, Minus, Loader2Icon } from "lucide-react";
import {
  getStockSummaryAction,
  getMovementReportAction,
} from "../actions/inventory-reports.actions";
import type { StockSummary, MovementReportItem } from "../services/InventoryReportService";

type Props = {
  companyId: string;
  initialStock: StockSummary;
  itemOptions: { id: string; sku: string; name: string }[];
};

type Tab = "stock" | "movements";

const MOVEMENT_TYPE_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ENTRADA: { label: "Entrada", color: "bg-emerald-100 text-emerald-700", icon: <TrendingUp className="h-3 w-3" /> },
  SALIDA:  { label: "Salida",  color: "bg-red-100 text-red-700",         icon: <TrendingDown className="h-3 w-3" /> },
  AJUSTE:  { label: "Ajuste",  color: "bg-amber-100 text-amber-700",     icon: <Minus className="h-3 w-3" /> },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT:  { label: "Borrador",       color: "bg-zinc-100 text-zinc-600" },
  POSTED: { label: "Contabilizado",  color: "bg-blue-100 text-blue-700" },
};

function fmtQty(val: string) {
  return Number(val).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtBs(val: string) {
  return Number(val).toLocaleString("es-VE", { minimumFractionDigits: 2 });
}

// ─── Tab: Existencias ─────────────────────────────────────────────────────────

function StockTab({
  data,
  onRefresh,
  isPending,
}: {
  data: StockSummary;
  onRefresh: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Cards resumen */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-zinc-500">Productos</p>
          <p className="mt-1 text-2xl font-bold text-zinc-900">{data.items.length}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-zinc-500">Valor total inventario</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">
            Bs. {fmtBs(data.totalInventoryValue)}
          </p>
        </div>
        <div className={`rounded-lg border p-4 ${data.lowStockCount > 0 ? "bg-red-50 border-red-200" : "bg-white"}`}>
          <p className="text-xs text-zinc-500">Bajo stock</p>
          <p className={`mt-1 text-2xl font-bold ${data.lowStockCount > 0 ? "text-red-600" : "text-zinc-400"}`}>
            {data.lowStockCount}
          </p>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold text-zinc-800">Existencias actuales</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">SKU</th>
              <th className="px-4 py-2 text-left font-medium">Producto</th>
              <th className="px-4 py-2 text-left font-medium">Unidad</th>
              <th className="px-4 py-2 text-right font-medium">Stock actual</th>
              <th className="px-4 py-2 text-right font-medium">Mínimo</th>
              <th className="px-4 py-2 text-right font-medium">CPP (Bs.)</th>
              <th className="px-4 py-2 text-right font-medium">Valor total (Bs.)</th>
              <th className="px-4 py-2 text-center font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-xs text-zinc-400">
                  Sin productos registrados
                </td>
              </tr>
            )}
            {data.items.map((item) => (
              <tr key={item.id} className={item.isLowStock ? "bg-red-50" : "hover:bg-zinc-50"}>
                <td className="px-4 py-2.5 font-mono text-xs">{item.sku}</td>
                <td className="px-4 py-2.5 font-medium text-zinc-900">
                  {item.isLowStock && (
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-red-500" />
                  )}
                  {item.name}
                </td>
                <td className="px-4 py-2.5 text-zinc-500">{item.unit}</td>
                <td className={`px-4 py-2.5 text-right font-mono ${item.isLowStock ? "text-red-600 font-semibold" : ""}`}>
                  {fmtQty(item.stockQuantity)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-zinc-400">
                  {item.minimumStock ? fmtQty(item.minimumStock) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtBs(item.averageCost)}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold text-zinc-900">
                  {fmtBs(item.totalValue)}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {item.isLowStock ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-10 font-bold text-red-700">
                      Bajo stock
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-10 font-bold text-emerald-700">
                      OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {data.items.length > 0 && (
            <tfoot className="border-t bg-zinc-50">
              <tr>
                <td colSpan={6} className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-600">
                  Total inventario:
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">
                  Bs. {fmtBs(data.totalInventoryValue)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Movimientos ─────────────────────────────────────────────────────────

function MovementsTab({
  companyId,
  itemOptions,
}: {
  companyId: string;
  itemOptions: { id: string; sku: string; name: string }[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + "-01";

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [type, setType] = useState("");
  const [itemId, setItemId] = useState("");
  const [status, setStatus] = useState("");
  const [movements, setMovements] = useState<MovementReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSearch() {
    setError(null);
    startTransition(async () => {
      const r = await getMovementReportAction(companyId, from, to, type || undefined, itemId || undefined, status || undefined);
      if (r.success) {
        setMovements(r.data);
      } else {
        setError(r.error);
        setMovements(null);
      }
    });
  }

  const totalEntradas = movements
    ?.filter((m) => m.type === "ENTRADA")
    .reduce((acc, m) => acc + Number(m.totalCost), 0) ?? 0;
  const totalSalidas = movements
    ?.filter((m) => m.type === "SALIDA")
    .reduce((acc, m) => acc + Number(m.totalCost), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="rounded-lg border bg-white p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Desde</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Hasta</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Todos</option>
              <option value="ENTRADA">Entrada</option>
              <option value="SALIDA">Salida</option>
              <option value="AJUSTE">Ajuste</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Todos</option>
              <option value="DRAFT">Borrador</option>
              <option value="POSTED">Contabilizado</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Producto</label>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="w-full rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Todos</option>
              {itemOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.sku} — {item.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleSearch}
              disabled={isPending}
              className="w-full rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      {/* Tabla de movimientos */}
      {movements !== null && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold text-zinc-800">
              Movimientos ({movements.length})
            </p>
            {movements.length > 0 && (
              <div className="flex gap-4 text-xs text-zinc-500">
                <span>
                  Entradas: <span className="font-mono font-semibold text-emerald-700">Bs. {fmtBs(totalEntradas.toFixed(2))}</span>
                </span>
                <span>
                  Salidas: <span className="font-mono font-semibold text-red-700">Bs. {fmtBs(totalSalidas.toFixed(2))}</span>
                </span>
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Fecha</th>
                <th className="px-4 py-2 text-left font-medium">Tipo</th>
                <th className="px-4 py-2 text-left font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                <th className="px-4 py-2 text-right font-medium">C. Unit. (Bs.)</th>
                <th className="px-4 py-2 text-right font-medium">Total (Bs.)</th>
                <th className="px-4 py-2 text-left font-medium">Referencia</th>
                <th className="px-4 py-2 text-center font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {movements.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-zinc-400">
                    Sin movimientos en el período seleccionado
                  </td>
                </tr>
              )}
              {movements.map((mov) => {
                const typeInfo = MOVEMENT_TYPE_LABELS[mov.type] ?? { label: mov.type, color: "bg-zinc-100 text-zinc-600", icon: null };
                const statusInfo = STATUS_LABELS[mov.status] ?? { label: mov.status, color: "bg-zinc-100 text-zinc-600" };
                return (
                  <tr key={mov.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5 font-mono text-xs">{mov.date}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-10 font-bold ${typeInfo.color}`}>
                        {typeInfo.icon}{typeInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-zinc-900">{mov.itemName}</p>
                      <p className="text-xs text-zinc-400">{mov.itemSku} · {mov.unit}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtQty(mov.quantity)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtBs(mov.unitCost)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtBs(mov.totalCost)}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500 max-w-37\.5 truncate">
                      {mov.reference ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`rounded px-2 py-0.5 text-10 font-bold ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {movements === null && !isPending && (
        <p className="text-center text-sm text-zinc-400">
          Selecciona un rango de fechas y presiona Buscar.
        </p>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function InventoryReportsView({ companyId, initialStock, itemOptions }: Props) {
  const [tab, setTab] = useState<Tab>("stock");
  const [stockData, setStockData] = useState<StockSummary>(initialStock);
  const [isPending, startTransition] = useTransition();

  function handleRefreshStock() {
    startTransition(async () => {
      const r = await getStockSummaryAction(companyId);
      if (r.success) setStockData(r.data);
    });
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-zinc-50 p-1 w-fit">
        {(["stock", "movements"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-white shadow-sm text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {t === "stock" ? "Existencias" : "Movimientos"}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <StockTab data={stockData} onRefresh={handleRefreshStock} isPending={isPending} />
      )}
      {tab === "movements" && (
        <MovementsTab companyId={companyId} itemOptions={itemOptions} />
      )}
    </div>
  );
}
