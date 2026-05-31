// src/modules/settings/components/StockControlLevelForm.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateStockControlLevelAction, type StockControlLevel } from "../actions/stock-config.actions";

const LEVELS: {
  value: StockControlLevel;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    value: "WARN",
    label: "Advertencia",
    description: "Permite facturar aunque el stock sea insuficiente. Muestra un aviso en la factura.",
    color: "text-amber-700 border-amber-200 bg-amber-50",
  },
  {
    value: "CONFIRM",
    label: "Confirmación requerida",
    description: "Muestra un diálogo de confirmación antes de emitir una factura con stock negativo.",
    color: "text-blue-700 border-blue-200 bg-blue-50",
  },
  {
    value: "BLOCK",
    label: "Bloqueo total",
    description: "Impide emitir facturas cuando el stock disponible es insuficiente. Recomendado para auditorías SENIAT (Art. 186 COT).",
    color: "text-red-700 border-red-200 bg-red-50",
  },
];

type Props = {
  companyId: string;
  currentLevel: StockControlLevel;
};

export function StockControlLevelForm({ companyId, currentLevel }: Props) {
  const [selected, setSelected] = useState<StockControlLevel>(currentLevel);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await updateStockControlLevelAction({ companyId, level: selected });
      if (result.success) {
        toast.success("Nivel de control de stock actualizado");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {LEVELS.map((lvl) => (
        <label
          key={lvl.value}
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
            selected === lvl.value ? lvl.color : "border-zinc-200 bg-white hover:bg-zinc-50"
          }`}
        >
          <input
            type="radio"
            name="stockControlLevel"
            value={lvl.value}
            checked={selected === lvl.value}
            onChange={() => setSelected(lvl.value)}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold">{lvl.label}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{lvl.description}</p>
          </div>
        </label>
      ))}

      <Button
        onClick={handleSave}
        disabled={isPending || selected === currentLevel}
        aria-busy={isPending}
        className="mt-2"
      >
        {isPending ? "Guardando…" : "Guardar configuración"}
      </Button>
    </div>
  );
}
