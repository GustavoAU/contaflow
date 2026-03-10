// src/components/accounting/PeriodManager.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarIcon, LockIcon, UnlockIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { openPeriodAction, closePeriodAction } from "@/modules/accounting/actions/period.actions";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Period = {
  id: string;
  year: number;
  month: number;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  openedBy: string;
  closedBy: string | null;
  _count?: { transactions: number };
};

type Props = {
  companyId: string;
  userId: string;
  periods: Period[];
  activePeriod: Period | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function getNextPeriod(periods: Period[]): { year: number; month: number } {
  if (periods.length === 0) {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }

  const sorted = [...periods].sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month
  );
  const last = sorted[0];

  if (last.month === 12) {
    return { year: last.year + 1, month: 1 };
  }
  return { year: last.year, month: last.month + 1 };
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function PeriodManager({ companyId, userId, periods, activePeriod }: Props) {
  const [isPending, startTransition] = useTransition();
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [localPeriods] = useState<Period[]>(periods);
  const [localActive] = useState<Period | null>(activePeriod);

  const nextPeriod = getNextPeriod(localPeriods);

  function handleOpen() {
    startTransition(async () => {
      const result = await openPeriodAction({
        companyId,
        userId,
        year: nextPeriod.year,
        month: nextPeriod.month,
      });

      if (result.success) {
        toast.success(
          `Período ${MONTH_NAMES[nextPeriod.month]} ${nextPeriod.year} abierto correctamente`
        );
        setOpenDialog(false);
        window.location.reload();
      } else {
        toast.error(result.error);
        setOpenDialog(false);
      }
    });
  }

  function handleClose() {
    startTransition(async () => {
      const result = await closePeriodAction({ companyId, userId });

      if (result.success) {
        toast.success("Período cerrado correctamente");
        setCloseDialog(false);
        window.location.reload();
      } else {
        toast.error(result.error);
        setCloseDialog(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ─── Estado del período activo ───────────────────────────────────── */}
      <div className="rounded-lg border bg-white p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarIcon className="h-5 w-5 text-blue-600" />
            <div>
              <h2 className="font-semibold">Período Activo</h2>
              {localActive ? (
                <p className="text-sm text-zinc-600">
                  {MONTH_NAMES[localActive.month]} {localActive.year}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">No hay período abierto</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {!localActive && (
              <Button onClick={() => setOpenDialog(true)} className="gap-2" disabled={isPending}>
                <PlusIcon className="h-4 w-4" />
                Abrir {MONTH_NAMES[nextPeriod.month]} {nextPeriod.year}
              </Button>
            )}

            {localActive && (
              <Button
                variant="destructive"
                onClick={() => setCloseDialog(true)}
                className="gap-2"
                disabled={isPending}
              >
                <LockIcon className="h-4 w-4" />
                Cerrar Período
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Historial de períodos ────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="border-b bg-zinc-50 px-4 py-3">
          <h2 className="text-sm font-semibold">Historial de Períodos</h2>
        </div>

        {localPeriods.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No hay períodos registrados.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Período</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Estado</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Asientos</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Abierto</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Cerrado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {localPeriods.map((period) => (
                <tr key={period.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-semibold">
                    {MONTH_NAMES[period.month]} {period.year}
                  </td>
                  <td className="px-4 py-3">
                    {period.status === "OPEN" ? (
                      <Badge className="gap-1 bg-green-100 text-green-700 hover:bg-green-100">
                        <UnlockIcon className="h-3 w-3" />
                        Abierto
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <LockIcon className="h-3 w-3" />
                        Cerrado
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">{period._count?.transactions ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {new Date(period.openedAt).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {period.closedAt ? new Date(period.closedAt).toLocaleDateString("es-VE") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Dialog: Abrir período ────────────────────────────────────────── */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir Período Contable</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-zinc-600">
              ¿Confirmas abrir el período{" "}
              <span className="font-semibold">
                {MONTH_NAMES[nextPeriod.month]} {nextPeriod.year}
              </span>
              ?
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Una vez abierto, podrás registrar asientos en este período.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleOpen} disabled={isPending}>
              {isPending ? "Abriendo..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Cerrar período ───────────────────────────────────────── */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar Período Contable</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-zinc-600">
              ¿Confirmas cerrar el período{" "}
              <span className="font-semibold">
                {localActive ? `${MONTH_NAMES[localActive.month]} ${localActive.year}` : ""}
              </span>
              ?
            </p>
            <p className="mt-2 text-xs font-medium text-amber-600">
              ⚠ Esta acción es irreversible. No podrás registrar más asientos en este período.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleClose} disabled={isPending}>
              {isPending ? "Cerrando..." : "Cerrar Período"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
