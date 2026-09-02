"use client";
// src/modules/payroll/components/AutoDraftToggle.tsx
//
// Interruptor del borrador automático de nómina.
//
// El cron existía desde el 2026-08-30 y NO había forma de encenderlo desde la
// aplicación: `setAutoDraftAction` no tenía ni un solo llamador. Activarlo por
// SQL se salta el AuditLog, que es justo lo que la action garantiza — y esto
// decide si el sistema escribe procesos de nómina solo.
//
// Con diálogo de confirmación y no un switch a secas: encenderlo tiene tres
// efectos que no se adivinan mirando un interruptor (reserva horas extra, ocupa
// la ranura del período y sustituye la señal de "falta la nómina"), y apagarlo
// deja de crear borradores sin avisar de nada.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2Icon, BotIcon, BotOffIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { setAutoDraftAction } from "../actions/payroll-config.actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  companyId: string;
  enabled: boolean;
  /** SEMANAL no tiene ancla de ciclo en la configuración: el cron la omite. */
  frequency: string;
};

export function AutoDraftToggle({ companyId, enabled, frequency }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const semanal = frequency === "SEMANAL";
  const next = !enabled;

  function handleConfirm() {
    startTransition(async () => {
      const result = await setAutoDraftAction(companyId, next);
      if (result.success) {
        toast.success(
          next
            ? "Borrador automático activado. El 1 y el 16 encontrarás la nómina calculada esperando revisión."
            : "Borrador automático desactivado. Los procesos vuelven a crearse a mano."
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
      <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {enabled ? <BotIcon className="h-4 w-4 text-emerald-600" /> : <BotOffIcon className="h-4 w-4 text-gray-400" />}
            Borrador automático
            <span
              className={
                enabled
                  ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                  : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
              }
            >
              {enabled ? "Activado" : "Desactivado"}
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-600">
            {semanal
              ? "La nómina semanal no tiene un ciclo anclado en la configuración, así que el borrador automático no la cubre: se sigue creando a mano."
              : enabled
                ? "El 1 y el 16 el sistema deja el proceso del período que acaba de cerrar ya calculado. Aprobar sigue siendo tuyo."
                : "Si lo activas, el 1 y el 16 el sistema deja el proceso calculado esperando tu revisión. Nunca lo aprueba."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={semanal && !enabled}
          className="shrink-0"
        >
          {enabled ? "Desactivar" : "Activar"}
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {next ? "¿Activar el borrador automático?" : "¿Desactivar el borrador automático?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {next ? (
                  <>
                    <p>
                      El 1 y el 16, el sistema calculará el proceso del período que acaba de
                      terminar y lo dejará en <strong>borrador</strong>. Nunca lo aprueba: el
                      asiento contable lo genera una persona.
                    </p>
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                      Un borrador no es inocuo: reserva las horas extra del período —ningún otro
                      proceso las verá— y ocupa la ranura de ese período y esa moneda. Si tienes
                      trabajadores en dos monedas, el automático sólo cubre uno de los dos
                      segmentos; el otro lo sigues creando tú.
                    </p>
                    <p>
                      Mientras esté activo, el aviso del panel deja de ser &laquo;falta la
                      nómina&raquo; y pasa a ser <strong>&laquo;hay trabajadores sin
                      cobrar&raquo;</strong>, que también avisa si el proceso automático no
                      llegó a crearse.
                    </p>
                  </>
                ) : (
                  <p>
                    Dejarán de crearse borradores solos. Los procesos vuelven a crearse a mano
                    desde &laquo;Nuevo Proceso&raquo;, y el panel te seguirá avisando de los
                    trabajadores que no hayan cobrado un período cerrado.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirm(); }}
              disabled={isPending}
              aria-busy={isPending}
            >
              {isPending && <Loader2Icon className="animate-spin" />}
              {next ? "Activar" : "Desactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
