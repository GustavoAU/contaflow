// src/app/(dashboard)/company/[companyId]/transactions/[id]/page.tsx
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { Badge } from "@/components/ui/badge";
import { ChevronLeftIcon } from "lucide-react";
import { getTransactionByIdAction } from "@/modules/accounting/actions/transaction.actions";
import { VoidTransactionButton } from "@/modules/accounting/components/VoidTransactionButton";
import { fmtVen } from "@/lib/fmt-ven";
import Decimal from "decimal.js";

type Props = { params: Promise<{ companyId: string; id: string }> };

const TYPE_LABELS: Record<string, string> = {
  DIARIO: "Diario",
  APERTURA: "Apertura",
  AJUSTE: "Ajuste",
  CIERRE: "Cierre",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
};

function fmt(n: string | number) {
  return fmtVen(n);
}

export default async function TransactionDetailPage({ params }: Props) {
  const { companyId, id } = await params;
  const result = await getTransactionByIdAction(companyId, id);

  if (!result.success) notFound();

  const tx = result.data;

  // Anular requiere ADMIN/OWNER (mismo gate que voidTransactionAction).
  const { userId } = await auth();
  let canVoid = false;
  if (userId) {
    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    canVoid = !!member && canAccess(member.role, ROLES.ADMIN_ONLY);
  }

  const debits = tx.entries.filter((e) => new Decimal(e.amount.toString()).gt(0));
  const credits = tx.entries.filter((e) => new Decimal(e.amount.toString()).lt(0));
  const totalDebit = debits.reduce(
    (s, e) => s.plus(new Decimal(e.amount.toString())),
    new Decimal(0)
  );
  const totalCredit = credits.reduce(
    (s, e) => s.plus(new Decimal(e.amount.toString()).abs()),
    new Decimal(0)
  );
  const isBalanced = totalDebit.minus(totalCredit).abs().lt(new Decimal("0.01"));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <Link
        href={`/company/${companyId}/transactions`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Asientos Contables
      </Link>

      {/* Header */}
      <div className="space-y-4 rounded-lg border bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-mono text-xl font-bold">{tx.number}</h1>
            <p className="mt-1 text-zinc-600">{tx.description}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={tx.status === "POSTED" ? "default" : "destructive"}>
              {tx.status === "POSTED" ? "Contabilizado" : "Anulado"}
            </Badge>
            {canVoid && tx.status === "POSTED" && userId && (
              <VoidTransactionButton
                transactionId={tx.id}
                transactionNumber={tx.number}
                userId={userId}
              />
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-400">Fecha</p>
            <p className="font-medium">
              {new Date(tx.date).toLocaleDateString("es-VE", { timeZone: "UTC" })}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-400">Tipo</p>
            <p className="font-medium">{TYPE_LABELS[tx.type] ?? tx.type}</p>
          </div>
          {tx.reference && (
            <div>
              <p className="text-xs text-zinc-400">Referencia</p>
              <p className="font-medium">{tx.reference}</p>
            </div>
          )}
          {tx.notes && (
            <div className="col-span-2 sm:col-span-3">
              <p className="text-xs text-zinc-400">Notas</p>
              <p className="font-medium">{tx.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Partidas */}
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="border-b bg-zinc-50 px-4 py-2">
          <h2 className="text-sm font-semibold text-zinc-700">Partidas del Asiento</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Cuenta</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">Débito (Bs.)</th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">Crédito (Bs.)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {/* Débitos primero */}
            {debits.map((e) => (
              <tr key={e.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <span className="mr-2 font-mono text-xs text-zinc-400">{e.account.code}</span>
                  <span className="text-zinc-800">{e.account.name}</span>
                  <span className="ml-2 text-xs text-zinc-400">
                    ({ACCOUNT_TYPE_LABELS[e.account.type] ?? e.account.type})
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono font-medium tabular-nums">
                  {fmt(Number(e.amount))}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300 tabular-nums">—</td>
              </tr>
            ))}
            {/* Créditos */}
            {credits.map((e) => (
              <tr key={e.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3 pl-10">
                  <span className="mr-2 font-mono text-xs text-zinc-400">{e.account.code}</span>
                  <span className="text-zinc-800">{e.account.name}</span>
                  <span className="ml-2 text-xs text-zinc-400">
                    ({ACCOUNT_TYPE_LABELS[e.account.type] ?? e.account.type})
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300 tabular-nums">—</td>
                <td className="px-4 py-3 text-right font-mono font-medium tabular-nums">
                  {fmt(new Decimal(e.amount.toString()).abs().toFixed(2))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-zinc-50">
            <tr>
              <td className="px-4 py-3 text-sm font-semibold text-zinc-700">Total</td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                {fmt(totalDebit.toFixed(2))}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                {fmt(totalCredit.toFixed(2))}
              </td>
            </tr>
          </tfoot>
        </table>
        {isBalanced ? (
          <div className="border-t bg-green-50 px-4 py-2 text-xs text-green-600">
            Asiento cuadrado — Débitos = Créditos
          </div>
        ) : (
          <div className="border-t bg-red-50 px-4 py-2 text-xs text-red-600">
            Advertencia: asiento desbalanceado
          </div>
        )}
      </div>
    </div>
  );
}
