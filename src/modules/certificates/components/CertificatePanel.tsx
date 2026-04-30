"use client";

import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import {
  generateDemoCertificateAction,
  uploadOfficialCertificateAction,
  getCertificateStatusAction,
} from "../actions/certificate.actions";
import type { CertificateStatusDTO } from "../services/CertificateService";

type Props = {
  companyId: string;
  initialStatus: CertificateStatusDTO;
};

function fmtDate(date: Date | string | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-VE", { dateStyle: "long" }).format(new Date(date));
}

function thumbShort(thumb: string | undefined): string {
  if (!thumb) return "—";
  return `${thumb.slice(0, 8)}…${thumb.slice(-8)}`;
}

export function CertificatePanel({ companyId, initialStatus }: Props) {
  const [status, setStatus] = useState<CertificateStatusDTO>(initialStatus);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshStatus() {
    const res = await getCertificateStatusAction({ companyId });
    if (res.success) setStatus(res.data);
  }

  function handleGenerateDemo() {
    startTransition(async () => {
      const res = await generateDemoCertificateAction({ companyId });
      if (res.success) {
        toast.success("Certificado demo generado correctamente");
        await refreshStatus();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100_000) {
      toast.error("El archivo .p12 no puede superar 100 KB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (!base64) return;

      startTransition(async () => {
        const res = await uploadOfficialCertificateAction({ companyId, p12Base64: base64 });
        if (res.success) {
          toast.success("Certificado oficial cargado correctamente");
          await refreshStatus();
        } else {
          toast.error(res.error);
        }
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
    };
    reader.readAsDataURL(file);
  }

  // ─── Estados visuales ──────────────────────────────────────────────────────

  if (!status.exists) {
    return (
      <div className="rounded-lg border border-dashed p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            Sin certificado
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Tu empresa no tiene un certificado digital configurado. Genera uno gratuito para comenzar
          a firmar documentos fiscales conforme a la PA 121.
        </p>
        <button
          onClick={handleGenerateDemo}
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? "Generando…" : "Generar certificado demo (gratuito)"}
        </button>
      </div>
    );
  }

  const isExpiringSoon = status.warningExpiringSoon;

  return (
    <div className="rounded-lg border p-6 space-y-4">
      {/* Banner de vencimiento próximo */}
      {isExpiringSoon && (
        <div className="rounded-md bg-orange-50 border border-orange-200 px-4 py-3 text-sm text-orange-800">
          <strong>Certificado por vencer:</strong> quedan {status.daysUntilExpiry} días. Renueva
          antes del {fmtDate(status.expiresAt)} para no interrumpir la firma de documentos.
        </div>
      )}

      {/* Estado del certificado */}
      <div className="flex items-center gap-3">
        {status.isSelfSigned ? (
          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
            Demo · Autofirmado
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            Oficial · {status.issuedBy}
          </span>
        )}
        {isExpiringSoon && (
          <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
            Vence en {status.daysUntilExpiry}d
          </span>
        )}
      </div>

      {/* Detalles */}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Huella digital (SHA-256)</dt>
          <dd className="font-mono text-xs mt-0.5">{thumbShort(status.thumbprint)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Vence</dt>
          <dd className="mt-0.5">{fmtDate(status.expiresAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Emitido por</dt>
          <dd className="mt-0.5">{status.issuedBy ?? "—"}</dd>
        </div>
      </dl>

      {/* Acciones */}
      <div className="border-t pt-4 flex flex-wrap gap-3">
        <label
          className={`inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium cursor-pointer hover:bg-accent ${isPending ? "opacity-50 pointer-events-none" : ""}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".p12,.pfx"
            className="sr-only"
            onChange={handleFileChange}
            disabled={isPending}
          />
          {isPending ? "Cargando…" : "Cargar certificado oficial (.p12)"}
        </label>
      </div>

      {status.isSelfSigned && (
        <p className="text-xs text-muted-foreground">
          El certificado demo identifica a tu empresa como firmante (CommonName = nombre de la
          empresa). Para homologación avanzada, carga un certificado emitido por PSC World o
          SUSCERTE.
        </p>
      )}
    </div>
  );
}
