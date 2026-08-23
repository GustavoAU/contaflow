"use client";
// src/modules/payroll/components/EmployeePortalTokenButton.tsx
// Botón que genera un enlace del portal del empleado y lo copia al portapapeles.

import { useState, useTransition } from "react";
import { LinkIcon, CopyIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generatePortalTokenAction } from "../actions/employee-portal-token.actions";

interface Props {
  companyId: string;
  employeeId: string;
  employeeName: string;
}

export function EmployeePortalTokenButton({ companyId, employeeId, employeeName }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generatePortalTokenAction(companyId, employeeId);
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
      // fallback: show URL for manual copy
    }
  }

  if (!url) {
    return (
      <div className="space-y-1">
        {/* Accion secundaria en cabecera de pagina: outline + h-9 (anexo A).
            Era un <button> crudo con bg-indigo-600 escrito a mano. */}
        <Button
          type="button"
          variant="outline"
          onClick={handleGenerate}
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <LinkIcon aria-hidden />
          )}
          {isPending ? "Generando…" : "Portal del empleado"}
        </Button>
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Enlace del portal para{" "}
        <span className="font-medium text-gray-700">{employeeName}</span> (válido 30 días):
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs focus:outline-none"
          aria-label="Enlace del portal del empleado"
          onFocus={(e) => e.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="shrink-0"
          aria-label={copied ? "Copiado" : "Copiar enlace"}
        >
          {copied ? (
            <>
              <CheckIcon className="text-emerald-600" aria-hidden />
              Copiado
            </>
          ) : (
            <>
              <CopyIcon aria-hidden />
              Copiar
            </>
          )}
        </Button>
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
