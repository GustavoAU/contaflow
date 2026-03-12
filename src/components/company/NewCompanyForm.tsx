// src/components/company/NewCompanyForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { createCompanyAction } from "@/modules/company/actions/company.actions";

type Props = {
  userId: string;
};

export function NewCompanyForm({ userId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [rif, setRif] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "El nombre es obligatorio";
    if (name.trim().length < 2) newErrors.name = "El nombre debe tener al menos 2 caracteres";
    return newErrors;
  }

  function handleSubmit() {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});

    startTransition(async () => {
      const result = await createCompanyAction({
        name: name.trim(),
        userId,
        rif: rif.trim() || undefined,
        address: address.trim() || undefined,
      });

      if (result.success) {
        toast.success(`Empresa "${result.data.name}" creada correctamente`);
        router.push(`/company/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <div className="space-y-4">
        {/* Nombre */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Nombre de la Empresa <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Distribuidora ABC C.A."
            className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
              errors.name ? "border-red-400" : "border-zinc-300"
            }`}
          />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
        </div>

        {/* RIF */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            RIF
            <span className="ml-1 font-normal text-zinc-400">(opcional)</span>
          </label>
          <input
            type="text"
            value={rif}
            onChange={(e) => setRif(e.target.value)}
            placeholder="Ej: J-12345678-9"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm transition-colors outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Dirección */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Dirección
            <span className="ml-1 font-normal text-zinc-400">(opcional)</span>
          </label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Ej: Av. Principal, Edificio Centro, Piso 3, Caracas"
            rows={3}
            className="w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm transition-colors outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Botón */}
        <Button onClick={handleSubmit} disabled={isPending} className="w-full">
          {isPending ? "Creando empresa..." : "Crear Empresa"}
        </Button>
      </div>
      <Toaster richColors position="top-right" />
    </>
  );
}
