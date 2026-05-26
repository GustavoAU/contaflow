"use client";
// src/modules/vendors/components/CustomerList.tsx
// Q3-2: CRM básico — categoría (LEAD/REGULAR/VIP), notas, historial de interacciones,
//        badge de "último contacto" e indicador de cliente inactivo.

import { useState, useTransition, useMemo } from "react";
import {
  PlusIcon, TagIcon, Trash2Icon, SearchIcon, XIcon, Edit2Icon, CheckIcon,
  MessageSquarePlusIcon, ChevronDownIcon, ChevronUpIcon, StickyNoteIcon,
  ClockIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createCustomerAction, updateCustomerAction, deleteCustomerAction,
         addContactNoteAction, listContactNotesAction, deleteContactNoteAction } from "../actions/customer.actions";
import { createCustomerGroupAction, deleteCustomerGroupAction } from "../actions/contact-group.actions";
import type { CustomerRow } from "../services/CustomerService";
import type { ContactNoteRow } from "../services/ContactNoteService";
import type { ContactCategory } from "../schemas/vendor.schemas";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ClientPortalTokenButton } from "./ClientPortalTokenButton";
import type { ContactGroupRow } from "../services/ContactGroupService";

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

function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function fmtRelative(days: number): string {
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 30) return `Hace ${days} días`;
  if (days < 60) return "Hace ~1 mes";
  if (days < 365) return `Hace ~${Math.round(days / 30)} meses`;
  return `Hace ~${Math.round(days / 365)} año${days > 730 ? "s" : ""}`;
}

// ─── Componente ContactNoteTimeline ───────────────────────────────────────────

type NoteTimelineProps = {
  companyId: string;
  customerId: string;
  canWrite: boolean;
};

