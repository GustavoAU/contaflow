"use client";
// src/modules/vendors/components/VendorList.tsx
// Q3-2: CRM básico — categoría (LEAD/REGULAR/VIP), notas, historial de interacciones.
// P2 (audit 2026-07-05): form crear/editar extraído a VendorForm (RHF + zodResolver);
// gestión de grupos extraída a GroupsPanel. 27 useState → 8 en VendorList.

import { Fragment, useState, useTransition, useMemo } from "react";
import {
  PlusIcon, TagIcon, Trash2Icon, SearchIcon, XIcon, Edit2Icon,
  MessageSquarePlusIcon, ChevronDownIcon, ChevronUpIcon, StickyNoteIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createVendorAction, updateVendorAction, deleteVendorAction,
         addVendorNoteAction, listVendorNotesAction, deleteVendorNoteAction } from "../actions/vendor.actions";
import { createVendorGroupAction, deleteVendorGroupAction } from "../actions/contact-group.actions";
import type { VendorRow } from "../services/VendorService";
import type { ContactNoteRow } from "../services/ContactNoteService";
import type { ContactCategory } from "../schemas/vendor.schemas";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ContactGroupRow } from "../services/ContactGroupService";
import { VendorForm, EMPTY_VENDOR_FORM, type VendorFormOutput } from "./VendorForm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ContactCategory, string> = {
  LEAD: "Lead",
  REGULAR: "Regular",
  VIP: "VIP",
};

const CATEGORY_COLORS: Record<ContactCategory, string> = {
  LEAD: "bg-zinc-100 text-zinc-600 border-zinc-200",
  REGULAR: "bg-blue-50 text-blue-700 border-blue-200",
  VIP: "bg-amber-50 text-amber-700 border-amber-200",
};

// ─── Componente VendorNoteTimeline ────────────────────────────────────────────

type NoteTimelineProps = {
  companyId: string;
  vendorId: string;
  canWrite: boolean;
};

