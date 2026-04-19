// src/app/error.tsx
// Error boundary para errores en el árbol de componentes del dashboard.
// Captura en Sentry con digest para correlacionar con logs del servidor.
"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest es el ID interno de Next.js — lo incluimos como fingerprint
    // para que Seer pueda correlacionar el evento del servidor con el del cliente
    Sentry.withScope((scope) => {
      if (error.digest) {
        scope.setTag("error_digest", error.digest);
        scope.setFingerprint(["next-error", error.digest]);
      }
      scope.setTag("boundary", "route-error");
      Sentry.captureException(error);
    });
  }, [error]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-800">Algo salió mal</h2>
        <p className="text-sm text-zinc-500">
          Ocurrió un error inesperado. El equipo ha sido notificado automáticamente.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-zinc-400">Ref: {error.digest}</p>
        )}
      </div>
      <Button variant="outline" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
