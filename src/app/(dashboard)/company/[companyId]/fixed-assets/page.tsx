// src/app/(dashboard)/company/[companyId]/fixed-assets/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { FixedAssetService } from "@/modules/fixed-assets/services/FixedAssetService";
import { FixedAssetList } from "@/modules/fixed-assets/components/FixedAssetList";
import { FixedAssetForm } from "@/modules/fixed-assets/components/FixedAssetForm";

type Props = { params: Promise<{ companyId: string }> };

export default async function FixedAssetsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    include: { company: true },
  });
  if (!member) redirect("/");

  const [assets, accounts] = await Promise.all([
    FixedAssetService.getSummary(companyId),
    prisma.account.findMany({
      where: { companyId, deletedAt: null, type: { in: ["ASSET", "EXPENSE"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
  ]);

  const serializedAssets = assets.map((a) => ({
    ...a,
    acquisitionCost: a.acquisitionCost.toFixed(2),
    residualValue: a.residualValue.toFixed(2),
    bookValue: a.bookValue.toFixed(2),
    accumulatedDepreciation: a.accumulatedDepreciation.toFixed(2),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Activos Fijos</h1>
        <p className="mt-1 text-sm text-gray-500">
          {member.company.name} — Gestión de activos y depreciación (VEN-NIF 16 / IAS 16)
        </p>
      </div>

      {/* Registro de nuevo activo */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-800">Registrar nuevo activo</h2>
        <FixedAssetForm
          companyId={companyId}
          accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))}
        />
      </section>

      {/* Listado de activos */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-800">
          Activos registrados
          <span className="ml-2 text-sm font-normal text-gray-400">({assets.length})</span>
        </h2>
        <FixedAssetList assets={serializedAssets as never} companyId={companyId} />
      </section>
    </div>
  );
}
