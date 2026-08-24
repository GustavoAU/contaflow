"use client";
// src/modules/payroll/components/EmployeeStatusToggle.tsx
// Suspender / reactivar un empleado desde su ficha.
//
// Existía el estado INACTIVE en el enum y NINGUNA forma de llegar a él desde la
// interfaz: el único camino que cambiaba el status era terminate() → TERMINATED,
// con fecha de egreso. Para sacar a alguien de una nómina había que ir a la base
// de datos (comprobado 2026-08-23).
//
// Botón con etiqueta explícita en vez de un switch a propósito: un interruptor
// no dice qué pasa al accionarlo, y esto saca a una persona de la nómina.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2Icon, PauseIcon, PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { setEmployeeActiveStatusAction } from "../actions/employee.actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  companyId: string;
  employeeId: string;
  employeeName: string;
  status: string;
  /** Préstamos ACTIVE del empleado — sus cuotas dejan de cobrarse al suspender. */
  activeLoanCount?: number;
};

export function EmployeeStatusToggle({
  companyId, employeeId, employeeName, status, activeLoanCount = 0,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // El egreso no se revierte con un botón — no se ofrece la acción.
  if (status === "TERMINATED") return null;

  const isActive = status === "ACTIVE";
  const next = isActive ? "INACTIVE" : "ACTIVE";

  function handleConfirm() {
    startTransition(async () => {
      const result = await setEmployeeActiveStatusAction(companyId, employeeId, { status: next });
      if (result.success) {
        toast.success(
          isActive
            ? `${employeeName} quedó inactivo. No entrará en las próximas nóminas.`
            : `${employeeName} está activo de nuevo.`
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {isActive ? <PauseIcon /> : <PlayIcon />}
        {isActive ? "Suspender" : "Reactivar"}
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? `¿Suspender a ${employeeName}?` : `¿Reactivar a ${employeeName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {isActive ? (
                  <>
                    <p>
                      Deja de entrar en el cálculo de nómina desde la próxima corrida.
                      No es un egreso: no lleva fecha de salida ni liquidación, y puedes
                      reactivarlo cuando quieras.
                    </p>
                    {activeLoanCount > 0 && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                        Tiene {activeLoanCount} préstamo{activeLoanCount !== 1 ? "s" : ""} activo
                        {activeLoanCount !== 1 ? "s" : ""}. Mientras esté suspendido,
                        {activeLoanCount !== 1 ? " esas cuotas no se cobrarán" : " esa cuota no se cobrará"} en
                        nómina y el saldo queda congelado.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    Vuelve a entrar en el cálculo de nómina desde la próxima corrida, con
                    su salario vigente
                    {activeLoanCount > 0 && " y sus cuotas de préstamo"}.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              variant={isActive ? "destructive" : "default"}
              onClick={(e) => { e.preventDefault(); handleConfirm(); }}
              disabled={isPending}
              aria-busy={isPending}
            >
              {isPending && <Loader2Icon className="animate-spin" />}
              {isActive ? "Suspender" : "Reactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
