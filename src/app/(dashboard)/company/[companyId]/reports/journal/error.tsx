"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, RefreshCwIcon, ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function JournalError({ error, reset }: Props) {
  const params = useParams<{ companyId: string }>();
  const [countdown, setCountdown] = useState(4);

  useEffect(() => {
    console.error("[reports/journal/error]", error.message);
  }, [error]);

  const isColdStart =
    error.message.toLowerCase().includes("timeout") ||
    error.message.toLowerCase().includes("connection") ||
    error.message.toLowerCase().includes("econnreset") ||
    error.message.toLowerCase().includes("socket") ||
    error.message.toLowerCase().includes("neon") ||
    error.message.toLowerCase().includes("headers timeout") ||
    error.message.toLowerCase().includes("fetch failed");

  useEffect(() => {
    if (!isColdStart) return;
    setCountdown(4);
    const tick = setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    const retry = setTimeout(() => reset(), 4000);
    return () => { clearInterval(tick); clearTimeout(retry); };
  }, [isColdStart, reset]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangleIcon className="h-7 w-7 text-amber-600" />
          </span>
        </div>

        <h2 className="text-lg font-semibold text-zinc-800">
          {isColdStart ? "La base de datos está iniciando" : "Error al cargar el Libro Diario"}
        </h2>

        <p className="text-sm text-zinc-500">
          {isColdStart
            ? `Reconectando automáticamente en ${countdown}s…`
            : "Ocurrió un error al obtener los asientos. Puedes reintentar o volver a Reportes."}
        </p>

        {error.digest && (
          <p className="font-mono text-xs text-zinc-300">ref: {error.digest}</p>
        )}

        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCwIcon className="h-4 w-4" />
            {isColdStart ? "Reintentar ahora" : "Reintentar"}
          </button>
          {params?.companyId && (
            <Link
              href={`/company/${params.companyId}/reports`}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Volver a Reportes
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
