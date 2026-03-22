// src/app/(dashboard)/company/[companyId]/invoices/new/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function NewInvoicePage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [period, company] = await Promise.all([
    prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      orderBy: { year: "desc" },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { isSpecialContributor: true },
    }),
  ]);

  if (!company) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}/invoices`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Libros de Compras y Ventas
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Registrar Factura</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {period
            ? `Período activo: ${period.month}/${period.year}`
            : "Sin período activo — la factura no se asociará a ningún período"}
        </p>
      </div>

      <div className="max-w-2xl">
        <InvoiceForm
          companyId={companyId}
          userId={user.id}
          periodId={period?.id}
          isSpecialContributor={company.isSpecialContributor}
        />
      </div>
    </div>
  );
}
