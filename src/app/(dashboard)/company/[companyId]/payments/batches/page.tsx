import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import {
  listPaymentBatchesAction,
  listUnpaidPurchaseInvoicesAction,
} from "@/modules/payments/actions/payment-batch.actions";
import { PaymentBatchForm } from "@/modules/payments/components/PaymentBatchForm";
import { PaymentBatchList } from "@/modules/payments/components/PaymentBatchList";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function PaymentBatchesPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [batchesResult, invoicesResult] = await Promise.all([
    listPaymentBatchesAction(companyId),
    listUnpaidPurchaseInvoicesAction(companyId),
  ]);

  const batches = batchesResult.success ? batchesResult.data.batches : [];
  const invoices = invoicesResult.success ? invoicesResult.data : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}/payments`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Medios de Pago
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Distribución de Pagos A/P</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cancela múltiples facturas de proveedor con un solo comprobante de pago
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PaymentBatchForm companyId={companyId} invoices={invoices} />

        <div className="space-y-3">
          <h2 className="font-semibold">Lotes registrados</h2>
          <PaymentBatchList companyId={companyId} batches={batches} />
        </div>
      </div>
    </div>
  );
}
