"use client";
// src/modules/payroll/components/ConceptList.tsx
// Fase NOM-B: tabla de conceptos de nómina + toggle activo/inactivo (ADMIN_ONLY)

import { useState, useTransition } from "react";
import { updateConceptAction, deleteConceptAction } from "../actions/payroll-concept.actions";
import type { PayrollConceptRow } from "../services/PayrollConceptService";

interface Props {
  companyId: string;
  initial: PayrollConceptRow[];
  canWrite: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  EARNING: "Asignación",
  DEDUCTION: "Deducción",
};

const TYPE_CLASSES: Record<string, string> = {
  EARNING: "bg-green-100 text-green-800",
  DEDUCTION: "bg-red-100 text-red-800",
};

export default function ConceptList({ companyId, initial, canWrite }: Props) {
  const [concepts, setConcepts] = useState<PayrollConceptRow[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});

  function setError(id: string, msg: string) {
    setErrorMap((prev) => ({ ...prev, [id]: msg }));
  }

  function toggleActive(concept: PayrollConceptRow) {
    startTransition(async () => {
      const result = await updateConceptAction(companyId, concept.id, {
        name: concept.name,
        isActive: !concept.isActive,
      });
      if (!result.success) {
        setError(concept.id, result.error);
        return;
      }
      setConcepts((prev) => prev.map((c) => (c.id === concept.id ? result.data : c)));
    });
  }

  function handleDelete(concept: PayrollConceptRow) {
    if (concept.isSystem) {
      setError(concept.id, "Los conceptos del sistema no se pueden eliminar.");
      return;
    }
    if (!confirm(`¿Eliminar el concepto "${concept.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteConceptAction(companyId, concept.id);
      if (!result.success) {
        setError(concept.id, result.error);
        return;
      }
      setConcepts((prev) => prev.filter((c) => c.id !== concept.id));
    });
  }

  const earnings = concepts.filter((c) => c.type === "EARNING");
  const deductions = concepts.filter((c) => c.type === "DEDUCTION");

  function renderGroup(title: string, items: PayrollConceptRow[]) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        <div className="overflow-hidden rounded border">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Código</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Nombre</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Tipo</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Estado</th>
                {canWrite && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((concept) => (
                <>
                  <tr key={concept.id} className={!concept.isActive ? "opacity-50" : ""}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">{concept.code}</td>
                    <td className="px-4 py-2 font-medium">
                      {concept.name}
                      {concept.isSystem && (
                        <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                          Sistema
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          TYPE_CLASSES[concept.type] ?? ""
                        }`}
                      >
                        {TYPE_LABELS[concept.type] ?? concept.type}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          concept.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {concept.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-2 text-right">
                        {concept.isSystem ? (
                          <span
                            title="Este concepto es requerido por ley y no puede desactivarse"
                            className="mr-3 cursor-not-allowed text-xs text-gray-400"
                          >
                            {concept.isActive ? "Desactivar" : "Activar"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => toggleActive(concept)}
                            className="mr-3 text-xs text-blue-600 hover:underline disabled:opacity-50"
                          >
                            {concept.isActive ? "Desactivar" : "Activar"}
                          </button>
                        )}
                        {!concept.isSystem && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleDelete(concept)}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {errorMap[concept.id] && (
                    <tr key={`${concept.id}-err`}>
                      <td colSpan={5} className="px-4 pb-2 text-xs text-red-600">
                        {errorMap[concept.id]}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {earnings.length > 0 && renderGroup("Asignaciones", earnings)}
      {deductions.length > 0 && renderGroup("Deducciones", deductions)}
      {concepts.length === 0 && (
        <p className="text-sm text-gray-400 italic">No hay conceptos configurados.</p>
      )}
    </div>
  );
}
