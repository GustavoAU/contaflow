"use client";

// src/modules/payments/components/UploadAttachmentButton.tsx
// ADR-029 / ADR-047: el comprobante se envía a una ruta autenticada del servidor, que lo guarda en el Blob PRIVADO.
// Se abre por otra ruta autenticada (attachmentDownloadPath): la URL del blob no sirve al navegador.

import { useRef, useState, useTransition } from "react";
import { Loader2Icon, PaperclipIcon, TrashIcon, FileIcon, ImageIcon, ExternalLinkIcon } from "lucide-react";
import { deleteAttachmentAction } from "../actions/payment.actions";
import type { AttachmentSummary } from "../services/PaymentAttachmentService";
import {
  ALLOWED_MIME_TYPES,
  MAX_SIZE_BYTES,
  MAX_SIZE_MB,
  attachmentDownloadPath,
} from "../constants/payment-attachment.constants";

const MIME_ACCEPT = ALLOWED_MIME_TYPES.join(",");

// ─── Sub-componente — adjunto existente ──────────────────────────────────────

function AttachmentRow({
  attachment,
  companyId,
  onDeleted,
  canDelete,
}: {
  attachment: AttachmentSummary;
  companyId: string;
  onDeleted?: () => void;
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPdf = attachment.mimeType === "application/pdf";
  const href = attachmentDownloadPath(companyId, attachment.id);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAttachmentAction(companyId, attachment.id);
      if (result.success) {
        onDeleted?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
      {isPdf ? (
        <FileIcon className="size-4 shrink-0 text-red-500" />
      ) : (
        <ImageIcon className="size-4 shrink-0 text-blue-500" />
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate text-blue-700 hover:underline"
        title={attachment.fileName}
      >
        {attachment.fileName}
      </a>
      <span className="shrink-0 text-xs text-zinc-400">
        {(attachment.sizeBytes / 1024).toFixed(0)} KB
      </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-zinc-400 hover:text-zinc-700"
        aria-label="Abrir en nueva pestaña"
      >
        <ExternalLinkIcon className="size-3.5" />
      </a>
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          aria-busy={isPending}
          className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-red-600 disabled:opacity-40"
          title="Eliminar comprobante"
        >
          {isPending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <TrashIcon className="size-3.5" />
          )}
        </button>
      )}
      {error && <span className="ml-1 text-xs text-red-600">{error}</span>}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

type Props = {
  companyId: string;
  paymentRecordId: string;
  existingAttachments?: AttachmentSummary[];
  canDelete?: boolean; // true si el rol del usuario puede eliminar adjuntos
  onUploaded?: () => void;
  onDeleted?: () => void;
};

export function UploadAttachmentButton({
  companyId,
  paymentRecordId,
  existingAttachments = [],
  canDelete = false,
  onUploaded,
  onDeleted,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blobEnabled = true; // el servidor reportará 503 si el store Blob no está configurado
  const hasAttachment = existingAttachments.length > 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // ── Validación client-side (UX inmediata, evita esperar la API) ──────────
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      setError("Tipo de archivo no permitido. Use PDF, JPEG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(`El archivo supera el límite de ${MAX_SIZE_MB} MB.`);
      return;
    }
    if (hasAttachment) {
      setError("Ya hay un comprobante adjunto. Elimínelo antes de subir uno nuevo.");
      return;
    }

    setUploading(true);
    try {
      // El servidor valida el contenido real, calcula el SHA-256 (R-2) y decide la ruta del archivo.
      const body = new FormData();
      body.set("companyId", companyId);
      body.set("paymentRecordId", paymentRecordId);
      body.set("file", file);
      const res = await fetch("/api/payments/attachments/upload", { method: "POST", body });
      if (!res.ok) {
        // Vercel corta con 413 (sin JSON) los cuerpos que superan su tope antes de llegar a la ruta.
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          data?.error ??
            (res.status === 413 ? `El archivo supera el límite de ${MAX_SIZE_MB} MB.` : "Error al subir el archivo"),
        );
      }

      onUploaded?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al subir el archivo";
      setError(msg);
    } finally {
      setUploading(false);
      // Limpiar input para permitir re-selección del mismo archivo
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {/* Adjuntos existentes */}
      {existingAttachments.map((att) => (
        <AttachmentRow
          key={att.id}
          attachment={att}
          companyId={companyId}
          canDelete={canDelete}
          onDeleted={onDeleted}
        />
      ))}

      {/* Botón de upload — visible si no hay adjunto activo */}
      {!hasAttachment && blobEnabled && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={MIME_ACCEPT}
            className="sr-only"
            onChange={handleFileChange}
            disabled={uploading}
            aria-label="Seleccionar comprobante de pago"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-busy={uploading}
            className="inline-flex items-center gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PaperclipIcon className="size-3.5" />
            )}
            {uploading ? "Subiendo..." : "Adjuntar comprobante"}
          </button>
          <p className="text-xs text-zinc-400">
            PDF, JPEG, PNG o WebP · máx. {MAX_SIZE_MB} MB
          </p>
        </>
      )}

      {/* Error de upload */}
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
