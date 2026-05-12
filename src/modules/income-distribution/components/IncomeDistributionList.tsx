// @vitest-environment jsdom
// src/modules/income-distribution/components/IncomeDistributionList.tsx
"use client";

import { useState, useTransition } from "react";
import { CheckCircle, Clock, XCircle, ChevronRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IncomeDistributionSummary } from "../services/IncomeDistributionService";
import { applyDistributionAction } from "../actions/income-distribution.actions";
import { VoidDistributionModal } from "./VoidDistributionModal";

const STATUS_CONFIG = {
  DRAFT: { label: "Borrador", icon: Clock, variant: "secondary" as const },
  APPLIED: { label: "Aplicada", icon: CheckCircle, variant: "default" as const },
  VOID: { label: "Anulada", icon: XCircle, variant: "destructive" as const },
};

function fmt(amount: string) {
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    parseFloat(amount)
  );
}

type Props = {
  companyId: string;
  distributions: IncomeDistributionSummary[];
  nextCursor: string | null;
  onRefresh: () => void;
};

export function IncomeDistributionList({ companyId, distributions, nextCursor, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applying, startApply] = useTransition();
  const [voidTarget, setVoidTarget] = useState<IncomeDistributionSummary | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  function handleApply(dist: IncomeDistributionSummary) {
    setApplyError(null);
    startApply(async () => {
      const result = await applyDistributionAction({ distributionId: dist.id, companyId });
      if (!result.success) {
        setApplyError(result.error);
      } else {
        onRefresh();
      }
    });
  }

  if (distributions.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-zinc-500">
        No hay distribuciones registradas. Crea la primera con el botón de arriba.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {applyError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {applyError}
        </div>
      )}

      {distributions.map((dist) => {
        const cfg = STATUS_CONFIG[dist.status];
        const Icon = cfg.icon;
        const isOpen = expanded === dist.id;

        return (
          <div key={dist.id} className="rounded-lg border bg-white dark:bg-zinc-950">
            {/* Header row */}
            <button
              onClick={() => setExpanded(isOpen ? null : dist.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
              <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {dist.referenceNumber ?? "Borrador"}
                  </span>
                  <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                  {dist.currencyCode !== "VES" && (
                    <span className="text-xs text-zinc-500">{dist.currencyCode}</span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {new Date(dist.date).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" })}
                  {" · "}
                  {dist.lines.length} destinatario{dist.lines.length !== 1 ? "s" : ""}
                  {dist.description && ` · ${dist.description}`}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Bs.D {fmt(dist.totalAmountVes)}
                </p>
                {dist.currencyCode !== "VES" && (
                  <p className="text-xs text-zinc-400">{dist.currencyCode} {fmt(dist.totalAmountOriginal)}</p>
                )}
              </div>
              <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>

            {/* Detail panel */}
            {isOpen && (
              <div className="border-t px-4 py-3 space-y-3">
                {/* Lines table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-zinc-500 border-b">
                        <th className="py-1.5 text-left font-medium">Destinatario</th>
                        <th className="py-1.5 text-left font-medium">Cuenta</th>
                        <th className="py-1.5 text-right font-medium">%</th>
                        <th className="py-1.5 text-right font-medium">Monto Bs.D</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dist.lines.map((line) => (
                        <tr key={line.id} className="border-b last:border-0">
                          <td className="py-1.5 text-zinc-700 dark:text-zinc-300">{line.recipientCompanyName}</td>
                          <td className="py-1.5 text-zinc-500">{line.accountCode} — {line.accountName}</td>
                          <td className="py-1.5 text-right text-zinc-700 dark:text-zinc-300">{parseFloat(line.percentageShare).toFixed(2)}%</td>
                          <td className="py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-100">{fmt(line.amountVes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Cuenta origen */}
                <p className="text-xs text-zinc-500">
                  Cuenta origen: <span className="font-medium text-zinc-700">{dist.originAccountCode} — {dist.originAccountName}</span>
                </p>

                {/* Actions */}
                {dist.status === "DRAFT" && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleApply(dist)}
                      disabled={applying}
                      aria-busy={applying}
                      className="gap-1.5"
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      Aplicar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setVoidTarget(dist)}
                      disabled={applying}
                    >
                      Anular
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {nextCursor && (
        <p className="text-center text-xs text-zinc-400 pt-2">
          Hay más registros — implementar paginación si se necesita.
        </p>
      )}

      {voidTarget && (
        <VoidDistributionModal
          companyId={companyId}
          distribution={voidTarget}
          onClose={() => setVoidTarget(null)}
          onSuccess={() => { setVoidTarget(null); onRefresh(); }}
        />
      )}
    </div>
  );
}
