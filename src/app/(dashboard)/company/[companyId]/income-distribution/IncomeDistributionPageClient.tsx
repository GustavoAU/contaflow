// src/app/(dashboard)/company/[companyId]/income-distribution/IncomeDistributionPageClient.tsx
"use client";

import { useState, useCallback, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IncomeDistributionForm } from "@/modules/income-distribution/components/IncomeDistributionForm";
import { IncomeDistributionList } from "@/modules/income-distribution/components/IncomeDistributionList";
import { listDistributionsAction } from "@/modules/income-distribution/actions/income-distribution.actions";
import type { IncomeDistributionSummary } from "@/modules/income-distribution/services/IncomeDistributionService";

type Account = { id: string; code: string; name: string; type: string };
type Company = { id: string; name: string };

type Props = {
  companyId: string;
  accounts: Account[];
  companies: Company[];
};

export function IncomeDistributionPageClient({ companyId, accounts, companies }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [distributions, setDistributions] = useState<IncomeDistributionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();

  const load = useCallback(() => {
    startLoad(async () => {
      const result = await listDistributionsAction(companyId);
      if (result.success) {
        setDistributions(result.data.distributions);
        setNextCursor(result.data.nextCursor);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    });
  }, [companyId]);

  // Load on mount
  useState(() => { load(); });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Distribución de Ingresos
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Distribuye un ingreso entre múltiples destinatarios a porcentajes fijos (ADR-023).
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nueva distribución
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border bg-white p-5 dark:bg-zinc-950 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nueva distribución
          </h2>
          <IncomeDistributionForm
            companyId={companyId}
            accounts={accounts}
            companies={companies}
            onSuccess={() => { setShowForm(false); load(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Error loading */}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-zinc-400">Cargando...</div>
      ) : (
        <IncomeDistributionList
          companyId={companyId}
          distributions={distributions}
          nextCursor={nextCursor}
          onRefresh={load}
        />
      )}
    </div>
  );
}
