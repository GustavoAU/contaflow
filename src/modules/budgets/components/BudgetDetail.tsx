"use client";
// src/modules/budgets/components/BudgetDetail.tsx
// Q3-3: Detalle de presupuesto — líneas + comparación Presupuestado vs Real.

import { useState, useTransition, useEffect, useCallback } from "react";
import { PlusIcon, Trash2Icon, BarChart2Icon, ListIcon } from "lucide-react";
import { toast } from "sonner";
import type { BudgetRow, BudgetLineRow, BudgetVsActualLine } from "../services/BudgetService";
import { upsertBudgetLineAction, deleteBudgetLineAction, getBudgetVsActualAction } from "../actions/budget.actions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBs(amount: string): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function varianceClass(variance: string): string {
  const n = parseFloat(variance);
  if (isNaN(n) || n === 0) return "text-zinc-500";
  return n > 0 ? "text-emerald-600" : "text-red-600";
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
  budget: BudgetRow;
  canWrite: boolean;
  accounts: { id: string; code: string; name: string; type: string }[];
  onBudgetUpdate: (updated: BudgetRow) => void;
};

type Tab = "lines" | "comparison";

export function BudgetDetail({ companyId, budget, canWrite, accounts, onBudgetUpdate }: Props) {
  const [tab, setTab] = useState<Tab>("lines");
  const [lines, setLines] = useState<BudgetLineRow[]>(budget.lines);
  const [vsActual, setVsActual] = useState<BudgetVsActualLine[] | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state for adding a new line
  const [addAccountId, setAddAccountId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // Update local state when budget prop changes (parent refreshes)
  useEffect(() => {
    setLines(budget.lines);
    setVsActual(null); // clear comparison when budget changes
  }, [budget.id, budget.lines]);

  const loadComparison = useCallback(async () => {
    if (vsActual !== null) return; // cached
    setLoadingComparison(true);
    const r = await getBudgetVsActualAction(companyId, budget.id);
    setLoadingComparison(false);
    if (r.success) setVsActual(r.data);
    else toast.error(r.error);
  }, [companyId, budget.id, vsActual]);

  function handleTabChange(t: Tab) {
    setTab(t);
    if (t === "comparison" && vsActual === null) loadComparison();
  }

  function handleAddLine() {
    if (!addAccountId || !addAmount.trim()) return;
    startTransition(async () => {
      const r = await upsertBudgetLineAction(companyId, budget.id, {
        accountId: addAccountId,
        amount: addAmount,
        notes: addNotes || undefined,
      });
      if (!r.success) { toast.error(r.error); return; }
      // Upsert in local state
      const exists = lines.find((l) => l.accountId === r.data.accountId);
      const newLines = exists
        ? lines.map((l) => l.accountId === r.data.accountId ? r.data : l)
        : [...lines, r.data];
      setLines(newLines);
      setVsActual(null); // invalidate comparison
      onBudgetUpdate({ ...budget, lines: newLines });
      setAddAccountId(""); setAddAmount(""); setAddNotes("");
      setShowAddForm(false);
      toast.success("Línea guardada");
    });
  }

  function handleDeleteLine(accountId: string) {
    startTransition(async () => {
      const r = await deleteBudgetLineAction(companyId, budget.id, accountId);
      if (!r.success) { toast.error(r.error); return; }
      const newLines = lines.filter((l) => l.accountId !== accountId);
      setLines(newLines);
      setVsActual(null);
      onBudgetUpdate({ ...budget, lines: newLines });
      toast.success("Línea eliminada");
    });
  }

  // Accounts not yet in budget (for the selector)
  const usedAccountIds = new Set(lines.map((l) => l.accountId));
  const availableAccounts = accounts.filter((a) => !usedAccountIds.has(a.id));

  const totalBudgeted = lines.reduce((s, l) => s + parseFloat(l.amount), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">{budget.name} — {budget.periodYear}</h3>
          <p className="text-xs text-zinc-500">
            {lines.length} cuenta{lines.length !== 1 ? "s" : ""} •
            Total presupuestado: <span className="font-medium text-zinc-700">Bs. {fmtBs(totalBudgeted.toFixed(2))}</span>
          </p>
        </div>
        {/* Tabs */}
        <div className="flex rounded-md border border-zinc-200 overflow-hidden text-sm">
          <button
            onClick={() => handleTabChange("lines")}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${tab === "lines" ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
          >
            <ListIcon className="size-3.5" />
            Líneas
          </button>
          <button
            onClick={() => handleTabChange("comparison")}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-zinc-200 ${tab === "comparison" ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
          >
            <BarChart2Icon className="size-3.5" />
            vs Real
          </button>
        </div>
      </div>

      {/* ── Tab: Lines ──────────────────────────────────────────────────── */}
      {tab === "lines" && (
        <div className="space-y-3">
          {canWrite && (
            <div>
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  disabled={availableAccounts.length === 0}
                  className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <PlusIcon className="size-4" />
                  Agregar cuenta
                </button>
              ) : (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 space-y-2">
                  <p className="text-xs font-medium text-indigo-800">Nueva línea de presupuesto</p>
                  <select
                    className="w-full rounded border px-2 py-1.5 text-sm text-zinc-700"
                    value={addAccountId}
                    onChange={(e) => setAddAccountId(e.target.value)}
                  >
                    <option value="">Seleccionar cuenta…</option>
                    {availableAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded border px-2 py-1.5 text-sm"
                      placeholder="Importe Bs. (anual)"
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                      type="number"
                      min="0"
                      step="0.01"
                    />
                    <input
                      className="flex-1 rounded border px-2 py-1.5 text-sm"
                      placeholder="Notas (opcional)"
                      value={addNotes}
                      onChange={(e) => setAddNotes(e.target.value)}
                      maxLength={500}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddLine}
                      disabled={!addAccountId || !addAmount.trim() || isPending}
                      className="rounded bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {isPending ? "Guardando…" : "Guardar"}
                    </button>
                    <button
                      onClick={() => { setShowAddForm(false); setAddAccountId(""); setAddAmount(""); }}
                      className="rounded border px-3 py-1 text-xs text-zinc-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {lines.length === 0 ? (
            <p className="text-sm text-zinc-400 py-4 text-center">Sin líneas presupuestadas. Agrega cuentas para definir el presupuesto.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full divide-y divide-zinc-100 text-sm">
                <thead className="bg-zinc-50">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600">Cuenta</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600 whitespace-nowrap">Importe Bs.</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600">Notas</th>
                    {canWrite && <th scope="col" className="px-4 py-2.5 w-8" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 bg-white">
                  {lines.map((l) => (
                    <tr key={l.accountId} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-zinc-500 mr-1.5">{l.account.code}</span>
                        <span className="text-zinc-800">{l.account.name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-zinc-800 whitespace-nowrap">
                        {fmtBs(l.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">{l.notes ?? "—"}</td>
                      {canWrite && (
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => handleDeleteLine(l.accountId)}
                            disabled={isPending}
                            className="text-zinc-300 hover:text-red-500 disabled:opacity-30"
                            title="Eliminar línea"
                          >
                            <Trash2Icon className="size-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-zinc-50">
                  <tr>
                    <td className="px-4 py-2 text-sm font-semibold text-zinc-700">Total</td>
                    <td className="px-4 py-2 text-right text-sm font-bold text-zinc-900 whitespace-nowrap">
                      {fmtBs(totalBudgeted.toFixed(2))}
                    </td>
                    <td colSpan={canWrite ? 2 : 1} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Presupuestado vs Real ───────────────────────────────────── */}
      {tab === "comparison" && (
        <div>
          {loadingComparison ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-zinc-400">Cargando comparación…</span>
            </div>
          ) : vsActual === null ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-zinc-400">Sin datos de comparación.</span>
            </div>
          ) : vsActual.length === 0 ? (
            <p className="text-sm text-zinc-400 py-4 text-center">
              No hay líneas presupuestadas. Agrega cuentas en la pestaña &ldquo;Líneas&rdquo;.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full divide-y divide-zinc-100 text-sm">
                <thead className="bg-zinc-50">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium text-zinc-600">Cuenta</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600 whitespace-nowrap">Presupuestado</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600 whitespace-nowrap">Real</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600 whitespace-nowrap">Variación</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium text-zinc-600">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 bg-white">
                  {vsActual.map((row) => (
                    <tr key={row.accountId} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-zinc-500 mr-1.5">{row.accountCode}</span>
                        <span className="text-zinc-800">{row.accountName}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-700 whitespace-nowrap">{fmtBs(row.budgeted)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-700 whitespace-nowrap">{fmtBs(row.actual)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${varianceClass(row.variance)}`}>
                        {parseFloat(row.variance) >= 0 ? "+" : ""}{fmtBs(row.variance)}
                      </td>
                      <td className={`px-4 py-2.5 text-right whitespace-nowrap ${row.pct !== null && row.pct > 100 ? "text-red-600" : "text-zinc-500"}`}>
                        {row.pct !== null ? `${row.pct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
