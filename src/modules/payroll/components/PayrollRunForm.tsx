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
  // C-01: threshold salario mínimo vigente
  salMinLastUpdate?: string | null;
  salMinValue?: string | null;
  // C-02: indica si existe tasa BCV para el mes actual
  hasBcvRateForMonth?: boolean;
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
    return {
      start: `${year}-${mm}-01`,
      end: `${year}-${mm}-15`,
    };
  } else {
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

export function PayrollRunForm({
  companyId,
  activeEmployeeCount,
  initialStart,
  initialEnd,
  salMinLastUpdate,
  salMinValue,
  hasBcvRateForMonth = true,
}: Props) {
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

  // C-01: salario mínimo desactualizado si es null o tiene >30 días sin actualizar
  const salMinIsStale = !salMinLastUpdate
    || (Date.now() - new Date(salMinLastUpdate).getTime()) > 30 * 24 * 60 * 60 * 1000;

  const salMinFormatted = salMinValue
    ? `Bs. ${parseFloat(salMinValue).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
  const ivssCapFormatted = salMinValue
    ? `Bs. ${(parseFloat(salMinValue) * 5).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
  const faovCapFormatted = salMinValue
    ? `Bs. ${(parseFloat(salMinValue) * 10).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  const salMinLastUpdateFormatted = salMinLastUpdate
    ? new Date(salMinLastUpdate).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    : null;

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

      {/* C-01: Alerta salario mínimo desactualizado */}
      {salMinIsStale && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            Salario mínimo desactualizado — bases de cotización incorrectas
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {salMinLastUpdate
              ? `Último registro: ${salMinLastUpdateFormatted} (hace más de 30 días).`
              : "No hay registro de salario mínimo vigente para esta empresa."}
            {salMinFormatted && (
              <> Valor actual: <span className="font-mono font-semibold">{salMinFormatted}</span>.</>
            )}
          </p>
          {ivssCapFormatted && faovCapFormatted && (
            <p className="mt-1 text-xs text-amber-800">
              Topes actuales: IVSS/INCES/RPE = <span className="font-mono">{ivssCapFormatted}</span> (5×) ·{" "}
              FAOV = <span className="font-mono">{faovCapFormatted}</span> (10×).
              Consulta el decreto vigente en MINPPTRASS y actualiza en{" "}
              <a
                href={`/company/${companyId}/payroll/thresholds`}
                className="underline hover:text-amber-900"
              >
                Topes Legales
              </a>.
            </p>
          )}
          {!salMinFormatted && (
            <a
              href={`/company/${companyId}/payroll/thresholds`}
              className="mt-1 block text-xs underline hover:text-amber-900"
            >
              Registrar salario mínimo vigente →
            </a>
          )}
        </div>
      )}

      {/* C-02: Sin tasa BCV para el período — intereses Art. 143 LOTTT no se calcularán */}
      {!hasBcvRateForMonth && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <p className="font-medium">Sin tasa BCV para el mes actual (Art. 143 LOTTT)</p>
          <p className="mt-0.5 text-xs text-blue-700">
            No hay tasa BCV registrada para este período. El snapshot <span className="font-mono">bcvRateAtRun</span>{" "}
            quedará vacío y los intereses sobre prestaciones no podrán calcularse para este proceso.{" "}
            <a
              href={`/company/${companyId}/payroll/benefits`}
              className="underline hover:text-blue-900"
            >
              Registrar tasa BCV →
            </a>
          </p>
        </div>
      )}

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
