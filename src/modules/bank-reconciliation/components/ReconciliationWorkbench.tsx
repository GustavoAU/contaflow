// src/modules/bank-reconciliation/components/ReconciliationWorkbench.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import {
  CheckCircleIcon,
  ClockIcon,
  LinkIcon,
  UnlinkIcon,
  SearchIcon,
  FileTextIcon,
  CreditCardIcon,
  ReceiptIcon,
} from "lucide-react";
import {
  matchBankTransactionAction,
  unreconcileTransactionAction,
  getUnreconciledTransactionsAction,
  getReconciliationSummaryAction,
  searchJournalEntriesAction,
  searchPaymentRecordsAction,
} from "../actions/banking.actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type MatchType = "INVOICE_PAYMENT" | "JOURNAL_ENTRY" | "PAYMENT_RECORD";

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
  matchedTransactionId: string | null;
  matchedPaymentRecordId: string | null;
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

type InvoicePaymentItem = Record<string, unknown> & {
  id: string;
  amount: string;
  currency: string;
  method: string;
  date: unknown;
  referenceNumber?: string | null;
};

type JournalEntryItem = {
  id: string;
  number: string;
  date: string;
  description: string;
};

type PaymentRecordItem = {
  id: string;
  method: string;
  amountVes: string;
  currency: string;
  amountOriginal: string | null;
  referenceNumber: string | null;
  date: string;
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

function fmtDate(value: Date | string | unknown) {
  try {
    return new Date(value as string).toLocaleDateString("es-VE");
  } catch {
    return "—";
  }
}

function getMatchLabel(tx: BankTransaction): string {
  if (tx.matchedPaymentId) return "Pago de factura";
  if (tx.matchedTransactionId) return "Asiento contable";
  if (tx.matchedPaymentRecordId) return "Pago digital";
  return "";
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
        <div className="text-2xl font-bold tabular-nums text-zinc-900" style={{ fontVariantNumeric: "tabular-nums" }}>
          {summary.total}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">Total</div>
      </div>
      <div className="rounded-lg border bg-green-50 p-3 text-center">
        <div className="text-2xl font-bold tabular-nums text-green-700" style={{ fontVariantNumeric: "tabular-nums" }}>
          {summary.reconciled}
        </div>
        <div className="mt-0.5 text-xs text-green-600">Conciliadas</div>
      </div>
      <div className="rounded-lg border bg-amber-50 p-3 text-center">
        <div className="text-2xl font-bold tabular-nums text-amber-700" style={{ fontVariantNumeric: "tabular-nums" }}>
          {summary.pending}
        </div>
        <div className="mt-0.5 text-xs text-amber-600">Pendientes</div>
      </div>
      <div className="rounded-lg border bg-zinc-50 p-3 text-center">
        <div className={`text-xl font-bold tabular-nums ${diffColor}`} style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtAmount(summary.difference)} {currency}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">Diferencia</div>
      </div>
    </div>
  );
}

// ─── Match type tabs ──────────────────────────────────────────────────────────

const MATCH_TABS: { type: MatchType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "INVOICE_PAYMENT", label: "Pago de Factura", icon: ReceiptIcon },
  { type: "JOURNAL_ENTRY", label: "Asiento Contable", icon: FileTextIcon },
  { type: "PAYMENT_RECORD", label: "Pago Digital", icon: CreditCardIcon },
];

// ─── Main component ───────────────────────────────────────────────────────────

