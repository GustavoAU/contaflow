"use client";
// src/modules/vendors/components/VendorList.tsx

import { useState, useTransition } from "react";
import { PlusIcon, TagIcon, Trash2Icon } from "lucide-react";
import { createVendorAction, updateVendorAction, deleteVendorAction } from "../actions/vendor.actions";
import { createVendorGroupAction, deleteVendorGroupAction } from "../actions/contact-group.actions";
import type { VendorRow } from "../services/VendorService";
import type { ContactGroupRow } from "../services/ContactGroupService";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Props = {
  companyId: string;
  initialVendors: VendorRow[];
  initialGroups: ContactGroupRow[];
  canWrite: boolean;
  canDelete: boolean;
};

export function VendorList({ companyId, initialVendors, initialGroups, canWrite, canDelete }: Props) {
  const [vendors, setVendors] = useState(initialVendors);
  const [groups, setGroups] = useState(initialGroups);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [createName, setCreateName] = useState("");
  const [createRif, setCreateRif] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createGroupId, setCreateGroupId] = useState("");
  const [createIsCE, setCreateIsCE] = useState(false);

  const [newGroupName, setNewGroupName] = useState("");

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const r = await createVendorAction(companyId, {
        name: createName,
        rif: createRif || undefined,
        email: createEmail || undefined,
        phone: createPhone || undefined,
        code: createCode || undefined,
        groupId: createGroupId || undefined,
        isSpecialContributor: createIsCE,
      });
      if (!r.success) { setError(r.error); return; }
      setVendors(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      setCreateName(""); setCreateRif(""); setCreateEmail(""); setCreatePhone("");
      setCreateCode(""); setCreateGroupId(""); setCreateIsCE(false);
    });
  }

  function handleToggleCE(vendorId: string, current: boolean) {
    if (!canWrite) return;
    startTransition(async () => {
      const r = await updateVendorAction(companyId, vendorId, { isSpecialContributor: !current });
      if (!r.success) { setError(r.error); return; }
      setVendors(prev => prev.map(v => v.id === vendorId ? { ...v, isSpecialContributor: !current } : v));
    });
  }

  function handleDelete(vendorId: string, name: string) {
    if (!confirm(`¿Desactivar a "${name}"? Las facturas vinculadas se conservan.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteVendorAction(companyId, vendorId);
      if (!r.success) { setError(r.error); return; }
      setVendors(prev => prev.filter(v => v.id !== vendorId));
    });
  }

  function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    startTransition(async () => {
      const r = await createVendorGroupAction(companyId, newGroupName.trim());
      if (!r.success) { setError(r.error); return; }
      setGroups(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewGroupName("");
    });
  }

  function handleDeleteGroup(groupId: string, name: string) {
    if (!confirm(`¿Eliminar grupo "${name}"? Los proveedores quedarán sin grupo.`)) return;
    startTransition(async () => {
      const r = await deleteVendorGroupAction(companyId, groupId);
      if (!r.success) { setError(r.error); return; }
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setVendors(prev => prev.map(v => v.groupId === groupId ? { ...v, groupId: null, group: null } : v));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {canWrite && (
          <button
            onClick={() => setShowGroups(!showGroups)}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            <TagIcon className="h-3.5 w-3.5" />
            Grupos ({groups.length})
          </button>
        )}
        <div className="ml-auto">
          {canWrite && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              + Nuevo proveedor
            </button>
          )}
        </div>
      </div>

      {/* Groups manager */}
      {showGroups && canWrite && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
          <p className="text-sm font-medium text-zinc-700">Grupos de proveedores</p>
          {groups.length === 0 ? (
            <p className="text-sm text-zinc-400">Sin grupos creados.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded border bg-white">
              {groups.map(g => (
                <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium text-zinc-800">{g.name}</span>
                  <span className="flex items-center gap-2 text-zinc-400">
                    <span>{g._count?.members ?? 0} prov.</span>
                    {canDelete && (
                      <button
                        onClick={() => handleDeleteGroup(g.id, g.name)}
                        disabled={isPending}
                        className="text-red-400 hover:text-red-600 disabled:opacity-40"
                        title="Eliminar grupo"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border px-2 py-1.5 text-sm"
              placeholder="Nombre del grupo"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreateGroup()}
            />
            <button
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim() || isPending}
              className="rounded bg-zinc-700 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && canWrite && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 space-y-3">
          <p className="text-sm font-medium text-indigo-800">Nuevo proveedor</p>
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
            <input
              className="rounded border px-2 py-1.5 text-sm"
              placeholder="Código (ej: P-001)"
              value={createCode}
              onChange={e => setCreateCode(e.target.value)}
            />
            <select
              className="rounded border px-2 py-1.5 text-sm text-zinc-700"
              value={createGroupId}
              onChange={e => setCreateGroupId(e.target.value)}
            >
              <option value="">Sin grupo</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-indigo-900 cursor-pointer">
            <input
              type="checkbox"
              checked={createIsCE}
              onChange={e => setCreateIsCE(e.target.checked)}
              className="rounded border-gray-300"
            />
            Contribuyente Especial (aplican retenciones IVA/ISLR)
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!createName.trim() || isPending}
              className="rounded bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {isPending ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateName(""); setCreateRif(""); setCreateCode(""); setCreateGroupId(""); setCreateIsCE(false); }}
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

      {vendors.length === 0 ? (
        <EmptyState
          illustration="list"
          title="No hay proveedores registrados."
          description="Agrega tu primer proveedor para comenzar a registrar facturas de compra."
          action={canWrite ? { label: "+ Nuevo proveedor", onClick: () => setShowCreate(true), Icon: PlusIcon } : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Proveedor</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Código</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">RIF</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Teléfono</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">C.E.</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                {canDelete && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {vendors.map(v => {
                const initials = v.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
                return (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold shrink-0">
                          {initials}
                        </span>
                        <div className="min-w-0">
                          <span className="font-medium text-gray-900 block">{v.name}</span>
                          {v.group && (
                            <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 mt-0.5">
                              {v.group.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {v.code
                        ? <span className="font-mono text-xs text-zinc-600 bg-zinc-100 rounded px-1.5 py-0.5">{v.code}</span>
                        : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.rif ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{v.email ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {canWrite ? (
                        <input
                          type="checkbox"
                          checked={v.isSpecialContributor}
                          onChange={() => handleToggleCE(v.id, v.isSpecialContributor)}
                          disabled={isPending}
                          aria-label="Contribuyente Especial"
                          className="rounded border-gray-300 disabled:opacity-50 cursor-pointer"
                          title="Contribuyente Especial — aplican retenciones IVA/ISLR"
                        />
                      ) : (
                        v.isSpecialContributor ? (
                          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">C.E.</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status="ACTIVE" />
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(v.id, v.name)}
                          disabled={isPending}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          Desactivar
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
