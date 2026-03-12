// src/components/company/ArchiveCompany.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { archiveCompanyAction } from "@/modules/company/actions/company.actions";

type Props = {
  companyId: string;
  companyName: string;
  userId: string;
};

export function ArchiveCompany({ companyId, companyName, userId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveCompanyAction(companyId, userId);

      if (result.success) {
        toast.success(`Empresa "${companyName}" archivada correctamente`);
        setOpen(false);
        router.push("/dashboard");
      } else {
        toast.error(result.error);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <div className="rounded-lg border border-red-200 bg-white p-6">
        <h2 className="font-semibold text-red-700">Zona de Peligro</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">
          Archivar esta empresa la ocultará del dashboard. El historial contable se conserva.
        </p>
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          className="gap-2"
          disabled={isPending}
        >
          <ArchiveIcon className="h-4 w-4" />
          Archivar Empresa
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archivar Empresa</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-zinc-600">
              ¿Confirmas archivar <span className="font-semibold">{companyName}</span>?
            </p>
            <p className="mt-2 text-xs font-medium text-amber-600">
              ⚠ La empresa desaparecerá del dashboard pero su historial contable se conserva. Podrás
              reactivarla desde el panel de administración.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleArchive} disabled={isPending}>
              {isPending ? "Archivando..." : "Archivar Empresa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
