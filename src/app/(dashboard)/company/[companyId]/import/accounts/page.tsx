// src/app/(dashboard)/company/[companyId]/import/accounts/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { AccountsImporter } from "@/components/import/AccountsImporter";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function ImportAccountsPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}/import`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Importar Datos
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Importar Plan de Cuentas</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube un archivo Excel o CSV con tus cuentas contables
        </p>
      </div>

      <AccountsImporter companyId={companyId} userId={user.id} />
    </div>
  );
}
