// src/modules/bank-reconciliation/components/BankStatementUpload.tsx
"use client";

import { useState, useTransition } from "react";
import { UploadIcon } from "lucide-react";
import { importStatementAction } from "../actions/banking.actions";

type Props = {
  bankAccountId: string;
  companyId: string;
  userId: string;
};

export function BankStatementUpload({ bankAccountId, companyId, userId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ count: number; statementId: string } | null>(null);
  const [csvContent, setCsvContent] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await importStatementAction({
        bankAccountId,
        companyId,
        csvContent,
        openingBalance,
        closingBalance,
      });

      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess({ count: result.data.transactionCount, statementId: result.data.statementId });
        setCsvContent("");
        setOpeningBalance("");
        setClosingBalance("");
      }
    });
  }

  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <UploadIcon className="h-5 w-5 text-zinc-400" aria-hidden="true" />
        <h2 className="font-semibold text-zinc-900">Importar extracto bancario</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Balances row */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="stmt-opening"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              Saldo inicial
            </label>
            <input
              id="stmt-opening"
              type="text"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="Ej. 1500.00"
              required
              inputMode="decimal"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-[15px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
          </div>
          <div>
            <label
              htmlFor="stmt-closing"
              className="mb-1 block text-sm font-medium text-zinc-700"
            >
              Saldo final
            </label>
            <input
              id="stmt-closing"
              type="text"
              value={closingBalance}
              onChange={(e) => setClosingBalance(e.target.value)}
              placeholder="Ej. 3200.00"
              required
              inputMode="decimal"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-[15px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
          </div>
        </div>

        {/* CSV textarea */}
        <div>
          <label htmlFor="stmt-csv" className="mb-1 block text-sm font-medium text-zinc-700">
            Contenido del extracto CSV
          </label>
          <p className="mb-1.5 text-xs text-zinc-400">
            Formato esperado: <code className="rounded bg-zinc-100 px-1 py-0.5">fecha|descripcion|debito|credito|saldo</code>
          </p>
          <textarea
            id="stmt-csv"
            value={csvContent}
            onChange={(e) => setCsvContent(e.target.value)}
            placeholder={`Pega el contenido del extracto CSV aquí...\n\nEjemplo:\nfecha|descripcion|debito|credito|saldo\n01/01/2026|Depósito inicial|0|1000,00|1000,00\n05/01/2026|Pago proveedor|500,00|0|500,00`}
            required
            rows={8}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Feedback */}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700" role="status">
            Extracto importado con {success.count} transaccion{success.count !== 1 ? "es" : ""}.
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <UploadIcon className="h-4 w-4" aria-hidden="true" />
          {isPending ? "Importando..." : "Importar extracto"}
        </button>
      </form>
    </div>
  );
}
