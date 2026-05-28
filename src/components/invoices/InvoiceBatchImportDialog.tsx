// src/components/invoices/InvoiceBatchImportDialog.tsx
// Importación masiva desde CSV — ALERTA 12 UX
"use client";

import { useState, useTransition, useRef } from "react";
import { UploadCloudIcon, DownloadIcon, CheckCircle2Icon, XCircleIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { importInvoiceBatchAction, type BatchRow, type BatchImportResult } from "@/modules/invoices/actions/invoice-batch.actions";

const CSV_HEADERS = ["tipo", "tipo_doc", "rif", "nombre", "nro_factura", "nro_control", "fecha", "base_16", "base_8", "exento", "ret_iva", "ret_islr"];

const CSV_TEMPLATE = [
  CSV_HEADERS.join(","),
  "COMPRA,FACTURA,J-12345678-9,Proveedor SA,B00000001,00-12345678,2026-01-15,1000.00,,,0,0",
  "VENTA,FACTURA,V-98765432-1,Cliente SRL,F-0001,,2026-01-15,500.00,,,0,0",
].join("\n");

type ParsedRow = BatchRow & { rowNum: number; error?: string };

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length === 0) return [];

  // Detect and skip header row
  const firstLine = lines[0].toLowerCase();
  const startIdx = CSV_HEADERS.some((h) => firstLine.includes(h)) ? 1 : 0;

  return lines.slice(startIdx).map((line, idx) => {
    const rowNum = startIdx + idx + 1;
    const cols = line.split(",").map((c) => c.trim());
    const [tipo, tipo_doc, rif, nombre, nro_factura, nro_control, fecha, base_16, base_8, exento, ret_iva, ret_islr] = cols;

    const errors: string[] = [];
    if (!tipo || !["COMPRA", "VENTA"].includes(tipo.toUpperCase()))
      errors.push('tipo debe ser COMPRA o VENTA');
    if (!tipo_doc || !["FACTURA", "NOTA_DEBITO", "NOTA_CREDITO"].includes((tipo_doc ?? "").toUpperCase()))
      errors.push('tipo_doc debe ser FACTURA, NOTA_DEBITO o NOTA_CREDITO');
    if (!rif) errors.push('rif requerido');
    if (!nombre) errors.push('nombre requerido');
    if (!nro_factura) errors.push('nro_factura requerido');
    if (!fecha) errors.push('fecha requerida (YYYY-MM-DD)');

    const noBase = !base_16 && !base_8 && !exento;
    const allZero = [base_16, base_8, exento].every((v) => !v || parseFloat(v) === 0);
    if (noBase || allZero) errors.push('se requiere al menos un monto en base_16, base_8 o exento');

    return {
      rowNum,
      tipo: (tipo?.toUpperCase() ?? "COMPRA") as "COMPRA" | "VENTA",
      tipo_doc: (tipo_doc?.toUpperCase() ?? "FACTURA") as "FACTURA" | "NOTA_DEBITO" | "NOTA_CREDITO",
      rif: rif ?? "",
      nombre: nombre ?? "",
      nro_factura: nro_factura ?? "",
      nro_control: nro_control ?? "",
      fecha: fecha ?? "",
      base_16: base_16 ?? "0",
      base_8: base_8 ?? "0",
      exento: exento ?? "0",
      ret_iva: ret_iva ?? "0",
      ret_islr: ret_islr ?? "0",
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  });
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-importacion-facturas.csv";
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  periodId?: string;
};

