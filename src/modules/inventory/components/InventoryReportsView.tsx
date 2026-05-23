"use client";
// src/modules/inventory/components/InventoryReportsView.tsx
// Panel de reportes de inventario — tabs: Existencias | Movimientos | Rotación y Ventas
// Roles: OWNER, ADMIN, ACCOUNTANT

import { useState, useTransition } from "react";
import {
  RefreshCw, AlertTriangle, TrendingDown, TrendingUp, Minus, Loader2Icon,
  ChevronUp, ChevronDown, ChevronsUpDown, BarChart2, TableIcon,
} from "lucide-react";
import {
  getStockSummaryAction,
  getMovementReportAction,
  getRotationReportAction,
} from "../actions/inventory-reports.actions";
import type { StockSummary, MovementReportItem, RotationReportItem } from "../services/InventoryReportService";
import { TopProductsChart } from "./TopProductsChart";

type Props = {
  companyId: string;
  initialStock: StockSummary;
  itemOptions: { id: string; sku: string; name: string }[];
};

type Tab = "stock" | "movements" | "rotation";

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
              <th scope="col" className="px-4 py-2 text-left font-medium">SKU</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Producto</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Unidad</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Stock actual</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Mínimo</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">CPP (Bs.)</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Valor total (Bs.)</th>
              <th scope="col" className="px-4 py-2 text-center font-medium">Estado</th>
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
                <th scope="col" className="px-4 py-2 text-left font-medium">Fecha</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Tipo</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Producto</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Cantidad</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">C. Unit. (Bs.)</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Total (Bs.)</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Referencia</th>
                <th scope="col" className="px-4 py-2 text-center font-medium">Estado</th>
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

// ─── Tab: Rotación y Ventas ───────────────────────────────────────────────────

type SortKey = "name" | "unitsSold" | "revenueVes" | "stockQuantity" | "daysSinceMovement";
type SortDir = "asc" | "desc";

