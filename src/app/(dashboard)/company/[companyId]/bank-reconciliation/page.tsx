// src/app/(dashboard)/company/[companyId]/bank-reconciliation/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon, LandmarkIcon } from "lucide-react";
import { BankAccountService } from "@/modules/bank-reconciliation/services/BankAccountService";
import { BankStatementService } from "@/modules/bank-reconciliation/services/BankStatementService";
import { BankAccountList } from "@/modules/bank-reconciliation/components/BankAccountList";
import { BankStatementUpload } from "@/modules/bank-reconciliation/components/BankStatementUpload";
import { Decimal } from "decimal.js";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ accountId?: string }>;
};

function fmtAmount(value: unknown) {
  const str = typeof value === "object" && value !== null ? value.toString() : String(value);
  const n = parseFloat(str);
  if (isNaN(n)) return str;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export default async function BankReconciliationPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { accountId } = await searchParams;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const accounts = await BankAccountService.list(companyId);

  // If an accountId is selected, load its statements
  const selectedAccount = accountId ? accounts.find((a) => a.id === accountId) ?? null : null;
  const statements = selectedAccount
    ? await BankStatementService.listByAccount(selectedAccount.id)
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/company/${companyId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <LandmarkIcon className="h-6 w-6 text-zinc-400" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Conciliación Bancaria</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              Vincula los movimientos del extracto bancario con los pagos registrados
            </p>
          </div>
        </div>
      </div>

      {/* Account list */}
      <BankAccountList accounts={accounts} companyId={companyId} userId={user.id} />

      {/* Statement section for selected account */}
      {selectedAccount && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <h2 className="text-lg font-semibold">{selectedAccount.name}</h2>
              <p className="text-sm text-zinc-500">
                {selectedAccount.bankName} &mdash; {selectedAccount.currency}
              </p>
            </div>
            <Link
              href={`/company/${companyId}/bank-reconciliation`}
              className="text-sm text-blue-600 hover:underline"
            >
              Ver todas las cuentas
            </Link>
          </div>

          {/* Upload form */}
          <BankStatementUpload
            bankAccountId={selectedAccount.id}
            companyId={companyId}
            userId={user.id}
          />

          {/* Statements list */}
          {statements.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-white">
              <div className="border-b bg-zinc-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-zinc-700">Extractos importados</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Período</th>
                    <th className="px-4 py-3 text-right">Saldo inicial</th>
                    <th className="px-4 py-3 text-right">Saldo final</th>
                    <th className="px-4 py-3 text-center">Transacciones</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                    <th className="px-4 py-3 text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {statements.map((stmt) => (
                    <tr key={stmt.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                        {new Date(stmt.periodStart).toLocaleDateString("es-VE")}
                        {" — "}
                        {new Date(stmt.periodEnd).toLocaleDateString("es-VE")}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-mono font-medium"
                        style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
                      >
                        {fmtAmount(new Decimal(stmt.openingBalance).toFixed(2))}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-mono font-medium"
                        style={{ fontVariantNumeric: "tabular-nums", fontSize: "15px" }}
                      >
                        {fmtAmount(new Decimal(stmt.closingBalance).toFixed(2))}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-zinc-600">
                        {stmt._count.transactions}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            stmt.status === "CLOSED"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {stmt.status === "CLOSED" ? "Cerrado" : "Abierto"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/company/${companyId}/bank-reconciliation/${stmt.id}`}
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          Conciliar
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {statements.length === 0 && (
            <div className="rounded-lg border border-dashed bg-white p-8 text-center">
              <p className="text-sm text-zinc-400">
                No hay extractos importados para esta cuenta. Importa el primero arriba.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
