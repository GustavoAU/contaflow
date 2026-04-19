"use client";
// src/modules/vendors/components/CustomerList.tsx

import { useState, useTransition } from "react";
import { createCustomerAction, deleteCustomerAction } from "../actions/customer.actions";
import type { CustomerRow } from "../services/CustomerService";

type Props = {
  companyId: string;
  initialCustomers: CustomerRow[];
  canWrite: boolean;
  canDelete: boolean;
};

export function CustomerList({ companyId, initialCustomers, canWrite, canDelete }: Props) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [createName, setCreateName] = useState("");
  const [createRif, setCreateRif] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const r = await createCustomerAction(companyId, {
        name: createName, rif: createRif || undefined,
        email: createEmail || undefined, phone: createPhone || undefined,
      });
      if (!r.success) { setError(r.error); return; }
      setCustomers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      setCreateName(""); setCreateRif(""); setCreateEmail(""); setCreatePhone("");
    });
  }

  function handleDelete(customerId: string, name: string) {
    if (!confirm(`¿Desactivar a "${name}"? Las facturas vinculadas se conservan.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteCustomerAction(companyId, customerId);
      if (!r.success) { setError(r.error); return; }
      setCustomers(prev => prev.filter(c => c.id !== customerId));
    });
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Nuevo cliente
          </button>
        </div>
      )}

      {showCreate && canWrite && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 space-y-3">
          <p className="text-sm font-medium text-emerald-800">Nuevo cliente</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              className="rounded border px-2 py-1.5 text-sm"
              placeholder="Nombre *"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
            />
            <input
              className="rounded border px-2 py-1.5 text-sm"
              placeholder="RIF (J-12345678-9)"
              value={createRif}
              onChange={e => setCreateRif(e.target.value)}
            />
            <input
              className="rounded border px-2 py-1.5 text-sm"
              placeholder="Email"
              value={createEmail}
              onChange={e => setCreateEmail(e.target.value)}
            />
            <input
              className="rounded border px-2 py-1.5 text-sm"
              placeholder="Teléfono"
              value={createPhone}
              onChange={e => setCreatePhone(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!createName.trim() || isPending}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {isPending ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateName(""); setCreateRif(""); }}
              className="rounded border px-3 py-1 text-sm text-gray-600"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
          No hay clientes registrados.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Nombre</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">RIF</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Teléfono</th>
                {canDelete && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {customers.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.rif ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone ?? "—"}</td>
                  {canDelete && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(c.id, c.name)}
                        disabled={isPending}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Desactivar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
