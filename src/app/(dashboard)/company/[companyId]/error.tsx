"use client";

// Error boundary a nivel de empresa — captura errores del layout company/[companyId]
// y de cualquier página hija que no tenga su propio error.tsx.
// Caso principal: Neon cold start durante getUserCompaniesAction o getActivePeriodAction.

import { useEffect, useState } from "react";
import { AlertTriangleIcon, RefreshCwIcon, HomeIcon } from "lucide-react";
import Link from "next/link";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function CompanyError({ error, reset }: Props) {
  const [countdown, setCountdown] = useState(4);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("[company/error]", error.message);
    }
  }, [error]);

  const isColdStart =
    error.message.toLowerCase().includes("timeout") ||
    error.message.toLowerCase().includes("connection") ||
    error.message.toLowerCase().includes("econnreset") ||
    error.message.toLowerCase().includes("socket") ||
    error.message.toLowerCase().includes("neon") ||
    error.message.toLowerCase().includes("headers timeout") ||
    error.message.toLowerCase().includes("fetch failed");

  // Auto-retry on cold start — Neon warms up in 2-10s, 4s covers most cases.
  useEffect(() => {
    if (!isColdStart) return;
    setCountdown(4);
    const tick = setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    const retry = setTimeout(() => reset(), 4000);
    return () => { clearInterval(tick); clearTimeout(retry); };
  }, [isColdStart, reset]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md text-center space-y-5">
        <div className="flex justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangleIcon className="h-8 w-8 text-amber-600" />
          </span>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {isColdStart ? "Reconectando con la base de datos" : "Error al cargar"}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {isColdStart
              ? `Reconectando automáticamente en ${countdown}s…`
              : "Ocurrió un error inesperado. Puedes reintentar o volver al inicio."}
          </p>
        </div>

        {error.digest && (
          <p className="font-mono text-xs text-zinc-300">ref: {error.digest}</p>
        )}

        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <RefreshCwIcon className="h-4 w-4" />
            {isColdStart ? "Reintentar ahora" : "Reintentar"}
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <HomeIcon className="h-4 w-4" />
            Inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
