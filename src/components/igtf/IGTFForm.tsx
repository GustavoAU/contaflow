// src/components/igtf/IGTFForm.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { createIGTFAction } from "@/modules/igtf/actions/igtf.actions";
import { IGTFService, IGTF_RATE } from "@/modules/igtf/services/IGTFService";

type Props = {
  companyId: string;
  userId: string;
  isSpecialContributor: boolean; // ← prop nueva
};

export function IGTFForm({ companyId, userId, isSpecialContributor }: Props) {
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "EUR" | "VES">("USD");

  // ← FIX: solo calcula si aplica IGTF según la lógica fiscal
  const applies = IGTFService.applies(currency, isSpecialContributor);
  const preview =
    applies && amount && parseFloat(amount) > 0 ? IGTFService.calculate(amount, IGTF_RATE) : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await createIGTFAction({
        companyId,
        amount,
        currency,
        concept: data.get("concept") as string,
        createdBy: userId,
      });

      if (result.success) {
        toast.success("IGTF registrado correctamente");
        form.reset();
        setAmount("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 font-semibold">Registrar Transacción IGTF</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Concepto */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Concepto</label>
            <input
              name="concept"
              required
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Pago a proveedor en divisas"
            />
          </div>

          {/* Monto y Moneda */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Monto de la Transacción
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="1000.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Moneda</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "USD" | "EUR" | "VES")}
                className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="USD">Dólares (USD)</option>
                <option value="EUR">Euros (EUR)</option>
                <option value="VES">Bolívares (VES) — Contribuyente Especial</option>
              </select>
            </div>
          </div>

          {/* ← Aviso cuando NO aplica IGTF */}
          {!applies && amount && parseFloat(amount) > 0 && (
            <div className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">
              ℹ️ IGTF no aplica para esta combinación de moneda y tipo de contribuyente.
            </div>
          )}

          {/* Preview — solo cuando aplica */}
          {preview && (
            <div className="space-y-1 rounded-lg bg-orange-50 p-4 text-sm">
              <p className="mb-2 font-semibold text-orange-800">
                Vista previa — {IGTFService.getDescription(currency, isSpecialContributor)}
              </p>
              <div className="flex justify-between">
                <span className="text-zinc-600">Monto base:</span>
                <span className="font-mono">{preview.amount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">IGTF ({IGTF_RATE}%):</span>
                <span className="font-mono text-orange-700">{preview.igtfAmount}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1">
                <span className="font-semibold text-orange-800">Total a pagar:</span>
                <span className="font-mono font-bold text-orange-800">{preview.total}</span>
              </div>
            </div>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Guardando..." : "Registrar IGTF"}
          </Button>
        </form>
      </div>

      <Toaster richColors position="top-right" />
    </>
  );
}
