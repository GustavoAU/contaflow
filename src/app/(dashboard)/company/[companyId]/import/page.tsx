// src/app/(dashboard)/company/[companyId]/import/page.tsx
import Link from "next/link";
import { FileSpreadsheetIcon, ArrowRightIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function ImportPage({ params }: Props) {
  const { companyId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar Datos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Importa tu Plan de Cuentas desde Excel o CSV
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href={`/company/${companyId}/import/accounts`}
          className="block rounded-lg border bg-white p-6 transition-all hover:border-blue-500 hover:shadow-sm"
        >
          <div className="flex items-start justify-between">
            <div>
              <FileSpreadsheetIcon className="mb-3 h-8 w-8 text-blue-500" />
              <h2 className="font-semibold">Plan de Cuentas</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Importa tus cuentas contables desde un archivo Excel o CSV
              </p>
            </div>
            <ArrowRightIcon className="h-5 w-5 shrink-0 text-zinc-300" />
          </div>
        </Link>
      </div>
    </div>
  );
}
