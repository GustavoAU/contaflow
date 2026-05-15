// src/app/(dashboard)/company/[companyId]/export/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { ExportForm } from "@/modules/export/components/ExportForm";
import { ExportJobList } from "@/modules/export/components/ExportJobList";
import { SIVITExportForm } from "@/modules/export/components/SIVITExportForm";

type Props = { params: Promise<{ companyId: string }> };

export default async function ExportPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true, company: { select: { name: true } } },
  });
  if (!member) redirect("/");

  const canExport = member.role !== "VIEWER";

  const recentJobs = await prisma.exportJob.findMany({
    where: { companyId, createdBy: userId },
    select: {
      id: true,
      status: true,
      dateFrom: true,
      dateTo: true,
      fileSize: true,
      expiresAt: true,
      errorMsg: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Exportar Datos Fiscales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Descarga un archivo ZIP con todos tus datos fiscales: libros IVA,
          asientos, retenciones, activos fijos y Forma 30.
        </p>
      </div>

      {canExport ? (
        <>
          <ExportForm companyId={companyId} />
          <SIVITExportForm companyId={companyId} />
        </>
      ) : (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Tu rol de Visualizador no permite exportar datos. Contacta al administrador de la empresa.
        </div>
      )}

      <ExportJobList jobs={recentJobs} />
    </div>
  );
}
