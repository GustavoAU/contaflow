// src/modules/bank-reconciliation/components/BankAccountList.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { PlusIcon, BuildingIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { createBankAccountAction } from "../actions/banking.actions";

type BankAccountListItem = {
  id: string;
  name: string;
  bankName: string;
  currency: string;
  accountCode: string;
  accountName: string;
  lastClosingBalance: string | null;
  lastStatementDate: Date | null;
};

type Props = {
  accounts: BankAccountListItem[];
  companyId: string;
  userId: string;
};

const CURRENCY_BADGE: Record<string, string> = {
  VES: "bg-green-100 text-green-700",
  USD: "bg-blue-100 text-blue-700",
  EUR: "bg-indigo-100 text-indigo-700",
};

function fmtAmount(value: string | null, currency: string) {
  if (!value) return "—";
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function BankAccountList({ accounts, companyId, userId }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState<"VES" | "USD" | "EUR">("VES");

  function handleOpenForm() {
    setShowForm(true);
    setError(null);
  }

  function handleCancel() {
    setShowForm(false);
    setError(null);
    setName("");
    setBankName("");
    setAccountId("");
    setCurrency("VES");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createBankAccountAction({
        companyId,
        accountId,
        name,
        bankName,
        currency,
        createdBy: userId,
      });
      if (!result.success) {
        setError(result.error);
      } else {
        handleCancel();
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Cuentas bancarias</h2>
          <p className="text-sm text-zinc-500">
            {accounts.length === 0
              ? "No hay cuentas bancarias registradas"
              : `${accounts.length} cuenta${accounts.length !== 1 ? "s" : ""} registrada${accounts.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={handleOpenForm}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Nueva cuenta bancaria
          </button>
        )}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-zinc-900">Nueva cuenta bancaria</h3>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded p-1 text-zinc-400 hover:bg-blue-100 hover:text-zinc-600"
              aria-label="Cerrar formulario"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ba-name" className="mb-1 block text-sm font-medium text-zinc-700">
                Nombre de la cuenta
              </label>
              <input
                id="ba-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Cuenta corriente operativa"
                required
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="ba-bank" className="mb-1 block text-sm font-medium text-zinc-700">
                Banco
              </label>
              <input
                id="ba-bank"
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Ej. Banesco, Mercantil, Provincial"
                required
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="ba-account" className="mb-1 block text-sm font-medium text-zinc-700">
                ID de cuenta contable
              </label>
              <input
                id="ba-account"
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="ID del plan de cuentas"
                required
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="ba-currency" className="mb-1 block text-sm font-medium text-zinc-700">
                Moneda
              </label>
              <select
                id="ba-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "VES" | "USD" | "EUR")}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="VES">VES — Bolívar</option>
                <option value="USD">USD — Dólar</option>
                <option value="EUR">EUR — Euro</option>
              </select>
            </div>

            {error && (
              <div className="sm:col-span-2">
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {error}
                </p>
              </div>
            )}

            <div className="flex gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {isPending ? "Guardando..." : "Guardar cuenta"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {accounts.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed bg-white p-10 text-center">
          <BuildingIcon className="mx-auto mb-3 h-8 w-8 text-zinc-300" aria-hidden="true" />
          <p className="text-sm text-zinc-400">
            No hay cuentas bancarias. Crea una para empezar la conciliación.
          </p>
        </div>
      ) : accounts.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Banco</th>
                <th className="px-4 py-3 text-left">Moneda</th>
                <th className="px-4 py-3 text-right">Último balance</th>
                <th className="px-4 py-3 text-left">Última fecha</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{account.name}</div>
                    <div className="text-xs text-zinc-400">
                      {account.accountCode} — {account.accountName}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{account.bankName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CURRENCY_BADGE[account.currency] ?? "bg-zinc-100 text-zinc-600"}`}
                    >
                      {account.currency}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right font-mono text-[15px]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {account.lastClosingBalance
                      ? fmtAmount(account.lastClosingBalance, account.currency)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {account.lastStatementDate
                      ? new Date(account.lastStatementDate).toLocaleDateString("es-VE")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/company/${companyId}/bank-reconciliation?accountId=${account.id}`}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      Ver extractos
                      <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