function DaysIndicator({ days }: { days: number | null }) {
  if (days === null) {
    return <span className="text-xs text-zinc-400">Sin mvto.</span>;
  }
  const color =
    days < 30  ? "bg-emerald-100 text-emerald-700" :
    days < 90  ? "bg-amber-100 text-amber-700"     :
                 "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        days < 30 ? "bg-emerald-500" : days < 90 ? "bg-amber-500" : "bg-red-500"
      }`} />
      {days}d
    </span>
  );
}

function SortIcon({ col, current, dir }: { col: SortKey; current: SortKey; dir: SortDir }) {
  if (col !== current) return <ChevronsUpDown className="ml-1 inline h-3 w-3 text-zinc-300" />;
  return dir === "asc"
    ? <ChevronUp className="ml-1 inline h-3 w-3 text-blue-500" />
    : <ChevronDown className="ml-1 inline h-3 w-3 text-blue-500" />;
}

function RotationTab({ companyId }: { companyId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfYear = today.slice(0, 4) + "-01-01";

  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo]     = useState(today);
  const [rows, setRows] = useState<RotationReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("revenueVes");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [chartMetric, setChartMetric] = useState<"revenueVes" | "unitsSold">("revenueVes");
  const [isPending, startTransition] = useTransition();

  function handleSearch() {
    setError(null);
    startTransition(async () => {
      const r = await getRotationReportAction(companyId, from, to);
      if (r.success) {
        setRows(r.data);
      } else {
        setError(r.error);
        setRows(null);
      }
    });
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = rows
    ? [...rows].sort((a, b) => {
        let va: number, vb: number;
        if (sortKey === "name") {
          const cmp = a.name.localeCompare(b.name, "es");
          return sortDir === "asc" ? cmp : -cmp;
        }
        if (sortKey === "daysSinceMovement") {
          // null (sin movimiento) va al final siempre
          if (a.daysSinceMovement === null && b.daysSinceMovement === null) return 0;
          if (a.daysSinceMovement === null) return 1;
          if (b.daysSinceMovement === null) return -1;
          va = a.daysSinceMovement;
          vb = b.daysSinceMovement;
        } else {
          va = parseFloat(a[sortKey] as string);
          vb = parseFloat(b[sortKey] as string);
        }
        return sortDir === "asc" ? va - vb : vb - va;
      })
    : null;

  // Totales del período
  const totals = rows
    ? rows.reduce(
        (acc, r) => ({
          unitsSold: acc.unitsSold + parseFloat(r.unitsSold),
          revenueVes: acc.revenueVes + parseFloat(r.revenueVes),
        }),
        { unitsSold: 0, revenueVes: 0 }
      )
    : null;

  function th(label: string, key: SortKey, align: "left" | "right" = "right") {
    return (
      <th
        scope="col"
        className={`cursor-pointer select-none px-4 py-2 text-${align} text-xs font-medium hover:text-zinc-700`}
        onClick={() => handleSort(key)}
      >
        {label}
        <SortIcon col={key} current={sortKey} dir={sortDir} />
      </th>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Desde</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Hasta</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending
              ? <><Loader2Icon className="h-3.5 w-3.5 animate-spin" /> Calculando...</>
              : "Calcular"
            }
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Ventas basadas en facturas emitidas (tipo SALE). Haz clic en cualquier columna para ordenar.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      {/* Gráfica top 10 */}
      {sorted !== null && sorted.some((r) => parseFloat(r[chartMetric]) > 0) && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-800">Top 10 productos</p>
              <p className="text-xs text-zinc-400">{from} → {to}</p>
            </div>
            {/* Selector de métrica */}
            <div className="flex gap-1 rounded-lg border bg-zinc-50 p-1">
              <button
                type="button"
                onClick={() => setChartMetric("revenueVes")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  chartMetric === "revenueVes"
                    ? "bg-white shadow-sm text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <BarChart2 className="h-3.5 w-3.5" />
                Ingresos Bs.
              </button>
              <button
                type="button"
                onClick={() => setChartMetric("unitsSold")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  chartMetric === "unitsSold"
                    ? "bg-white shadow-sm text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <TableIcon className="h-3.5 w-3.5" />
                Unidades
              </button>
            </div>
          </div>
          <TopProductsChart data={sorted} metric={chartMetric} />
        </div>
      )}

      {/* Tabla */}
      {sorted !== null && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold text-zinc-800">
              Detalle completo
              <span className="ml-2 text-xs font-normal text-zinc-400">
                {sorted.length} producto{sorted.length !== 1 ? "s" : ""}
              </span>
            </p>
            {totals && (
              <div className="flex gap-4 text-xs text-zinc-500">
                <span>
                  Total vendido:{" "}
                  <span className="font-mono font-semibold text-zinc-800">
                    {totals.unitsSold.toLocaleString("es-VE", { maximumFractionDigits: 2 })} uds
                  </span>
                </span>
                <span>
                  Ingresos:{" "}
                  <span className="font-mono font-semibold text-emerald-700">
                    Bs. {totals.revenueVes.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                  </span>
                </span>
              </div>
            )}
          </div>

          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                {th("Producto", "name", "left")}
                {th("Unid. vendidas", "unitsSold")}
                {th("Ingresos Bs.", "revenueVes")}
                {th("Stock actual", "stockQuantity")}
                {th("Días sin mvto.", "daysSinceMovement")}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-zinc-400">
                    Sin productos en el catálogo
                  </td>
                </tr>
              )}
              {sorted.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-zinc-900">{item.name}</p>
                    <p className="text-xs text-zinc-400">{item.sku} · {item.unit}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {parseFloat(item.unitsSold) === 0 ? (
                      <span className="text-zinc-300">—</span>
                    ) : (
                      parseFloat(item.unitsSold).toLocaleString("es-VE", { maximumFractionDigits: 2 })
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {parseFloat(item.revenueVes) === 0 ? (
                      <span className="text-zinc-300">—</span>
                    ) : (
                      <span className="font-semibold text-emerald-700">
                        {parseFloat(item.revenueVes).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-zinc-600">
                    {parseFloat(item.stockQuantity).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DaysIndicator days={item.daysSinceMovement} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sorted === null && !isPending && (
        <p className="text-center text-sm text-zinc-400">
          Selecciona un rango de fechas y presiona Calcular.
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
        {(["stock", "movements", "rotation"] as Tab[]).map((t) => (
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
            {t === "stock" ? "Existencias" : t === "movements" ? "Movimientos" : "Rotación y Ventas"}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <StockTab data={stockData} onRefresh={handleRefreshStock} isPending={isPending} />
      )}
      {tab === "movements" && (
        <MovementsTab companyId={companyId} itemOptions={itemOptions} />
      )}
      {tab === "rotation" && (
        <RotationTab companyId={companyId} />
      )}
    </div>
  );
}
