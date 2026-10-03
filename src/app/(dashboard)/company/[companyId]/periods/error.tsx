"use client";

/**
 * Error boundary para /periods — captura errores de runtime (debugging 404).
 * Muestra el mensaje de error en dev; en producción sólo muestra el mensaje genérico.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function PeriodsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PeriodsError]", error);
  }, [error]);

  return (
    <div className="flex min-h-96 flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Error al cargar Períodos
      </h2>
      {process.env.NODE_ENV === "development" && (
        <pre className="max-w-lg overflow-auto rounded-md border border-red-200 bg-red-50 p-3 text-left text-xs text-red-700">
          {error.message}
          {error.stack ? "\n\n" + error.stack : ""}
        </pre>
      )}
      <p className="text-sm text-zinc-500">
        {process.env.NODE_ENV !== "development"
          ? "Ocurrió un error inesperado. Intenta de nuevo o contacta soporte."
          : null}
      </p>
      <Button onClick={reset} variant="outline" size="sm">
        Reintentar
      </Button>
    </div>
  );
}
