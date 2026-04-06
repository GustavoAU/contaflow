// src/modules/bank-reconciliation/components/ReconciliationWorkbench.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { CheckCircleIcon, ClockIcon, LinkIcon, UnlinkIcon, SearchIcon } from "lucide-react";
import {
  reconcileTransactionAction,
  unreconcileTransactionAction,
  getUnreconciledTransactionsAction,
  getReconciliationSummaryAction,
} from "../actions/banking.actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type MatchedPayment = {
  id: string;
  amount: unknown;
  currency: string;
  method: string;
  date: Date;
  referenceNumber: string | null;
};

type BankTransaction = {
  id: string;
  date: Date;
  description: string;
  type: "CREDIT" | "DEBIT";
  amount: string;
  matchedPaymentId: string | null;
  matchedAt: Date | null;
  matchedBy: string | null;
  isReconciled: boolean;
  matchedPayment: MatchedPayment | null;
};

type BankStatement = {
  id: string;
  bankAccountId: string;
  openingBalance: string;
  closingBalance: string;
  matchedCount: number;
  totalCount: number;
  bankAccount: { id: string; name: string; bankName: string; currency: string };
  transactions: BankTransaction[];
};

type UnreconciledPayment = Record<string, unknown> & {
  id: string;
  amount: string;
  currency: string;
  method: string;
  date: unknown;
  referenceNumber?: string | null;
};

type Summary = {
  total: number;
  reconciled: number;
  pending: number;
  difference: string;
};

