"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CajaCajaBalanceCard } from "./CajaCajaBalanceCard";
import { CajaCajaMovementForm } from "./CajaCajaMovementForm";
import { CajaCajaMovementList } from "./CajaCajaMovementList";
import { closeCajaCajaAction, listMovementsAction } from "../actions/cajachica.actions";
import type { CajaCajaSummary } from "../services/CajaCajaService";
import type { MovementSummary } from "../services/CajaCajaMovementService";

type Account = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  cajas: CajaCajaSummary[];
  accounts: Account[];
  isAdmin: boolean;
  onRefresh: () => void;
};

function CajaRow({
  caja,
  companyId,
  accounts,
  isAdmin,
  onRefresh,
}: {
  caja: CajaCajaSummary;
  companyId: string;
  accounts: Account[];
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();
  const [isClosing, startClose] = useTransition();

  function loadMovements() {
    startLoad(async () => {
      const result = await listMovementsAction(caja.id, companyId);
      if (result.success) {
        setMovements(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    });
  }

  function handleExpand() {
    if (!expanded) loadMovements();
    setExpanded(!expanded);
  }

  function handleClose() {
    setCloseError(null);
    startClose(async () => {
      const result = await closeCajaCajaAction({ cajaCajaId: caja.id, companyId });
      if (!result.success) setCloseError(result.error);
      else onRefresh();
    });
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm dark:bg-zinc-950 overflow-hidden">
      {/* Balance Card */}
      <div
        className="cursor-pointer"
        onClick={handleExpand}
        role="button"
        aria-expanded={expanded}
      >
        <CajaCajaBalanceCard caja={caja} />
      </div>

      {/* Expand toggle */}
      <div className="flex items-center justify-between border-t px-4 py-2">
        <button
          type="button"
          onClick={handleExpand}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {expanded ? "Ocultar" : "Ver movimientos"}
        </button>

        {isAdmin && caja.status === "ACTIVE" && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(!showForm)}
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo gasto
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClose}
              disabled={isClosing}
              aria-busy={isClosing}
              className="text-xs text-zinc-500 hover:text-red-600"
            >
              Cerrar caja
            </Button>
          </div>
        )}
      </div>

      {closeError && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {closeError}
        </div>
      )}

      {/* Form */}
      {showForm && expanded && (
        <div className="border-t px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Registrar Gasto
          </h4>
          <CajaCajaMovementForm
            companyId={companyId}
            cajaCajaId={caja.id}
            accounts={accounts}
            onSuccess={() => { setShowForm(false); loadMovements(); onRefresh(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Movements */}
      {expanded && (
        <div className="border-t px-4 py-4">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-zinc-400">Cargando...</p>
          ) : loadError ? (
            <p className="text-xs text-red-600">{loadError}</p>
          ) : (
            <CajaCajaMovementList
              companyId={companyId}
              movements={movements}
              isAdmin={isAdmin}
              onRefresh={loadMovements}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function CajaCajaList({ companyId, cajas, accounts, isAdmin, onRefresh }: Props) {
  if (cajas.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-zinc-500">
          No hay Cajas Chicas creadas.{" "}
          {isAdmin && "Crea una con el botón de arriba."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {cajas.map((caja) => (
        <CajaRow
          key={caja.id}
          caja={caja}
          companyId={companyId}
          accounts={accounts}
          isAdmin={isAdmin}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
