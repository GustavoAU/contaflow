"use client";
// src/modules/payroll/components/VacationRequestList.tsx
// Feature 8/10: lista de solicitudes de vacaciones con acciones de aprobación/rechazo.

import { useState, useTransition } from "react";
import { CheckCircle2Icon, XCircleIcon, XIcon, CalendarIcon } from "lucide-react";
import {
  approveVacationRequestAction,
  rejectVacationRequestAction,
  cancelVacationRequestAction,
} from "../actions/vacation-request.actions";
import type { VacationRequestRow } from "../services/VacationRequestService";

type Props = {
  companyId: string;
  requests: VacationRequestRow[];
  canApprove: boolean; // ACCOUNTING role
  canCancel?: boolean; // WRITERS role
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
};

function RejectModal({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm: (reason: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-zinc-800">Rechazar solicitud</h3>
          <button onClick={onClose} aria-label="Cerrar">
            <XIcon className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo del rechazo…"
          rows={3}
          maxLength={500}
          className="w-full rounded border px-3 py-2 text-sm resize-none"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded border px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={!reason.trim() || isPending}
            aria-busy={isPending}
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Rechazando…" : "Rechazar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function VacationRequestList({ companyId, requests, canApprove, canCancel = true }: Props) {
  const [isPending, startTransition] = useTransition();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function approve(id: string) {
    setActionError(null);
    startTransition(async () => {
      const res = await approveVacationRequestAction(companyId, id);
      if (!res.success) setActionError(res.error);
    });
  }

  function cancel(id: string) {
    setActionError(null);
    startTransition(async () => {
      const res = await cancelVacationRequestAction(companyId, id);
      if (!res.success) setActionError(res.error);
    });
  }

  function handleReject(reason: string) {
    if (!rejectingId) return;
    const id = rejectingId;
    setRejectingId(null);
    setActionError(null);
    startTransition(async () => {
      const res = await rejectVacationRequestAction(companyId, id, { rejectionReason: reason });
      if (!res.success) setActionError(res.error);
    });
  }

  if (requests.length === 0) {
    return (
      <p className="text-sm text-zinc-400 italic">Sin solicitudes de vacaciones registradas.</p>
    );
  }

  return (
    <>
      {rejectingId && (
        <RejectModal
          onConfirm={handleReject}
          onClose={() => setRejectingId(null)}
          isPending={isPending}
        />
      )}

      {actionError && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="space-y-3">
        {requests.map((req) => (
          <div
            key={req.id}
            className="rounded-xl border bg-white p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-zinc-400 shrink-0" />
                <span className="text-sm font-medium text-zinc-800">
                  {req.startDate} — {req.endDate}
                </span>
                <span className="text-xs text-zinc-500">
                  ({req.daysRequested} días)
                </span>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[req.status] ?? ""}`}
              >
                {STATUS_LABELS[req.status] ?? req.status}
              </span>
            </div>

            {req.notes && (
              <p className="text-xs text-zinc-500">{req.notes}</p>
            )}

            {req.status === "REJECTED" && req.rejectionReason && (
              <p className="text-xs text-red-600">
                Motivo: {req.rejectionReason}
              </p>
            )}

            {req.status === "PENDING" && (
              <div className="flex gap-2 pt-1">
                {canApprove && (
                  <>
                    <button
                      onClick={() => approve(req.id)}
                      disabled={isPending}
                      aria-busy={isPending}
                      className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      <CheckCircle2Icon className="h-3.5 w-3.5" />
                      Aprobar
                    </button>
                    <button
                      onClick={() => setRejectingId(req.id)}
                      disabled={isPending}
                      className="flex items-center gap-1 rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircleIcon className="h-3.5 w-3.5" />
                      Rechazar
                    </button>
                  </>
                )}
                {canCancel && !canApprove && (
                  <button
                    onClick={() => cancel(req.id)}
                    disabled={isPending}
                    className="rounded border px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Cancelar solicitud
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
