"use client";
// src/modules/budgets/components/BudgetList.tsx
// Q3-3: Lista de presupuestos + botón crear + selector año.

import { useState, useTransition } from "react";
import { PlusIcon, Trash2Icon, ChevronRightIcon, CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import type { BudgetRow } from "../services/BudgetService";
import type { BudgetStatus } from "@prisma/client";
import { createBudgetAction, deleteBudgetAction, updateBudgetAction } from "../actions/budget.actions";
import { EmptyState } from "@/components/ui/EmptyState";
import { BudgetDetail } from "./BudgetDetail";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<BudgetStatus, string> = {
  DRAFT:  "Borrador",
  ACTIVE: "Activo",
  CLOSED: "Cerrado",
};

const STATUS_COLOR: Record<BudgetStatus, string> = {
  DRAFT:  "bg-zinc-100 text-zinc-600",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CLOSED: "bg-zinc-200 text-zinc-500",
};

const STATUS_ICON: Record<BudgetStatus, React.ReactNode> = {
  DRAFT:  <ClockIcon className="size-3" />,
  ACTIVE: <CheckCircle2Icon className="size-3" />,
  CLOSED: <XCircleIcon className="size-3" />,
};

function fmtBs(amount: string): string {
  const n = parseFloat(amount);
  return isNaN(n) ? "—" : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
  initialBudgets: BudgetRow[];
  canWrite: boolean;
  canDelete: boolean;
  accounts: { id: string; code: string; name: string; type: string }[];
};

export function BudgetList({ companyId, initialBudgets, canWrite, canDelete, accounts }: Props) {
  const [budgets, setBudgets] = useState<BudgetRow[]>(initialBudgets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createYear, setCreateYear] = useState(new Date().getFullYear());
  const [createName, setCreateName] = useState("Presupuesto Anual");
  const [isPending, startTransition] = useTransition();

  const selectedBudget = budgets.find((b) => b.id === selectedId) ?? null;

  function handleCreate() {
    startTransition(async () => {
      const r = await createBudgetAction(companyId, { periodYear: createYear, name: createName });
      if (!r.success) { toast.error(r.error); return; }
      setBudgets((prev) => [r.data, ...prev]);
      setSelectedId(r.data.id);
      setShowCreate(false);
      setCreateName("Presupuesto Anual");
      toast.success("Presupuesto creado");
    });
  }

  function handleDelete(budgetId: string, name: string) {
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
    startTransition(async () => {
      const r = await deleteBudgetAction(companyId, budgetId);
      if (!r.success) { toast.error(r.error); return; }
      setBudgets((prev) => prev.filter((b) => b.id !== budgetId));
      if (selectedId === budgetId) setSelectedId(null);
      toast.success("Presupuesto eliminado");
    });
  }

  function handleActivate(budgetId: string) {
    startTransition(async () => {
      const r = await updateBudgetAction(companyId, budgetId, { status: "ACTIVE" });
      if (!r.success) { toast.error(r.error); return; }
      setBudgets((prev) => prev.map((b) => b.id === budgetId ? r.data : b));
    });
  }

  function handleBudgetUpdate(updated: BudgetRow) {
    setBudgets((prev) => prev.map((b) => b.id === updated.id ? updated : b));
  }

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i);

  return (
    <div className="flex gap-6 min-h-[400px]">
      {/* ── Left panel: list ─────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 space-y-3">
        {canWrite && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <PlusIcon className="size-4" />
            Nuevo presupuesto
          </button>
        )}

        {showCreate && canWrite && (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 space-y-2">
            <p className="text-xs font-medium text-indigo-800">Nuevo presupuesto</p>
            <select
              className="w-full rounded border px-2 py-1.5 text-sm text-zinc-700"
              value={createYear}
              onChange={(e) => setCreateYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <input
              className="w-full rounded border px-2 py-1.5 text-sm"
              placeholder="Nombre"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              maxLength={100}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!createName.trim() || isPending}
                className="flex-1 rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {isPending ? "Creando…" : "Crear"}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded border px-2 py-1 text-xs text-zinc-600"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {budgets.length === 0 ? (
          <EmptyState
            illustration="list"
            title="Sin presupuestos"
            description="Crea tu primer presupuesto anual para comparar con los valores reales."
          />
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border bg-white overflow-hidden">
            {budgets.map((b) => (
              <li
                key={b.id}
                className={`cursor-pointer hover:bg-zinc-50 transition-colors ${selectedId === b.id ? "bg-indigo-50 border-l-2 border-l-indigo-600" : ""}`}
                onClick={() => setSelectedId(selectedId === b.id ? null : b.id)}
              >
                <div className="flex items-start justify-between px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-zinc-900 truncate">{b.name}</span>
                      <ChevronRightIcon className={`size-3 text-zinc-400 shrink-0 transition-transform ${selectedId === b.id ? "rotate-90" : ""}`} />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-zinc-500">{b.periodYear}</span>
                      <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-10 font-medium ${STATUS_COLOR[b.status]}`}>
                        {STATUS_ICON[b.status]}
                        {STATUS_LABEL[b.status]}
                      </span>
                    </div>
                    <p className="text-10 text-zinc-400 mt-0.5">
                      {b.lines.length} cuenta{b.lines.length !== 1 ? "s" : ""} — Bs. {fmtBs(b.totalAmount)}
                    </p>
                  </div>
                  {canWrite && b.status === "DRAFT" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleActivate(b.id); }}
                      disabled={isPending}
                      className="ml-1 shrink-0 text-10 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 whitespace-nowrap"
                      title="Activar presupuesto"
                    >
                      Activar
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(b.id, `${b.name} ${b.periodYear}`); }}
                      disabled={isPending}
                      className="ml-1 shrink-0 text-zinc-300 hover:text-red-500 disabled:opacity-30"
                      title="Eliminar presupuesto"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Right panel: detail ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {selectedBudget ? (
          <BudgetDetail
            companyId={companyId}
            budget={selectedBudget}
            canWrite={canWrite}
            accounts={accounts}
            onBudgetUpdate={handleBudgetUpdate}
          />
        ) : (
          <div className="flex items-center justify-center h-full rounded-lg border border-dashed border-zinc-200 text-zinc-400 text-sm">
            Selecciona un presupuesto para ver sus líneas y comparación con el real
          </div>
        )}
      </div>
    </div>
  );
}
