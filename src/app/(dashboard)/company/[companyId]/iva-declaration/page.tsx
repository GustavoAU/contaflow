// src/app/(dashboard)/company/[companyId]/iva-declaration/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Forma30View } from "@/modules/iva-declaration/components/Forma30View";
import { prisma } from "@/lib/prisma";
import { ModuleTabs } from "@/components/ui/ModuleTabs";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function IvaDeclarationPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { companyId } = await params;

  const activePeriod = await prisma.accountingPeriod.findFirst({
    where: { companyId, status: "OPEN" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { month: true, year: true },
  });

  const fiscalTabs = [
    { label: "Libros IVA",    href: `/company/${companyId}/invoices` },
    { label: "Retenciones",   href: `/company/${companyId}/retentions` },
    { label: "Decl. IVA",     href: `/company/${companyId}/iva-declaration` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Declaración IVA — Forma 30</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumen mensual de débitos y créditos fiscales para la Forma 30 SENIAT
        </p>
      </div>

      <ModuleTabs tabs={fiscalTabs} color="amber" />

      <Forma30View
        companyId={companyId}
        activePeriodMonth={activePeriod?.month}
        activePeriodYear={activePeriod?.year}
      />
    </div>
  );
}
