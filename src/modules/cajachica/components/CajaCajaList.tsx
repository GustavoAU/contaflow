"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CajaCajaBalanceCard } from "./CajaCajaBalanceCard";
import { CajaCajaMovementForm } from "./CajaCajaMovementForm";
import { CajaCajaMovementList } from "./CajaCajaMovementList";
import { CajaCajaDepositForm } from "./CajaCajaDepositForm";
import { CajaCajaDepositList } from "./CajaCajaDepositList";
import { CajaCajaReimbursementForm } from "./CajaCajaReimbursementForm";
import { CajaCajaReimbursementList } from "./CajaCajaReimbursementList";
import { CajaCajaExportButtons } from "./CajaCajaExportButtons";
import {
  closeCajaCajaAction,
  assignCustodianAction,
  listMovementsAction,
  listDepositsAction,
  listReimbursementsAction,
} from "../actions/cajachica.actions";
import type { CajaCajaSummary } from "../services/CajaCajaService";
import type { MovementSummary } from "../services/CajaCajaMovementService";
import type { DepositSummary } from "../services/CajaCajaDepositService";
import type { ReimbursementSummary } from "../services/CajaCajaReimbursementService";

type Account = { id: string; code: string; name: string; type: string };
type Employee = { id: string; name: string; status: string };

type Props = {
  companyId: string;
  cajas: CajaCajaSummary[];
  accounts: Account[];
  employees: Employee[];
  isAdmin: boolean;
  onRefresh: () => void;
};

// ─── Asignar / cambiar custodio (form inline) ──────────────────────────────────

