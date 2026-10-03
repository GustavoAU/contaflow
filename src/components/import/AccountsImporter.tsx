// src/components/import/AccountsImporter.tsx
"use client";

import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  UploadIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertCircleIcon,
  Loader2Icon,
  PencilIcon,
} from "lucide-react";
import {
  importAccountsAction,
  parseAccountsFileAction,
  downloadTemplateAction,
} from "@/modules/import/actions/import.actions";
import type {
  ImportAccountRow,
  ImportAccountRowError,
} from "@/modules/import/schemas/import.schema";

type Props = {
  companyId: string;
  userId: string;
};

type ImportResult = {
  created: number;
  skipped: number;
  errors: ImportAccountRowError[];
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  CONTRA_ASSET: "Contra-activo",
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
  // Feedback del dueño 2026-10-01: un choque de NOMBRE entre cuentas de movimiento
  // (ADR-056) se corrige ahí mismo, sin reeditar el Excel — un input por fila +
  // "Crear" que reintenta SOLO esa cuenta con el nombre nuevo. `editedNames` guarda
  // el borrador por código de cuenta; `retryingCode` acota el spinner/disabled a la
  // fila que se está reintentando, no a toda la lista.
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});
  const [retryingCode, setRetryingCode] = useState<string | null>(null);
  const [isRetrying, startRetryTransition] = useTransition();

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
        'El formato .xls (Excel antiguo) no es compatible. Abre el archivo en Excel, Google Sheets o LibreOffice y usa "Guardar como" → Excel (.xlsx) o CSV, y vuelve a subirlo.',
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

  function handleRetryRename(err: ImportAccountRowError) {
    const nuevoNombre = (editedNames[err.row.codigo] ?? "").trim();
    if (!nuevoNombre) {
      toast.error("Escribe el nombre nuevo para esta cuenta");
      return;
    }
    if (nuevoNombre === err.row.nombre) {
      toast.error("Ese es el mismo nombre que ya está en uso — cámbialo");
      return;
    }

    setRetryingCode(err.row.codigo);
    startRetryTransition(async () => {
      const res = await importAccountsAction(companyId, userId, [
        { ...err.row, nombre: nuevoNombre },
      ]);
      setRetryingCode(null);

      if (!res.success) {
        toast.error(res.error);
        return;
      }

      if (res.data.created === 1) {
        setResult((prev) =>
          prev
            ? {
                ...prev,
                created: prev.created + 1,
                errors: prev.errors.filter((e) => e.row.codigo !== err.row.codigo),
              }
            : prev
        );
        toast.success(`Cuenta "${nuevoNombre}" creada correctamente`);
        return;
      }

      if (res.data.errors.length > 0) {
        // Sigue chocando (p.ej. el nombre nuevo también está en uso) — se reemplaza
        // el error en la lista con el nuevo mensaje en vez de solo mostrar un toast,
        // para que el contador vea por qué sin perder su lugar en la lista.
        const nuevoError = res.data.errors[0];
        setResult((prev) =>
          prev
            ? {
                ...prev,
                errors: prev.errors.map((e) => (e.row.codigo === err.row.codigo ? nuevoError : e)),
              }
            : prev
        );
        toast.error(nuevoError.message);
        return;
      }

      // res.data.skipped === 1: el código ya existe (carrera con otra importación)
      toast.error(`Ya existe una cuenta con el código ${err.row.codigo}`);
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
            <li>
              Los tipos válidos son: Activo, Pasivo, Patrimonio, Ingreso, Gasto (las cuentas de
              Costo también se marcan como Gasto — ContaFlow no las distingue como tipo aparte)
            </li>
            <li>Sube el archivo y confirma la importación</li>
          </ol>
          <p className="mt-2 text-xs text-blue-600">
            ¿Ya tienes tu plan de cuentas en Excel de otro sistema? También puedes subirlo
            directamente: se acepta &quot;Código&quot;/&quot;Descripción&quot; con tilde, columna
            &quot;G/M&quot; (G = cuenta de título, sin movimientos) y &quot;Ter.&quot; =
            &quot;SI&quot; para marcar cuentas que exigen indicar cliente/proveedor en cada asiento.
            No debe haber título ni filas en blanco antes de la fila de encabezados.
          </p>
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
              <p className="text-xs text-zinc-400">
                Excel (.xlsx) o CSV — el .xls antiguo no es compatible
              </p>
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
              {isPending && <Loader2Icon className="animate-spin" />}
              {isPending ? "Importando..." : `Importar ${preview.length} cuentas`}
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
                <div className="mt-2 space-y-2">
                  <p className="mb-1 text-sm font-medium text-red-600">Errores:</p>
                  {result.errors.map((err) => (
                    <div
                      key={err.row.codigo}
                      className="rounded border border-red-100 bg-red-50/50 p-2"
                    >
                      <div className="flex items-start gap-2 text-xs text-red-600">
                        <XCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{err.message}</span>
                      </div>
                      {err.reason === "duplicate_name" && (
                        <div className="mt-2 flex items-center gap-2 pl-5">
                          <PencilIcon className="h-3 w-3 shrink-0 text-zinc-400" />
                          <Input
                            value={editedNames[err.row.codigo] ?? ""}
                            onChange={(e) =>
                              setEditedNames((prev) => ({
                                ...prev,
                                [err.row.codigo]: e.target.value,
                              }))
                            }
                            placeholder="Nombre nuevo para esta cuenta"
                            disabled={isRetrying && retryingCode === err.row.codigo}
                            aria-label={`Nuevo nombre para la cuenta ${err.row.codigo}`}
                            className="h-8 flex-1 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetryRename(err)}
                            disabled={isRetrying && retryingCode === err.row.codigo}
                            aria-busy={isRetrying && retryingCode === err.row.codigo}
                            className="h-8 gap-1 text-xs"
                          >
                            {isRetrying && retryingCode === err.row.codigo ? (
                              <Loader2Icon className="h-3 w-3 animate-spin" />
                            ) : null}
                            Crear con este nombre
                          </Button>
                        </div>
                      )}
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
