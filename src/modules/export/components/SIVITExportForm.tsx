"use client";

// src/modules/export/components/SIVITExportForm.tsx
import { useState, useTransition } from "react";
import { generateSIVITAction } from "../actions/sivit-export.actions";
import { Button } from "@/components/ui/button";
import { DownloadIcon, LoaderIcon } from "lucide-react";

type Props = { companyId: string };

export function SIVITExportForm({ companyId }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = today.slice(0, 8) + "01";

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo,   setDateTo]   = useState(today);
  const [error,    setError]    = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await generateSIVITAction({ companyId, dateFrom, dateTo });
      if (!result.success) {
        setError(result.error);
        return;
      }

      // Decode base64 → Blob → download
      const binary = atob(result.data.base64Zip);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "application/zip" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-lg">Exportar SIVIT</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Genera <span className="font-mono">LV.txt</span> (Libro de Ventas) y{" "}
          <span className="font-mono">LC.txt</span> (Libro de Compras) en formato
          pipe-delimitado para cargar en el sistema SIVIT del SENIAT.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="sivit-from">
              Desde
            </label>
            <input
              id="sivit-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="sivit-to">
              Hasta
            </label>
            <input
              id="sivit-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Rango máximo: 366 días. Los archivos TXT se descargan en un ZIP.
        </p>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={isPending}
          variant="outline"
          className="w-full sm:w-auto"
          aria-busy={isPending}
        >
          {isPending ? (
            <>
              <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <DownloadIcon className="mr-2 h-4 w-4" />
              Descargar ZIP SIVIT
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
