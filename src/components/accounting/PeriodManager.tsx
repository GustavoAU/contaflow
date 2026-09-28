// src/components/accounting/PeriodManager.tsx
// ADR-055: ya no es "abrir mes siguiente / cerrar este mes" — es "abrir ejercicio
// completo" (12 meses de una vez) y "cerrar ejercicio completo" (link a /fiscal-close,
// que ya lo trata como operación atómica de todo el año).
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarIcon, PlusIcon, Loader2Icon, LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { openFiscalYearAction } from "@/modules/accounting/actions/fiscal-year.actions";
import type { FiscalYearWithPeriods } from "@/modules/accounting/services/FiscalYearService";

type Props = {
  companyId: string;
  fiscalYears: FiscalYearWithPeriods[];
};

const MAX_CONCURRENT_OPEN = 2;

/** Mismo cálculo que FiscalYearService.openFiscalYear (D-10) — solo para el label del botón. */
function nextFiscalYearLabel(mostRecent: FiscalYearWithPeriods | undefined): number | null {
  if (!mostRecent) return null;
  const totalMonths = mostRecent.year * 12 + (mostRecent.startMonth - 1) + 12;
  return Math.floor(totalMonths / 12);
}

export function PeriodManager({ companyId, fiscalYears }: Props) {
  const [isPending, startTransition] = useTransition();
  const [openDialog, setOpenDialog] = useState(false);
  const [bootstrapYear, setBootstrapYear] = useState(() => String(new Date().getFullYear()));

  // fiscalYears viene ordenado más reciente primero (FiscalYearService.getFiscalYears).
  const openYears = fiscalYears.filter((fy) => fy.status === "OPEN");
  const closedYears = fiscalYears.filter((fy) => fy.status === "CLOSED");
  const activeFiscalYear = openYears[0] ?? null; // D-3: el OPEN más reciente
  const closingFiscalYear = openYears[1] ?? null; // el otro OPEN (a lo sumo 1 más, D-9)

  const nextYear = nextFiscalYearLabel(fiscalYears[0]);
  const canOpenNext = openYears.length < MAX_CONCURRENT_OPEN;

  function handleOpenNext() {
    if (nextYear === null) return;
    startTransition(async () => {
      const result = await openFiscalYearAction({ companyId, year: nextYear });
      if (result.success) {
        toast.success(`Ejercicio fiscal ${result.data.year} abierto correctamente`);
        window.location.reload();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleOpenBootstrap() {
    const year = parseInt(bootstrapYear, 10);
    startTransition(async () => {
      const result = await openFiscalYearAction({ companyId, year });
      if (result.success) {
        toast.success(`Ejercicio fiscal ${result.data.year} abierto correctamente`);
        setOpenDialog(false);
        window.location.reload();
      } else {
        toast.error(result.error);
        setOpenDialog(false);
      }
    });
  }

  const currentYear = new Date().getFullYear();
  const bootstrapYearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="space-y-6">
      {/* ─── Sin ningún ejercicio — bootstrap ────────────────────────────── */}
      {fiscalYears.length === 0 && (
        <div className="rounded-lg border bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarIcon className="h-5 w-5 text-blue-600" />
              <div>
                <h2 className="font-semibold">Ejercicio Fiscal</h2>
                <p className="text-muted-foreground text-sm">
                  No hay ningún ejercicio fiscal abierto todavía.
                </p>
              </div>
            </div>
            <Button onClick={() => setOpenDialog(true)} className="gap-2" disabled={isPending}>
              <PlusIcon className="h-4 w-4" />
              Abrir primer ejercicio
            </Button>
          </div>
        </div>
      )}

      {/* ─── Ejercicio activo ─────────────────────────────────────────────── */}
      {activeFiscalYear && (
        <div className="rounded-lg border bg-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarIcon className="h-5 w-5 text-blue-600" />
              <div>
                <h2 className="font-semibold">Ejercicio Activo</h2>
                <p className="text-2xl font-bold tracking-tight text-zinc-800">
                  {activeFiscalYear.year}
                </p>
                <p className="text-muted-foreground text-xs">
                  {activeFiscalYear.periods.length} meses abiertos · desde{" "}
                  {new Date(activeFiscalYear.openedAt).toLocaleDateString("es-VE")}
                </p>
              </div>
            </div>
            {nextYear !== null && (
              <Button
                onClick={handleOpenNext}
                disabled={isPending || !canOpenNext}
                title={!canOpenNext ? "Ya hay 2 ejercicios abiertos — cierra uno primero" : undefined}
                className="gap-2"
              >
                {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                <PlusIcon className="h-4 w-4" />
                Abrir ejercicio {nextYear}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ─── Ejercicio en cierre (el otro OPEN, a lo sumo 1) ────────────────── */}
      {closingFiscalYear && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LockIcon className="h-5 w-5 text-amber-600" />
              <div>
                <h2 className="font-semibold text-amber-800">Ejercicio en Cierre</h2>
                <p className="text-sm text-amber-700">
                  {closingFiscalYear.year} — todavía abierto, pendiente de cerrar (declaración ISLR).
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-100">
              <Link href={`/company/${companyId}/fiscal-close`}>Ir a cerrar ejercicio</Link>
            </Button>
          </div>
        </div>
      )}

      {/* ─── Ejercicios cerrados ──────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="border-b bg-zinc-50 px-4 py-3">
          <h2 className="text-sm font-semibold">Historial de Ejercicios</h2>
        </div>

        {fiscalYears.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No hay ejercicios fiscales registrados.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Ejercicio</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Estado</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Meses</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Abierto</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Cerrado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {fiscalYears.map((fy) => (
                <tr key={fy.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-semibold">{fy.year}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={fy.status} />
                  </td>
                  <td className="px-4 py-3 font-mono">{fy.periods.length}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {new Date(fy.openedAt).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {fy.closedAt ? new Date(fy.closedAt).toLocaleDateString("es-VE") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {closedYears.length > 0 && closedYears.length === fiscalYears.length && (
        <p className="text-muted-foreground text-center text-xs">
          Todos los ejercicios están cerrados — abre uno nuevo para seguir registrando.
        </p>
      )}

      {/* ─── Dialog: abrir primer ejercicio (bootstrap) ─────────────────────── */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir Primer Ejercicio Fiscal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <p className="text-sm text-zinc-600">
              Se abrirán los 12 meses del ejercicio de una vez, listos para registrar operaciones.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">Año del ejercicio</label>
              <Select value={bootstrapYear} onValueChange={setBootstrapYear}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bootstrapYearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleOpenBootstrap} disabled={isPending}>
              {isPending && <Loader2Icon className="animate-spin" />}
              {isPending ? "Abriendo..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