function VendorNoteTimeline({ companyId, vendorId, canWrite }: NoteTimelineProps) {
  const [notes, setNotes] = useState<ContactNoteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleLoad() {
    if (loaded) return;
    setLoading(true);
    const r = await listVendorNotesAction(companyId, vendorId);
    setLoading(false);
    setLoaded(true);
    if (r.success) setNotes(r.data);
  }

  function handleAdd() {
    if (!newContent.trim()) return;
    startTransition(async () => {
      const r = await addVendorNoteAction(companyId, vendorId, { content: newContent.trim() });
      if (!r.success) { toast.error(r.error); return; }
      setNotes((prev) => [r.data, ...prev]);
      setNewContent("");
    });
  }

  function handleDelete(noteId: string) {
    startTransition(async () => {
      const r = await deleteVendorNoteAction(companyId, noteId);
      if (!r.success) { toast.error(r.error); return; }
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    });
  }

  return (
    <div className="space-y-2" onMouseEnter={handleLoad} onFocus={handleLoad}>
      {canWrite && (
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-zinc-200 px-2 py-1 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            placeholder="Nueva nota de interacción…"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            maxLength={2000}
          />
          <button
            onClick={handleAdd}
            disabled={!newContent.trim() || isPending}
            className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-40 hover:bg-indigo-700"
          >
            <MessageSquarePlusIcon className="size-3" />
          </button>
        </div>
      )}

      {loading && <p className="text-xs text-zinc-400">Cargando…</p>}
      {loaded && notes.length === 0 && (
        <p className="text-xs text-zinc-400 italic">Sin notas registradas.</p>
      )}
      <ul className="space-y-1.5">
        {notes.map((n) => (
          <li key={n.id} className="group flex items-start gap-2 rounded bg-zinc-50 border border-zinc-100 px-2.5 py-1.5">
            <StickyNoteIcon className="size-3 text-zinc-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-700 wrap-break-word">{n.content}</p>
              <p className="text-10 text-zinc-400 mt-0.5">
                {new Date(n.createdAt).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
            {canWrite && (
              <button
                onClick={() => handleDelete(n.id)}
                disabled={isPending}
                className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-500 shrink-0 disabled:opacity-30"
                title="Eliminar nota"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Componente GroupsPanel ────────────────────────────────────────────────────
// Dueño único del input "nombre del grupo". Las mutaciones viven en el padre
// (comparten su transition/error); onCreateGroup limpia el input solo en éxito.

type GroupsPanelProps = {
  groups: ContactGroupRow[];
  canDelete: boolean;
  isPending: boolean;
  onCreateGroup: (name: string, onSuccess: () => void) => void;
  onDeleteGroup: (groupId: string, name: string) => void;
};

function GroupsPanel({ groups, canDelete, isPending, onCreateGroup, onDeleteGroup }: GroupsPanelProps) {
  const [newGroupName, setNewGroupName] = useState("");

  function handleCreate() {
    if (!newGroupName.trim()) return;
    onCreateGroup(newGroupName.trim(), () => setNewGroupName(""));
  }

  return (
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
                    onClick={() => onDeleteGroup(g.id, g.name)}
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
          onKeyDown={e => e.key === "Enter" && handleCreate()}
        />
        <button
          onClick={handleCreate}
          disabled={!newGroupName.trim() || isPending}
          className="rounded bg-zinc-700 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Agregar
        </button>
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.rif ?? "").toLowerCase().includes(q) ||
        (v.code ?? "").toLowerCase().includes(q)
    );
  }, [vendors, search]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate(values: VendorFormOutput) {
    setError(null);
    startTransition(async () => {
      const r = await createVendorAction(companyId, values);
      if (!r.success) { setError(r.error); return; }
      setVendors(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
    });
  }

  function handleStartEdit(vendorId: string) {
    setEditingId(vendorId);
    setError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function handleSaveEdit(vendorId: string, values: VendorFormOutput) {
    setError(null);
    startTransition(async () => {
      const r = await updateVendorAction(companyId, vendorId, values);
      if (!r.success) { setError(r.error); return; }
      setVendors(prev =>
        prev.map(v => v.id === vendorId ? r.data : v).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingId(null);
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

  function handleCreateGroup(name: string, onSuccess: () => void) {
    startTransition(async () => {
      const r = await createVendorGroupAction(companyId, name);
      if (!r.success) { setError(r.error); return; }
      setGroups(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      onSuccess();
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

  function toggleNotes(id: string) {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
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
        <GroupsPanel
          groups={groups}
          canDelete={canDelete}
          isPending={isPending}
          onCreateGroup={handleCreateGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      )}

      {/* Create form */}
      {showCreate && canWrite && (
        <VendorForm
          variant="create"
          defaultValues={EMPTY_VENDOR_FORM}
          groups={groups}
          isPending={isPending}
          submitLabel="Guardar"
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Search */}
      {vendors.length > 0 && (
        <div className="relative max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, RIF o código…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-8 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              aria-label="Limpiar"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {vendors.length === 0 ? (
        <EmptyState
          illustration="list"
          title="No hay proveedores registrados."
          description="Agrega tu primer proveedor para comenzar a registrar facturas de compra."
          action={canWrite ? { label: "+ Nuevo proveedor", onClick: () => setShowCreate(true), Icon: PlusIcon } : undefined}
        />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-lg border">
          {filteredVendors.length === 0 && search ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              No hay proveedores que coincidan con &ldquo;{search}&rdquo;
            </p>
          ) : (
          <table className="stack-card-table min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Proveedor</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Código</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">RIF</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Teléfono</th>
                <th scope="col" className="px-4 py-3 text-center font-medium text-gray-600">C.E.</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                {canWrite && <th scope="col" className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredVendors.map(v => {
                const initials = v.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
                const notesOpen = expandedNotes.has(v.id);

                // ── Edit row ────────────────────────────────────────────────
                if (editingId === v.id) {
                  return (
                    <VendorForm
                      key={v.id}
                      variant="edit"
                      canWrite={canWrite}
                      defaultValues={{
                        name: v.name,
                        rif: v.rif ?? "",
                        email: v.email ?? "",
                        phone: v.phone ?? "",
                        code: v.code ?? "",
                        groupId: v.groupId ?? "",
                        isSpecialContributor: v.isSpecialContributor,
                        category: v.category ?? "REGULAR",
                        notes: v.notes ?? "",
                      }}
                      groups={groups}
                      isPending={isPending}
                      submitLabel="Guardar"
                      onSubmit={(values) => handleSaveEdit(v.id, values)}
                      onCancel={handleCancelEdit}
                    />
                  );
                }

                // ── Display row ─────────────────────────────────────────────
                return (
                  <Fragment key={v.id}>
                    <tr className="hover:bg-gray-50">
                      <td data-label="Proveedor" className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold shrink-0">
                            {initials}
                          </span>
                          <div className="min-w-0">
                            <span className="font-medium text-gray-900 block">{v.name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {v.group && (
                                <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-10 font-medium text-zinc-500">
                                  {v.group.name}
                                </span>
                              )}
                              {/* Badge categoría */}
                              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-10 font-medium ${CATEGORY_COLORS[v.category ?? "REGULAR"]}`}>
                                {CATEGORY_LABELS[v.category ?? "REGULAR"]}
                              </span>
                              {/* Nota rápida si existe */}
                              {v.notes && (
                                <span className="inline-flex items-center gap-0.5 text-10 text-zinc-400" title={v.notes}>
                                  <StickyNoteIcon className="size-2.5" />
                                  <span className="truncate max-w-24">{v.notes}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Código" className="px-4 py-3 whitespace-nowrap">
                        {v.code
                          ? <span className="font-mono text-xs text-zinc-600 bg-zinc-100 rounded px-1.5 py-0.5 whitespace-nowrap">{v.code}</span>
                          : <span className="text-zinc-300">—</span>}
                      </td>
                      <td data-label="RIF" className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.rif ?? "—"}</td>
                      <td data-label="Email" className="px-4 py-3 text-gray-600">{v.email ?? "—"}</td>
                      <td data-label="Teléfono" className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.phone ?? "—"}</td>
                      <td data-label="C.E." className="px-4 py-3 text-center">
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
                      <td data-label="Estado" className="px-4 py-3">
                        <StatusBadge status="ACTIVE" />
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {/* Toggle historial notas */}
                            <button
                              onClick={() => toggleNotes(v.id)}
                              className="flex items-center gap-0.5 text-zinc-400 hover:text-indigo-600 text-xs"
                              title="Historial de interacciones"
                            >
                              <MessageSquarePlusIcon className="h-3.5 w-3.5" />
                              {notesOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                            </button>
                            <button
                              onClick={() => handleStartEdit(v.id)}
                              disabled={isPending}
                              className="text-zinc-400 hover:text-indigo-600 disabled:opacity-40"
                              title="Editar proveedor"
                            >
                              <Edit2Icon className="h-3.5 w-3.5" />
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(v.id, v.name)}
                                disabled={isPending}
                                className="text-xs text-red-600 hover:underline disabled:opacity-50"
                              >
                                Desactivar
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {/* Timeline de notas — fila expandible */}
                    {notesOpen && (
                      <tr className="bg-zinc-50/80">
                        <td colSpan={canWrite ? 8 : 7} className="px-6 py-3">
                          <VendorNoteTimeline
                            companyId={companyId}
                            vendorId={v.id}
                            canWrite={canWrite}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      )}
    </div>
  );
}
