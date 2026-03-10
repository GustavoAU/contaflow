// src/app/(dashboard)/company/[companyId]/reports/ledger/page.tsx
import { getLedgerAction } from "@/modules/accounting/actions/report.actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

export default async function LedgerPage({ params }: Props) {
  const { companyId } = await params;
  const result = await getLedgerAction(companyId);

  if (!result.success) redirect("/dashboard");

  const accounts = result.data;

  return (
    <div className="space-y-8">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/company/${companyId}/reports`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Reportes
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Libro Mayor</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Movimientos por cuenta — todos los períodos
          </p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No hay movimientos registrados.
        </div>
      ) : (
        <div className="space-y-8">
          {accounts.map((account) => (
            <div key={account.id} className="overflow-hidden rounded-lg border bg-white">
              {/* Header de la cuenta */}
              <div className="flex items-center justify-between border-b bg-zinc-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-blue-600">{account.code}</span>
                  <span className="font-semibold">{account.name}</span>
                  <span className="text-xs text-zinc-500">{TYPE_LABELS[account.type]}</span>
                </div>
                <div className="flex gap-6 text-sm">
                  <span className="text-zinc-500">
                    Débitos:{" "}
                    <span className="font-mono font-semibold text-zinc-800">
                      {account.totalDebit}
                    </span>
                  </span>
                  <span className="text-zinc-500">
                    Créditos:{" "}
                    <span className="font-mono font-semibold text-zinc-800">
                      {account.totalCredit}
                    </span>
                  </span>
                  <span className="text-zinc-500">
                    Saldo:{" "}
                    <span className="font-mono font-bold text-blue-600">{account.balance}</span>
                  </span>
                </div>
              </div>

              {/* Movimientos */}
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-zinc-500">
                    <th className="px-4 py-2 text-left font-medium">Fecha</th>
                    <th className="px-4 py-2 text-left font-medium">Número</th>
                    <th className="px-4 py-2 text-left font-medium">Descripción</th>
                    <th className="px-4 py-2 text-right font-medium">Débito</th>
                    <th className="px-4 py-2 text-right font-medium">Crédito</th>
                    <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {account.entries.map((entry, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-2 text-zinc-600">
                        {new Date(entry.date).toLocaleDateString("es-VE")}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-blue-600">{entry.number}</td>
                      <td className="max-w-xs truncate px-4 py-2">{entry.description}</td>
                      <td className="px-4 py-2 text-right font-mono">{entry.debit || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{entry.credit || "—"}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">
                        {entry.balance}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
