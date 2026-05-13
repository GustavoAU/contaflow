"use client";
// src/modules/payroll/components/EmployeeForm.tsx
// Fase NOM-B: formulario para crear/editar empleado (ADMIN_ONLY)

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { createEmployeeAction, updateEmployeeAction } from "../actions/employee.actions";
import type { EmployeeRow } from "../services/EmployeeService";

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

  return (
    <div className="space-y-5 rounded-lg border p-6">
      <h2 className="text-lg font-semibold">
        {isEdit ? "Editar empleado" : "Registrar empleado"}
      </h2>

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

      {/* Contrato */}
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

      {/* Datos bancarios */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Banco</label>
          <input
            type="text"
            value={form.bankName}
            onChange={(e) => set("bankName", e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="ej. Banesco, BDV..."
          />
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

      {/* Salario inicial — solo en creación */}
      {!isEdit && (
        <div className="rounded bg-blue-50 p-4">
          <p className="mb-2 text-xs font-medium text-blue-800">
            Salario inicial (opcional — puedes agregarlo después)
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
