// src/app/(dashboard)/company/[companyId]/payments/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { listPaymentsAction } from "@/modules/payments/actions/payment.actions";
import { PaymentForm } from "@/modules/payments/components/PaymentForm";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "@/modules/payments/schemas/payment.schema";

type Props = {
  params: Promise<{ companyId: string }>;
};

const METHOD_BADGE: Record<PaymentMethodType, string> = {
  EFECTIVO: "bg-zinc-100 text-zinc-600",
  TRANSFERENCIA: "bg-blue-100 text-blue-700",
  PAGOMOVIL: "bg-indigo-100 text-indigo-700",
  ZELLE: "bg-green-100 text-green-700",
  CASHEA: "bg-purple-100 text-purple-700",
};

function fmtVes(v: string) {
  const n = parseFloat(v);
  return isNaN(n)
    ? v
    : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default async function PaymentsPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await listPaymentsAction(companyId);
  const payments = result.success ? result.data : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Medios de Pago</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          PagoMóvil, Zelle, Cashea y otros medios digitales
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Formulario */}
        <PaymentForm companyId={companyId} userId={user.id} />

        {/* Historial */}
        <div className="space-y-3">
          <h2 className="font-semibold">Últimos pagos registrados</h2>
          {payments.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-white p-8 text-center">
              <p className="text-sm text-zinc-400">No hay pagos registrados aún</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-white">
              <table className="w-full text-sm">
                <thead className="border-b bg-zinc-50 text-xs font-medium uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-left">Método</th>
                    <th className="px-4 py-3 text-right">Monto Bs.D</th>
                    <th className="px-4 py-3 text-right">USD</th>
                    <th className="px-4 py-3 text-right">IGTF</th>
                    <th className="px-4 py-3 text-left">Ref.</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                        {new Date(p.date).toLocaleDateString("es-VE")}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${METHOD_BADGE[p.method as PaymentMethodType] ?? "bg-zinc-100 text-zinc-600"}`}
                        >
                          {PAYMENT_METHOD_LABELS[p.method as PaymentMethodType] ?? p.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {fmtVes(p.amountVes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-green-700">
                        {p.amountOriginal ? `$${fmtVes(p.amountOriginal)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-amber-700">
                        {p.igtfAmount ? fmtVes(p.igtfAmount) : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                        {p.referenceNumber ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
