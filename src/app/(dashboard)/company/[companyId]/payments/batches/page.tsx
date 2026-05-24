// src/app/(dashboard)/company/[companyId]/payments/batches/page.tsx
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
import { ModuleTabs } from "@/components/ui/ModuleTabs";

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

  const pagosTabs = [
    { label: "Medios de Pago",    href: `/company/${companyId}/payments` },
    { label: "Distribución A/P",  href: `/company/${companyId}/payments/batches` },
  ];

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
        <h1 className="text-2xl font-bold tracking-tight">Pagos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Medios de pago digitales y distribución de pagos a proveedores
        </p>
      </div>

      <ModuleTabs tabs={pagosTabs} color="blue" />

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