function ContactNoteTimeline({ companyId, customerId, canWrite }: NoteTimelineProps) {
  const [notes, setNotes] = useState<ContactNoteRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isPending, startTransition] = useTransition();

  // Carga lazy al abrir
  async function handleLoad() {
    if (loaded) return;
    setLoading(true);
    const r = await listContactNotesAction(companyId, customerId);
    setLoading(false);
    setLoaded(true);
    if (r.success) setNotes(r.data);
  }

  function handleAdd() {
    if (!newContent.trim()) return;
    startTransition(async () => {
      const r = await addContactNoteAction(companyId, customerId, { content: newContent.trim() });
      if (!r.success) { toast.error(r.error); return; }
      setNotes((prev) => [r.data, ...prev]);
      setNewContent("");
    });
  }

  function handleDelete(noteId: string) {
    startTransition(async () => {
      const r = await deleteContactNoteAction(companyId, noteId);
      if (!r.success) { toast.error(r.error); return; }
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    });
  }

  return (
    <div className="space-y-2" onMouseEnter={handleLoad} onFocus={handleLoad}>
      {/* Input nueva nota */}
      {canWrite && (
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-zinc-200 px-2 py-1 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            placeholder="Nueva nota de interacción…"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            maxLength={2000}
          />
          <button
            onClick={handleAdd}
            disabled={!newContent.trim() || isPending}
            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-40 hover:bg-emerald-700"
          >
            <MessageSquarePlusIcon className="size-3" />
          </button>
        </div>
      )}

      {/* Timeline */}
      {loading && <p className="text-xs text-zinc-400">Cargando…</p>}
      {loaded && notes.length === 0 && (
        <p className="text-xs text-zinc-400 italic">Sin notas registradas.</p>
      )}
      <ul className="space-y-1.5">
        {notes.map((n) => (
          <li key={n.id} className="group flex items-start gap-2 rounded bg-zinc-50 border border-zinc-100 px-2.5 py-1.5">
            <StickyNoteIcon className="size-3 text-zinc-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-700 break-words">{n.content}</p>
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

// ─── Componente principal ──────────────────────────────────────────────────────

type Props = {
  companyId: string;
  initialCustomers: CustomerRow[];
  initialGroups: ContactGroupRow[];
  canWrite: boolean;
  canDelete: boolean;
};

export function CustomerList({ companyId, initialCustomers, initialGroups, canWrite, canDelete }: Props) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [groups, setGroups] = useState(initialGroups);
  const [showCreate, setShowCreate] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── Create fields ──────────────────────────────────────────────────────────
  const [createName, setCreateName] = useState("");
  const [createRif, setCreateRif] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createGroupId, setCreateGroupId] = useState("");
  const [createCategory, setCreateCategory] = useState<ContactCategory>("REGULAR");
  const [createNotes, setCreateNotes] = useState("");

  // ── Edit fields ────────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRif, setEditRif] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editCategory, setEditCategory] = useState<ContactCategory>("REGULAR");
  const [editNotes, setEditNotes] = useState("");

  const [newGroupName, setNewGroupName] = useState("");
  const [search, setSearch] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.rif ?? "").toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const r = await createCustomerAction(companyId, {
        name: createName,
        rif: createRif || undefined,
        email: createEmail || undefined,
        phone: createPhone || undefined,
        code: createCode || undefined,
        groupId: createGroupId || undefined,
        category: createCategory,
        notes: createNotes || undefined,
      });
      if (!r.success) { setError(r.error); return; }
      setCustomers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      setCreateName(""); setCreateRif(""); setCreateEmail(""); setCreatePhone("");
      setCreateCode(""); setCreateGroupId(""); setCreateCategory("REGULAR"); setCreateNotes("");
    });
  }

  function handleStartEdit(c: CustomerRow) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditRif(c.rif ?? "");
    setEditEmail(c.email ?? "");
    setEditPhone(c.phone ?? "");
    setEditCode(c.code ?? "");
    setEditGroupId(c.groupId ?? "");
    setEditCategory(c.category ?? "REGULAR");
    setEditNotes(c.notes ?? "");
    setError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function handleSaveEdit(customerId: string) {
    if (!editName.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await updateCustomerAction(companyId, customerId, {
        name: editName,
        rif: editRif || undefined,
        email: editEmail || undefined,
        phone: editPhone || undefined,
        code: editCode || undefined,
        groupId: editGroupId || undefined,
        category: editCategory,
        notes: editNotes || undefined,
      });
      if (!r.success) { setError(r.error); return; }
      setCustomers(prev =>
        prev.map(c => c.id === customerId ? r.data : c).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingId(null);
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

  function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    startTransition(async () => {
      const r = await createCustomerGroupAction(companyId, newGroupName.trim());
      if (!r.success) { setError(r.error); return; }
      setGroups(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewGroupName("");
    });
  }

  function handleDeleteGroup(groupId: string, name: string) {
    if (!confirm(`¿Eliminar grupo "${name}"? Los clientes quedarán sin grupo.`)) return;
    startTransition(async () => {
      const r = await deleteCustomerGroupAction(companyId, groupId);
      if (!r.success) { setError(r.error); return; }
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setCustomers(prev => prev.map(c => c.groupId === groupId ? { ...c, groupId: null, group: null } : c));
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
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </div>

      {/* Groups manager */}
      {showGroups && canWrite && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-3">
          <p className="text-sm font-medium text-zinc-700">Grupos de clientes</p>
          {groups.length === 0 ? (
            <p className="text-sm text-zinc-400">Sin grupos creados.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded border bg-white">
              {groups.map(g => (
                <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium text-zinc-800">{g.name}</span>
                  <span className="flex items-center gap-2 text-zinc-400">
                    <span>{g._count?.members ?? 0} cli.</span>
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
            <input
              className="rounded border px-2 py-1.5 text-sm"
              placeholder="Código (ej: C-001)"
              value={createCode}
              onChange={e => setCreateCode(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="flex-1 rounded border px-2 py-1.5 text-sm text-zinc-700"
                value={createGroupId}
                onChange={e => setCreateGroupId(e.target.value)}
              >
                <option value="">Sin grupo</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <select
                className="w-32 rounded border px-2 py-1.5 text-sm text-zinc-700"
                value={createCategory}
                onChange={e => setCreateCategory(e.target.value as ContactCategory)}
              >
                <option value="LEAD">Lead</option>
                <option value="REGULAR">Regular</option>
                <option value="VIP">VIP</option>
              </select>
            </div>
          </div>
          <textarea
            className="w-full rounded border px-2 py-1.5 text-sm resize-none"
            placeholder="Notas (ej: requiere factura con retención ISLR)"
            rows={2}
            value={createNotes}
            onChange={e => setCreateNotes(e.target.value)}
            maxLength={2000}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!createName.trim() || isPending}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {isPending ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateName(""); setCreateRif(""); setCreateCode(""); setCreateGroupId(""); setCreateNotes(""); }}
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

      {/* Search */}
      {customers.length > 0 && (
        <div className="relative max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, RIF o código…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-8 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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

      {customers.length === 0 ? (
        <EmptyState
          illustration="list"
          title="No hay clientes registrados."
          description="Agrega tu primer cliente para comenzar a emitir facturas de venta."
          action={canWrite ? { label: "+ Nuevo cliente", onClick: () => setShowCreate(true), Icon: PlusIcon } : undefined}
        />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-lg border">
          {filteredCustomers.length === 0 && search ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              No hay clientes que coincidan con &ldquo;{search}&rdquo;
            </p>
          ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Cliente</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Código</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">RIF</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">Último contacto</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                {canWrite && <th scope="col" className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredCustomers.map(c => {
                const initials = c.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
                const days = daysSince(c.lastInvoiceDate);
                const isInactive = days !== null && days > 90;
                const notesOpen = expandedNotes.has(c.id);

                // ── Edit row ────────────────────────────────────────────────
                if (editingId === c.id) {
                  return (
                    <tr key={c.id} className="bg-emerald-50">
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <input
                            className="rounded border px-2 py-1 text-sm w-full min-w-35"
                            placeholder="Nombre *"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                          />
                          <div className="flex gap-1">
                            <select
                              className="flex-1 rounded border px-2 py-1 text-xs text-zinc-600"
                              value={editGroupId}
                              onChange={e => setEditGroupId(e.target.value)}
                            >
                              <option value="">Sin grupo</option>
                              {groups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                            <select
                              className="w-24 rounded border px-2 py-1 text-xs text-zinc-600"
                              value={editCategory}
                              onChange={e => setEditCategory(e.target.value as ContactCategory)}
                            >
                              <option value="LEAD">Lead</option>
                              <option value="REGULAR">Regular</option>
                              <option value="VIP">VIP</option>
                            </select>
                          </div>
                          <textarea
                            className="rounded border px-2 py-1 text-xs resize-none"
                            placeholder="Notas…"
                            rows={2}
                            value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            maxLength={2000}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="rounded border px-2 py-1 text-sm w-full min-w-20"
                          placeholder="C-001"
                          value={editCode}
                          onChange={e => setEditCode(e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="rounded border px-2 py-1 text-sm w-full min-w-30"
                          placeholder="J-12345678-9"
                          value={editRif}
                          onChange={e => setEditRif(e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="rounded border px-2 py-1 text-sm w-full min-w-35"
                          placeholder="email@ejemplo.com"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="rounded border px-2 py-1 text-sm w-full min-w-25"
                          placeholder="+58 412…"
                          value={editPhone}
                          onChange={e => setEditPhone(e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2" colSpan={canWrite ? 2 : 1}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveEdit(c.id)}
                            disabled={!editName.trim() || isPending}
                            className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            <CheckIcon className="h-3 w-3" />
                            {isPending ? "Guardando…" : "Guardar"}
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            disabled={isPending}
                            className="rounded border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // ── Display row ─────────────────────────────────────────────
                return (
                  <>
                    <tr key={c.id} className={`hover:bg-gray-50 ${isInactive ? "bg-amber-50/40" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">
                            {initials}
                          </span>
                          <div className="min-w-0">
                            <span className="font-medium text-gray-900 block">{c.name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {c.group && (
                                <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-10 font-medium text-zinc-500">
                                  {c.group.name}
                                </span>
                              )}
                              {/* Badge categoría */}
                              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-10 font-medium ${CATEGORY_COLORS[c.category ?? "REGULAR"]}`}>
                                {CATEGORY_LABELS[c.category ?? "REGULAR"]}
                              </span>
                              {/* Nota rápida si existe */}
                              {c.notes && (
                                <span className="inline-flex items-center gap-0.5 text-10 text-zinc-400" title={c.notes}>
                                  <StickyNoteIcon className="size-2.5" />
                                  <span className="truncate max-w-24">{c.notes}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.code
                          ? <span className="font-mono text-xs text-zinc-600 bg-zinc-100 rounded px-1.5 py-0.5">{c.code}</span>
                          : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.rif ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{c.email ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {days === null ? (
                          <span className="text-zinc-300 text-xs">Sin facturas</span>
                        ) : (
                          <span className={`flex items-center gap-1 text-xs ${isInactive ? "text-amber-600 font-medium" : "text-zinc-500"}`}>
                            <ClockIcon className="size-3 shrink-0" />
                            {fmtRelative(days)}
                            {isInactive && <span className="text-10 rounded bg-amber-100 text-amber-700 px-1">Inactivo</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status="ACTIVE" />
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3 flex-wrap">
                            {/* Toggle historial notas */}
                            <button
                              onClick={() => toggleNotes(c.id)}
                              className="flex items-center gap-0.5 text-zinc-400 hover:text-emerald-600 text-xs"
                              title="Historial de interacciones"
                            >
                              <MessageSquarePlusIcon className="h-3.5 w-3.5" />
                              {notesOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                            </button>
                            {canDelete && (
                              <ClientPortalTokenButton
                                companyId={companyId}
                                customerId={c.id}
                                customerName={c.name}
                              />
                            )}
                            <button
                              onClick={() => handleStartEdit(c)}
                              disabled={isPending}
                              className="text-zinc-400 hover:text-emerald-600 disabled:opacity-40"
                              title="Editar cliente"
                            >
                              <Edit2Icon className="h-3.5 w-3.5" />
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(c.id, c.name)}
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
                      <tr key={`${c.id}-notes`} className="bg-zinc-50/80">
                        <td colSpan={canWrite ? 7 : 6} className="px-6 py-3">
                          <ContactNoteTimeline
                            companyId={companyId}
                            customerId={c.id}
                            canWrite={canWrite}
                          />
                        </td>
                      </tr>
                    )}
                  </>
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
