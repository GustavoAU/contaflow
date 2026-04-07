"use client";

// src/components/invoices/RifInput.tsx

import { useState, useTransition, useRef } from "react";
import { validateVenezuelanRif } from "@/lib/fiscal-validators";
import { validateRifAction } from "@/modules/rif-validation/actions/validateRifAction";

type VerifyStatus =
  | "idle"
  | "checking"
  | "verified"          // SENIAT confirmó
  | "format_only"       // Formato válido, SENIAT no disponible
  | "format_invalid";   // Formato incorrecto

interface Props {
  companyId: string;
  name?: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  onLegalNameFound?: (name: string) => void;
}

export function RifInput({
  companyId,
  name = "counterpartRif",
  defaultValue = "",
  required,
  placeholder = "J-12345678-9",
  onLegalNameFound,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [legalName, setLegalName] = useState<string | null>(null);
  const [isChecking, startCheckTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const formatValid = value.length > 0 && validateVenezuelanRif(value.trim());

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    // Resetear estado al editar el campo
    if (status !== "idle") {
      setStatus("idle");
      setLegalName(null);
    }
  }

  function handleVerify() {
    if (!formatValid) return;
    startCheckTransition(async () => {
      setStatus("checking");
      const result = await validateRifAction(companyId, value.trim());
      if (!result.success) {
        // Error de auth/rate-limit — mostrar como no verificado sin bloquear
        setStatus("format_only");
        return;
      }
      if (!result.data.formatValid) {
        setStatus("format_invalid");
        return;
      }
      if (result.data.seniatVerified && result.data.legalName) {
        setStatus("verified");
        setLegalName(result.data.legalName);
        onLegalNameFound?.(result.data.legalName);
      } else {
        setStatus("format_only");
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          name={name}
          value={value}
          onChange={handleChange}
          required={required}
          placeholder={placeholder}
          className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={handleVerify}
          disabled={!formatValid || isChecking}
          title={!formatValid ? "Escribe un RIF válido para verificar" : "Consultar en el portal SENIAT"}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isChecking ? "Verificando…" : "Verificar"}
        </button>
      </div>

      {/* Badge de estado */}
      {value.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs">
          {status === "idle" && !formatValid && (
            <span className="text-red-500">✗ Formato inválido — use J-12345678-9</span>
          )}
          {status === "idle" && formatValid && (
            <span className="text-zinc-400">Formato válido · Presiona Verificar para consultar SENIAT</span>
          )}
          {status === "checking" && (
            <span className="text-zinc-400">Consultando portal SENIAT…</span>
          )}
          {status === "verified" && (
            <span className="font-medium text-green-700">
              ✓ Verificado SENIAT{legalName ? ` — ${legalName}` : ""}
            </span>
          )}
          {status === "format_only" && (
            <span className="text-amber-600">
              ⚠ Formato válido · Portal SENIAT no disponible en este momento
            </span>
          )}
          {status === "format_invalid" && (
            <span className="text-red-500">✗ RIF no reconocido por SENIAT</span>
          )}
        </div>
      )}
    </div>
  );
}