function AssignCustodianControl({
  caja,
  companyId,
  employees,
  onAssigned,
}: {
  caja: CajaCajaSummary;
  companyId: string;
  employees: Employee[];
  onAssigned: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [custodianId, setCustodianId] = useState(caja.custodianId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  // Preferir empleados activos; conservar el custodio actual aunque ya no esté activo
  // para no perderlo del select de edición.
  const activeEmployees = employees.filter((e) => e.status === "ACTIVE");
  const options =
    caja.custodianId && !activeEmployees.some((e) => e.id === caja.custodianId)
      ? [
          ...activeEmployees,
          ...employees.filter((e) => e.id === caja.custodianId),
        ]
      : activeEmployees;

  function open() {
    setCustodianId(caja.custodianId ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function handleSave() {
    setError(null);
    start(async () => {
      const result = await assignCustodianAction({
        cajaCajaId: caja.id,
        companyId,
        custodianId,
      });
      if (!result.success) {
        setError(result.error);
      } else {
        setEditing(false);
        onAssigned();
      }
    });
  }

  if (!editing) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={open}
        className="gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        <UserCog className="h-3.5 w-3.5" aria-hidden />
        {caja.custodianId ? "Cambiar custodio" : "Asignar custodio"}
      </Button>
    );
  }

  const selectId = `assign-custodian-${caja.id}`;

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg border bg-zinc-50 p-3 dark:bg-zinc-900">
      <div className="space-y-1">
        <Label htmlFor={selectId} className="text-xs">
          {caja.custodianId ? "Cambiar custodio responsable" : "Asignar custodio responsable"}
        </Label>
        <select
          id={selectId}
          value={custodianId}
          onChange={(e) => setCustodianId(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isPending || options.length === 0}
        >
          <option value="">Seleccionar empleado...</option>
          {options.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
              {emp.status !== "ACTIVE" ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
        {options.length === 0 && (
          <p className="text-xs text-amber-600">
            No hay empleados activos. Registra o activa un empleado para asignarlo como custodio.
          </p>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || !custodianId || custodianId === caja.custodianId}
          aria-busy={isPending}
        >
          Guardar
        </Button>
        <Button size="sm" variant="outline" onClick={cancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Cierre con liquidación (AlertDialog) — HC-05/06 ───────────────────────────

function CloseCajaDialog({
  caja,
  companyId,
  accounts,
  onClosed,
}: {
  caja: CajaCajaSummary;
  companyId: string;
  accounts: Account[];
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [returnAccountId, setReturnAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isClosing, startClose] = useTransition();

  // Cuenta de retorno: solo Activo y distinta de la propia cuenta de la caja.
  const returnAccounts = accounts.filter(
    (a) => a.type === "ASSET" && a.id !== caja.accountId,
  );

  function handleConfirm() {
    setError(null);
    startClose(async () => {
      const result = await closeCajaCajaAction({
        cajaCajaId: caja.id,
        companyId,
        returnAccountId,
      });
      if (!result.success) {
        setError(result.error);
      } else {
        setOpen(false);
        onClosed();
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs text-zinc-500 hover:text-red-600"
        >
          Cerrar caja
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cerrar caja chica</AlertDialogTitle>
          <AlertDialogDescription>
            Al cerrar la caja se generará el asiento de liquidación que devuelve el efectivo
            remanente a la cuenta de Activo que selecciones. Esta acción no puede revertirse desde
            la aplicación.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={`return-account-${caja.id}`} className="text-xs">
            Cuenta de retorno del efectivo (Activo) *
          </Label>
          <select
            id={`return-account-${caja.id}`}
            value={returnAccountId}
            onChange={(e) => setReturnAccountId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            disabled={isClosing || returnAccounts.length === 0}
          >
            <option value="">Seleccionar cuenta...</option>
            {returnAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          {returnAccounts.length === 0 && (
            <p className="text-xs text-amber-600">
              No hay otra cuenta de tipo Activo disponible para recibir el efectivo. Crea una en el
              Plan de Cuentas antes de cerrar la caja.
            </p>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClosing}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={isClosing || !returnAccountId}
            aria-busy={isClosing}
          >
            Cerrar caja
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CajaRow({
  caja,
  companyId,
  accounts,
  employees,
  isAdmin,
  onRefresh,
}: {
  caja: CajaCajaSummary;
  companyId: string;
  accounts: Account[];
  employees: Employee[];
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showReimbForm, setShowReimbForm] = useState(false);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [deposits, setDeposits] = useState<DepositSummary[]>([]);
  const [reimbursements, setReimbursements] = useState<ReimbursementSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [depositLoadError, setDepositLoadError] = useState<string | null>(null);
  const [reimbLoadError, setReimbLoadError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();
  const [isLoadingDeposits, startLoadDeposits] = useTransition();
  const [isLoadingReimb, startLoadReimb] = useTransition();

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

  function loadDeposits() {
    startLoadDeposits(async () => {
      const result = await listDepositsAction(caja.id, companyId);
      if (result.success) {
        setDeposits(result.data);
        setDepositLoadError(null);
      } else {
        setDepositLoadError(result.error);
      }
    });
  }

  function loadReimbursements() {
    startLoadReimb(async () => {
      const result = await listReimbursementsAction(caja.id, companyId);
      if (result.success) {
        setReimbursements(result.data);
        setReimbLoadError(null);
      } else {
        setReimbLoadError(result.error);
      }
    });
  }

  function handleExpand() {
    if (!expanded) {
      loadMovements();
      loadDeposits();
      loadReimbursements();
    }
    setExpanded(!expanded);
  }

  const canManageCustodian = isAdmin && caja.status !== "CLOSED";

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

      {/* Custodian management */}
      {canManageCustodian && (
        <div className="border-t px-4 py-2">
          <AssignCustodianControl
            caja={caja}
            companyId={companyId}
            employees={employees}
            onAssigned={onRefresh}
          />
        </div>
      )}

      {/* Expand toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
        <button
          type="button"
          onClick={handleExpand}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {expanded ? "Ocultar" : "Ver movimientos"}
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export (arqueo) — visible para cualquier usuario que ya ve la caja */}
          <CajaCajaExportButtons cajaCajaId={caja.id} companyId={companyId} />

          {isAdmin && caja.status === "ACTIVE" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!expanded) handleExpand();
                  setShowDepositForm((v) => !v);
                  setShowForm(false);
                  setShowReimbForm(false);
                }}
                className="gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Depositar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!expanded) handleExpand();
                  setShowReimbForm((v) => !v);
                  setShowForm(false);
                  setShowDepositForm(false);
                }}
                className="gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo reembolso
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!expanded) handleExpand();
                  setShowForm((v) => !v);
                  setShowDepositForm(false);
                  setShowReimbForm(false);
                }}
                className="gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo gasto
              </Button>
              <CloseCajaDialog
                caja={caja}
                companyId={companyId}
                accounts={accounts}
                onClosed={onRefresh}
              />
            </>
          )}
        </div>
      </div>

      {/* Deposit form */}
      {showDepositForm && expanded && (
        <div className="border-t px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Registrar Depósito (reposición de fondo)
          </h4>
          <CajaCajaDepositForm
            companyId={companyId}
            cajaCajaId={caja.id}
            cajaAccountId={caja.accountId}
            currency={caja.currency}
            accounts={accounts}
            onSuccess={() => { setShowDepositForm(false); loadDeposits(); onRefresh(); }}
            onCancel={() => setShowDepositForm(false)}
          />
        </div>
      )}

      {/* Reimbursement form */}
      {showReimbForm && expanded && (
        <div className="border-t px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Nuevo Reembolso (reposición de fondo)
          </h4>
          <CajaCajaReimbursementForm
            companyId={companyId}
            cajaCajaId={caja.id}
            onSuccess={() => { setShowReimbForm(false); loadReimbursements(); onRefresh(); }}
            onCancel={() => setShowReimbForm(false)}
          />
        </div>
      )}

      {/* Movement form */}
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

      {/* Reimbursements */}
      {expanded && (
        <div className="border-t px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Reembolsos (reposición de fondo)
          </h4>
          {isLoadingReimb ? (
            <p className="py-4 text-center text-sm text-zinc-400">Cargando...</p>
          ) : reimbLoadError ? (
            <p className="text-xs text-red-600">{reimbLoadError}</p>
          ) : (
            <CajaCajaReimbursementList
              companyId={companyId}
              reimbursements={reimbursements}
              isAdmin={isAdmin}
              onRefresh={() => { loadReimbursements(); onRefresh(); }}
            />
          )}
        </div>
      )}

      {/* Deposits */}
      {expanded && (
        <div className="border-t px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Depósitos
          </h4>
          {isLoadingDeposits ? (
            <p className="py-4 text-center text-sm text-zinc-400">Cargando...</p>
          ) : depositLoadError ? (
            <p className="text-xs text-red-600">{depositLoadError}</p>
          ) : (
            <CajaCajaDepositList
              companyId={companyId}
              deposits={deposits}
              currency={caja.currency}
              isAdmin={isAdmin}
              onRefresh={() => { loadDeposits(); onRefresh(); }}
            />
          )}
        </div>
      )}

      {/* Movements */}
      {expanded && (
        <div className="border-t px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Movimientos (gastos)
          </h4>
          {isLoading ? (
            <p className="py-4 text-center text-sm text-zinc-400">Cargando...</p>
          ) : loadError ? (
            <p className="text-xs text-red-600">{loadError}</p>
          ) : (
            <CajaCajaMovementList
              companyId={companyId}
              movements={movements}
              isAdmin={isAdmin}
              // HC-11: refrescar también el resumen de la caja (saldo Comprometido/
              // Disponible de la tarjeta), no solo la lista de movimientos.
              onRefresh={() => { loadMovements(); onRefresh(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function CajaCajaList({ companyId, cajas, accounts, employees, isAdmin, onRefresh }: Props) {
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
          employees={employees}
          isAdmin={isAdmin}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