type Props = {
  statement: BankStatement;
  companyId: string;
  userId: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmount(value: string | unknown) {
  const str = typeof value === "string" ? value : String(value);
  const n = parseFloat(str);
  if (isNaN(n)) return str;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(value: Date | unknown) {
  try {
    return new Date(value as string).toLocaleDateString("es-VE");
  } catch {
    return "—";
  }
}

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ summary, currency }: { summary: Summary; currency: string }) {
  const differenceNum = parseFloat(summary.difference);
  const diffColor =
    differenceNum === 0
      ? "text-green-700"
      : differenceNum > 0
        ? "text-amber-700"
        : "text-red-700";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border bg-white p-3 text-center">
        <div
          className="text-2xl font-bold tabular-nums text-zinc-900"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {summary.total}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">Total</div>
      </div>
      <div className="rounded-lg border bg-green-50 p-3 text-center">
        <div
          className="text-2xl font-bold tabular-nums text-green-700"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {summary.reconciled}
        </div>
        <div className="mt-0.5 text-xs text-green-600">Conciliadas</div>
      </div>
      <div className="rounded-lg border bg-amber-50 p-3 text-center">
        <div
          className="text-2xl font-bold tabular-nums text-amber-700"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {summary.pending}
        </div>
        <div className="mt-0.5 text-xs text-amber-600">Pendientes</div>
      </div>
      <div className="rounded-lg border bg-zinc-50 p-3 text-center">
        <div
          className={`text-xl font-bold tabular-nums ${diffColor}`}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmtAmount(summary.difference)} {currency}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">Diferencia</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReconciliationWorkbench({ statement, companyId, userId }: Props) {
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [unreconciledPayments, setUnreconciledPayments] = useState<UnreconciledPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Local transaction state (optimistic UI)
  const [transactions, setTransactions] = useState<BankTransaction[]>(statement.transactions);

  const selectedTx = transactions.find((t) => t.id === selectedTxId) ?? null;

  // Load summary on mount
  useEffect(() => {
    async function loadSummary() {
      const result = await getReconciliationSummaryAction({
        bankStatementId: statement.id,
        companyId,
      });
      if (result.success) setSummary(result.data);
    }
    void loadSummary();
  }, [statement.id, companyId]);

  // Load unreconciled payments when a pending transaction is selected
  useEffect(() => {
    if (!selectedTx || selectedTx.isReconciled) return;
    void (async () => {
      setLoadingPayments(true);
      setPaymentsError(null);
      const result = await getUnreconciledTransactionsAction({
        bankAccountId: statement.bankAccountId,
        companyId,
      });
      setLoadingPayments(false);
      if (result.success) {
        setUnreconciledPayments(result.data as UnreconciledPayment[]);
      } else {
        setUnreconciledPayments([]);
        setPaymentsError(result.error);
      }
    })();
  }, [selectedTxId, selectedTx?.isReconciled, statement.bankAccountId, companyId]);

  function handleSelectTx(txId: string) {
    setSelectedTxId((prev) => (prev === txId ? null : txId));
    setActionError(null);
  }

  function handleReconcile(paymentId: string) {
    if (!selectedTxId) return;
    setActionError(null);
    startTransition(async () => {
      const result = await reconcileTransactionAction({
        bankTransactionId: selectedTxId,
        invoicePaymentId: paymentId,
        companyId,
      });
      if (!result.success) {
        setActionError(result.error);
      } else {
        // Optimistic update
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === selectedTxId
              ? { ...t, isReconciled: true, matchedPaymentId: paymentId }
              : t
          )
        );
        setSummary((prev) =>
          prev
            ? { ...prev, reconciled: prev.reconciled + 1, pending: prev.pending - 1 }
            : prev
        );
        setSelectedTxId(null);
      }
    });
  }

  function handleUnreconcile(txId: string) {
    setActionError(null);
    startTransition(async () => {
      const result = await unreconcileTransactionAction({
        bankTransactionId: txId,
        companyId,
      });
      if (!result.success) {
        setActionError(result.error);
      } else {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? { ...t, isReconciled: false, matchedPaymentId: null, matchedPayment: null }
              : t
          )
        );
        setSummary((prev) =>
          prev
            ? { ...prev, reconciled: prev.reconciled - 1, pending: prev.pending + 1 }
            : prev
        );
        if (selectedTxId === txId) setSelectedTxId(null);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      {summary && (
        <SummaryBar summary={summary} currency={statement.bankAccount.currency} />
      )}

      {/* Balances info */}
      <div className="flex flex-wrap gap-4 rounded-lg border bg-zinc-50 px-4 py-3 text-sm">
        <span className="text-zinc-500">
          Saldo inicial:{" "}
          <span
            className="font-mono font-semibold text-zinc-800"
            style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
          >
            {fmtAmount(statement.openingBalance)} {statement.bankAccount.currency}
          </span>
        </span>
        <span className="text-zinc-500">
          Saldo final:{" "}
          <span
            className="font-mono font-semibold text-zinc-800"
            style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
          >
            {fmtAmount(statement.closingBalance)} {statement.bankAccount.currency}
          </span>
        </span>
      </div>

      {/* Global action error */}
      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      )}

      {/* Two-panel layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left panel: transactions */}
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="border-b bg-zinc-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-700">
              Transacciones del extracto
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Selecciona una transacción pendiente para conciliarla
            </p>
          </div>
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400">
              No hay transacciones en este extracto
            </div>
          ) : (
            <ul className="divide-y" role="listbox" aria-label="Transacciones del extracto">
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  role="option"
                  aria-selected={selectedTxId === tx.id}
                  onClick={() => !tx.isReconciled && handleSelectTx(tx.id)}
                  className={[
                    "flex items-start justify-between gap-3 px-4 py-3 text-sm transition-colors",
                    tx.isReconciled
                      ? "bg-green-50 opacity-80"
                      : selectedTxId === tx.id
                        ? "bg-blue-50"
                        : "cursor-pointer hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {tx.isReconciled ? (
                        <CheckCircleIcon
                          className="h-4 w-4 shrink-0 text-green-500"
                          aria-label="Conciliada"
                        />
                      ) : (
                        <ClockIcon
                          className="h-4 w-4 shrink-0 text-amber-400"
                          aria-label="Pendiente"
                        />
                      )}
                      <span className="truncate font-medium text-zinc-800">
                        {tx.description}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 pl-6 text-xs text-zinc-400">
                      <span className="font-mono">{fmtDate(tx.date)}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-medium ${
                          tx.type === "CREDIT"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {tx.type === "CREDIT" ? "Crédito" : "Débito"}
                      </span>
                      {tx.isReconciled && (
                        <span className="text-green-600">Conciliada</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`font-mono font-semibold ${
                        tx.type === "CREDIT" ? "text-green-700" : "text-red-700"
                      }`}
                      style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
                    >
                      {tx.type === "DEBIT" ? "-" : "+"}
                      {fmtAmount(tx.amount)}
                    </span>
                    {tx.isReconciled && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnreconcile(tx.id);
                        }}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label="Desconciliar transacción"
                      >
                        <UnlinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        Desconciliar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right panel: payment matcher */}
        <div className="rounded-lg border bg-white">
          {!selectedTx ? (
            <div className="flex h-full flex-col items-center justify-center p-10 text-center">
              <SearchIcon className="mb-3 h-8 w-8 text-zinc-200" aria-hidden="true" />
              <p className="text-sm text-zinc-400">
                Selecciona una transacción pendiente del panel izquierdo para buscar pagos correspondientes
              </p>
            </div>
          ) : selectedTx.isReconciled ? (
            <div className="p-5">
              <div className="mb-3 border-b pb-3">
                <h3 className="text-sm font-semibold text-zinc-700">Transacción conciliada</h3>
              </div>
              {selectedTx.matchedPayment && (
                <div className="rounded-lg bg-green-50 p-3 text-sm">
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-green-800">
                    <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                    Vinculada con pago
                  </div>
                  <div className="space-y-1 pl-5.5 text-xs text-green-700">
                    <div>
                      Monto:{" "}
                      <span
                        className="font-mono font-semibold"
                        style={{ fontVariantNumeric: "tabular-nums", fontSize: "14px" }}
                      >
                        {fmtAmount(selectedTx.matchedPayment.amount as string)}{" "}
                        {selectedTx.matchedPayment.currency}
                      </span>
                    </div>
                    <div>Método: {selectedTx.matchedPayment.method}</div>
                    <div>Fecha: {fmtDate(selectedTx.matchedPayment.date)}</div>
                    {selectedTx.matchedPayment.referenceNumber && (
                      <div>Ref: {selectedTx.matchedPayment.referenceNumber}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b bg-zinc-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-zinc-700">Pagos disponibles</h3>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Selecciona el pago correspondiente a{" "}
                  <strong>{selectedTx.description}</strong> (
                  {fmtAmount(selectedTx.amount)} {statement.bankAccount.currency})
                </p>
              </div>

              {loadingPayments ? (
                <div className="space-y-2 p-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 animate-pulse rounded-md bg-zinc-100" />
                  ))}
                </div>
              ) : paymentsError ? (
                <p className="p-4 text-sm text-red-600" role="alert">
                  {paymentsError}
                </p>
              ) : unreconciledPayments.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                  <p className="text-sm text-zinc-400">
                    No hay pagos pendientes de conciliación disponibles
                  </p>
                </div>
              ) : (
                <ul className="divide-y overflow-y-auto" role="list">
                  {unreconciledPayments.map((payment) => (
                    <li key={payment.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-800">{payment.method as string}</span>
                            {payment.referenceNumber && (
                              <span className="truncate font-mono text-xs text-zinc-400">
                                {payment.referenceNumber as string}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-400">
                            {fmtDate(payment.date)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span
                            className="font-mono font-semibold text-zinc-800"
                            style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
                          >
                            {fmtAmount(payment.amount)} {payment.currency as string}
                          </span>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleReconcile(payment.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label={`Conciliar con pago ${payment.id}`}
                          >
                            <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            Conciliar
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
