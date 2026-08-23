"use client";
// src/modules/payroll/components/LoanTable.tsx
// Tabla de préstamos con flujo aprobación: PENDING → ADMIN aprueba/rechaza → ACTIVE.
//
// Punto 10 del handoff de UI. Dos scopes:
//   "company"  → /payroll/loans, con columna EMPLEADO
//   "employee" → tab Préstamos de un empleado, con KPIs y columna CONCEPTO

import { useState, useTransition } from "react";
import { Loader2Icon, PlusIcon, MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { cancelLoanAction, approveLoanAction, rejectLoanAction } from "../actions/employee-loan.actions";
import CreateLoanForm from "./CreateLoanForm";
import type { EmployeeLoanRow } from "../services/EmployeeLoanService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyBadge, type ExchangeRateInfo } from "@/components/ui/MoneyBadge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EmployeeOption { id: string; name: string }

interface Props {
  companyId: string;
  initialLoans: EmployeeLoanRow[];
  employees: EmployeeOption[];
  isAdmin: boolean; // ADMIN_ONLY — puede aprobar/rechazar/cancelar
  scope?: "company" | "employee";
  /** Tasa BCV para el equivalente en la otra moneda. */
  exchangeRate?: ExchangeRateInfo;
  /** Acción extra en la cabecera de la tarjeta (p.ej. importar saldos). */
  headerSlot?: React.ReactNode;
}

// ─── Montos ───────────────────────────────────────────────────────────────────
// Un préstamo en USD guarda 0 en las columnas VES y el valor real en las USD
// (EmployeeLoanService.create). Renderizar una sola de las dos ramas dejaba la
// celda EN BLANCO cuando la que tocaba venía nula. Esto no puede devolver vacío:
// en el peor caso MoneyBadge recibe un valor no numérico y pinta "—".
type MoneyField = "total" | "installment" | "remaining";

const FIELDS: Record<MoneyField, { ves: keyof EmployeeLoanRow; usd: keyof EmployeeLoanRow }> = {
  total:       { ves: "totalAmount",       usd: "amountUsd" },
  installment: { ves: "installmentAmount", usd: "installmentAmountUsd" },
  remaining:   { ves: "remainingBalance",  usd: "remainingBalanceUsd" },
};

function moneyParts(loan: EmployeeLoanRow, field: MoneyField): Array<{ amount: string; currency: string }> {
  const { ves, usd } = FIELDS[field];
  const vesVal = loan[ves] as string | null;
  const usdVal = loan[usd] as string | null;
  const parts: Array<{ amount: string; currency: string }> = [];

  const nonZero = (v: string | null) => v != null && v !== "" && Number(v) !== 0;

  if (loan.currency !== "USD" && nonZero(vesVal)) parts.push({ amount: vesVal!, currency: "VES" });
  if (nonZero(usdVal)) parts.push({ amount: usdVal!, currency: "USD" });

  if (parts.length === 0) {
    // Ninguna rama trae valor util — se muestra el que exista, aunque sea cero.
    parts.push({
      amount: (loan.currency === "USD" ? usdVal : vesVal) ?? vesVal ?? usdVal ?? "",
      currency: loan.currency === "USD" ? "USD" : "VES",
    });
  }
  return parts;
}

function Money({
  loan, field, rate, showEquivalent = true, className,
}: {
  loan: EmployeeLoanRow; field: MoneyField; rate?: ExchangeRateInfo;
  showEquivalent?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      {moneyParts(loan, field).map((p, i) => (
        <MoneyBadge
          key={i}
          amount={p.amount}
          currency={p.currency}
          exchangeRate={showEquivalent ? rate : undefined}
          align="right"
          className="justify-end text-xs"
        />
      ))}
    </div>
  );
}

// ─── Concepto ─────────────────────────────────────────────────────────────────
function currencyLabel(currency: string) {
  return currency === "MIXED" ? "Mixto" : currency === "USD" ? "USD" : "Bs.";
}

function formatDate(value: string) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-VE");
}

