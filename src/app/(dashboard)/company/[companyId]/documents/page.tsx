// src/app/(dashboard)/company/[companyId]/documents/page.tsx
// Q3-1: Página de Gestión Documental — vista unificada facturas + retenciones.
// Server component: carga los primeros 50 documentos y delega filtros al cliente.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { DocumentService } from "@/modules/documents/services/DocumentService";
import { DocumentList } from "@/modules/documents/components/DocumentList";
import { FolderOpenIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function DocumentsPage({ params }: Props) {
  const { companyId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ALL)) redirect("/");

  // Carga inicial — sin filtros, página 1
  const { items, total } = await DocumentService.list(companyId, {}, 1);

  return (
    <div className="space-y-6">
      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <FolderOpenIcon className="mt-0.5 size-6 text-muted-foreground shrink-0" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documentos</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Vista unificada de facturas y comprobantes de retención.
            Descarga PDFs o genera links temporales para auditorías SENIAT.
          </p>
        </div>
      </div>

      {/* ── Lista con filtros (client component) ────────────────────────── */}
      <DocumentList
        companyId={companyId}
        initialItems={items}
        initialTotal={total}
      />
    </div>
  );
}
