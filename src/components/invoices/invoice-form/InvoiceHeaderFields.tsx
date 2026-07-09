// src/components/invoices/invoice-form/InvoiceHeaderFields.tsx
// Presentacional — JSX movido MECÁNICAMENTE desde InvoiceForm.tsx (sin cambios).
// Estado y handlers viven en el contenedor; aquí solo llegan por props.
"use client";

import { RifInput } from "@/components/invoices/RifInput";
import { RelatedInvoicePicker } from "@/components/invoices/RelatedInvoicePicker";
import { DOC_TYPES, TAX_CATEGORIES } from "./helpers";

type Props = {
  companyId: string;
  type: "SALE" | "PURCHASE";
  docType: string;
  setDocType: (value: string) => void;
  taxCategory: string;
  setTaxCategory: (value: string) => void;
  setPendingCategory: (value: string | null) => void;
  setShowAlert: (value: boolean) => void;
  prevCategoryRef: React.RefObject<string>;
  isReporteZ: boolean;
  currency: "VES" | "USD" | "EUR";
  setCurrency: (value: "VES" | "USD" | "EUR") => void;
  counterpartName: string;
  setCounterpartName: (value: string) => void;
  counterpartNameRef: React.RefObject<HTMLInputElement | null>;
  counterpartAddress: string;
  setCounterpartAddress: (value: string) => void;
  counterpartIsSpecialContributor: boolean;
  setCounterpartIsSpecialContributor: (value: boolean) => void;
  relatedInvoiceId: string;
  setRelatedInvoiceId: (value: string) => void;
  invoiceNumberRef: React.RefObject<HTMLInputElement | null>;
  controlNumberRef: React.RefObject<HTMLInputElement | null>;
  dateRef: React.RefObject<HTMLInputElement | null>;
  ocrRifKey: number;
  ocrCounterpartRif: string;
};

