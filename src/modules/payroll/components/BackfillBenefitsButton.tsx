"use client";
// src/modules/payroll/components/BackfillBenefitsButton.tsx
//
// backfillBenefitsAction (ADR-015) existía en el backend desde NOM-D pero
// ningún componente lo llamaba — sin este botón, un trimestre que ya cerró
// contablemente (o que nunca tuvo período contable, ej. antes de que la
// empresa empezara a usar ContaFlow) queda sin acumular PARA SIEMPRE: el
// formulario normal de "Ejecutar acumulación" exige un período OPEN dentro
// del trimestre, y éste postea al período ACTIVO actual en su lugar.
//
// Encontrado en vivo (2026-09-06): una empresa real llevaba Q1/Q2/Q3-2026
// sin acumular ni una vez, sin forma de ponerse al día desde la pantalla.

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { backfillBenefitsAction } from "../actions/nom-d.actions";

interface Props {
  companyId: string;
}

export function BackfillBenefitsButton({ companyId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    employeesProcessed: number;
    quartersProcessed: number;
    totalAccrued: string;
  } | null>(null);

  function handleClick() {
    if (!window.confirm(
      "¿Poner al día las prestaciones sociales atrasadas? Esto acumulará TODOS los " +
      "trimestres faltantes (desde la fecha de contratación de cada empleado hasta hoy) " +
      "que aún no tengan acumulación registrada, posteando el ajuste en el período " +
      "contable activo actual. No se puede deshacer desde aquí."
    )) return;

    setResult(null);
    startTransition(async () => {
      const res = await backfillBenefitsAction(companyId);
      if (res.success) {
        setResult(res.data);
        toast.success(
          res.data.quartersProcessed > 0
            ? `Backfill completado: ${res.data.quartersProcessed} trimestre(s) en ${res.data.employeesProcessed} empleado(s)`
            : "No había trimestres pendientes de acumular"
        );
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Si un trimestre pasado quedó sin acumular (ej. el período contable de ese
        trimestre ya cerró, o la empresa no procesaba prestaciones antes de usar
        ContaFlow), «Ejecutar acumulación» arriba no puede corregirlo — exige un
        período abierto dentro de ese trimestre. Este botón pone al día a cada
        empleado desde su fecha de contratación, posteando el ajuste en el
        período activo actual.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
        className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
      >
        {isPending && <Loader2Icon className="size-4 animate-spin" />}
        {isPending ? "Procesando…" : "Poner al día trimestres atrasados"}
      </button>

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">Backfill completado</p>
          <p className="mt-1 text-green-700">
            Trimestres procesados: <span className="font-mono font-semibold">{result.quartersProcessed}</span>
            &nbsp;·&nbsp;
            Empleados: <span className="font-mono font-semibold">{result.employeesProcessed}</span>
            &nbsp;·&nbsp;
            Total acumulado: <span className="font-mono font-semibold">
              {Number(result.totalAccrued).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