export function ReconciliationWorkbench({ statement, companyId }: Props) {
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<MatchType>("INVOICE_PAYMENT");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Local transaction state (optimistic UI)
  const [transactions, setTransactions] = useState<BankTransaction[]>(statement.transactions);
  const selectedTx = transactions.find((t) => t.id === selectedTxId) ?? null;

  // ── INVOICE_PAYMENT state
  const [invoicePayments, setInvoicePayments] = useState<InvoicePaymentItem[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);

  // ── JOURNAL_ENTRY state
  const [journalQuery, setJournalQuery] = useState("");
  const [journalEntries, setJournalEntries] = useState<JournalEntryItem[]>([]);
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  // ── PAYMENT_RECORD state
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecordItem[]>([]);
  const [loadingPaymentRecords, setLoadingPaymentRecords] = useState(false);
  const [paymentRecordsError, setPaymentRecordsError] = useState<string | null>(null);

  // Load summary on mount
  useEffect(() => {
    async function loadSummary() {
      const result = await getReconciliationSummaryAction({ bankStatementId: statement.id, companyId });
      if (result.success) setSummary(result.data);
    }
    void loadSummary();
  }, [statement.id, companyId]);

  // Load INVOICE_PAYMENT candidates when tab is active and tx is selected
  useEffect(() => {
    if (!selectedTx || selectedTx.isReconciled || matchType !== "INVOICE_PAYMENT") return;
    void (async () => {
      setLoadingPayments(true);
      setPaymentsError(null);
      const result = await getUnreconciledTransactionsAction({ bankAccountId: statement.bankAccountId, companyId });
      setLoadingPayments(false);
      if (result.success) {
        setInvoicePayments(result.data as InvoicePaymentItem[]);
      } else {
        setInvoicePayments([]);
        setPaymentsError(result.error);
      }
    })();
  }, [selectedTxId, selectedTx, matchType, statement.bankAccountId, companyId]);

  // Load JOURNAL_ENTRY candidates when tab is active and tx is selected
  useEffect(() => {
    if (!selectedTx || selectedTx.isReconciled || matchType !== "JOURNAL_ENTRY") return;
    void (async () => {
      setLoadingJournal(true);
      setJournalError(null);
      const result = await searchJournalEntriesAction({ companyId, query: journalQuery || undefined });
      setLoadingJournal(false);
      if (result.success) {
        setJournalEntries(result.data);
      } else {
        setJournalEntries([]);
        setJournalError(result.error);
      }
    })();
  }, [selectedTxId, selectedTx, matchType, companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: journalQuery debounce handled by search button

  // Load PAYMENT_RECORD candidates when tab is active and tx is selected
  useEffect(() => {
    if (!selectedTx || selectedTx.isReconciled || matchType !== "PAYMENT_RECORD") return;
    void (async () => {
      setLoadingPaymentRecords(true);
      setPaymentRecordsError(null);
      const result = await searchPaymentRecordsAction({ companyId });
      setLoadingPaymentRecords(false);
      if (result.success) {
        setPaymentRecords(result.data);
      } else {
        setPaymentRecords([]);
        setPaymentRecordsError(result.error);
      }
    })();
  }, [selectedTxId, selectedTx, matchType, companyId]);

  function handleSelectTx(txId: string) {
    setSelectedTxId((prev) => (prev === txId ? null : txId));
    setActionError(null);
  }

  function handleMatchTypeChange(type: MatchType) {
    setMatchType(type);
    setJournalQuery("");
    setJournalEntries([]);
    setActionError(null);
  }

  function handleMatch(targetId: string) {
    if (!selectedTxId) return;
    setActionError(null);
    startTransition(async () => {
      const result = await matchBankTransactionAction({
        bankTransactionId: selectedTxId,
        companyId,
        matchType,
        targetId,
      });
      if (!result.success) {
        setActionError(result.error);
      } else {
        // Optimistic update: mark as reconciled
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === selectedTxId
              ? {
                  ...t,
                  isReconciled: true,
                  matchedPaymentId: matchType === "INVOICE_PAYMENT" ? targetId : t.matchedPaymentId,
                  matchedTransactionId: matchType === "JOURNAL_ENTRY" ? targetId : t.matchedTransactionId,
                  matchedPaymentRecordId: matchType === "PAYMENT_RECORD" ? targetId : t.matchedPaymentRecordId,
                }
              : t
          )
        );
        setSummary((prev) =>
          prev ? { ...prev, reconciled: prev.reconciled + 1, pending: prev.pending - 1 } : prev
        );
        setSelectedTxId(null);
      }
    });
  }

  function handleUnreconcile(txId: string) {
    setActionError(null);
    startTransition(async () => {
      const result = await unreconcileTransactionAction({ bankTransactionId: txId, companyId });
      if (!result.success) {
        setActionError(result.error);
      } else {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId
              ? {
                  ...t,
                  isReconciled: false,
                  matchedPaymentId: null,
                  matchedTransactionId: null,
                  matchedPaymentRecordId: null,
                  matchedPayment: null,
                }
              : t
          )
        );
        setSummary((prev) =>
          prev ? { ...prev, reconciled: prev.reconciled - 1, pending: prev.pending + 1 } : prev
        );
        if (selectedTxId === txId) setSelectedTxId(null);
      }
    });
  }

  async function handleJournalSearch() {
    if (!selectedTx || selectedTx.isReconciled) return;
    setLoadingJournal(true);
    setJournalError(null);
    const result = await searchJournalEntriesAction({ companyId, query: journalQuery || undefined });
    setLoadingJournal(false);
    if (result.success) {
      setJournalEntries(result.data);
    } else {
      setJournalEntries([]);
      setJournalError(result.error);
    }
  }

  // ─── Right panel content ────────────────────────────────────────────────────

  function renderRightPanel() {
    if (!selectedTx) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-10 text-center">
          <SearchIcon className="mb-3 h-8 w-8 text-zinc-200" aria-hidden="true" />
          <p className="text-sm text-zinc-400">
            Selecciona una transacción pendiente del panel izquierdo para buscar contrapartidas
          </p>
        </div>
      );
    }

    if (selectedTx.isReconciled) {
      const matchLabel = getMatchLabel(selectedTx);
      return (
        <div className="p-5">
          <div className="mb-3 border-b pb-3">
            <h3 className="text-sm font-semibold text-zinc-700">Transacción conciliada</h3>
          </div>
          <div className="rounded-lg bg-green-50 p-3 text-sm">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-green-800">
              <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
              {matchLabel ? `Vinculada con: ${matchLabel}` : "Conciliada"}
            </div>
            {selectedTx.matchedPayment && (
              <div className="space-y-1 pl-6 text-xs text-green-700">
                <div>
                  Monto:{" "}
                  <span className="font-mono font-semibold" style={{ fontVariantNumeric: "tabular-nums", fontSize: "14px" }}>
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
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col">
        {/* Match type selector */}
        <div className="border-b px-4 pt-3">
          <p className="mb-2 text-xs text-zinc-400">
            Selecciona el tipo de contrapartida para{" "}
            <strong className="text-zinc-600">{selectedTx.description}</strong>{" "}
            ({fmtAmount(selectedTx.amount)} {statement.bankAccount.currency})
          </p>
          <div className="flex gap-1 pb-0" role="tablist">
            {MATCH_TABS.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                role="tab"
                aria-selected={matchType === type}
                onClick={() => handleMatchTypeChange(type)}
                className={[
                  "flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500",
                  matchType === type
                    ? "border-zinc-200 bg-white text-blue-700"
                    : "border-transparent bg-zinc-50 text-zinc-500 hover:text-zinc-700",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {matchType === "INVOICE_PAYMENT" && (
            <InvoicePaymentPanel
              items={invoicePayments}
              loading={loadingPayments}
              error={paymentsError}
              isPending={isPending}
              onMatch={handleMatch}
            />
          )}
          {matchType === "JOURNAL_ENTRY" && (
            <JournalEntryPanel
              items={journalEntries}
              loading={loadingJournal}
              error={journalError}
              query={journalQuery}
              onQueryChange={setJournalQuery}
              onSearch={handleJournalSearch}
              isPending={isPending}
              onMatch={handleMatch}
            />
          )}
          {matchType === "PAYMENT_RECORD" && (
            <PaymentRecordPanel
              items={paymentRecords}
              loading={loadingPaymentRecords}
              error={paymentRecordsError}
              isPending={isPending}
              onMatch={handleMatch}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {summary && <SummaryBar summary={summary} currency={statement.bankAccount.currency} />}

      <div className="flex flex-wrap gap-4 rounded-lg border bg-zinc-50 px-4 py-3 text-sm">
        <span className="text-zinc-500">
          Saldo inicial:{" "}
          <span className="font-mono font-semibold text-zinc-800" style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}>
            {fmtAmount(statement.openingBalance)} {statement.bankAccount.currency}
          </span>
        </span>
        <span className="text-zinc-500">
          Saldo final:{" "}
          <span className="font-mono font-semibold text-zinc-800" style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}>
            {fmtAmount(statement.closingBalance)} {statement.bankAccount.currency}
          </span>
        </span>
      </div>

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: transactions list */}
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="border-b bg-zinc-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-700">Transacciones del extracto</h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Selecciona una transacción pendiente para conciliarla
            </p>
          </div>
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400">No hay transacciones en este extracto</div>
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
                        <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-500" aria-label="Conciliada" />
                      ) : (
                        <ClockIcon className="h-4 w-4 shrink-0 text-amber-400" aria-label="Pendiente" />
                      )}
                      <span className="truncate font-medium text-zinc-800">{tx.description}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 pl-6 text-xs text-zinc-400">
                      <span className="font-mono">{fmtDate(tx.date)}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-medium ${
                          tx.type === "CREDIT" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {tx.type === "CREDIT" ? "Crédito" : "Débito"}
                      </span>
                      {tx.isReconciled && (
                        <span className="text-green-600">{getMatchLabel(tx)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`font-mono font-semibold ${tx.type === "CREDIT" ? "text-green-700" : "text-red-700"}`}
                      style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
                    >
                      {tx.type === "DEBIT" ? "-" : "+"}
                      {fmtAmount(tx.amount)}
                    </span>
                    {tx.isReconciled && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={(e) => { e.stopPropagation(); handleUnreconcile(tx.id); }}
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

        {/* Right: match panel */}
        <div className="rounded-lg border bg-white">{renderRightPanel()}</div>
      </div>
    </div>
  );
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function MatchButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
      aria-label={label}
    >
      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
      Conciliar
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-zinc-400">{message}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-zinc-100" />
      ))}
    </div>
  );
}

// ── INVOICE_PAYMENT panel

function InvoicePaymentPanel({
  items,
  loading,
  error,
  isPending,
  onMatch,
}: {
  items: InvoicePaymentItem[];
  loading: boolean;
  error: string | null;
  isPending: boolean;
  onMatch: (id: string) => void;
}) {
  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="p-4 text-sm text-red-600" role="alert">{error}</p>;
  if (items.length === 0)
    return <EmptyState message="No hay pagos de factura pendientes de conciliación" />;

  return (
    <ul className="divide-y" role="list">
      {items.map((payment) => (
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
                {new Date(payment.date as string).toLocaleDateString("es-VE")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-mono font-semibold text-zinc-800" style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}>
                {new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                  parseFloat(payment.amount)
                )}{" "}
                {payment.currency as string}
              </span>
              <MatchButton disabled={isPending} onClick={() => onMatch(payment.id)} label={`Conciliar con pago ${payment.id}`} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── JOURNAL_ENTRY panel

function JournalEntryPanel({
  items,
  loading,
  error,
  query,
  onQueryChange,
  onSearch,
  isPending,
  onMatch,
}: {
  items: JournalEntryItem[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  isPending: boolean;
  onMatch: (id: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Buscar por número o descripción…"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            <SearchIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Buscar
          </button>
        </div>
      </div>
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <p className="p-4 text-sm text-red-600" role="alert">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState message="No se encontraron asientos contables. Usa el buscador para filtrar." />
      ) : (
        <ul className="divide-y" role="list">
          {items.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-zinc-700">{entry.number}</span>
                    <span className="text-xs text-zinc-400">{new Date(entry.date).toLocaleDateString("es-VE")}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{entry.description}</div>
                </div>
                <MatchButton
                  disabled={isPending}
                  onClick={() => onMatch(entry.id)}
                  label={`Conciliar con asiento ${entry.number}`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── PAYMENT_RECORD panel

function PaymentRecordPanel({
  items,
  loading,
  error,
  isPending,
  onMatch,
}: {
  items: PaymentRecordItem[];
  loading: boolean;
  error: string | null;
  isPending: boolean;
  onMatch: (id: string) => void;
}) {
  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="p-4 text-sm text-red-600" role="alert">{error}</p>;
  if (items.length === 0)
    return <EmptyState message="No hay pagos digitales disponibles para conciliación" />;

  return (
    <ul className="divide-y" role="list">
      {items.map((record) => (
        <li key={record.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-800">{record.method}</span>
                {record.referenceNumber && (
                  <span className="font-mono text-xs text-zinc-400">{record.referenceNumber}</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                <span>{new Date(record.date).toLocaleDateString("es-VE")}</span>
                {record.currency !== "VES" && record.amountOriginal && (
                  <span className="text-green-600">
                    {record.amountOriginal} {record.currency}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-mono font-semibold text-zinc-800" style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}>
                {record.amountVes} VES
              </span>
              <MatchButton
                disabled={isPending}
                onClick={() => onMatch(record.id)}
                label={`Conciliar con pago ${record.id}`}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
