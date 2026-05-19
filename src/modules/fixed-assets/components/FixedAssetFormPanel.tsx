"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, CheckCircle2Icon } from "lucide-react";
import { FixedAssetForm } from "./FixedAssetForm";

type AccountOption = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  accounts: AccountOption[];
};

export function FixedAssetFormPanel({ companyId, accounts }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);

  function handleSuccess() {
    setOpen(false);
    setJustRegistered(true);
    router.refresh();
    setTimeout(() => setJustRegistered(false), 4000);
  }

  return (
    <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Registrar nuevo activo</h2>
          {!open && (
            <p className="mt-0.5 text-xs text-gray-400">
              Equipos, vehículos, inmuebles y otros activos depreciables (VEN-NIF 16 / IAS 16).
            </p>
          )}
        </div>
        {!open && (
          <button
            onClick={() => {
              setJustRegistered(false);
              setOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <PlusIcon className="h-4 w-4" />
            Nuevo activo
          </button>
        )}
      </div>

      {justRegistered && !open && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <CheckCircle2Icon className="h-4 w-4 shrink-0" />
          Activo registrado. La lista se ha actualizado.
        </div>
      )}

      {open && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/30 p-5">
          <FixedAssetForm
            companyId={companyId}
            accounts={accounts}
            onSuccess={handleSuccess}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
