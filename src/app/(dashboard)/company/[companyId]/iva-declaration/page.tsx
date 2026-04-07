// src/app/(dashboard)/company/[companyId]/iva-declaration/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { Forma30View } from "@/modules/iva-declaration/components/Forma30View";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function IvaDeclarationPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { companyId } = await params;

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
        <h1 className="text-2xl font-bold tracking-tight">Declaración IVA — Forma 30</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumen mensual de débitos y créditos fiscales para la Forma 30 SENIAT
        </p>
      </div>

      <Forma30View companyId={companyId} />
    </div>
  );
}
