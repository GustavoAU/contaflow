// src/app/(dashboard)/company/[companyId]/retentions/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getRetentionsAction } from "@/modules/retentions/actions/retention.actions";
import { RetentionForm } from "@/components/retentions/RetentionForm";
import { RetentionList } from "@/components/retentions/RetentionList";
import { RetentionReconciliation } from "@/components/retentions/RetentionReconciliation";
import { ModuleTabs } from "@/components/ui/ModuleTabs";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function RetentionsPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getRetentionsAction(companyId);

  const fiscalTabs = [
    { label: "Libros IVA",    href: `/company/${companyId}/invoices` },
    { label: "Retenciones",   href: `/company/${companyId}/retentions` },
    { label: "Decl. IVA",     href: `/company/${companyId}/iva-declaration` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Retenciones</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Comprobantes de retención IVA, ISLR, INCES y FAT
        </p>
      </div>

      <ModuleTabs tabs={fiscalTabs} color="amber" />

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

      {/* H-15: Conciliación Retenciones ↔ Libro de Compras (Prov. 0049 Art. 11) */}
      <div className="space-y-3">
        <div>
          <h2 className="font-semibold">Conciliación Retenciones ↔ Libro de Compras</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Verifica coherencia entre comprobantes RIVA emitidos y facturas del Libro de Compras para el período seleccionado.
          </p>
        </div>
        <RetentionReconciliation companyId={companyId} />
      </div>
    </div>
  );
}
