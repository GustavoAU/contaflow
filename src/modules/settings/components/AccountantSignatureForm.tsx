"use client";

// src/modules/settings/components/AccountantSignatureForm.tsx

import { useTransition } from "react";
import { toast } from "sonner";
import { saveAccountantConfigAction } from "../actions/accountant-config.actions";
import type { AccountantConfig } from "../actions/accountant-config.actions";

type Props = {
  companyId: string;
  initialConfig: AccountantConfig;
};

export function AccountantSignatureForm({ companyId, initialConfig }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveAccountantConfigAction(companyId, formData);
      if (result.success) {
        toast.success("Firma del contador guardada");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Nombre completo del CPC
          </label>
          <input
            name="accountantName"
            defaultValue={initialConfig.accountantName ?? ""}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Ej. María González Pérez"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Cargo / Título
          </label>
          <input
            name="accountantTitle"
            defaultValue={initialConfig.accountantTitle ?? ""}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Contador Público Colegiado"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Nº C.P.C.
          </label>
          <input
            name="accountantCpcNumber"
            defaultValue={initialConfig.accountantCpcNumber ?? ""}
            className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Ej. 12345"
          />
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Estos datos aparecerán en el bloque de firma de reportes financieros (Balance General,
        Estado de Resultados, Libro Mayor y Balance de Comprobación).
      </p>

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Guardando…" : "Guardar firma"}
      </button>
    </form>
  );
}
