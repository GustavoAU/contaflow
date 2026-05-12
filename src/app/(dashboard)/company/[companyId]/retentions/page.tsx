// src/app/(dashboard)/company/[companyId]/retentions/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { getRetentionsAction } from "@/modules/retentions/actions/retention.actions";
import { RetentionForm } from "@/components/retentions/RetentionForm";
import { RetentionList } from "@/components/retentions/RetentionList";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function RetentionsPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getRetentionsAction(companyId);

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
        <h1 className="text-2xl font-bold tracking-tight">Retenciones</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Comprobantes de retención IVA, ISLR, INCES y FAT
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Formulario */}
        <RetentionForm companyId={companyId} userId={user.id} />

        {/* Lista */}
        <div className="space-y-4">
          <h2 className="font-semibold">Retenciones emitidas</h2>
          {!result.success ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {result.error}
            </div>
          ) : (
            <RetentionList companyId={companyId} retentions={result.data} />
          )}
        </div>
      </div>
    </div>
  );
}
