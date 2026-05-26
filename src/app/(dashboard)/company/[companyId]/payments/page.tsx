// src/app/(dashboard)/company/[companyId]/payments/page.tsx
import { currentUser, auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { listPaymentsAction } from "@/modules/payments/actions/payment.actions";
import { PaymentForm } from "@/modules/payments/components/PaymentForm";
import { PaymentRecordList } from "@/modules/payments/components/PaymentRecordList";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import prisma from "@/lib/prisma";
import { canAccess } from "@/lib/auth-helpers";
import { UserRole } from "@prisma/client";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function PaymentsPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await listPaymentsAction(companyId);
  const payments = result.success ? result.data : [];

  // Determinar si el usuario puede eliminar comprobantes (ADR-029 D-5)
  const { userId } = await auth();
  const member = userId
    ? await prisma.companyMember.findFirst({
        where: { companyId, userId },
        select: { role: true },
      })
    : null;
  const canDeleteAttachments = canAccess(
    (member?.role ?? "VIEWER") as UserRole,
    ["OWNER", "ADMIN", "ACCOUNTANT"] as UserRole[],
  );

  const pagosTabs = [
    { label: "Medios de Pago",   href: `/company/${companyId}/payments` },
    { label: "Distribución A/P", href: `/company/${companyId}/payments/batches` },
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
        {/* Formulario */}
        <PaymentForm companyId={companyId} userId={user.id} />

        {/* Historial con anulación (#14) y overflow (#10) */}
        <div className="space-y-3">
          <h2 className="font-semibold">Últimos pagos registrados</h2>
          <PaymentRecordList
            companyId={companyId}
            payments={payments}
            canDelete={canDeleteAttachments}
          />
        </div>
      </div>
    </div>
  );
}
