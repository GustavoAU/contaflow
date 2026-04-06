// src/modules/bank-reconciliation/components/CsvImporter.tsx
"use client";

import { useState, useTransition } from "react";
import { UploadIcon, CheckIcon } from "lucide-react";
import { importStatementAction } from "../actions/banking.actions";
import type { ColumnMap } from "../services/CsvParserService";

type Step = "upload" | "map" | "balances" | "done";

type Props = {
  bankAccountId: string;
  companyId: string;
};

const REQUIRED_FIELDS = ["date", "description", "debit", "credit"] as const;
const OPTIONAL_FIELDS = ["balance"] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const;
type FieldKey = (typeof ALL_FIELDS)[number];

const FIELD_LABELS: Record<FieldKey, string> = {
  date: "Fecha",
  description: "Descripción",
  debit: "Débito",
  credit: "Crédito",
  balance: "Saldo (opcional)",
};

function parseCsvLines(csvText: string): string[][] {
  return csvText
    .split(/\r?\n/)
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((row) => row.some((c) => c !== ""));
}

export function CsvImporter({ bankAccountId, companyId }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Partial<Record<FieldKey, number>>>({});
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [success, setSuccess] = useState<{ count: number } | null>(null);

  // ─── Step 1: Upload / Paste CSV ────────────────────────────────────────────

  function handleCsvLoad(text: string) {
    const rows = parseCsvLines(text);
    if (rows.length < 2) {
      setError("El archivo debe tener al menos una fila de encabezado y una de datos.");
      return;
    }
    setCsvText(text);
    setHeaderRow(rows[0]);
    setPreviewRows(rows.slice(1, 4)); // primeras 3 filas de datos

    // Auto-mapeo por nombre de columna (heurística)
    const autoMap: Partial<Record<FieldKey, number>> = {};
    rows[0].forEach((col, idx) => {
      const lower = col.toLowerCase();
      if (!autoMap.date && /fecha|date/.test(lower)) autoMap.date = idx;
      else if (!autoMap.description && /desc|concepto|detalle|narr/.test(lower)) autoMap.description = idx;
      else if (!autoMap.debit && /d[eé]bit|egreso|cargo/.test(lower)) autoMap.debit = idx;
      else if (!autoMap.credit && /cr[eé]dit|ingreso|abono/.test(lower)) autoMap.credit = idx;
      else if (!autoMap.balance && /saldo|balance/.test(lower)) autoMap.balance = idx;
    });
    setColumnMap(autoMap);
    setError(null);
    setStep("map");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      handleCsvLoad(text);
    };
    reader.readAsText(file, "utf-8");
  }

  // ─── Step 2: Column Mapper ─────────────────────────────────────────────────

  function isMapComplete(): boolean {
    return REQUIRED_FIELDS.every((f) => columnMap[f] !== undefined);
  }

  function handleMapConfirm() {
    if (!isMapComplete()) {
      setError("Debes mapear todos los campos obligatorios (Fecha, Descripción, Débito, Crédito).");
      return;
    }
    setError(null);
    setStep("balances");
  }

  // ─── Step 3: Balances + Submit ─────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const cm: ColumnMap = {
      date: columnMap.date!,
      description: columnMap.description!,
      debit: columnMap.debit!,
      credit: columnMap.credit!,
      ...(columnMap.balance !== undefined ? { balance: columnMap.balance } : {}),
    };

    startTransition(async () => {
      const result = await importStatementAction({
        bankAccountId,
        companyId,
        csvContent: csvText,
        openingBalance,
        closingBalance,
        columnMap: cm,
      });

      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess({ count: result.data.transactionCount });
        setStep("done");
      }
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <UploadIcon className="h-5 w-5 text-zinc-400" aria-hidden="true" />
        <h2 className="font-semibold text-zinc-900">Importar extracto bancario</h2>
      </div>

      {/* Indicador de pasos */}
      <div className="mb-5 flex items-center gap-2 text-xs text-zinc-400">
        {(["upload", "map", "balances"] as const).map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1">→</span>}
            <span
              className={
                step === s
                  ? "font-semibold text-blue-600"
                  : step === "done" || ["upload", "map", "balances"].indexOf(step) > i
                    ? "text-green-600"
                    : ""
              }
            >
              {i + 1}.{" "}
              {s === "upload" ? "Cargar CSV" : s === "map" ? "Mapear columnas" : "Saldos"}
            </span>
          </span>
        ))}
      </div>

      {/* ── Paso 1: Upload ── */}
      {step === "upload" && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Archivo CSV
            </label>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={handleFileChange}
              className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-zinc-100"
            />
          </div>
          <p className="text-xs text-zinc-400">O pega el contenido directamente:</p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"fecha,descripcion,debito,credito,saldo\n01/01/2026,Depósito,,1000.00,1000.00"}
            rows={6}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => csvText && handleCsvLoad(csvText)}
            disabled={!csvText.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Continuar
          </button>
        </div>
      )}

      {/* ── Paso 2: Column Mapper ── */}
      {step === "map" && (
        <div className="space-y-4">
          {/* Preview tabla */}
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">
              Vista previa (primeras {previewRows.length} filas):
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    {headerRow.map((h, i) => (
                      <th key={i} className="border-b px-3 py-1.5 text-left font-medium text-zinc-600">
                        {h || `Col ${i}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="even:bg-zinc-50">
                      {headerRow.map((_, ci) => (
                        <td key={ci} className="border-b px-3 py-1 text-zinc-700">
                          {row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selectores de columna */}
          <div>
            <p className="mb-2 text-xs font-medium text-zinc-500">
              Asigna cada campo a su columna correspondiente:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ALL_FIELDS.map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field as typeof REQUIRED_FIELDS[number]) && (
                      <span className="ml-1 text-red-500">*</span>
                    )}
                  </label>
                  <select
                    value={columnMap[field] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setColumnMap((prev) => ({
                        ...prev,
                        [field]: val === "" ? undefined : Number(val),
                      }));
                    }}
                    className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">— seleccionar —</option>
                    {headerRow.map((h, i) => (
                      <option key={i} value={i}>
                        {i}: {h || `Col ${i}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={handleMapConfirm}
              disabled={!isMapComplete()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Confirmar mapeo
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Balances ── */}
      {step === "balances" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="csv-opening" className="mb-1 block text-sm font-medium text-zinc-700">
                Saldo inicial
              </label>
              <input
                id="csv-opening"
                type="text"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="Ej. 1500.00"
                required
                inputMode="decimal"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-[15px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ fontVariantNumeric: "tabular-nums" }}
              />
            </div>
            <div>
              <label htmlFor="csv-closing" className="mb-1 block text-sm font-medium text-zinc-700">
                Saldo final
              </label>
              <input
                id="csv-closing"
                type="text"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
                placeholder="Ej. 3200.00"
                required
                inputMode="decimal"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-[15px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ fontVariantNumeric: "tabular-nums" }}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("map")}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <UploadIcon className="h-4 w-4" aria-hidden="true" />
              {isPending ? "Importando..." : "Importar extracto"}
            </button>
          </div>
        </form>
      )}

      {/* ── Done ── */}
      {step === "done" && success && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckIcon className="h-10 w-10 text-green-500" aria-hidden="true" />
          <p className="text-sm text-zinc-700">
            Extracto importado con{" "}
            <span className="font-semibold">
              {success.count} transacción{success.count !== 1 ? "es" : ""}
            </span>
            .
          </p>
          <button
            type="button"
            onClick={() => {
              setStep("upload");
              setCsvText("");
              setPreviewRows([]);
              setHeaderRow([]);
              setColumnMap({});
              setOpeningBalance("");
              setClosingBalance("");
              setSuccess(null);
              setError(null);
            }}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            Importar otro extracto
          </button>
        </div>
      )}

      {/* Error global */}
      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
