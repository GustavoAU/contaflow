"use client";

// src/modules/payroll/components/PayrollRunForm.tsx
// Fase NOM-C: formulario para crear un nuevo proceso de nómina

import { useMemo, useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPayrollRunAction } from "../actions/payroll-run.actions";
import { salaryCurrencyAt, type SalaryVigencia } from "../utils/salary-vigencia";
import { periodoPorDefecto, finDesdeInicio } from "../utils/payroll-period";
import type { PayrollFrequency } from "@prisma/client";
import { todayLocalISO } from "@/lib/today";
import { EmployeePicker } from "./EmployeePicker";

export interface RunEmployeeOption {
  id: string;
  name: string;
  // Vigencias del sueldo, de la más reciente a la más antigua. Se mandan todas
  // en vez de la moneda ya resuelta porque cuál rige depende de la fecha de
  // inicio, y esa se elige aquí: resolverla en el servidor la dejaba clavada a
  // la fecha con la que se cargó la página.
  salaries: SalaryVigencia[];
}

/** Un trabajador con su moneda ya resuelta a la fecha del período. */
export interface PickerEmployee {
  id: string;
  name: string;
  // `null` = sin sueldo vigente al inicio del período: el calculador lo
  // descarta, así que no se puede incluir.
  currency: SalaryVigencia["currency"] | null;
}

// Con una sola moneda no hay nada que elegir: van todos, como siempre. Con
// varias arranca preseleccionada la más numerosa, que es la que la empresa
// procesa de ordinario.
function seleccionPorDefecto(elegibles: PickerEmployee[]): Set<string> {
  const monedas = [...new Set(elegibles.map((e) => e.currency))];
  if (monedas.length <= 1) return new Set(elegibles.map((e) => e.id));
  const mayoritaria = monedas.sort(
    (a, b) => elegibles.filter((e) => e.currency === b).length
            - elegibles.filter((e) => e.currency === a).length,
  )[0];
  return new Set(elegibles.filter((e) => e.currency === mayoritaria).map((e) => e.id));
}

