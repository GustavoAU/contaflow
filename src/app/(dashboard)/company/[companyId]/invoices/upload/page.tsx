// src/app/(dashboard)/company/[companyId]/invoices/upload/page.tsx
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { requireCompanyPage } from "@/lib/company-page-guard";
import { InvoiceUploader } from "@/components/ocr/InvoiceUploader";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function InvoiceUploadPage({ params }: Props) {
  const { companyId } = await params;

  // El check de membresía ya existía, pero DESPUÉS de leer la empresa: la fila
  // ajena se cargaba igual. Ahora ambas cosas son la misma query (ADR-004).
  const { company } = await requireCompanyPage(companyId, { name: true });

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
        <h1 className="text-2xl font-bold tracking-tight">Escanear Factura</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube una imagen y Gemini Vision extrae los datos automáticamente
        </p>
      </div>

      <InvoiceUploader companyId={companyId} />
    </div>
  );
}
