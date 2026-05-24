"use client";
// src/modules/vendors/components/ClientPortalTokenButton.tsx
// Botón que genera un enlace del portal del cliente y lo copia al portapapeles.
// Arquitectura idéntica a EmployeePortalTokenButton.

import { useState, useTransition } from "react";
import { LinkIcon, CopyIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { generateClientPortalTokenAction } from "../actions/client-portal-token.actions";

interface Props {
  companyId: string;
  customerId: string;
  customerName: string;
}

export function ClientPortalTokenButton({ companyId, customerId, customerName }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateClientPortalTokenAction(companyId, customerId);
      if (result.success) {
        setUrl(result.url);
      } else {
        setError(result.error);
      }
    });
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: el usuario puede copiar manualmente del input
    }
  }

  if (!url) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
        >
          {isPending ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <LinkIcon className="h-3.5 w-3.5" aria-hidden />
          )}
          {isPending ? "Generando…" : "Portal del cliente"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Enlace del portal para{" "}
        <span className="font-medium text-gray-700">{customerName}</span> (válido 30 días):
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs focus:outline-none"
          aria-label="Enlace del portal del cliente"
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
          aria-label={copied ? "Copiado" : "Copiar enlace"}
        >
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5 text-green-600" aria-hidden />
              Copiado
            </>
          ) : (
            <>
              <CopyIcon className="h-3.5 w-3.5" aria-hidden />
              Copiar
            </>
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={() => { setUrl(null); setError(null); }}
        className="text-xs text-gray-400 hover:underline"
      >
        Regenerar enlace
      </button>
    </div>
  );
}