interface Props {
  companyId: string;
  employees?: RunEmployeeOption[];
  activeEmployeeCount?: number;
  initialStart?: string;
  initialEnd?: string;
  // C-01: threshold salario mínimo vigente
  salMinLastUpdate?: string | null;
  salMinValue?: string | null;
  // C-02: indica si existe tasa BCV para el mes actual
  hasBcvRateForMonth?: boolean;
  // Frecuencia configurada de la empresa. Decide los cortes que se proponen:
  // hasta ahora el formulario proponia SIEMPRE quincenas y el campo no se
  // miraba, asi que la configuracion y la practica podian discrepar.
  frequency?: PayrollFrequency;
  // Hoy en la zona del pais, calculado en el servidor. Derivarlo aqui con
  // `new Date()` da UTC en el render del servidor: despues de las 20:00 en
  // Venezuela ya es manana, y el periodo nacia corrido un dia.
  todayISO?: string;
}

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function PayrollRunForm({
  companyId,
  employees,
  activeEmployeeCount,
  initialStart,
  initialEnd,
  salMinLastUpdate,
  salMinValue,
  hasBcvRateForMonth = true,
  frequency = "BIWEEKLY",
  todayISO,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // `todayISO` viene del servidor en la zona del país. El respaldo usa
  // todayLocalISO() —la del navegador—, nunca toISOString(): en husos
  // negativos eso da MAÑANA a partir de las 20:00.
  const defaults = periodoPorDefecto(todayISO ?? todayLocalISO(), frequency);
  const [periodStart, setPeriodStart] = useState(initialStart ?? defaults.start);
  const [periodEnd, setPeriodEnd] = useState(initialEnd ?? defaults.end);

  // ── Quiénes entran en esta nómina ─────────────────────────────────────────
  // El calculador BLOQUEA las monedas mixtas (C-01): sumar bolívares y dólares
  // da un total que no es de ninguna de las dos. Una empresa con sueldos en las
  // dos monedas no podía procesar NADA desde aquí, porque el formulario no
  // dejaba elegir a quién incluir aunque la action sí lo aceptaba.
  //
  // La moneda se resuelve a la fecha de inicio con la MISMA regla que aplica el
  // servicio al calcular (ver salary-vigencia.ts): mostrarla sin mirar la fecha
  // hacía que la pantalla y el cálculo discreparan justo cuando un sueldo cambia
  // dentro del período.
  const conMoneda: PickerEmployee[] = useMemo(
    () => (employees ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      currency: salaryCurrencyAt(e.salaries, periodStart),
    })),
    [employees, periodStart],
  );

  const elegibles = useMemo(
    () => conMoneda.filter((e) => e.currency !== null),
    [conMoneda],
  );
  const monedas = useMemo(
    () => [...new Set(elegibles.map((e) => e.currency))],
    [elegibles],
  );
  const hayMonedasMixtas = monedas.length > 1;

  const [selected, setSelected] = useState<Set<string>>(() => seleccionPorDefecto(elegibles));

  // Mover la fecha de inicio cambia quién es elegible y en qué moneda, así que
  // las marcas anteriores se hicieron sobre datos que ya no son ciertos: se
  // rehace la selección por defecto. Es el patrón de React para estado derivado
  // de un valor que cambia (ajustar durante el render, no en un efecto).
  const [startAplicado, setStartAplicado] = useState(periodStart);
  if (startAplicado !== periodStart) {
    setStartAplicado(periodStart);
    setSelected(seleccionPorDefecto(elegibles));
  }

  const monedasSeleccionadas = [...new Set(
    elegibles.filter((e) => selected.has(e.id)).map((e) => e.currency),
  )];
  const seleccionInvalida = monedasSeleccionadas.length > 1;

  function toggleEmployee(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectCurrency(cur: string) {
    setSelected(new Set(elegibles.filter((e) => e.currency === cur).map((e) => e.id)));
  }
  const [error, setError] = useState<string | null>(null);

  function handleStartChange(value: string) {
    setPeriodStart(value);
    if (value) setPeriodEnd(finDesdeInicio(value, frequency));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createPayrollRunAction(companyId, {
        periodStart,
        periodEnd,
        idempotencyKey: generateIdempotencyKey(),
        // Vacío = todos los activos, que es el comportamiento de siempre.
        ...(selected.size > 0 && selected.size < elegibles.length
          ? { employeeIds: [...selected] }
          : {}),
      });

      if (result.success) {
        // LOTTT Art. 178. La nómina se procesa igual —las horas se trabajaron y
        // hay que pagarlas— pero la empresa tiene que enterarse de que excedió.
        const avisos = result.data.overtimeWarnings ?? [];
        if (avisos.length > 0) {
          toast.warning(
            `Nómina creada con ${avisos.length} exceso(s) de horas extraordinarias`,
            { description: avisos[0], duration: 10000 },
          );
        } else {
          toast.success("Proceso de nómina creado exitosamente");
        }
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

  // El badge decía "se procesarán N activos" mientras abajo había menos
  // marcados: la pantalla se contradecía a sí misma. Se arma aquí y no dentro
  // del JSX a propósito — un ternario anidado más ahí dentro tumba el build de
  // este archivo con "Zone Allocation failed", que no es falta de heap y por
  // eso no se arregla subiendo --max-old-space-size.
  const plural = activeEmployeeCount !== 1 ? "s" : "";
  const resumenPlantilla = activeEmployeeCount === 0
    ? "Sin empleados activos registrados"
    : employees === undefined
      ? `Se procesarán ${activeEmployeeCount} empleado${plural} activo${plural}`
      : `Se procesarán ${selected.size} de ${activeEmployeeCount} empleado${plural} activo${plural}`;

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
            {resumenPlantilla}
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
        <p className="mt-1 text-xs text-blue-600">Las horas extra se toman del registro del período (LOTTT Art. 183). El ISLR se agrega como concepto manual en el detalle.</p>
      </div>

      <EmployeePicker
        employees={elegibles}
        selected={selected}
        onToggle={toggleEmployee}
        onSelectCurrency={selectCurrency}
        currencies={monedas}
        mixed={hayMonedasMixtas}
        invalidMix={seleccionInvalida ? monedasSeleccionadas.join(" y ") : null}
      />

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || seleccionInvalida || (elegibles.length > 0 && selected.size === 0)}
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
