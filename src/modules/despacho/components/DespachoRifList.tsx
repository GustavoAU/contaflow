"use client";

// ADR-034: Lista de RIFs gestionados por el Despacho
import { useTransition } from "react";
import { toast } from "sonner";
import { ArchiveIcon, CheckCircle2Icon, XCircleIcon, PauseCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRifModal } from "./AddRifModal";
import { archiveManagedClientAction } from "../actions/despacho.actions";
import type { ManagedClient } from "@prisma/client";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ManagedClient["status"] }) {
  if (status === "ACTIVE")
    return (
      <Badge variant="outline" className="text-emerald-700 border-emerald-300 gap-1">
        <CheckCircle2Icon className="h-3 w-3" aria-hidden="true" />
        Activo
      </Badge>
    );
  if (status === "SUSPENDED")
    return (
      <Badge variant="outline" className="text-amber-700 border-amber-300 gap-1">
        <PauseCircleIcon className="h-3 w-3" aria-hidden="true" />
        Suspendido
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-gray-500 border-gray-300 gap-1">
      <XCircleIcon className="h-3 w-3" aria-hidden="true" />
      Archivado
    </Badge>
  );
}

// ─── Archive button ───────────────────────────────────────────────────────────

function ArchiveButton({ companyId, managedClientId }: { companyId: string; managedClientId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleArchive() {
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("managedClientId", managedClientId);
    startTransition(async () => {
      const result = await archiveManagedClientAction(fd);
      if (result.success) toast.success("Cliente archivado");
      else toast.error(result.error);
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleArchive}
      disabled={isPending}
      aria-busy={isPending}
      aria-label="Archivar cliente"
      title="Archivar cliente"
    >
      <ArchiveIcon className="h-4 w-4 text-gray-500" aria-hidden="true" />
    </Button>
  );
}

// ─── Main list ────────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
  clients: ManagedClient[];
  currentCount: number;
  limit: number | null;
};

export function DespachoRifList({ companyId, clients, currentCount, limit }: Props) {
  const canAdd = limit === null || currentCount < limit;
  const limitLabel = limit === null ? "ilimitado" : `${currentCount}/${limit}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            RIFs gestionados
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {limit === null
              ? `${currentCount} clientes registrados`
              : `${currentCount} de ${limit} clientes`}
          </p>
        </div>
        <AddRifModal companyId={companyId} canAdd={canAdd} limitLabel={limitLabel} />
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="Sin clientes registrados"
          description="Agrega el primer RIF que gestionas desde este Despacho."
          illustration="list"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="stack-card-table min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  RIF
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Razón Social
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  CIIU
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td data-label="RIF" className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">
                    {client.rif}
                  </td>
                  <td data-label="Razón Social" className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {client.clientName}
                  </td>
                  <td data-label="CIIU" className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {client.ciiu ?? "—"}
                  </td>
                  <td data-label="Estado" className="px-4 py-3">
                    <StatusBadge status={client.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {client.deletedAt === null && (
                      <ArchiveButton companyId={companyId} managedClientId={client.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
