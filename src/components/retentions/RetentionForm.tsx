// src/components/retentions/RetentionForm.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  createRetentionAction,
  exportRetentionVoucherPDFAction,
  linkRetentionToInvoiceAction,
  findInvoiceByNumberAction,
  type InvoiceMatch,
} from "@/modules/retentions/actions/retention.actions";
import { RetentionService } from "@/modules/retentions/services/RetentionService";
import { ISLR_RATES, IVA_RETENTION_RATES } from "@/modules/retentions/schemas/retention.schema";

type Props = {
  companyId: string;
  userId: string;
};

export function RetentionForm({ companyId, userId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isPendingVoucher, startTransitionVoucher] = useTransition();
  const [isPendingLink, startTransitionLink] = useTransition();
  const [isPendingSearch, startTransitionSearch] = useTransition();
  const [savedRetentionId, setSavedRetentionId] = useState<string | null>(null);
  const [savedVoucherNumber, setSavedVoucherNumber] = useState<string | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceMatches, setInvoiceMatches] = useState<InvoiceMatch[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceMatch | null>(null);
  const [retentionType, setRetentionType] = useState<"IVA" | "ISLR" | "AMBAS">("IVA");
  const [taxBase, setTaxBase] = useState("");
  const [ivaRetentionPct, setIvaRetentionPct] = useState<75 | 100>(75);
  const [islrCode, setIslrCode] = useState("SERVICIOS_PJ");

  function handleDownloadVoucher(retentionId: string) {
    startTransitionVoucher(async () => {
      const result = await exportRetentionVoucherPDFAction(retentionId, companyId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comprobante-retencion-${retentionId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleSearchInvoice() {
    if (!invoiceSearch.trim()) return;
    startTransitionSearch(async () => {
      const result = await findInvoiceByNumberAction(invoiceSearch.trim(), companyId);
      if (result.success) {
        setInvoiceMatches(result.data);
        if (result.data.length === 0) toast.error("No se encontraron facturas con ese número");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleLinkToInvoice(retentionId: string, invoice: InvoiceMatch) {
    startTransitionLink(async () => {
      const result = await linkRetentionToInvoiceAction(retentionId, invoice.id, companyId);
      if (result.success) {
        toast.success(`Retención vinculada a factura ${invoice.invoiceNumber}`);
        setInvoiceSearch("");
        setInvoiceMatches([]);
        setSelectedInvoice(invoice);
      } else {
        toast.error(result.error);
      }
    });
  }

  // Preview en tiempo real
  const preview =
    taxBase && parseFloat(taxBase) > 0
      ? RetentionService.calculate(
          taxBase,
          ivaRetentionPct,
          retentionType !== "IVA" ? islrCode : undefined
        )
      : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await createRetentionAction({
        companyId,
        providerName: data.get("providerName") as string,
        providerRif: data.get("providerRif") as string,
        invoiceNumber: data.get("invoiceNumber") as string,
        invoiceDate: new Date(data.get("invoiceDate") as string),
        invoiceAmount: data.get("invoiceAmount") as string,
        taxBase: taxBase,
        ivaAmount: preview?.ivaAmount ?? "0",
        ivaRetentionPct,
        islrCode: retentionType !== "IVA" ? islrCode : undefined,
        type: retentionType,
        createdBy: userId,
      });

      if (result.success) {
        toast.success("Retención creada correctamente");
        setSavedRetentionId(result.data.id);
        setSavedVoucherNumber(result.data.voucherNumber);
        setSelectedInvoice(null);
        setInvoiceSearch("");
        setInvoiceMatches([]);
        form.reset();
        setTaxBase("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 font-semibold">Nueva Retención</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Proveedor */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Nombre del Proveedor
              </label>
              <input
                name="providerName"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Distribuidora ABC C.A."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                RIF del Proveedor
              </label>
              <input
                name="providerRif"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="J-12345678-9"
              />
            </div>
          </div>

          {/* Factura */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">N° Factura</label>
              <input
                name="invoiceNumber"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="B00000001"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Fecha de Factura
              </label>
              <input
                name="invoiceDate"
                type="date"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Montos */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Monto Total Factura
              </label>
              <input
                name="invoiceAmount"
                type="number"
                step="0.01"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="1160.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Base Imponible</label>
              <input
                type="number"
                step="0.01"
                required
                value={taxBase}
                onChange={(e) => setTaxBase(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="1000.00"
              />
            </div>
          </div>

          {/* Tipo de retención */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Tipo de Retención
            </label>
            <select
              value={retentionType}
              onChange={(e) => setRetentionType(e.target.value as "IVA" | "ISLR" | "AMBAS")}
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="IVA">Solo IVA</option>
              <option value="ISLR">Solo ISLR</option>
              <option value="AMBAS">IVA + ISLR</option>
            </select>
          </div>

          {/* Porcentaje IVA */}
          {(retentionType === "IVA" || retentionType === "AMBAS") && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                % Retención IVA
              </label>
              <select
                value={ivaRetentionPct}
                onChange={(e) => setIvaRetentionPct(Number(e.target.value) as 75 | 100)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value={75}>{IVA_RETENTION_RATES.STANDARD.description}</option>
                <option value={100}>{IVA_RETENTION_RATES.FULL.description}</option>
              </select>
            </div>
          )}

          {/* Código ISLR */}
          {(retentionType === "ISLR" || retentionType === "AMBAS") && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Concepto ISLR (Decreto 1808)
              </label>
              <select
                value={islrCode}
                onChange={(e) => setIslrCode(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {Object.entries(ISLR_RATES).map(([code, rate]) => (
                  <option key={code} value={code}>
                    {rate.description} ({rate.pct}%)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Preview de cálculo */}
          {preview && (
            <div className="space-y-1 rounded-lg bg-blue-50 p-4 text-sm">
              <p className="mb-2 font-semibold text-blue-800">Vista previa del cálculo</p>
              <div className="flex justify-between">
                <span className="text-zinc-600">IVA (16%):</span>
                <span className="font-mono">{preview.ivaAmount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Retención IVA ({ivaRetentionPct}%):</span>
                <span className="font-mono">{preview.ivaRetention}</span>
              </div>
              {preview.islrAmount && (
                <div className="flex justify-between">
                  <span className="text-zinc-600">
                    Retención ISLR ({preview.islrRetentionPct}%):
                  </span>
                  <span className="font-mono">{preview.islrAmount}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t pt-1">
                <span className="font-semibold text-blue-800">Total a retener:</span>
                <span className="font-mono font-bold text-blue-800">{preview.totalRetention}</span>
              </div>
            </div>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Guardando..." : "Crear Retención"}
          </Button>
        </form>

        {/* Acciones post-guardado */}
        {savedRetentionId && (
          <div className="mt-4 space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-800">
              Retención guardada
              {savedVoucherNumber && (
                <> — Comprobante <span className="font-mono">{savedVoucherNumber}</span></>
              )}
            </p>

            {/* Descargar comprobante */}
            <Button
              variant="outline"
              onClick={() => handleDownloadVoucher(savedRetentionId)}
              disabled={isPendingVoucher}
              className="w-full border-green-300 text-green-800 hover:bg-green-100"
              aria-label="Descargar comprobante de retención en PDF"
            >
              {isPendingVoucher ? "Generando..." : "Descargar Comprobante"}
            </Button>

            {/* Vincular a factura */}
            {selectedInvoice ? (
              <p className="text-sm text-green-700">
                Vinculada a factura{" "}
                <span className="font-mono font-semibold">{selectedInvoice.invoiceNumber}</span>
                {" "}— {selectedInvoice.counterpartName}
              </p>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-600">
                  Vincular a factura (opcional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="N° Factura (ej. B00000001)"
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchInvoice()}
                    className="flex-1 rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSearchInvoice}
                    disabled={isPendingSearch || !invoiceSearch.trim()}
                    className="shrink-0"
                  >
                    {isPendingSearch ? "..." : "Buscar"}
                  </Button>
                </div>
                {invoiceMatches.length > 0 && (
                  <ul className="divide-y rounded-md border bg-white text-sm">
                    {invoiceMatches.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between px-3 py-2 hover:bg-zinc-50"
                      >
                        <span>
                          <span className="font-mono font-medium">{inv.invoiceNumber}</span>
                          {" "}— {inv.counterpartName}
                          <span className="ml-2 text-xs text-zinc-400">
                            {new Date(inv.date).toLocaleDateString("es-VE")}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleLinkToInvoice(savedRetentionId, inv)}
                          disabled={isPendingLink}
                          className="ml-2 shrink-0 text-xs"
                        >
                          Vincular
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}
