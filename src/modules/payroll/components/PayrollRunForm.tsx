"use client";

// src/modules/payroll/components/PayrollRunForm.tsx
// Fase NOM-C: formulario para crear un nuevo proceso de nómina

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPayrollRunAction } from "../actions/payroll-run.actions";

interface Props {
  companyId: string;
  activeEmployeeCount?: number;
  initialStart?: string;
  initialEnd?: string;
}

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const day = now.getDate();

  if (day <= 15) {
    // Primera quincena
    return {
      start: `${year}-${mm}-01`,
      end: `${year}-${mm}-15`,
    };
  } else {
    // Segunda quincena
    return {
      start: `${year}-${mm}-16`,
      end: `${year}-${mm}-${lastDay}`,
    };
  }
}

function computeEndFromStart(startISO: string): string {
  const [year, month, day] = startISO.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  if (day <= 15) {
    return `${year}-${mm}-15`;
  }
  return `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
}

export function PayrollRunForm({ companyId, activeEmployeeCount, initialStart, initialEnd }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const defaults = getDefaultPeriod();
  const [periodStart, setPeriodStart] = useState(initialStart ?? defaults.start);
  const [periodEnd, setPeriodEnd] = useState(initialEnd ?? defaults.end);
  const [error, setError] = useState<string | null>(null);

  function handleStartChange(value: string) {
    setPeriodStart(value);
    if (value) setPeriodEnd(computeEndFromStart(value));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createPayrollRunAction(companyId, {
        periodStart,
        periodEnd,
        idempotencyKey: generateIdempotencyKey(),
      });

      if (result.success) {
        toast.success("Proceso de nómina creado exitosamente");
        router.push(`/company/${companyId}/payroll/runs/${result.data.id}`);
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Nuevo Proceso de Nómina</h2>
        <p className="mt-1 text-sm text-gray-500">
          Se calcularán automáticamente todos los empleados activos con salario vigente.
        </p>
        {activeEmployeeCount !== undefined && (
          <p className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
            activeEmployeeCount === 0
              ? "bg-amber-50 text-amber-700"
              : "bg-blue-50 text-blue-700"
          }`}>
            {activeEmployeeCount === 0
              ? "Sin empleados activos registrados"
              : `Se procesarán ${activeEmployeeCount} empleado${activeEmployeeCount !== 1 ? "s" : ""} activo${activeEmployeeCount !== 1 ? "s" : ""}`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha de inicio
          </label>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => handleStartChange(e.target.value)}
            required
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha de fin
          </label>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>Incluye automáticamente:</strong>
        <ul className="mt-1 ml-4 list-disc text-xs space-y-0.5 text-blue-700">
          <li>Salario básico + IVSS (4%), INCES (2%), FAOV (1%) según configuración</li>
          <li>Cuotas de préstamos activos como deducciones automáticas</li>
          <li>Tasa BCV de interés del período (snapshot del registro mensual)</li>
          <li>Asiento de causación GL generado automáticamente al aprobar</li>
        </ul>
        <p className="mt-1 text-xs text-blue-600">Horas extra e ISLR se agregan como conceptos manuales en el detalle del proceso.</p>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="size-4 animate-spin" />}
          {isPending ? "Calculando…" : "Calcular Nómina"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
