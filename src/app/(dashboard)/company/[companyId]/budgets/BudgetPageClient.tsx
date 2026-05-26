"use client";
// src/app/(dashboard)/company/[companyId]/budgets/BudgetPageClient.tsx
// Q3-3: Tab container — Presupuestos | Proyección de Flujo de Caja.

import { useState } from "react";
import { BookOpenIcon, TrendingUpIcon } from "lucide-react";
import type { BudgetRow, CashFlowProjection } from "@/modules/budgets/services/BudgetService";
import { BudgetList } from "@/modules/budgets/components/BudgetList";
import { CashFlowWidget } from "@/modules/budgets/components/CashFlowWidget";

type Props = {
  companyId: string;
  initialBudgets: BudgetRow[];
  initialCashFlow: CashFlowProjection;
  accounts: { id: string; code: string; name: string; type: string }[];
  canWrite: boolean;
  canDelete: boolean;
};

type Tab = "budgets" | "cashflow";

export function BudgetPageClient({
  companyId, initialBudgets, initialCashFlow, accounts, canWrite, canDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>("budgets");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Presupuestos y Proyecciones</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Define presupuestos anuales por cuenta y monitorea la ejecución presupuestaria.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setTab("budgets")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "budgets"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          <BookOpenIcon className="size-4" />
          Presupuestos
        </button>
        <button
          onClick={() => setTab("cashflow")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "cashflow"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-zinc-500 hover:text-zinc-700"
          }`}
        >
          <TrendingUpIcon className="size-4" />
          Flujo de Caja
        </button>
      </div>

      {tab === "budgets" && (
        <BudgetList
          companyId={companyId}
          initialBudgets={initialBudgets}
          canWrite={canWrite}
          canDelete={canDelete}
          accounts={accounts}
        />
      )}

      {tab === "cashflow" && (
        <CashFlowWidget
          companyId={companyId}
          initial={initialCashFlow}
        />
      )}
    </div>
  );
}
