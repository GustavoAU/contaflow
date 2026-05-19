// src/app/(dashboard)/company/[companyId]/invoices/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusIcon, ScanIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { InvoiceBook } from "@/components/invoices/InvoiceBook";
import { Button } from "@/components/ui/button";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function InvoicesPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [company, activePeriod] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    }),
    prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { month: true, year: true },
    }),
  ]);
  if (!company) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Libros de Compras y Ventas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Registro fiscal de facturas — IVA Débito y Crédito Fiscal
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/company/${companyId}/invoices/upload`}>
            <Button variant="outline">
              <ScanIcon className="mr-2 h-4 w-4" />
              Escanear Factura
            </Button>
          </Link>
          <Link href={`/company/${companyId}/invoices/new`}>
            <Button>
              <PlusIcon className="mr-2 h-4 w-4" />
              Nueva Factura
            </Button>
          </Link>
        </div>
      </div>

      <InvoiceBook
        companyId={companyId}
        companyName={company.name}
        activePeriodMonth={activePeriod?.month}
        activePeriodYear={activePeriod?.year}
      />
    </div>
  );
}
