// src/app/(dashboard)/company/[companyId]/payables/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { getPayablesAction } from "@/modules/receivables/actions/receivable.actions";
import { AgingReportTable } from "@/modules/receivables/components/AgingReportTable";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function PayablesPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getPayablesAction(companyId);
  const report = result.success ? result.data : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cartera CxP — Cuentas por Pagar</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Facturas de compra con saldo pendiente de pago, ordenadas por antigüedad
        </p>
      </div>

      {!result.success ? (
        <p className="text-destructive text-sm">{result.error}</p>
      ) : report && report.rows.length === 0 && report.grandTotalPendingVes === "0.00" ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground text-sm">No hay facturas de compra con saldo pendiente</p>
        </div>
      ) : report ? (
        <AgingReportTable report={report} companyId={companyId} />
      ) : null}

      <Toaster richColors position="top-right" />
    </div>
  );
}
