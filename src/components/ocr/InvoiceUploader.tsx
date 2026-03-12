// src/components/ocr/InvoiceUploader.tsx
"use client";

import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { UploadIcon, ScanIcon, CheckIcon, FileTextIcon, XIcon } from "lucide-react";
import { extractInvoiceAction } from "@/modules/ocr/actions/ocr.actions";
import type { ExtractedInvoice } from "@/modules/ocr/schemas/invoice.schema";

type Props = {
  companyId: string;
  userId: string;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  PAGO_MOVIL: "Pago Móvil",
  ZELLE: "Zelle",
  CASHEA: "Cashea",
  TRANSFERENCIA: "Transferencia",
  OTRO: "Otro",
};

const CURRENCY_LABELS: Record<string, string> = {
  VES: "Bolívares (VES)",
  USD: "Dólares (USD)",
  EUR: "Euros (EUR)",
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function InvoiceUploader({ companyId, userId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("image/jpeg");
  const [base64, setBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar tipo
    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!validTypes.includes(file.type)) {
      toast.error("Solo se permiten imágenes (JPG, PNG, WEBP) o PDF");
      return;
    }

    // Validar tamaño — máx 10MB
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10MB");
      return;
    }

    setFileName(file.name);
    setMimeType(file.type);
    setExtracted(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      // Preview
      if (file.type !== "application/pdf") {
        setPreview(result);
      } else {
        setPreview(null);
      }
      // Extraer base64 puro
      const b64 = result.split(",")[1];
      setBase64(b64);
    };
    reader.readAsDataURL(file);
  }

  function handleScan() {
    if (!base64) {
      toast.error("Primero selecciona una factura");
      return;
    }

    startTransition(async () => {
      const validMime = mimeType as "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
      const result = await extractInvoiceAction(base64, validMime);

      if (result.success) {
        setExtracted(result.data);
        toast.success("¡Factura procesada correctamente!");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleClear() {
    setPreview(null);
    setBase64("");
    setFileName("");
    setExtracted(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─── Panel izquierdo: subir archivo ──────────────────────────── */}
        <div className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              base64
                ? "border-blue-400 bg-blue-50"
                : "border-zinc-300 hover:border-blue-400 hover:bg-zinc-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
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
                <p className="text-xs text-zinc-500">PDF cargado</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <UploadIcon className="h-10 w-10 text-zinc-400" />
                <p className="font-medium text-zinc-600">Haz click para subir una factura</p>
                <p className="text-xs text-zinc-400">JPG, PNG, WEBP o PDF — máx. 10MB</p>
              </div>
            )}
          </div>

          {/* Botones */}
          <div className="flex gap-3">
            <Button onClick={handleScan} disabled={!base64 || isPending} className="flex-1 gap-2">
              <ScanIcon className="h-4 w-4" />
              {isPending ? "Procesando..." : "Escanear Factura"}
            </Button>

            {base64 && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={isPending}
                className="gap-2"
              >
                <XIcon className="h-4 w-4" />
                Limpiar
              </Button>
            )}
          </div>

          {isPending && (
            <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
              🤖 Gemini está analizando tu factura...
            </div>
          )}
        </div>

        {/* ─── Panel derecho: datos extraídos ──────────────────────────── */}
        <div>
          {!extracted ? (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed bg-white p-8 text-center">
              <ScanIcon className="mb-3 h-10 w-10 text-zinc-300" />
              <p className="font-medium text-zinc-500">Los datos extraídos aparecerán aquí</p>
              <p className="mt-1 text-xs text-zinc-400">
                Sube una factura y presiona &quot;Escanear&quot;
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-white">
              {/* Header */}
              <div className="flex items-center gap-2 border-b bg-green-50 px-4 py-3">
                <CheckIcon className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700">
                  Datos extraídos correctamente
                </span>
              </div>

              {/* Campos */}
              <div className="space-y-3 p-4">
                {extracted.supplierName && (
                  <Field label="Proveedor" value={extracted.supplierName} />
                )}
                {extracted.supplierRif && <Field label="RIF" value={extracted.supplierRif} />}
                {extracted.invoiceNumber && (
                  <Field label="N° Factura" value={extracted.invoiceNumber} />
                )}
                {extracted.invoiceDate && <Field label="Fecha" value={extracted.invoiceDate} />}
                {extracted.currency && (
                  <Field
                    label="Moneda"
                    value={CURRENCY_LABELS[extracted.currency] ?? extracted.currency}
                  />
                )}
                {extracted.subtotal && <Field label="Subtotal" value={extracted.subtotal} mono />}
                {extracted.taxAmount && <Field label="IVA" value={extracted.taxAmount} mono />}
                {extracted.totalAmount && (
                  <Field label="Total" value={extracted.totalAmount} mono bold />
                )}
                {extracted.paymentMethod && (
                  <Field
                    label="Método de Pago"
                    value={
                      PAYMENT_METHOD_LABELS[extracted.paymentMethod] ?? extracted.paymentMethod
                    }
                  />
                )}
                {extracted.notes && <Field label="Notas" value={extracted.notes} />}

                {/* Items */}
                {extracted.items && extracted.items.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-zinc-500">Líneas de Factura</p>
                    <div className="space-y-2">
                      {extracted.items.map(
                        (
                          item: {
                            description: string;
                            quantity?: string;
                            unitPrice?: string;
                            totalPrice?: string;
                          },
                          i: number
                        ) => (
                          <div key={i} className="rounded bg-zinc-50 px-3 py-2 text-xs">
                            <p className="font-medium">{item.description}</p>
                            <div className="mt-1 flex gap-4 text-zinc-500">
                              {item.quantity && <span>Cant: {item.quantity}</span>}
                              {item.unitPrice && <span>P/U: {item.unitPrice}</span>}
                              {item.totalPrice && (
                                <span className="font-semibold text-zinc-700">
                                  Total: {item.totalPrice}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Acción futura */}
              <div className="border-t bg-zinc-50 px-4 py-3">
                <p className="text-center text-xs text-zinc-400">
                  Próximamente: generar asiento contable automático desde esta factura
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}

// ─── Componente auxiliar ──────────────────────────────────────────────────────

function Field({
  label,
  value,
  mono = false,
  bold = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className={`text-right text-sm ${mono ? "font-mono" : ""} ${bold ? "font-bold" : ""}`}>
        {value}
      </span>
    </div>
  );
}