export function InvoiceHeaderFields({
  companyId,
  type,
  docType,
  setDocType,
  taxCategory,
  setTaxCategory,
  setPendingCategory,
  setShowAlert,
  prevCategoryRef,
  isReporteZ,
  currency,
  setCurrency,
  counterpartName,
  setCounterpartName,
  counterpartNameRef,
  counterpartAddress,
  setCounterpartAddress,
  counterpartIsSpecialContributor,
  setCounterpartIsSpecialContributor,
  relatedInvoiceId,
  setRelatedInvoiceId,
  invoiceNumberRef,
  controlNumberRef,
  dateRef,
  ocrRifKey,
  ocrCounterpartRif,
}: Props) {
  return (
    <>
      {/* Tipo de documento y categoría fiscal */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Tipo de Documento
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Categoría Fiscal
          </label>
          <select
            value={taxCategory}
            onChange={(e) => {
              const newValue = e.target.value;
              if (["EXENTA", "EXONERADA", "NO_SUJETA"].includes(newValue)) {
                setPendingCategory(newValue);
                setShowAlert(true);
                // NO aplicar el cambio aún — esperar confirmación
              } else {
                setTaxCategory(newValue);
                prevCategoryRef.current = newValue;
              }
            }}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {TAX_CATEGORIES.filter((c) => type === "PURCHASE" || c.value !== "IMPORTACION").map(
              (c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              )
            )}
          </select>
        </div>
      </div>

      {/* Números de documento */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Número de Factura <span className="text-red-500">*</span>
          </label>
          <input
            ref={invoiceNumberRef}
            name="invoiceNumber"
            required
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="0000001"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Número de Control{" "}
            {type === "PURCHASE" && <span className="text-red-500">*</span>}
          </label>
          {type === "SALE" ? (
            <div className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-400">
              <span>Se asignará automáticamente</span>
              <span className="ml-auto rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600">Prov. 0071 Art. 14</span>
            </div>
          ) : (
            <input
              ref={controlNumberRef}
              name="controlNumber"
              required
              pattern="\d{2}-\d{8}"
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="00-00000001"
            />
          )}
        </div>
      </div>

      {/* Reporte Z */}
      {isReporteZ && (
        <div className="grid gap-3 rounded-lg bg-zinc-50 p-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              N° Inicial (Reporte Z)
            </label>
            <input
              name="reportZStart"
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="0000001"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              N° Final (Reporte Z)
            </label>
            <input
              name="reportZEnd"
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="0000050"
            />
          </div>
        </div>
      )}

      {/* Nota relacionada e importación */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            N° Nota Déb/Cré relacionada
          </label>
          <input
            name="relatedDocNumber"
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Opcional"
          />
        </div>
        {(type === "PURCHASE" || taxCategory === "IMPORTACION") && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              N° Planilla de Importación{" "}
              {taxCategory === "IMPORTACION" && <span className="text-red-500">*</span>}
            </label>
            <input
              name="importFormNumber"
              required={taxCategory === "IMPORTACION"}
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder={taxCategory === "IMPORTACION" ? "Requerido" : "Opcional"}
            />
          </div>
        )}
      </div>

      {/* Factura original — sólo para NC/ND */}
      {(docType === "NOTA_CREDITO" || docType === "NOTA_DEBITO") && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <label className="mb-2 block text-xs font-medium text-zinc-700">
            Factura original <span className="text-red-500">*</span>
          </label>
          <RelatedInvoicePicker
            companyId={companyId}
            type={type}
            value={relatedInvoiceId}
            onChange={setRelatedInvoiceId}
          />
          <p className="mt-1.5 text-xs text-amber-700">
            El número de documento relacionado se deriva automáticamente de la factura seleccionada.
          </p>
        </div>
      )}

      {/* Fecha + Moneda */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Fecha <span className="text-red-500">*</span>
          </label>
          <input
            ref={dateRef}
            name="date"
            type="date"
            required
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Moneda</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "VES" | "USD" | "EUR")}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="VES">Bs.D (VES)</option>
            <option value="USD">USD — Dólar</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </div>
      </div>
      {currency !== "VES" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          Los montos se ingresan en VES (conversión a la tasa BCV del día). Use el widget{" "}
          <strong>BCV</strong> en el encabezado para actualizar la tasa del día. Si no existe
          tasa para la fecha seleccionada, la factura no podrá guardarse.
        </div>
      )}

      {/* Contraparte */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            {type === "PURCHASE" ? "Proveedor" : "Cliente"}{" "}
            <span className="text-red-500">*</span>
          </label>
          <input
            ref={counterpartNameRef}
            name="counterpartName"
            required
            value={counterpartName}
            onChange={(e) => setCounterpartName(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Razón Social"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            RIF <span className="text-red-500">*</span>
          </label>
          <RifInput
            key={ocrRifKey}
            companyId={companyId}
            name="counterpartRif"
            defaultValue={ocrCounterpartRif}
            required
            onLegalNameFound={(name) => {
              if (!counterpartName) setCounterpartName(name);
            }}
            onContactSelected={(contact) => {
              if (!counterpartName) setCounterpartName(contact.name);
              if (!counterpartAddress && contact.address) setCounterpartAddress(contact.address);
              setCounterpartIsSpecialContributor(contact.isSpecialContributor);
            }}
          />
        </div>
      </div>

      {/* H-1: Dirección fiscal — Art. 57 Ley IVA, Art. 13 Prov. 00071 */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          Dirección Fiscal{" "}
          <span className="font-normal text-zinc-400" title="Art. 57 Ley IVA: el libro debe registrar la dirección del contribuyente">(recomendada)</span>
          {counterpartIsSpecialContributor && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-10 font-bold text-amber-700 uppercase" title="Contribuyente Especial — aplica retención IVA (Prov. 0049)">CE</span>
          )}
        </label>
        <input
          type="text"
          name="counterpartAddress"
          value={counterpartAddress}
          onChange={(e) => setCounterpartAddress(e.target.value)}
          placeholder="Ej: Av. Principal, Edif. Torre, Piso 3, Caracas"
          className="w-full rounded-md border px-3 py-2 text-sm text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>
    </>
  );
}
