// src/components/ocr/InvoiceUploader.tsx
"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  UploadIcon,
  ScanIcon,
  CheckIcon,
  FileTextIcon,
  XIcon,
  ArrowRightIcon,
  Loader2Icon,
  DownloadIcon,
  SparklesIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { extractInvoiceAction, exportOcrDraftPDFAction } from "@/modules/ocr/actions/ocr.actions";
import type { ExtractedInvoice } from "@/modules/ocr/schemas/invoice.schema";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
};

// "uploading"  = 0–500 ms: button shows spinner + "Subiendo..."
// "analyzing"  = 500 ms – completion: skeleton + indeterminate bar
// "done"       = data received: fields fade in with yellow highlight
type ScanPhase = "idle" | "uploading" | "analyzing" | "done";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  EFECTIVO:       "Efectivo",
  TARJETA:        "Tarjeta",
  PAGO_MOVIL:     "Pago Móvil",
  ZELLE:          "Zelle",
  CASHEA:         "Cashea",
  TRANSFERENCIA:  "Transferencia",
  OTRO:           "Otro",
};

const CURRENCY_LABELS: Record<string, string> = {
  VES: "Bolívares (VES)",
  USD: "Dólares (USD)",
  EUR: "Euros (EUR)",
};

export const OCR_SESSION_KEY = "ocr:invoice:draft";

// ─── Skeleton (State 2: analyzing) ───────────────────────────────────────────

function ScannerSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 border-b bg-blue-50 px-4 py-3">
        <Loader2Icon className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
        <span className="text-sm font-semibold text-blue-700">
          Analizando factura con IA
        </span>
      </div>

      {/* Progress message */}
      <div className="border-b bg-blue-50/50 px-4 py-2.5">
        <p className="text-center text-xs text-blue-600 mb-2">
          Esto puede tomar 15–30 segundos — no cierres esta ventana
        </p>
        {/* Indeterminate progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-300 via-blue-500 to-blue-300 animate-pulse"
            style={{ width: "100%" }}
          />
        </div>
      </div>

      {/* Field skeletons */}
      <div className="space-y-3 p-4">
        {[
          { label: 90, value: 160 },
          { label: 60, value: 120 },
          { label: 80, value: 140 },
          { label: 70, value: 130 },
          { label: 55, value: 100 },
          { label: 95, value: 150 },
          { label: 75, value: 110 },
        ].map(({ label, value }, i) => (
          <div key={i} className="flex items-start justify-between gap-4">
            <div
              className="h-3.5 rounded-md bg-zinc-200 animate-pulse"
              style={{ width: label, animationDelay: `${i * 80}ms` }}
            />
            <div
              className="h-3.5 rounded-md bg-zinc-200 animate-pulse"
              style={{ width: value, animationDelay: `${i * 80 + 40}ms` }}
            />
          </div>
        ))}

        {/* Fake items section skeleton */}
        <div className="mt-2 space-y-2">
          <div className="h-3 w-28 rounded-md bg-zinc-200 animate-pulse" style={{ animationDelay: "600ms" }} />
          <div className="h-10 w-full rounded-md bg-zinc-100 animate-pulse" style={{ animationDelay: "700ms" }} />
          <div className="h-10 w-full rounded-md bg-zinc-100 animate-pulse" style={{ animationDelay: "800ms" }} />
        </div>
      </div>

      {/* Action buttons skeleton */}
      <div className="border-t bg-zinc-50 px-4 py-3 space-y-2">
        <div className="h-9 w-full rounded-md bg-zinc-200 animate-pulse" />
        <div className="h-9 w-full rounded-md bg-zinc-100 animate-pulse" />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InvoiceUploader({ companyId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [, startDownload] = useTransition();

  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [fieldsVisible, setFieldsVisible] = useState(false);

  const [preview, setPreview] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<"image/jpeg" | "image/png" | "image/webp">("image/jpeg");
  const [base64, setBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);

  // Cleanup timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const isLoading = scanPhase === "uploading" || scanPhase === "analyzing";

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp"] as const;
    type ValidMime = typeof validTypes[number];
    if (!validTypes.includes(file.type as ValidMime)) {
      toast.error("Solo se permiten imágenes JPG, PNG o WEBP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10MB");
      return;
    }

    setFileName(file.name);
    setMimeType(file.type as ValidMime);
    setExtracted(null);
    setScanPhase("idle");

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setPreview(result);
      setBase64(result.split(",")[1] ?? "");
    };
    reader.readAsDataURL(file);
  }

  async function handleScan() {
    if (!base64) {
      toast.error("Primero selecciona una imagen de factura");
      return;
    }

    // State 1: immediate — button disabled + "Subiendo archivo..."
    setScanPhase("uploading");
    setExtracted(null);
    setFieldsVisible(false);

    // State 2: after 500 ms — show skeleton + indeterminate progress
    timerRef.current = setTimeout(() => setScanPhase("analyzing"), 500);

    try {
      const result = await extractInvoiceAction(companyId, base64, mimeType);
      if (timerRef.current) clearTimeout(timerRef.current);

      if (result.success) {
        // State 3: data ready — fields fade in with yellow highlight
        setExtracted(result.data);
        setScanPhase("done");
        // Small delay so the DOM renders with opacity-0 before we animate to opacity-100
        setTimeout(() => setFieldsVisible(true), 50);
      } else {
        setScanPhase("idle");
        toast.error(result.error);
      }
    } catch {
      if (timerRef.current) clearTimeout(timerRef.current);
      setScanPhase("idle");
      toast.error("Error al procesar la factura. Intenta de nuevo.");
    }
  }

  function handleClear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPreview(null);
    setBase64("");
    setFileName("");
    setExtracted(null);
    setScanPhase("idle");
    setFieldsVisible(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDownloadPDF() {
    if (!extracted) return;
    startDownload(async () => {
      const result = await exportOcrDraftPDFAction(companyId, extracted);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.data.pdf), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleUseInForm() {
    if (!extracted) return;
    try {
      sessionStorage.setItem(OCR_SESSION_KEY, JSON.stringify(extracted));
    } catch {
      // sessionStorage not available (extreme private mode) — continue anyway
    }
    router.push(`/company/${companyId}/invoices/new`);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">

        {/* ── Left panel: upload ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <div
            onClick={() => !isLoading && fileInputRef.current?.click()}
            className={cn(
              "cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              isLoading && "pointer-events-none opacity-60",
              base64 && !isLoading
                ? "border-blue-400 bg-blue-50"
                : "border-zinc-300 hover:border-blue-400 hover:bg-zinc-50"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />

            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview}
                alt="Vista previa"
                className="mx-auto max-h-64 rounded object-contain"
              />
            ) : base64 ? (
              <div className="flex flex-col items-center gap-2">
                <FileTextIcon className="h-12 w-12 text-blue-500" />
                <p className="text-sm font-medium text-blue-700">{fileName}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <UploadIcon className="h-10 w-10 text-zinc-400" />
                <p className="font-medium text-zinc-600">Haz click para subir una factura</p>
                <p className="text-xs text-zinc-400">JPG, PNG o WEBP — máx. 10MB</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              onClick={() => void handleScan()}
              disabled={!base64 || isLoading}
              aria-busy={isLoading}
              className="flex-1 gap-2"
            >
              {isLoading ? (
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ScanIcon className="h-4 w-4" aria-hidden />
              )}
              {scanPhase === "uploading"
                ? "Subiendo archivo..."
                : scanPhase === "analyzing"
                  ? "Analizando..."
                  : "Escanear Factura"}
            </Button>

            {base64 && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={isLoading}
                className="gap-2"
              >
                <XIcon className="h-4 w-4" aria-hidden />
                Limpiar
              </Button>
            )}
          </div>

          {/* State 1 hint (0–500 ms) */}
          {scanPhase === "uploading" && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Enviando imagen al servidor...
            </div>
          )}
        </div>

        {/* ── Right panel: results ───────────────────────────────────────── */}
        <div>
          {/* State 2: analyzing — skeleton */}
          {scanPhase === "analyzing" && <ScannerSkeleton />}

          {/* State 3: done — extracted data with staggered fade-in */}
          {scanPhase === "done" && extracted && (
            <div className="overflow-hidden rounded-lg border bg-white">
              {/* Success header */}
              <div className="flex items-center gap-2 border-b bg-green-50 px-4 py-3">
                <CheckIcon className="h-4 w-4 text-green-600 shrink-0" />
                <span className="text-sm font-semibold text-green-700">
                  Datos extraídos correctamente
                </span>
              </div>

              {/* AI caution banner */}
              <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2.5">
                <ShieldAlertIcon className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-amber-700">
                  <span className="font-semibold">Generado por IA — revisión obligatoria.</span>{" "}
                  Los campos en amarillo fueron pre-rellenados automáticamente.
                  Verifica cada valor antes de guardar.
                </p>
              </div>

              {/* Fields with staggered fade-in */}
              <div className="space-y-1 p-4">
                {[
                  extracted.razonSocial     && { label: "Razón Social",             value: extracted.razonSocial },
                  extracted.rif             && { label: "RIF",                      value: extracted.rif },
                  extracted.numeroFactura   && { label: "N° Factura",               value: extracted.numeroFactura },
                  extracted.numeroControl   && { label: "N° Control",               value: extracted.numeroControl },
                  extracted.fechaEmision    && { label: "Fecha",                    value: extracted.fechaEmision },
                  extracted.currency        && { label: "Moneda",                   value: CURRENCY_LABELS[extracted.currency] ?? extracted.currency },
                  extracted.baseImponibleGeneral && { label: "Base Imponible General", value: formatAmount(extracted.baseImponibleGeneral), mono: true },
                  extracted.ivaGeneral      && { label: "IVA 16%",                  value: formatAmount(extracted.ivaGeneral), mono: true },
                  extracted.ivaReducido     && { label: "IVA 8%",                   value: formatAmount(extracted.ivaReducido), mono: true },
                  extracted.ivaAdicional    && { label: "IVA Adicional (+15%)",     value: formatAmount(extracted.ivaAdicional), mono: true },
                  extracted.montoTotal      && { label: "Monto Total",              value: formatAmount(extracted.montoTotal), mono: true, bold: true },
                  extracted.paymentMethod   && { label: "Método de Pago",           value: PAYMENT_METHOD_LABELS[extracted.paymentMethod] ?? extracted.paymentMethod },
                  extracted.notes           && { label: "Notas",                    value: extracted.notes },
                ]
                  .filter(Boolean)
                  .map((field, i) => {
                    const f = field as { label: string; value: string; mono?: boolean; bold?: boolean };
                    return (
                      <Field
                        key={f.label}
                        label={f.label}
                        value={f.value}
                        mono={f.mono}
                        bold={f.bold}
                        visible={fieldsVisible}
                        delay={i * 55}
                      />
                    );
                  })}

                {/* Invoice line items */}
                {extracted.items && extracted.items.length > 0 && (
                  <div
                    className={cn(
                      "pt-2 transition-all duration-300",
                      fieldsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
                    )}
                    style={{ transitionDelay: `${13 * 55}ms` }}
                  >
                    <p className="mb-1.5 text-xs font-medium text-zinc-500">Líneas de Factura</p>
                    <div className="space-y-2">
                      {extracted.items.map(
                        (item: { description: string; quantity?: string; unitPrice?: string; totalPrice?: string }, i: number) => (
                          <div key={i} className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-xs">
                            <p className="font-medium text-zinc-800">{item.description}</p>
                            <div className="mt-1 flex gap-4 text-zinc-500">
                              {item.quantity  && <span>Cant: {item.quantity}</span>}
                              {item.unitPrice && <span>P/U: {item.unitPrice}</span>}
                              {item.totalPrice && (
                                <span className="font-semibold text-zinc-700">Total: {item.totalPrice}</span>
                              )}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* AI badge */}
                <div
                  className={cn(
                    "flex items-center gap-1.5 pt-2 transition-all duration-300",
                    fieldsVisible ? "opacity-100" : "opacity-0"
                  )}
                  style={{ transitionDelay: "800ms" }}
                >
                  <SparklesIcon className="h-3 w-3 text-zinc-400" aria-hidden />
                  <span className="text-[10px] text-zinc-400">
                    Extraído con Gemini Vision · precisión estimada ~95%
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="border-t bg-zinc-50 px-4 py-3 flex flex-col gap-2">
                <Button
                  onClick={handleUseInForm}
                  className="w-full gap-2"
                  kbdHint="Ctrl+↵"
                >
                  <ArrowRightIcon className="h-4 w-4" aria-hidden />
                  Usar datos en formulario de factura
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownloadPDF}
                  className="w-full gap-2"
                >
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  Descargar PDF
                </Button>
              </div>
            </div>
          )}

          {/* State 0/1: idle or uploading — empty state */}
          {(scanPhase === "idle" || scanPhase === "uploading") && (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed bg-white p-8 text-center">
              <ScanIcon className="mb-3 h-10 w-10 text-zinc-300" aria-hidden />
              <p className="font-medium text-zinc-500">Los datos extraídos aparecerán aquí</p>
              <p className="mt-1 text-xs text-zinc-400">
                Sube una factura y presiona &quot;Escanear&quot;
              </p>
            </div>
          )}
        </div>
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function formatAmount(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function Field({
  label,
  value,
  mono = false,
  bold = false,
  visible,
  delay,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-md px-2 py-1 transition-all duration-300",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      {/* Yellow highlight signals AI-generated data */}
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-right text-sm bg-amber-50 text-amber-900 ring-1 ring-amber-200/60",
          mono && "font-mono",
          bold && "font-bold"
        )}
      >
        {value}
      </span>
    </div>
  );
}
