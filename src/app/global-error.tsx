// src/app/global-error.tsx
// Captura errores que escapan de todos los error.tsx anidados,
// incluyendo errores en el root layout. Necesita incluir <html>/<body>
// ya que reemplaza completamente el layout raíz.
"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.withScope((scope) => {
      if (error.digest) {
        scope.setTag("error_digest", error.digest);
        scope.setFingerprint(["next-global-error", error.digest]);
      }
      scope.setTag("boundary", "global-error");
      scope.setLevel("fatal");
      Sentry.captureException(error);
    });
  }, [error]);

  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center font-sans">
        <div className="rounded-xl border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-zinc-800">Error crítico</h1>
          <p className="mt-2 text-sm text-zinc-500">
            ContaFlow encontró un error grave. El equipo ha sido notificado.
          </p>
          {error.digest && (
            <p className="mt-1 font-mono text-xs text-zinc-400">Ref: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
