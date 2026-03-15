// src/app/(dashboard)/company/[companyId]/igtf/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { getIGTFAction } from "@/modules/igtf/actions/igtf.actions";
import { IGTFForm } from "@/components/igtf/IGTFForm";
import { prisma } from "@/lib/prisma"; // ← importar prisma directamente

type Props = {
  params: Promise<{ companyId: string }>;
};

function formatAmount(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export default async function IGTFPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // ← FIX: obtener la empresa para leer isSpecialContributor
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { isSpecialContributor: true },
  });
  if (!company) redirect("/dashboard");

  const result = await getIGTFAction(companyId);

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
        <h1 className="text-2xl font-bold tracking-tight">IGTF</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Impuesto a las Grandes Transacciones Financieras — 3%
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Formulario */}
        <IGTFForm
          companyId={companyId}
          userId={user.id}
          isSpecialContributor={company.isSpecialContributor} // ← ahora funciona
        />

        {/* Lista — sin cambios */}
        <div className="space-y-4">
          <h2 className="font-semibold">Transacciones IGTF registradas</h2>
          {!result.success ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {result.error}
            </div>
          ) : result.data.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-white p-8 text-center">
              <p className="text-sm text-zinc-400">No hay transacciones IGTF registradas</p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.data.map((r) => (
                <div key={r.id} className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{r.concept}</p>
                      <p className="text-xs text-zinc-400">
                        {r.currency} — {new Date(r.createdAt).toLocaleDateString("es-VE")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-zinc-500">Monto base</p>
                      <p className="font-mono text-sm">{formatAmount(r.amount)}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between border-t pt-2 text-sm">
                    <span className="text-zinc-500">IGTF ({r.igtfRate}%):</span>
                    <span className="font-mono font-semibold text-orange-700">
                      {formatAmount(r.igtfAmount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
