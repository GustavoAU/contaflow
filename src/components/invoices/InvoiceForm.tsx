// src/components/invoices/InvoiceForm.tsx
"use client";

import { useState, useTransition, useId } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Decimal } from "decimal.js";
import { createInvoiceAction } from "@/modules/invoices/actions/invoice.actions";
import { IGTFService, IGTF_RATE } from "@/modules/igtf/services/IGTFService";

type TaxLineType = "IVA_GENERAL" | "IVA_REDUCIDO" | "IVA_ADICIONAL" | "EXENTO";

type TaxLine = {
  id: string;
  taxType: TaxLineType;
  base: string;
  rate: string;
  amount: string;
  luxuryGroupId: string | null; // Para vincular líneas de lujo con su IVA general hermana
};

type Props = {
  companyId: string;
  userId: string;
  periodId?: string;
  isSpecialContributor: boolean;
  defaultType?: "SALE" | "PURCHASE";
};

const DOC_TYPES = [
  { value: "FACTURA", label: "Factura" },
  { value: "NOTA_DEBITO", label: "Nota de Débito" },
  { value: "NOTA_CREDITO", label: "Nota de Crédito" },
  { value: "REPORTE_Z", label: "Reporte Z (Máquina Fiscal)" },
  { value: "RESUMEN_VENTAS", label: "Resumen de Ventas" },
  { value: "PLANILLA_IMPORTACION", label: "Planilla de Importación" },
  { value: "OTRO", label: "Otro" },
];

const TAX_CATEGORIES = [
  { value: "GRAVADA", label: "Gravada" },
  { value: "EXENTA", label: "Exenta" },
  { value: "EXONERADA", label: "Exonerada" },
  { value: "NO_SUJETA", label: "No Sujeta" },
  { value: "IMPORTACION", label: "Importación" },
];

// ─── Calcula monto IVA usando Decimal.js exclusivamente ───────────────────────
function calcAmount(base: string, rate: string): string {
  try {
    const b = new Decimal(base || "0");
    const r = new Decimal(rate || "0");
    if (b.isNaN() || r.isNaN() || b.isNegative() || r.isNegative()) return "0.00";
    return b.mul(r).div(100).toFixed(2);
  } catch {
    return "0.00";
  }
}

// ─── Suma total IVA usando Decimal.js exclusivamente ─────────────────────────
function sumTaxLines(lines: TaxLine[]): string {
  return lines
    .reduce((acc, l) => {
      try {
        return acc.plus(new Decimal(l.amount || "0"));
      } catch {
        return acc;
      }
    }, new Decimal(0))
    .toFixed(2);
}