export default function LoanTable({
  companyId, initialLoans, employees, isAdmin,
  scope = "company", exchangeRate, headerSlot,
}: Props) {
  const [loans, setLoans] = useState(initialLoans);
  const [showForm, setShowForm] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [cancelling, setCancelling] = useState<EmployeeLoanRow | null>(null);
  const [, startTransition] = useTransition();

  const isEmployeeScope = scope === "employee";

  function handleCreated(loan: EmployeeLoanRow) {
    setLoans((prev) => [loan, ...prev]);
    setShowForm(false);
  }

  function handleApprove(loanId: string) {
    setActionId(loanId);
    startTransition(async () => {
      const result = await approveLoanAction(companyId, loanId);
      if (result.success) {
        toast.success("Préstamo aprobado. Se descontará en la próxima nómina.");
        setLoans((prev) => prev.map((l) => l.id === loanId ? { ...l, ...result.data } : l));
      } else {
        toast.error(result.error);
      }
      setActionId(null);
    });
  }

  function handleRejectSubmit(loanId: string) {
    if (!rejectionReason.trim()) { toast.error("Ingrese el motivo de rechazo."); return; }
    setActionId(loanId);
    startTransition(async () => {
      const result = await rejectLoanAction(companyId, loanId, { rejectionReason });
      if (result.success) {
        toast.success("Préstamo rechazado.");
        setLoans((prev) => prev.map((l) => l.id === loanId ? { ...l, ...result.data } : l));
        setRejectingId(null);
        setRejectionReason("");
      } else {
        toast.error(result.error);
      }
      setActionId(null);
    });
  }

  function handleCancelConfirm() {
    const loan = cancelling;
    if (!loan) return;
    setActionId(loan.id);
    startTransition(async () => {
      const result = await cancelLoanAction(companyId, loan.id);
      if (result.success) {
        toast.success("Préstamo cancelado.");
        setLoans((prev) => prev.map((l) => l.id === loan.id ? { ...l, status: "CANCELLED" as const } : l));
      } else {
        toast.error(result.error);
      }
      setActionId(null);
      setCancelling(null);
    });
  }

  const solicitar = (
    <Button onClick={() => setShowForm((v) => !v)}>
      <PlusIcon />
      Solicitar préstamo
    </Button>
  );

  return (
    <div className="space-y-4">
      {isEmployeeScope && <LoanKpis loans={loans} exchangeRate={exchangeRate} />}

      {showForm && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-700">Nuevo préstamo</h3>
          <CreateLoanForm companyId={companyId} employees={employees}
            onCreated={handleCreated} onCancel={() => setShowForm(false)} />
        </Card>
      )}

      {/* Motivo de rechazo — requiere texto, por eso no cabe en un AlertDialog */}
      {rejectingId && (
        <Card className="border-red-200 bg-red-50 p-4 gap-3">
          <p className="text-sm font-semibold text-red-800">Motivo de rechazo</p>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Describa el motivo…"
            className="w-full rounded-md border border-red-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm"
              onClick={() => { setRejectingId(null); setRejectionReason(""); }}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm"
              onClick={() => handleRejectSubmit(rejectingId)}
              disabled={actionId === rejectingId}
              aria-busy={actionId === rejectingId}>
              {actionId === rejectingId && <Loader2Icon className="animate-spin" />}
              Confirmar rechazo
            </Button>
          </div>
        </Card>
      )}

      {loans.length === 0 ? (
        <Card>
          <EmptyState
            illustration="list"
            title="Sin préstamos registrados"
            description="Los préstamos aprobados se descuentan automáticamente en cada proceso de nómina."
            action={{ label: "Solicitar préstamo", onClick: () => setShowForm(true), Icon: PlusIcon }}
          />
        </Card>
      ) : (
        <Card flush>
          {/* Cabecera de la tarjeta: las acciones viven aquí, no en una banda
              vacía encima de la tabla. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-800">Préstamos</span>
              <Badge variant="secondary">{loans.length}</Badge>
            </div>
            <div className="flex gap-2">
              {headerSlot}
              {solicitar}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold text-zinc-500 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    {isEmployeeScope ? "Concepto" : "Empleado"}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">Monto</th>
                  <th scope="col" className="px-4 py-3 text-center">Cuotas</th>
                  <th scope="col" className="px-4 py-3 text-right">Cuota</th>
                  <th scope="col" className="px-4 py-3 text-right">Saldo</th>
                  <th scope="col" className="px-4 py-3 text-left">Estado</th>
                  {/* La columna de acciones necesita su th aunque el label vaya
                      oculto: sin él el menú flota sin ancho reservado. */}
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => {
                  const busy = actionId === loan.id;
                  const progress = loan.installments > 0
                    ? Math.min(100, Math.round((loan.paidInstallments / loan.installments) * 100))
                    : 0;

                  return (
                    <tr key={loan.id} className="border-t hover:bg-zinc-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-zinc-900">
                          {isEmployeeScope
                            ? (loan.description || "Préstamo personal")
                            : loan.employeeName}
                        </p>
                        <p className="mt-0.5 text-11 text-zinc-400">
                          {[
                            currencyLabel(loan.currency),
                            `otorgado ${formatDate(loan.createdAt)}`,
                            loan.interestRate
                              ? `${(parseFloat(loan.interestRate) * 100).toFixed(1)}% anual`
                              : "sin intereses",
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <Money loan={loan} field="total" rate={exchangeRate} />
                      </td>

                      <td className="px-4 py-2.5 text-center">
                        <span className="tabular-nums text-xs text-zinc-600">
                          {loan.paidInstallments} / {loan.installments}
                        </span>
                        <span
                          className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-zinc-200"
                          role="progressbar"
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${loan.paidInstallments} de ${loan.installments} cuotas pagadas`}
                        >
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                        </span>
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        {/* Sin equivalente: la cuota ya se lee junto al saldo */}
                        <Money loan={loan} field="installment" showEquivalent={false} />
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <Money loan={loan} field="remaining" rate={exchangeRate} className="font-semibold" />
                      </td>

                      <td className="px-4 py-2.5">
                        <StatusBadge status={loan.status} />
                        {loan.status === "REJECTED" && loan.rejectionReason && (
                          <p className="mt-0.5 max-w-28 truncate text-11 text-red-500">{loan.rejectionReason}</p>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        {isAdmin && (
                          <div className="flex items-center justify-end gap-1">
                            {loan.status === "PENDING" && (
                              <Button variant="ghost" size="sm"
                                onClick={() => handleApprove(loan.id)}
                                disabled={busy} aria-busy={busy}>
                                {busy && <Loader2Icon className="animate-spin" />}
                                Aprobar
                              </Button>
                            )}
                            {(loan.status === "PENDING" || loan.status === "ACTIVE") && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label="Más acciones">
                                    <MoreHorizontalIcon />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {loan.status === "PENDING" && (
                                    <DropdownMenuItem onSelect={() => setRejectingId(loan.id)}>
                                      Rechazar solicitud
                                    </DropdownMenuItem>
                                  )}
                                  {loan.status === "ACTIVE" && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => setCancelling(loan)}
                                      >
                                        Cancelar préstamo
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Cancelar es destructivo: AlertDialog en vez de window.confirm */}
      <AlertDialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este préstamo?</AlertDialogTitle>
            <AlertDialogDescription>
              El saldo restante deja de cobrarse en nómina. La operación queda en la
              auditoría y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => { e.preventDefault(); handleCancelConfirm(); }}
              disabled={!!actionId}
              aria-busy={!!actionId}
            >
              {actionId && <Loader2Icon className="animate-spin" />}
              Cancelar préstamo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── KPIs (solo scope="employee") ─────────────────────────────────────────────
// Responden la pregunta con la que el usuario abre el tab: cuánto debe, cuánto
// se le descuenta este mes, y cuántos préstamos tiene vivos.
function LoanKpis({ loans, exchangeRate }: { loans: EmployeeLoanRow[]; exchangeRate?: ExchangeRateInfo }) {
  const active = loans.filter((l) => l.status === "ACTIVE");

  // Se suman por moneda, nunca entre monedas: mezclar Bs. y USD en un total es
  // exactamente el error que el sistema evita en todo el resto de la app.
  //
  // Suma sobre moneyParts, la MISMA funcion que pinta la tabla. Tener aqui una
  // segunda lectura de los campos era un fallo: la fila mostraba el monto y el
  // KPI mostraba "—" para el mismo prestamo, porque solo una de las dos tenia
  // el fallback para filas con la moneda en la columna que no toca (asi las
  // escribe seed-demo-tesa.ts).
  const sum = (rows: EmployeeLoanRow[], field: MoneyField) => {
    let ves = 0, usd = 0;
    for (const r of rows) {
      for (const part of moneyParts(r, field)) {
        const n = Number(part.amount) || 0;
        if (part.currency === "USD") usd += n; else ves += n;
      }
    }
    return { ves, usd };
  };

  const balance = sum(active, "remaining");
  const quota = sum(active, "installment");

  const nextDue = active.length > 0 ? active[0] : null;

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      <Kpi
        label="Saldo total pendiente"
        value={
          <MoneyStack ves={balance.ves} usd={balance.usd} exchangeRate={exchangeRate} />
        }
        note={active.length === 0 ? "Sin préstamos activos" : undefined}
      />
      <Kpi
        label="Deducción del período"
        value={<MoneyStack ves={quota.ves} usd={quota.usd} exchangeRate={exchangeRate} />}
        note="Se descuenta en la próxima nómina aprobada"
      />
      <Kpi
        label="Préstamos activos"
        value={<span className="text-2xl font-semibold tracking-tight">{active.length}</span>}
        note={
          nextDue
            ? `Cuota ${nextDue.paidInstallments + 1} de ${nextDue.installments}`
            : undefined
        }
      />
    </div>
  );
}

function MoneyStack({ ves, usd, exchangeRate }: { ves: number; usd: number; exchangeRate?: ExchangeRateInfo }) {
  if (ves === 0 && usd === 0) {
    return <span className="text-2xl font-semibold tracking-tight text-zinc-300">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-2xl font-semibold tracking-tight">
      {usd > 0 && <MoneyBadge amount={usd} currency="USD" exchangeRate={exchangeRate} align="left" />}
      {ves > 0 && <MoneyBadge amount={ves} currency="VES" exchangeRate={exchangeRate} align="left" />}
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <Card className="gap-1 px-4 py-3.5">
      <p className="text-11 text-zinc-400">{label}</p>
      {value}
      {note && <p className="text-11 text-zinc-400">{note}</p>}
    </Card>
  );
}
