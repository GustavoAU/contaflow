// src/modules/settings/components/CajaChicaStepUpForm.tsx
"use client";

// ADR-039 (nota #3): umbral (VES) a partir del cual cerrar/reabrir una caja chica
// exige step-up 2FA. Vacío = usar el default global. Editar = ADMIN_ONLY (lo valida
// el server). Patrón clonado de StockControlLevelForm: valor inicial por props.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateCajaChicaStepUpThresholdAction } from "../actions/cajachica-config.actions";

type Props = {
  companyId: string;
  /** Valor configurado para la empresa, o null si usa el default global. */
  threshold: string | null;
  /** Default global (string) — placeholder/ayuda. */
  defaultThreshold: string;
};

export function CajaChicaStepUpForm({ companyId, threshold, defaultThreshold }: Props) {
  const [value, setValue] = useState<string>(threshold ?? "");
  const [isPending, startTransition] = useTransition();

  const initial = threshold ?? "";
  const dirty = value.trim() !== initial.trim();

  function handleSave() {
    startTransition(async () => {
      const result = await updateCajaChicaStepUpThresholdAction({
        companyId,
        threshold: value.trim(),
      });
      if (result.success) {
        toast.success(
          value.trim().length > 0
            ? "Umbral de step-up de caja chica actualizado"
            : "Umbral restablecido al valor por defecto",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleResetToDefault() {
    setValue("");
    startTransition(async () => {
      const result = await updateCajaChicaStepUpThresholdAction({ companyId, threshold: "" });
      if (result.success) {
        toast.success("Umbral restablecido al valor por defecto");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label
          htmlFor="cajaChicaStepUpThreshold"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Umbral para exigir 2FA en cierre/reapertura de caja chica (VES)
        </label>
        <input
          id="cajaChicaStepUpThreshold"
          name="cajaChicaStepUpThreshold"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={defaultThreshold}
          aria-describedby="cajaChicaStepUpThreshold-help"
          className="w-full max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <p
          id="cajaChicaStepUpThreshold-help"
          className="text-xs text-zinc-600 dark:text-zinc-400"
        >
          Por encima de este monto, cerrar o reabrir una caja exigirá verificación con
          segundo factor. Vacío = usar el valor por defecto ({defaultThreshold} VES).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleSave}
          disabled={isPending || !dirty}
          aria-busy={isPending}
        >
          {isPending ? "Guardando…" : "Guardar configuración"}
        </Button>
        {(threshold !== null || value.trim().length > 0) && (
          <Button
            type="button"
            variant="outline"
            onClick={handleResetToDefault}
            disabled={isPending}
            aria-busy={isPending}
          >
            Usar valor por defecto
          </Button>
        )}
      </div>
    </div>
  );
}
