// src/components/import/AccountsImporter.tsx
"use client";

import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  UploadIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertCircleIcon,
  Loader2Icon,
} from "lucide-react";
import {
  importAccountsAction,
  parseAccountsFileAction,
  downloadTemplateAction,
} from "@/modules/import/actions/import.actions";
import type { ImportAccountRow } from "@/modules/import/schemas/import.schema";

type Props = {
  companyId: string;
  userId: string;
};

type ImportResult = {
  created: number;
  skipped: number;
  errors: string[];
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

export function AccountsImporter({ companyId, userId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isDownloading, startDownload] = useTransition();
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<ImportAccountRow[] | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isXlsx =
      lowerName.endsWith(".xlsx") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const isCsv = lowerName.endsWith(".csv") || file.type === "text/csv";
    // .xls (Excel 97-2003, binario) NUNCA fue soportado de verdad — exceljs solo lee
    // .xlsx (zip/OOXML). La librería que sí leía .xls (xlsx/SheetJS) se sacó del
    // proyecto por 2 CVEs (DECISIONS.md) y no se reintroduce solo para esto. Bug tester
    // Alpha 2026-09-28: antes esto pasaba el check y crasheaba/fallaba en el parseo sin
    // decir por qué — ahora se avisa ANTES de intentar leerlo, con la salida real.
    const isLegacyXls = lowerName.endsWith(".xls") || file.type === "application/vnd.ms-excel";

    if (isLegacyXls) {
      toast.error(
        "El formato .xls (Excel antiguo) no es compatible. Abre el archivo en Excel, Google Sheets o LibreOffice y usa \"Guardar como\" → Excel (.xlsx) o CSV, y vuelve a subirlo.",
        { duration: 10000 }
      );
      return;
    }

    if (!isXlsx && !isCsv) {
      toast.error("Solo se permiten archivos Excel (.xlsx) o CSV");
      return;
    }

    setFileName(file.name);
    setParseError("");
    setPreview(null);
    setResult(null);
    setIsParsing(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        // El parseo real (exceljs/CSV + inferencia de tipo por código + columnas G/M,
        // Pre., Ter.) vive server-side en ImportService — no duplicar esa lógica aquí.
        // Bug tester Alpha 2026-09-27: el parser propio del cliente no tenía ninguno de
        // esos ajustes ni un guard contra un archivo sin hojas legibles.
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        const res = await parseAccountsFileAction(companyId, base64, isCsv ? "csv" : "xlsx");

        if (res.success) {
          setPreview(res.data);
        } else {
          setParseError(res.error);
        }
      } catch {
        setParseError("No se pudo leer el archivo");
      } finally {
        setIsParsing(false);
      }
    };
    reader.onerror = () => {
      setParseError("No se pudo leer el archivo");
      setIsParsing(false);
    };
    reader.readAsArrayBuffer(file);
  }

  function handleImport() {
    if (!preview) return;

    startTransition(async () => {
      const res = await importAccountsAction(companyId, userId, preview);

      if (res.success) {
        setResult(res.data);
        setPreview(null);
        setFileName("");
        if (fileInputRef.current) fileInputRef.current.value = "";

        if (res.data.created > 0) {
          toast.success(
            `${res.data.created} cuenta${res.data.created !== 1 ? "s" : ""} importada${res.data.created !== 1 ? "s" : ""} correctamente`
          );
        }
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleDownloadTemplate() {
    startDownload(async () => {
      const res = await downloadTemplateAction();

      if (res.success) {
        const binary = atob(res.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "plantilla-plan-de-cuentas.xlsx";
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <div className="space-y-6">
        {/* ─── Instrucciones + plantilla ───────────────────────────────── */}
        <div className="rounded-lg border bg-blue-50 p-4">
          <p className="mb-1 text-sm font-semibold text-blue-800">
            ¿Cómo importar tu Plan de Cuentas?
          </p>
          <ol className="list-inside list-decimal space-y-1 text-sm text-blue-700">
            <li>Descarga la plantilla Excel</li>
            <li>
              Completa las columnas: <strong>codigo, nombre, tipo, descripcion</strong>
            </li>
            <li>Los tipos válidos son: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE</li>
            <li>Sube el archivo y confirma la importación</li>
          </ol>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadTemplate}
            disabled={isDownloading}
            className="mt-3 gap-2 border-blue-300 text-blue-700 hover:bg-blue-100"
          >
            <DownloadIcon className="h-4 w-4" />
            {isDownloading ? "Generando..." : "Descargar Plantilla Excel"}
          </Button>
        </div>

        {/* ─── Subir archivo ───────────────────────────────────────────── */}
        <div
          onClick={() => !isParsing && fileInputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            preview
              ? "border-green-400 bg-green-50"
              : parseError
                ? "border-red-400 bg-red-50"
                : "border-zinc-300 hover:border-blue-400 hover:bg-zinc-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {isParsing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2Icon className="h-10 w-10 animate-spin text-blue-400" />
              <p className="font-medium text-zinc-600">Leyendo {fileName}...</p>
            </div>
          ) : preview ? (
            <div className="flex flex-col items-center gap-2">
              <FileSpreadsheetIcon className="h-10 w-10 text-green-500" />
              <p className="font-medium text-green-700">{fileName}</p>
              <p className="text-sm text-green-600">
                {preview.length} cuentas listas para importar
              </p>
            </div>
          ) : parseError ? (
            <div className="flex flex-col items-center gap-2">
              <XCircleIcon className="h-10 w-10 text-red-500" />
              <p className="font-medium text-red-700">Error en el archivo</p>
              <p className="max-w-sm text-xs text-red-600">{parseError}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <UploadIcon className="h-10 w-10 text-zinc-400" />
              <p className="font-medium text-zinc-600">Haz click para subir tu archivo</p>
              <p className="text-xs text-zinc-400">Excel (.xlsx) o CSV — el .xls antiguo no es compatible</p>
            </div>
          )}
        </div>

        {/* ─── Preview de filas ────────────────────────────────────────── */}
        {preview && preview.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-zinc-700">
              Vista previa ({preview.length} cuentas)
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-zinc-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">Código</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">Nombre</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">Tipo</th>
                    <th className="px-3 py-2 text-left font-medium text-zinc-500">Descripción</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.slice(0, 10).map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-3 py-2 font-mono text-xs">{row.codigo}</td>
                      <td className="px-3 py-2">{row.nombre}</td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                          {TYPE_LABELS[row.tipo] ?? row.tipo}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">{row.descripcion ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 10 && (
                <div className="border-t bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-400">
                  ... y {preview.length - 10} cuentas más
                </div>
              )}
            </div>

            <Button onClick={handleImport} disabled={isPending} className="mt-4 w-full gap-2">
              <UploadIcon className="h-4 w-4" />
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Importando..." : `Importar ${preview.length} cuentas`}
            </Button>
          </div>
        )}

        {/* ─── Resultado ───────────────────────────────────────────────── */}
        {result && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-green-50 px-4 py-3">
              <CheckCircleIcon className="h-4 w-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">Importación completada</span>
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircleIcon className="h-4 w-4 text-green-500" />
                <span>
                  <strong>{result.created}</strong> cuentas creadas
                </span>
              </div>
              {result.skipped > 0 && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <AlertCircleIcon className="h-4 w-4 text-amber-500" />
                  <span>
                    <strong>{result.skipped}</strong> cuentas omitidas (ya existían)
                  </span>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-sm font-medium text-red-600">Errores:</p>
                  {result.errors.map((err, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-red-500">
                      <XCircleIcon className="h-3 w-3" />
                      {err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <Toaster richColors position="top-right" />
    </>
  );
}
