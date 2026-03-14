// src/components/retentions/RetentionForm.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { createRetentionAction } from "@/modules/retentions/actions/retention.actions";
import { RetentionService } from "@/modules/retentions/services/RetentionService";
import { ISLR_RATES, IVA_RETENTION_RATES } from "@/modules/retentions/schemas/retention.schema";

type Props = {
  companyId: string;
  userId: string;
};

export function RetentionForm({ companyId, userId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [retentionType, setRetentionType] = useState<"IVA" | "ISLR" | "AMBAS">("IVA");
  const [taxBase, setTaxBase] = useState("");
  const [ivaRetentionPct, setIvaRetentionPct] = useState<75 | 100>(75);
  const [islrCode, setIslrCode] = useState("SERVICIOS_PJ");

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
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}
