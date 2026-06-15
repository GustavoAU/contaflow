"use client";

// ADR-034: Modal para agregar un RIF gestionado por el Despacho
import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { PlusIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { addManagedClientAction } from "../actions/despacho.actions";

type Props = {
  companyId: string;
  canAdd: boolean;
  limitLabel: string;
};

export function AddRifModal({ companyId, canAdd, limitLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addManagedClientAction(formData);
      if (result.success) {
        toast.success("Cliente agregado correctamente");
        setOpen(false);
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={!canAdd}
        title={!canAdd ? `Límite alcanzado (${limitLabel}). Mejora tu tier.` : "Agregar cliente"}
        size="sm"
      >
        <PlusIcon className="h-4 w-4 mr-1" aria-hidden="true" />
        Agregar RIF
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar cliente al Despacho</DialogTitle>
            <DialogDescription>
              Registra el RIF de un cliente que gestionas desde este Despacho.
            </DialogDescription>
          </DialogHeader>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <input type="hidden" name="companyId" value={companyId} />

            <div className="space-y-1">
              <Label htmlFor="rif">
                RIF <span className="text-red-600">*</span>
              </Label>
              <Input
                id="rif"
                name="rif"
                placeholder="J-12345678-9"
                required
                aria-required="true"
                className="uppercase"
              />
              <p className="text-xs text-gray-600">Formato: J/V/E/G/C/P-XXXXXXXX-D</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="clientName">
                Razón social <span className="text-red-600">*</span>
              </Label>
              <Input
                id="clientName"
                name="clientName"
                placeholder="Empresa ABC C.A."
                required
                aria-required="true"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="ciiu">Código CIIU</Label>
              <Input id="ciiu" name="ciiu" placeholder="6201" maxLength={10} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="notes">Notas internas</Label>
              <Input id="notes" name="notes" placeholder="Observaciones..." maxLength={500} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending} aria-busy={isPending}>
                {isPending ? (
                  <><Loader2Icon className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />Guardando…</>
                ) : (
                  "Guardar cliente"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
