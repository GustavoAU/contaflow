"use client";

// src/components/invoices/RifInput.tsx

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { validateVenezuelanRif } from "@/lib/fiscal-validators";
import { validateRifAction } from "@/modules/rif-validation/actions/validateRifAction";
import { searchContactsByRifAction, type ContactSuggestion } from "@/modules/invoices/actions/invoice-contacts.actions";

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
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const formatValid = value.length > 0 && validateVenezuelanRif(value.trim());

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchSuggestions = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (query.trim().length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        const res = await searchContactsByRifAction(companyId, query);
        if (res.success && res.data.length > 0) {
          setSuggestions(res.data);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      }, 300);
    },
    [companyId],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    if (status !== "idle") {
      setStatus("idle");
      setLegalName(null);
    }
    fetchSuggestions(v);
  }

  function handleSelectSuggestion(s: ContactSuggestion) {
    setValue(s.rif);
    setStatus("verified");
    setLegalName(s.name);
    onLegalNameFound?.(s.name);
    setShowSuggestions(false);
    setSuggestions([]);
  }

  function handleVerify() {
    if (!formatValid) return;
    setShowSuggestions(false);
    startCheckTransition(async () => {
      setStatus("checking");
      const result = await validateRifAction(companyId, value.trim());
      if (!result.success) {
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
    <div ref={containerRef} className="space-y-1.5">
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            name={name}
            value={value}
            onChange={handleChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            required={required}
            placeholder={placeholder}
            autoComplete="off"
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />

          {/* Dropdown de sugerencias desde BD local */}
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={`${s.source}-${s.rif}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s); }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-10 font-medium bg-zinc-100 text-zinc-600 mt-0.5">
                      {s.source === "vendor" ? "PROV" : "CLI"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-zinc-800">{s.name}</span>
                      <span className="block font-mono text-xs text-zinc-400">{s.rif}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
              ✓ Verificado{legalName ? ` — ${legalName}` : ""}
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