export function InvoiceForm({
  companyId,
  userId,
  periodId,
  isSpecialContributor,
  defaultType = "PURCHASE",
}: Props) {
  const baseId = useId();
  const newLineId = () => `${baseId}-${crypto.randomUUID()}`;

  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"SALE" | "PURCHASE">(defaultType);
  const [docType, setDocType] = useState("FACTURA");
  const [taxCategory, setTaxCategory] = useState("GRAVADA");
  const [taxLines, setTaxLines] = useState<TaxLine[]>([
    {
      id: newLineId(),
      taxType: "IVA_GENERAL",
      base: "",
      rate: "16",
      amount: "0.00",
      luxuryGroupId: null,
    },
  ]);
  const [paidInForeign, setPaidInForeign] = useState(false);
  const [igtfBase, setIgtfBase] = useState("");

  const isReporteZ = docType === "REPORTE_Z";

  // ─── IGTF automático ────────────────────────────────────────────────────────
  const igtfApplies =
    type === "SALE" && IGTFService.applies(paidInForeign ? "USD" : "VES", isSpecialContributor);
  const igtfCalculation =
    igtfApplies && igtfBase && !new Decimal(igtfBase || "0").isZero()
      ? IGTFService.calculate(igtfBase, IGTF_RATE)
      : null;

  // ─── Manejo de taxLines ──────────────────────────────────────────────────────
  function addTaxLine() {
    setTaxLines((prev) => [
      ...prev,
      {
        id: newLineId(),
        taxType: "IVA_GENERAL",
        base: "",
        rate: "16",
        amount: "0.00",
        luxuryGroupId: null,
      },
    ]);
  }

  function removeTaxLine(id: string) {
    setTaxLines((prev) => {
      const line = prev.find((l) => l.id === id);
      // Si elimina una línea vinculada, eliminar también su hermana
      if (line?.luxuryGroupId) {
        return prev.filter((l) => l.luxuryGroupId !== line.luxuryGroupId);
      }
      return prev.filter((l) => l.id !== id);
    });
  }

  // ─── updateTaxLine unificado ──────────────────────────────────────────────────
  function updateTaxLine(id: string, field: keyof TaxLine, value: string) {
    setTaxLines((prev) => {
      const line = prev.find((l) => l.id === id);
      if (!line) return prev;

      // 1. CAMBIO A IVA_ADICIONAL — limpiar líneas huérfanas y crear par limpio
      if (field === "taxType" && value === "IVA_ADICIONAL") {
        // Primero eliminar cualquier línea vinculada anterior de esta línea
        const cleanPrev = line.luxuryGroupId
          ? prev.filter((l) => l.luxuryGroupId !== line.luxuryGroupId || l.id === id)
          : prev;

        const groupId = crypto.randomUUID();
        return [
          ...cleanPrev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  taxType: "IVA_ADICIONAL" as TaxLineType,
                  rate: "15",
                  amount: calcAmount(l.base, "15"),
                  luxuryGroupId: groupId,
                }
              : l
          ),
          {
            id: crypto.randomUUID(),
            taxType: "IVA_GENERAL" as TaxLineType,
            base: line.base,
            rate: "16",
            amount: calcAmount(line.base, "16"),
            luxuryGroupId: groupId,
          },
        ];
      }

      // 2. CAMBIO DESDE IVA_ADICIONAL A OTRO TIPO — eliminar línea hermana vinculada
      if (field === "taxType" && line.taxType === "IVA_ADICIONAL" && value !== "IVA_ADICIONAL") {
        const rateMap: Record<string, string> = {
          IVA_GENERAL: "16",
          IVA_REDUCIDO: "8",
          EXENTO: "0",
        };
        const newRate = rateMap[value] ?? "0";
        // Eliminar la línea hermana IVA_GENERAL vinculada
        const withoutSister = prev.filter(
          (l) => !(l.luxuryGroupId === line.luxuryGroupId && l.id !== id)
        );
        return withoutSister.map((l) =>
          l.id === id
            ? {
                ...l,
                taxType: value as TaxLineType,
                rate: newRate,
                amount: calcAmount(l.base, newRate),
                luxuryGroupId: null,
              }
            : l
        );
      }

      // 3. SINCRONIZACIÓN ATÓMICA DE BASES — espejo entre líneas vinculadas
      if (field === "base" && line.luxuryGroupId) {
        return prev.map((l) =>
          l.luxuryGroupId === line.luxuryGroupId
            ? { ...l, base: value, amount: calcAmount(value, l.rate) }
            : l
        );
      }

      // 4. CAMBIO DE TIPO NORMAL — líneas no vinculadas
      if (field === "taxType") {
        const rateMap: Record<string, string> = {
          IVA_GENERAL: "16",
          IVA_REDUCIDO: "8",
          EXENTO: "0",
        };
        const newRate = rateMap[value] ?? "0";
        return prev.map((l) =>
          l.id === id
            ? {
                ...l,
                taxType: value as TaxLineType,
                rate: newRate,
                amount: calcAmount(l.base, newRate),
                luxuryGroupId: null,
              }
            : l
        );
      }

      // 5. CAMBIO DE BASE O TASA — líneas normales
      return prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };
        if (field === "base" || field === "rate") {
          updated.amount = calcAmount(
            field === "base" ? value : l.base,
            field === "rate" ? value : l.rate
          );
        }
        return updated;
      });
    });
  }

  // ─── Verificar si línea IVA_ADICIONAL tiene su hermana IVA_GENERAL ──────────
  function hasAdditionalWithoutGeneral(): boolean {
    const hasAdicional = taxLines.some((l) => l.taxType === "IVA_ADICIONAL");
    const hasGeneral = taxLines.some((l) => l.taxType === "IVA_GENERAL");
    return hasAdicional && !hasGeneral;
  }

  // ─── Validación pre-submit ───────────────────────────────────────────────────
  function validateBeforeSubmit(): string | null {
    const hasAdicional = taxLines.some((l) => l.taxType === "IVA_ADICIONAL");
    const hasGeneral = taxLines.some((l) => l.taxType === "IVA_GENERAL");

    if (hasAdicional && !hasGeneral) {
      return "Una factura de bien suntuario requiere una línea de IVA General (16%). El par no está completo.";
    }

    if (hasAdicional && hasGeneral) {
      const adicional = taxLines.find((l) => l.taxType === "IVA_ADICIONAL")!;
      const general = taxLines.find(
        (l) => l.taxType === "IVA_GENERAL" && l.luxuryGroupId === adicional.luxuryGroupId
      );
      if (!general || adicional.base !== general.base) {
        return "Las bases de IVA General (16%) e IVA Adicional (15%) deben ser iguales en bienes suntuarios.";
      }
    }

    const linesWithBase = taxLines.filter(
      (l) => l.taxType !== "EXENTO" && l.base && !new Decimal(l.base || "0").isZero()
    );

    if (linesWithBase.length === 0 && taxCategory === "GRAVADA") {
      return "Debes ingresar al menos una base imponible mayor a cero.";
    }

    for (const line of linesWithBase) {
      const expected = calcAmount(line.base, line.rate);
      if (line.amount !== expected) {
        return `Monto IVA inconsistente en línea ${line.taxType.replace(/_/g, " ")}. Recalculando...`;
      }
    }

    const categoryForcesZero = ["EXENTA", "EXONERADA", "NO_SUJETA"].includes(taxCategory);
    if (categoryForcesZero) {
      const hasNonZeroIva = taxLines.some(
        (l) => l.taxType !== "EXENTO" && l.base && !new Decimal(l.base || "0").isZero()
      );
      if (hasNonZeroIva) {
        return `Una factura ${taxCategory.toLowerCase()} no puede tener líneas de IVA con base imponible. Cambia las líneas a 'Exento / Exonerado' o corrige la categoría fiscal.`;
      }
    }

    return null;
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationError = validateBeforeSubmit();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await createInvoiceAction({
        companyId,
        createdBy: userId,
        periodId,
        type,
        docType,
        taxCategory,
        invoiceNumber: data.get("invoiceNumber"),
        controlNumber: data.get("controlNumber") || undefined,
        relatedDocNumber: data.get("relatedDocNumber") || undefined,
        importFormNumber: data.get("importFormNumber") || undefined,
        reportZStart: isReporteZ ? data.get("reportZStart") || undefined : undefined,
        reportZEnd: isReporteZ ? data.get("reportZEnd") || undefined : undefined,
        date: data.get("date"),
        counterpartName: data.get("counterpartName"),
        counterpartRif: data.get("counterpartRif"),
        taxLines: taxLines
          .filter((l) => l.base && !new Decimal(l.base || "0").isZero())
          .map((l) => ({
            taxType: l.taxType,
            base: l.base,
            rate: l.rate,
            amount: l.amount,
          })),
        ivaRetentionAmount: data.get("ivaRetentionAmount") || "0",
        ivaRetentionVoucher: data.get("ivaRetentionVoucher") || undefined,
        ivaRetentionDate: data.get("ivaRetentionDate") || undefined,
        islrRetentionAmount: data.get("islrRetentionAmount") || "0",
        igtfBase: igtfCalculation ? igtfCalculation.amount : "0",
        igtfAmount: igtfCalculation ? igtfCalculation.igtfAmount : "0",
      });

      if (result.success) {
        toast.success("Factura registrada correctamente");
        form.reset();
        setTaxLines([
          {
            id: newLineId(),
            taxType: "IVA_GENERAL",
            base: "",
            rate: "16",
            amount: "0.00",
            luxuryGroupId: null,
          },
        ]);
        setTaxCategory("GRAVADA");
        setDocType("FACTURA");
        setPaidInForeign(false);
        setIgtfBase("");
      } else {
        toast.error(result.error);
      }
    });
  }

  const totalIva = sumTaxLines(taxLines);

  return (
    <>
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 font-semibold">Registrar Factura</h2>

        {/* Selector Compra / Venta */}
        <div className="mb-6 flex rounded-lg border p-1">
          {(["PURCHASE", "SALE"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                type === t ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {t === "PURCHASE" ? "Compra" : "Venta"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                onChange={(e) => setTaxCategory(e.target.value)}
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
                name="invoiceNumber"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="0000001"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Número de Control <span className="text-red-500">*</span>
              </label>
              <input
                name="controlNumber"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="00-0000001"
              />
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
            {type === "PURCHASE" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  N° Planilla de Importación
                </label>
                <input
                  name="importFormNumber"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Opcional"
                />
              </div>
            )}
          </div>

          {/* Fecha */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Fecha <span className="text-red-500">*</span>
            </label>
            <input
              name="date"
              type="date"
              required
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Contraparte */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                {type === "PURCHASE" ? "Proveedor" : "Cliente"}{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                name="counterpartName"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Razón Social"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                RIF <span className="text-red-500">*</span>
              </label>
              <input
                name="counterpartRif"
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="J-12345678-9"
              />
            </div>
          </div>

          {/* ─── Desglose de impuestos ──────────────────────────────────────── */}
          <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-700">Desglose de Impuestos (IVA)</p>
              <button
                type="button"
                onClick={addTaxLine}
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                + Agregar línea
              </button>
            </div>

            {/* Aviso bien suntuario */}
            {hasAdditionalWithoutGeneral() && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                ⚠️ Falta la línea de <strong>IVA General (16%)</strong> requerida para bienes
                suntuarios. Agrégala sobre la misma base imponible.
              </div>
            )}

            {taxLines.map((line, idx) => (
              <div
                key={line.id}
                className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                    Línea {idx + 1}
                  </span>
                  {taxLines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTaxLine(line.id)}
                      className="text-xs font-medium text-red-400 hover:text-red-600"
                    >
                      Eliminar
                    </button>
                  )}
                </div>

                {/* Tipo de impuesto */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">
                    Tipo de Impuesto
                  </label>
                  <select
                    value={line.taxType}
                    disabled={line.taxType === "IVA_GENERAL" && line.luxuryGroupId !== null}
                    onChange={(e) =>
                      updateTaxLine(line.id, "taxType", e.target.value as TaxLineType)
                    }
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm font-medium text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                  >
                    <option value="IVA_GENERAL">IVA General (16%)</option>
                    <option value="IVA_REDUCIDO">IVA Reducido (8%)</option>
                    <option value="IVA_ADICIONAL">IVA Lujo (15% Adicional)</option>
                    <option value="EXENTO">Exento / Exonerado</option>
                  </select>

                  {line.taxType === "IVA_ADICIONAL" && (
                    <p className="mt-1 rounded border border-amber-100 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      ⚠️ Esta línea calcula el 15% adicional. La línea de IVA General (16%) se
                      gestionará automáticamente.
                    </p>
                  )}
                </div>

                {/* Base + Tasa + Monto */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                      Base Imponible
                      {line.luxuryGroupId && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase">
                          Vinculado
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.base}
                      disabled={line.taxType === "IVA_GENERAL" && !!line.luxuryGroupId}
                      onChange={(e) => updateTaxLine(line.id, "base", e.target.value)}
                      className="w-full rounded-md border px-3 py-2 font-mono text-sm text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">Tasa %</label>
                    <input
                      type="text"
                      value={`${line.rate}%`}
                      readOnly
                      className="w-full cursor-not-allowed rounded-md border bg-zinc-100 px-3 py-2 text-center font-mono text-sm text-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">
                      Monto IVA
                    </label>
                    <input
                      type="text"
                      value={line.amount}
                      readOnly
                      className="w-full rounded-md border bg-blue-50 px-3 py-2 text-right font-mono text-sm font-semibold text-blue-700"
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Total IVA */}
            <div className="flex justify-end border-t border-zinc-200 pt-2">
              <span className="mr-2 text-sm font-semibold text-zinc-600">Total IVA:</span>
              <span className="font-mono text-sm font-bold text-blue-700">{totalIva}</span>
            </div>
          </div>

          {/* Retenciones */}
          <div className="space-y-3 rounded-lg bg-orange-50 p-4">
            <p className="text-sm font-semibold text-orange-700">Retenciones</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Monto IVA Retenido
                </label>
                <input
                  name="ivaRetentionAmount"
                  type="number"
                  step="0.01"
                  defaultValue="0"
                  className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  N° Comprobante Retención IVA
                </label>
                <input
                  name="ivaRetentionVoucher"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
                  placeholder="Opcional"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Fecha Comprobante Retención IVA
                </label>
                <input
                  name="ivaRetentionDate"
                  type="date"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
                />
              </div>
              {type === "PURCHASE" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">
                    Monto ISLR Retenido
                  </label>
                  <input
                    name="islrRetentionAmount"
                    type="number"
                    step="0.01"
                    defaultValue="0"
                    className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* IGTF — solo ventas */}
          {type === "SALE" && (
            <div className="space-y-3 rounded-lg bg-yellow-50 p-4">
              <p className="text-sm font-semibold text-yellow-700">Detalle de Pago / IGTF</p>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={paidInForeign}
                  onChange={(e) => setPaidInForeign(e.target.checked)}
                  className="rounded"
                />
                Pago recibido en divisas
              </label>
              {igtfApplies && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">
                      Base IGTF (3%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={igtfBase}
                      onChange={(e) => setIgtfBase(e.target.value)}
                      className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-yellow-500 focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">
                      Monto IGTF Percibido
                    </label>
                    <input
                      type="text"
                      value={igtfCalculation?.igtfAmount ?? "0.00"}
                      readOnly
                      className="w-full rounded-md border bg-yellow-100 px-3 py-2 font-mono text-sm font-semibold text-yellow-800"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Guardando..." : "Registrar Factura"}
          </Button>
        </form>
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}
