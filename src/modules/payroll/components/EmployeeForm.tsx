"use client";
// src/modules/payroll/components/EmployeeForm.tsx
// Fase NOM-B: formulario para crear/editar empleado (ADMIN_ONLY)

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { createEmployeeAction, updateEmployeeAction } from "../actions/employee.actions";
import type { EmployeeRow } from "../services/EmployeeService";
import { VENEZUELA_BANKS } from "../../payments/constants/venezuela-banks";

interface Props {
  companyId: string;
  initial?: EmployeeRow | null;
  onSaved?: (emp: EmployeeRow) => void;
}

const CONTRACT_OPTIONS = [
  { value: "INDEFINIDO", label: "Tiempo Indeterminado (Art. 61 LOTTT)" },
  { value: "DETERMINADO", label: "Tiempo Determinado (Art. 64 LOTTT)" },
  { value: "OBRA_DETERMINADA", label: "Por Obra Determinada (Art. 62 LOTTT)" },
];

const REGIME_OPTIONS = [
  { value: "POST_2012", label: "Post-LOTTT 2012" },
  { value: "MIXED", label: "Pre-1997 LOT (régimen mixto)" },
];

const CURRENCY_OPTIONS = [
  { value: "VES", label: "Bolívares (VES)" },
  { value: "USD", label: "Dólares (USD)" },
];

const WORKER_TYPE_OPTIONS = [
  { value: "EMPLEADO", label: "Empleado (Art. 1 LOTTT)" },
  { value: "OBRERO", label: "Obrero (Art. 1 LOTTT)" },
];

const MARITAL_STATUS_OPTIONS = [
  { value: "SOLTERO", label: "Soltero(a)" },
  { value: "CASADO", label: "Casado(a)" },
  { value: "DIVORCIADO", label: "Divorciado(a)" },
  { value: "VIUDO", label: "Viudo(a)" },
  { value: "UNION_ESTABLE", label: "Unión estable de hecho" },
];

const SCHEDULE_OPTIONS = [
  { value: "DIURNA", label: "Diurna (Art. 173 LOTTT)" },
  { value: "NOCTURNA", label: "Nocturna (Art. 175 LOTTT)" },
  { value: "MIXTA", label: "Mixta (Art. 176 LOTTT)" },
];

