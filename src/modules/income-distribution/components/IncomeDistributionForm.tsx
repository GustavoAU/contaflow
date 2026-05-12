// src/modules/income-distribution/components/IncomeDistributionForm.tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDistributionAction } from "../actions/income-distribution.actions";

type Account = { id: string; code: string; name: string; type: string };
type Company = { id: string; name: string };

type LineInput = {
  recipientCompanyId: string;
  accountId: string;
  percentageShare: string;
  lineDescription: string;
};

type Props = {
  companyId: string;
  accounts: Account[];
  companies: Company[];
  onSuccess: () => void;
  onCancel: () => void;
};

const emptyLine = (): LineInput => ({
  recipientCompanyId: "",
  accountId: "",
  percentageShare: "",
  lineDescription: "",
});

export function IncomeDistributionForm({ companyId, accounts, companies, onSuccess, onCancel }: Props) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [currencyCode, setCurrencyCode] = useState("VES");
  const [totalAmountOriginal, setTotalAmountOriginal] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [originAccountId, setOriginAccountId] = useState("");
  const [lines, setLines] = useState<LineInput[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const percentageSum = lines.reduce((sum, l) => {
    const p = parseFloat(l.percentageShare || "0");
    return sum + (isNaN(p) ? 0 : p);
  }, 0);
  const isBalanced = Math.abs(percentageSum - 100) < 0.01;

  function updateLine(idx: number, field: keyof LineInput, value: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isBalanced) {
      setError(`Los porcentajes suman ${percentageSum.toFixed(2)}% — deben sumar exactamente 100%.`);
      return;
    }

    startTransition(async () => {
      const result = await createDistributionAction({
        companyId,
        date,
        description: description || undefined,
        currencyCode,
        totalAmountOriginal,
        exchangeRate,
        originAccountId,
        lines: lines.map((l) => ({
          recipientCompanyId: l.recipientCompanyId,
          accountId: l.accountId,
          percentageShare: l.percentageShare,
          lineDescription: l.lineDescription || undefined,
        })),
      });

      if (!result.success) {
        setError(result.error);
      } else {
        onSuccess();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Cabecera */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha *</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Moneda *</Label>
          <select
            value={currencyCode}
            onChange={(e) => { setCurrencyCode(e.target.value); if (e.target.value === "VES") setExchangeRate("1"); }}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            disabled={isPending}
          >
            <option value="VES">VES (Bolívares)</option>
            <option value="USD">USD (Dólares)</option>
            <option value="EUR">EUR (Euros)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Monto {currencyCode !== "VES" ? `(${currencyCode})` : "Bs.D"} *</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={totalAmountOriginal}
            onChange={(e) => setTotalAmountOriginal(e.target.value)}
            placeholder="0.00"
            required
            disabled={isPending}
          />
        </div>
        {currencyCode !== "VES" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Tasa de cambio (Bs.D / {currencyCode}) *</Label>
            <Input
              type="number"
              step="0.000001"
              min="0.000001"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
              placeholder="36.50"
              required
              disabled={isPending}
            />
          </div>
        )}
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Cuenta origen *</Label>
          <select
            value={originAccountId}
            onChange={(e) => setOriginAccountId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            required
            disabled={isPending}
          >
            <option value="">Seleccionar cuenta...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Descripción (opcional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción de la distribución"
            maxLength={500}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Líneas de distribución */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Destinatarios
          </Label>
          <span className={`text-xs font-medium ${isBalanced ? "text-green-600" : "text-amber-600"}`}>
            Σ = {percentageSum.toFixed(2)}% {isBalanced ? "✓" : "(debe ser 100%)"}
          </span>
        </div>

        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-start rounded-lg border p-3">
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">Empresa destinataria *</Label>
              <select
                value={line.recipientCompanyId}
                onChange={(e) => updateLine(idx, "recipientCompanyId", e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                required
                disabled={isPending}
              >
                <option value="">Seleccionar...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">Cuenta (CxP) *</Label>
              <select
                value={line.accountId}
                onChange={(e) => updateLine(idx, "accountId", e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                required
                disabled={isPending}
              >
                <option value="">Seleccionar...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">% *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                value={line.percentageShare}
                onChange={(e) => updateLine(idx, "percentageShare", e.target.value)}
                placeholder="0.00"
                className="h-8 text-xs"
                required
                disabled={isPending}
              />
            </div>
            <div className="col-span-1 space-y-1">
              <Label className="text-xs invisible">Del</Label>
              <button
                type="button"
                onClick={() => removeLine(idx)}
                disabled={lines.length <= 2 || isPending}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                aria-label="Eliminar línea"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          disabled={lines.length >= 20 || isPending}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar destinatario
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1 border-t">
        <Button type="submit" size="sm" disabled={isPending || !isBalanced} aria-busy={isPending}>
          Guardar borrador
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
