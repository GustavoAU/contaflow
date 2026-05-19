// src/components/retentions/RetentionList.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2Icon, ClockIcon, CheckCircleIcon, CheckCheckIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  enterRetentionAction,
  exportRetentionVoucherPDFAction,
  getAccountsForEnteramientoAction,
  type RetentionSummary,
  type AccountOption,
} from "@/modules/retentions/actions/retention.actions";
import { formatAmount } from "@/lib/format";

type Props = {
  companyId: string;
  retentions: RetentionSummary[];
};

const STATUS_LABEL: Record<string, { label: string; className: string; Icon?: LucideIcon }> = {
  PENDING:  { label: "Pendiente", className: "bg-yellow-100 text-yellow-700", Icon: ClockIcon },
  ISSUED:   { label: "Emitida",   className: "bg-green-100 text-green-700",   Icon: CheckCircleIcon },
  ENTERADO: { label: "Enterada",  className: "bg-indigo-100 text-indigo-700", Icon: CheckCheckIcon },
  VOIDED:   { label: "Anulada",   className: "bg-red-100 text-red-700",       Icon: XCircleIcon },
};

function EnterRetentionModal({
  companyId,
  retention,
  onDone,
  onCancel,
}: {
  companyId: string;
  retention: RetentionSummary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [enterDate, setEnterDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    getAccountsForEnteramientoAction(companyId).then((r) => {
      if (r.success) setAccounts(r.data);
    });
  }, [companyId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!liabilityAccountId || !bankAccountId) return;

    startTransition(async () => {
      const result = await enterRetentionAction({
        retentionId: retention.id,
        companyId,
        liabilityAccountId,
        bankAccountId,
        enterDate: new Date(enterDate),
      });

      if (result.success) {
        toast.success("Retención enterada correctamente");
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  const liabilityAccounts = accounts.filter((a) => a.type === "LIABILITY");
  const bankAccounts = accounts.filter((a) => a.type === "ASSET");

  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <p className="mb-3 text-sm font-semibold text-indigo-800">
        Enterar retención {retention.voucherNumber} —{" "}
        <span className="font-mono">{formatAmount(retention.totalRetention)}</span>
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Cuenta Retenciones por Pagar (Pasivo)
          </label>
          <select
            value={liabilityAccountId}
            onChange={(e) => setLiabilityAccountId(e.target.value)}
            required
            className="w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="">-- Seleccionar cuenta pasivo --</option>
            {liabilityAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Cuenta Banco / Caja (Activo)
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            required
            className="w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="">-- Seleccionar cuenta banco/caja --</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Fecha de enteramiento</label>
          <input
            type="date"
            value={enterDate}
            onChange={(e) => setEnterDate(e.target.value)}
            required
            className="w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={isPending || !liabilityAccountId || !bankAccountId}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            aria-busy={isPending}
          >
            {isPending && <Loader2Icon className="mr-1 h-3 w-3 animate-spin" />}
            {isPending ? "Enterando..." : "Confirmar Enteramiento"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

function RetentionCard({
  companyId,
  retention,
}: {
  companyId: string;
  retention: RetentionSummary;
}) {
  const [showEnterForm, setShowEnterForm] = useState(false);
  const [isPendingPdf, startTransitionPdf] = useTransition();
  const [localStatus, setLocalStatus] = useState(retention.status);

  const statusInfo = STATUS_LABEL[localStatus] ?? {
    label: localStatus,
    className: "bg-zinc-100 text-zinc-600",
  };
  const StatusIcon = statusInfo.Icon;

  function handleDownloadVoucher() {
    startTransitionPdf(async () => {
      const result = await exportRetentionVoucherPDFAction(retention.id, companyId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comprobante-${retention.voucherNumber ?? retention.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const canEnter = localStatus === "PENDING" || localStatus === "ISSUED";

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium">{retention.providerName}</p>
          <p className="text-xs text-zinc-500">
            {retention.providerRif} — {retention.invoiceNumber}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-bold">{formatAmount(retention.totalRetention)}</p>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
            {StatusIcon && <StatusIcon className="h-3 w-3" aria-hidden />}
            {statusInfo.label}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>IVA: {formatAmount(retention.ivaRetention)}</span>
        {retention.islrAmount && <span>ISLR: {formatAmount(retention.islrAmount)}</span>}
        {retention.incesAmount && <span>INCES: {formatAmount(retention.incesAmount)}</span>}
        {retention.fatAmount && <span>FAT: {formatAmount(retention.fatAmount)}</span>}
        <span>Tipo: {retention.type}</span>
        {retention.voucherNumber && (
          <span className="font-mono">{retention.voucherNumber}</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadVoucher}
          disabled={isPendingPdf}
          className="rounded border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
        >
          {isPendingPdf ? "..." : "Comprobante PDF"}
        </button>

        {canEnter && !showEnterForm && (
          <button
            type="button"
            onClick={() => setShowEnterForm(true)}
            className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
          >
            Enterar
          </button>
        )}
      </div>

      {showEnterForm && (
        <EnterRetentionModal
          companyId={companyId}
          retention={retention}
          onDone={() => {
            setShowEnterForm(false);
            setLocalStatus("ENTERADO");
          }}
          onCancel={() => setShowEnterForm(false)}
        />
      )}
    </div>
  );
}

export function RetentionList({ companyId, retentions }: Props) {
  if (retentions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-white p-8 text-center">
        <p className="text-sm text-zinc-500">No hay retenciones registradas</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {retentions.map((r) => (
        <RetentionCard key={r.id} companyId={companyId} retention={r} />
      ))}
    </div>
  );
}