export default function EmployeeForm({ companyId, initial, onSaved }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!initial;

  const [form, setForm] = useState({
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    cedulaType: initial?.cedulaType ?? "V",
    cedulaNumber: initial?.cedulaNumber ?? "",
    contractType: initial?.contractType ?? "INDEFINIDO",
    employeeRegime: initial?.employeeRegime ?? "POST_2012",
    hireDate: initial?.hireDate ?? "",
    position: initial?.position ?? "",
    department: initial?.department ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    bankName: initial?.bankName ?? "",
    bankAccount: initial?.bankAccount ?? "",
    costCenter: initial?.costCenter ?? "",
    // Solo en creación
    initialSalaryAmount: "",
    initialSalaryCurrency: "VES" as "VES" | "USD" | "MIXED",
    // F-01: parafiscal
    ivssNumber: initial?.ivssNumber ?? "",
    banavihNumber: initial?.banavihNumber ?? "",
    dependents: initial?.dependents?.toString() ?? "",
    birthDate: initial?.birthDate ?? "",
    workSchedule: initial?.workSchedule ?? "",
    // F-02: clasificación LOTTT + estado civil
    maritalStatus: initial?.maritalStatus ?? "",
    payrollWorkerType: initial?.payrollWorkerType ?? "EMPLEADO",
    contractEndDate: initial?.contractEndDate ?? "",
    useFideicomiso: initial?.useFideicomiso ?? false,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const action = isEdit
        ? updateEmployeeAction(companyId, initial!.id, form)
        : createEmployeeAction(companyId, form);
      const result = await action;
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved?.(result.data);
    });
  }

  const SECTIONS = isEdit
    ? ["Identificación", "Datos personales", "Contrato", "Banco", "Parafiscales"]
    : ["Identificación", "Datos personales", "Contrato", "Banco", "Parafiscales", "Salario inicial"];

  return (
    <div className="space-y-5 rounded-lg border p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold">
          {isEdit ? "Editar empleado" : "Registrar empleado"}
        </h2>
        {/* U-06: índice de secciones del formulario */}
        <ol className="flex flex-wrap gap-1.5" aria-label="Secciones del formulario">
          {SECTIONS.map((sec, i) => (
            <li
              key={sec}
              className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold leading-none">
                {i + 1}
              </span>
              {sec}
            </li>
          ))}
        </ol>
      </div>

      {/* Identificación */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Nombre *</label>
          <input
            type="text"
            value={form.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Nombre(s)"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Apellido *</label>
          <input
            type="text"
            value={form.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Apellido(s)"
          />
        </div>
      </div>

      {!isEdit && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tipo cédula *</label>
            <select
              value={form.cedulaType}
              onChange={(e) => set("cedulaType", e.target.value as "V" | "E")}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="V">V (Venezolano)</option>
              <option value="E">E (Extranjero)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Número de cédula *
            </label>
            <input
              type="text"
              value={form.cedulaNumber}
              onChange={(e) => set("cedulaNumber", e.target.value.replace(/\D/g, ""))}
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="12345678"
              maxLength={9}
            />
          </div>
        </div>
      )}

      {/* ② Datos personales */}
      <div className="border-t pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">② Datos personales</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Fecha de nacimiento</label>
          <input
            type="date"
            value={form.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Estado civil{" "}
            <span className="text-gray-400 font-normal">(ISLR D. 1808)</span>
          </label>
          <select
            value={form.maritalStatus}
            onChange={(e) => set("maritalStatus", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="">— Sin especificar —</option>
            {MARITAL_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ③ Contrato */}
      <div className="border-t pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">③ Contrato</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tipo contrato *</label>
          <select
            value={form.contractType}
            onChange={(e) => set("contractType", e.target.value as typeof form.contractType)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            {CONTRACT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Régimen LOTTT *
          </label>
          <select
            value={form.employeeRegime}
            onChange={(e) => set("employeeRegime", e.target.value as typeof form.employeeRegime)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            {REGIME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {form.contractType === "DETERMINADO" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Fecha de vencimiento del contrato{" "}
            <span className="text-gray-400 font-normal">(LOTTT Art. 64)</span>
          </label>
          <input
            type="date"
            value={form.contractEndDate}
            onChange={(e) => set("contractEndDate", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      )}

      {!isEdit && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Fecha de ingreso *
          </label>
          <input
            type="date"
            value={form.hireDate}
            onChange={(e) => set("hireDate", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      )}

      {/* Clasificación LOTTT */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Tipo trabajador *{" "}
            <span className="text-gray-400 font-normal">(Art. 1 LOTTT)</span>
          </label>
          <select
            value={form.payrollWorkerType}
            onChange={(e) => set("payrollWorkerType", e.target.value as "EMPLEADO" | "OBRERO")}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            {WORKER_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Jornada laboral</label>
          <select
            value={form.workSchedule}
            onChange={(e) => set("workSchedule", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="">— Sin especificar —</option>
            {SCHEDULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cargo */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Cargo *</label>
          <input
            type="text"
            value={form.position}
            onChange={(e) => set("position", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="ej. Contador, Vendedor..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Departamento</label>
          <input
            type="text"
            value={form.department}
            onChange={(e) => set("department", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="ej. Administración"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Centro de Costo</label>
          <input
            type="text"
            value={form.costCenter}
            onChange={(e) => set("costCenter", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="ej. CC-ADM-01"
            maxLength={100}
          />
        </div>
      </div>

      {/* Contacto */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Teléfono</label>
          <input
            type="text"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* ④ Banco */}
      <div className="border-t pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">④ Datos bancarios</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Banco</label>
          <select
            value={form.bankName}
            onChange={(e) => set("bankName", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-white"
          >
            <option value="">— Seleccionar banco —</option>
            {VENEZUELA_BANKS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Cuenta bancaria</label>
          <input
            type="text"
            value={form.bankAccount}
            onChange={(e) => set("bankAccount", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* ⑤ Parafiscal */}
      <div className="border-t pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">⑤ Parafiscales</p>
      </div>
      <div className="rounded bg-slate-50 p-4 space-y-3">
        <p className="text-xs font-medium text-slate-700">
          Datos parafiscales{" "}
          <span className="font-normal text-slate-500">(IVSS Forma 14-02, Banavih, ISLR D. 1808)</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              N° afiliación IVSS
            </label>
            <input
              type="text"
              value={form.ivssNumber}
              onChange={(e) => set("ivssNumber", e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm font-mono"
              placeholder="ej. 12-34567890-1"
              maxLength={20}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              N° afiliación Banavih/FAOV
            </label>
            <input
              type="text"
              value={form.banavihNumber}
              onChange={(e) => set("banavihNumber", e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm font-mono"
              placeholder="Número FAOVWeb"
              maxLength={20}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Cargas familiares{" "}
            <span className="text-gray-400 font-normal">(hijos u otros dependientes — D. 1808)</span>
          </label>
          <input
            type="number"
            min="0"
            max="20"
            value={form.dependents}
            onChange={(e) => set("dependents", e.target.value)}
            className="w-32 rounded border px-3 py-2 text-sm"
            placeholder="0"
          />
        </div>
      </div>

      {/* Fideicomiso individual (Art. 143 LOTTT parte final) */}
      <div className="flex items-start gap-3 rounded border bg-slate-50 px-4 py-3">
        <input
          type="checkbox"
          id="useFideicomiso"
          checked={form.useFideicomiso}
          onChange={(e) => set("useFideicomiso", e.target.checked)}
          className="mt-0.5 accent-blue-600"
        />
        <div>
          <label htmlFor="useFideicomiso" className="text-xs font-medium text-slate-700 cursor-pointer">
            Fideicomiso bancario individual{" "}
            <span className="font-normal text-slate-500">(Art. 143 LOTTT)</span>
          </label>
          <p className="text-xs text-slate-400 mt-0.5">
            Activa si el trabajador optó por depositar sus prestaciones en un fideicomiso bancario real.
            Por defecto, el sistema lleva contabilidad interna.
          </p>
        </div>
      </div>

      {/* ⑥ Salario inicial — solo en creación */}
      {!isEdit && (
        <>
          <div className="border-t pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">⑥ Salario inicial</p>
          </div>
        </>
      )}
      {!isEdit && (
        <div className="rounded bg-blue-50 p-4">
          <p className="mb-2 text-xs font-medium text-blue-800">
            Salario inicial (opcional — puedes agregarlo después)
          </p>
          {/* U-07: indicador de salario mínimo legal */}
          <p className="mb-3 text-xs text-blue-700">
            Salario mínimo legal vigente (LOTTT Art. 130):{" "}
            <strong>VES 130,00</strong> — verifica en{" "}
            <a
              href="https://www.minpptrass.gob.ve"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-900"
            >
              MINPPTRASS
            </a>
            . El sistema valida el tope de cotización IVSS/INCES con el valor configurado en
            Nómina → Configuración → Salario Mínimo.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.initialSalaryAmount}
                onChange={(e) => set("initialSalaryAmount", e.target.value)}
                placeholder="0.00"
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <select
                value={form.initialSalaryCurrency}
                onChange={(e) =>
                  set("initialSalaryCurrency", e.target.value as typeof form.initialSalaryCurrency)
                }
                className="w-full rounded border px-3 py-2 text-sm"
              >
                {CURRENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="size-4 animate-spin" />}
          {isPending ? "Guardando..." : isEdit ? "Guardar cambios" : "Registrar empleado"}
        </button>
      </div>
    </div>
  );
}