export function InvoiceBatchImportDialog({ open, onOpenChange, companyId, periodId }: Props) {
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<BatchImportResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function resetDialog() {
    setStep("upload");
    setRows([]);
    setResult(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        toast.error("El archivo no contiene filas válidas");
        return;
      }
      setRows(parsed);
      setStep("preview");
    };
    reader.readAsText(file, "utf-8");
  }

  function handleImport() {
    const validRows = rows.filter((r) => !r.error);
    if (validRows.length === 0) {
      toast.error("No hay filas válidas para importar");
      return;
    }
    startTransition(async () => {
      const res = await importInvoiceBatchAction(companyId, periodId, validRows);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      setResult(res.data);
      setStep("result");
      if (res.data.created > 0) {
        toast.success(`${res.data.created} factura(s) importadas`);
      }
    });
  }

  const validCount = rows.filter((r) => !r.error).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isPending) { onOpenChange(v); if (!v) resetDialog(); } }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importar facturas desde CSV</DialogTitle>
          <DialogDescription>
            Carga masiva de facturas en moneda VES. Máximo 200 filas por archivo.
          </DialogDescription>
        </DialogHeader>

        {/* ─── Paso 1: Subir archivo ─────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="flex flex-col items-center gap-6 py-8">
            <div
              className="w-full cursor-pointer rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-10 text-center transition-colors hover:border-blue-400 hover:bg-blue-50"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) {
                  const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                  handleFileChange(fakeEvent);
                }
              }}
            >
              <UploadCloudIcon className="mx-auto mb-3 h-10 w-10 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-700">Arrastra un archivo CSV o haz clic para seleccionar</p>
              <p className="mt-1 text-xs text-zinc-400">Formato: tipo, tipo_doc, rif, nombre, nro_factura, nro_control, fecha, base_16, base_8, exento, ret_iva, ret_islr</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <Button variant="outline" onClick={downloadTemplate} className="gap-2">
              <DownloadIcon className="h-4 w-4" />
              Descargar plantilla CSV
            </Button>
          </div>
        )}

        {/* ─── Paso 2: Vista previa ──────────────────────────────────────────── */}
        {step === "preview" && (
          <div className="flex flex-col gap-4 overflow-hidden">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">
                {rows.length} fila(s) — {" "}
                <span className="font-medium text-emerald-700">{validCount} válidas</span>
                {errorCount > 0 && (
                  <span className="ml-2 font-medium text-red-600">{errorCount} con errores (se omitirán)</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => { setStep("upload"); setRows([]); if (fileRef.current) fileRef.current.value = ""; }}
                className="text-xs text-zinc-400 underline hover:text-zinc-600"
              >
                Cambiar archivo
              </button>
            </div>

            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-xs">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 text-left w-8">#</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-left">RIF</th>
                    <th className="px-3 py-2 text-left">Nombre</th>
                    <th className="px-3 py-2 text-left">N° Factura</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-right">Base 16%</th>
                    <th className="px-3 py-2 text-right">Base 8%</th>
                    <th className="px-3 py-2 text-right">Exento</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((row) => (
                    <tr key={row.rowNum} className={row.error ? "bg-red-50" : "bg-white"}>
                      <td className="px-3 py-2 text-zinc-400">{row.rowNum}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-10 font-medium ${row.tipo === "VENTA" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
                          {row.tipo}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{row.rif}</td>
                      <td className="px-3 py-2 max-w-36 truncate" title={row.nombre}>{row.nombre}</td>
                      <td className="px-3 py-2 font-mono">{row.nro_factura}</td>
                      <td className="px-3 py-2">{row.fecha}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.base_16 !== "0" ? row.base_16 : ""}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.base_8 !== "0" ? row.base_8 : ""}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.exento !== "0" ? row.exento : ""}</td>
                      <td className="px-3 py-2">
                        {row.error ? (
                          <span title={row.error} className="flex items-center gap-1 text-red-600">
                            <XCircleIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate max-w-40">{row.error}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2Icon className="h-3.5 w-3.5" />
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { onOpenChange(false); resetDialog(); }}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={isPending || validCount === 0}>
                {isPending ? (
                  <><Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> Importando…</>
                ) : (
                  `Importar ${validCount} factura${validCount !== 1 ? "s" : ""}`
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ─── Paso 3: Resultado ─────────────────────────────────────────────── */}
        {step === "result" && result && (
          <div className="flex flex-col gap-4 py-4">
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4">
              <CheckCircle2Icon className="h-6 w-6 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-800">{result.created} factura(s) importadas correctamente</p>
                {result.errors.length > 0 && (
                  <p className="text-sm text-amber-700">{result.errors.length} fila(s) con errores no se importaron</p>
                )}
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="mb-2 text-xs font-semibold text-red-700">Filas con errores:</p>
                <ul className="space-y-1 text-xs text-red-600">
                  {result.errors.map((e) => (
                    <li key={e.row}>Fila {e.row}: {e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { resetDialog(); }}>
                Importar otro archivo
              </Button>
              <Button onClick={() => { onOpenChange(false); resetDialog(); }}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
