// src/components/retentions/RetentionForm.tsx
"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Loader2Icon, AlertTriangleIcon, InfoIcon } from "lucide-react";
import { suggestIslrCode, type IslrSuggestion } from "@/lib/islr-suggestions";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  createRetentionAction,
  exportRetentionVoucherPDFAction,
  linkRetentionToInvoiceAction,
  findInvoiceByNumberAction,
  getActivePeriodAction,
  type InvoiceMatch,
  type ActivePeriod,
} from "@/modules/retentions/actions/retention.actions";
import { RetentionCalculator } from "@/modules/retentions/services/RetentionCalculator";
import { ISLR_RATES, IVA_RETENTION_RATES } from "@/modules/retentions/schemas/retention.schema";
import { fmtVen } from "@/lib/fmt-ven";

type Props = {
  companyId: string;
  userId: string;
};

export function RetentionForm({ companyId, userId }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
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
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [taxBase, setTaxBase] = useState("");
  const [ivaRetentionPct, setIvaRetentionPct] = useState<75 | 100>(75);
  const [islrCode, setIslrCode] = useState("SERVICIOS_PJ");
  const [islrConcept, setIslrConcept] = useState("");
  const [islrSuggestion, setIslrSuggestion] = useState<IslrSuggestion | null>(null);
  const [applyInces, setApplyInces] = useState(false);
  const [applyFat, setApplyFat] = useState(false);
  const [activePeriod, setActivePeriod] = useState<ActivePeriod | null>(null);

  // ALERTA 20: cargar período activo al montar
  useEffect(() => {
    getActivePeriodAction(companyId).then((res) => {
      if (res.success) setActivePeriod(res.data);
    });
  }, [companyId]);

  // Debounce 400ms para sugerencia ISLR al escribir el concepto
  useEffect(() => {
    if (!islrConcept.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIslrSuggestion(null);
      return;
    }
    const timer = setTimeout(() => {
      setIslrSuggestion(suggestIslrCode(islrConcept));
    }, 400);
    return () => clearTimeout(timer);
  }, [islrConcept]);

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
      ? RetentionCalculator.calculate(
          taxBase,
          ivaRetentionPct,
          retentionType !== "IVA" ? islrCode : undefined,
          16,
          retentionType,
          applyInces,
          applyFat
        )
      : null;

  const invoiceDateDisplay = invoiceDate ? (() => {
    const [year, month, day] = invoiceDate.split("-").map(Number);
    const d = new Date(Date.UTC(year!, month! - 1, day!));
    return d.toLocaleDateString("es-VE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  })() : null;

  const baseExceedsTotal =
    taxBase && invoiceAmount &&
    parseFloat(taxBase) > parseFloat(invoiceAmount);

  // ALERTA 20: calcular si la fecha de factura está fuera del período activo
  const invoiceDateOutsidePeriod = (() => {
    if (!activePeriod || !invoiceDate) return false;
    const [y, m, d] = invoiceDate.split("-").map(Number);
    if (!y || !m || !d) return false;
    return y !== activePeriod.year || m !== activePeriod.month;
  })();

  // ALERTA 17: detectar si alguna factura encontrada corresponde a un CE
  const selectedMatchIsSpecialContributor = invoiceMatches.some(
    (inv) => inv.isVendorSpecialContributor
  );

  function handleClear() {
    setInvoiceDate("");
    setInvoiceAmount("");
    setTaxBase("");
    setRetentionType("IVA");
    setIvaRetentionPct(75);
    setIslrCode("SERVICIOS_PJ");
    setIslrConcept("");
    setIslrSuggestion(null);
    setApplyInces(false);
    setApplyFat(false);
    setSavedRetentionId(null);
    setSavedVoucherNumber(null);
    setSelectedInvoice(null);
    setInvoiceSearch("");
    setInvoiceMatches([]);
    formRef.current?.reset();
  }

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
        applyInces,
        applyFat,
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
        setInvoiceDate("");
        setInvoiceAmount("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 font-semibold">Nueva Retención</h2>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
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
                {activePeriod && (
                  <span className="ml-1.5 font-normal text-zinc-400">
                    — Período activo:{" "}
                    {String(activePeriod.month).padStart(2, "0")}/{activePeriod.year}
                  </span>
                )}
              </label>
              <input
                name="invoiceDate"
                type="date"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                  invoiceDateOutsidePeriod ? "border-amber-400 bg-amber-50" : ""
                }`}
              />
              {invoiceDateDisplay && !invoiceDateOutsidePeriod && (
                <p className="mt-0.5 text-xs text-emerald-600">{invoiceDateDisplay}</p>
              )}
              {/* ALERTA 20 */}
              {invoiceDateOutsidePeriod && activePeriod && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangleIcon className="h-3 w-3 shrink-0" aria-hidden />
                  Fecha fuera del período activo (
                  {String(activePeriod.month).padStart(2, "0")}/{activePeriod.year}
                  ) — la retención será rechazada por el servidor.
                </p>
              )}
              {!invoiceDate && (
                <p className="mt-0.5 text-xs text-zinc-400">Selecciona una fecha</p>
              )}
            </div>
          </div>

          {/* Montos */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Monto Total Factura{" "}
                <span className="font-normal text-zinc-400">(Bs.)</span>
              </label>
              <input
                name="invoiceAmount"
                type="number"
                step="0.01"
                required
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="1160.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Base Imponible{" "}
                <span className="font-normal text-zinc-400">(Bs.)</span>
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={taxBase}
                onChange={(e) => setTaxBase(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                  baseExceedsTotal ? "border-amber-400 bg-amber-50" : ""
                }`}
                placeholder="1000.00"
              />
              {baseExceedsTotal && (
                <p className="mt-0.5 text-xs text-amber-600">
                  La base supera el total de la factura
                </p>
              )}
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
              {/* ALERTA 18: guía Providencia 0049 */}
              <p className="mt-0.5 flex items-start gap-1 text-xs text-zinc-500">
                <InfoIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>
                  <strong>75%</strong> para compras con insumos materiales ·{" "}
                  <strong>100%</strong> para servicios sin insumos (Prov. 0049 Art. 1)
                </span>
              </p>
            </div>
          )}

          {/* Código ISLR */}
          {(retentionType === "ISLR" || retentionType === "AMBAS") && (
            <div className="space-y-2">
              {/* Campo de descripción para sugerencia automática */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Descripción del servicio{" "}
                  <span className="font-normal text-zinc-400">(para sugerencia automática)</span>
                </label>
                <input
                  type="text"
                  value={islrConcept}
                  onChange={(e) => setIslrConcept(e.target.value)}
                  placeholder="ej. Honorarios de auditoría, Flete terrestre…"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                {/* Badge de sugerencia */}
                {islrSuggestion && (
                  <div className="mt-1.5 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                    <div className="text-xs text-blue-800">
                      <span className="font-medium">Sugerido:</span>{" "}
                      {islrSuggestion.label} — {islrSuggestion.rate}%{" "}
                      <span className="text-blue-500">({islrSuggestion.legalRef})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIslrCode(islrSuggestion.code)}
                      className="ml-3 shrink-0 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      Aplicar
                    </button>
                  </div>
                )}
              </div>
              {/* Selector manual de concepto ISLR */}
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
            </div>
          )}

          {/* Retenciones parafiscales opcionales */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-600">Retenciones parafiscales (opcional)</p>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={applyInces}
                onChange={(e) => setApplyInces(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <span className="text-sm">INCES 2% — Ley INCES Art. 14</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={applyFat}
                onChange={(e) => setApplyFat(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <span className="text-sm">FAT 0.75% — Fondo de Ahorro para Trabajadores</span>
            </label>
          </div>

          {/* Preview de cálculo */}
          {preview && (
            <div className="space-y-1 rounded-lg bg-blue-50 p-4 text-sm">
              <p className="mb-2 font-semibold text-blue-800">Vista previa del cálculo</p>
              {retentionType !== "ISLR" && (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-600">IVA (16%):</span>
                    <span className="font-mono">{fmtVen(preview.ivaAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-600">Retención IVA ({ivaRetentionPct}%):</span>
                    <span className="font-mono">{fmtVen(preview.ivaRetention)}</span>
                  </div>
                </>
              )}
              {preview.islrAmount && (
                <div className="flex justify-between">
                  <span className="text-zinc-600">
                    Retención ISLR ({preview.islrRetentionPct}%):
                  </span>
                  <span className="font-mono">{fmtVen(preview.islrAmount)}</span>
                </div>
              )}
              {preview.incesAmount && (
                <div className="flex justify-between">
                  <span className="text-zinc-600">
                    INCES ({preview.incesRetentionPct}%):
                  </span>
                  <span className="font-mono">{fmtVen(preview.incesAmount)}</span>
                </div>
              )}
              {preview.fatAmount && (
                <div className="flex justify-between">
                  <span className="text-zinc-600">
                    FAT ({preview.fatRetentionPct}%):
                  </span>
                  <span className="font-mono">{fmtVen(preview.fatAmount)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t pt-1">
                <span className="font-semibold text-blue-800">Total a retener:</span>
                <span className="font-mono font-bold text-blue-800">{fmtVen(preview.totalRetention)}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={isPending}
              className="flex-1"
            >
              Limpiar
            </Button>
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending && <Loader2Icon className="animate-spin" />}
              {isPending ? "Guardando..." : "Crear Retención"}
            </Button>
          </div>
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
                {/* ALERTA 17: proveedor es Contribuyente Especial */}
                {selectedMatchIsSpecialContributor && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                    <span>
                      <strong>Contribuyente Especial</strong> — Este proveedor requiere comprobante
                      de retención de IVA (75% estándar o 100% si servicios sin insumos) según
                      Providencia 0049.
                    </span>
                  </div>
                )}
                {invoiceMatches.length > 0 && (
                  <ul className="divide-y rounded-md border bg-white text-sm">
                    {invoiceMatches.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between px-3 py-2 hover:bg-zinc-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-mono font-medium">{inv.invoiceNumber}</span>
                          {" "}— {inv.counterpartName}
                          <span className="ml-2 text-xs text-zinc-400">
                            {new Date(inv.date).toLocaleDateString("es-VE")}
                          </span>
                          {/* ALERTA 19: ya tiene retención vinculada */}
                          {inv.hasLinkedRetention && (
                            <span className="ml-2 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-10 font-medium bg-amber-100 text-amber-700">
                              <AlertTriangleIcon className="h-2.5 w-2.5" aria-hidden />
                              Ya tiene retención
                            </span>
                          )}
                          {/* ALERTA 17: CE badge por factura */}
                          {inv.isVendorSpecialContributor && (
                            <span className="ml-1 inline-flex items-center rounded px-1.5 py-0.5 text-10 font-medium bg-blue-100 text-blue-700">
                              CE
                            </span>
                          )}
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
