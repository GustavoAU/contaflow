// src/app/(dashboard)/company/[companyId]/invoices/upload/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { InvoiceUploader } from "@/components/ocr/InvoiceUploader";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function InvoiceUploadPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

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
        <h1 className="text-2xl font-bold tracking-tight">Escanear Factura</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube una foto o PDF de tu factura y ContaFlow extraerá los datos automáticamente
        </p>
      </div>

      <InvoiceUploader companyId={companyId} userId={user.id} />
    </div>
  );
}
