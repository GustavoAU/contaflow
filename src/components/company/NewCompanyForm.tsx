// src/components/company/NewCompanyForm.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, BuildingIcon, UserIcon, LayoutGridIcon } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { createCompanyAction } from "@/modules/company/actions/company.actions";
// MP-4 (ADR-042): sin constantes VEN_* — etiqueta, placeholder y regex del ID
// tributario salen de la config del país seleccionado. Aquí no hay empresa aún
// (es el alta), así que no aplica useFiscalConfig(): el país es estado del form.
import { getFiscalConfig, SUPPORTED_COUNTRIES, type CountryCode } from "@/lib/countries";
import { cn } from "@/lib/utils";

type ScopeProfile = "SOLO" | "EMPRESA" | "DESPACHO";

const PROFILES: {
  value: ScopeProfile;
  label: string;
  description: string;
  Icon: React.ElementType;
}[] = [
  {
    value: "SOLO",
    label: "Empresa Individual",
    description: "Un solo RIF. Ideal para autónomos, pequeñas empresas o contadores que gestionan sus propias cuentas.",
    Icon: UserIcon,
  },
  {
    value: "EMPRESA",
    label: "Empresa con Equipo",
    description: "Equipo contable, nómina, inventario. Para empresas con operaciones completas.",
    Icon: BuildingIcon,
  },
  {
    value: "DESPACHO",
    label: "Despacho / Grupo",
    description: "Gestiona los RIFs de tus clientes desde un solo panel.",
    Icon: LayoutGridIcon,
  },
];

type Props = {
  userId: string;
  initialProfile?: string;
};

export function NewCompanyForm({ userId, initialProfile }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [rif, setRif] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [country, setCountry] = useState<CountryCode>("VEN");
  const [profile, setProfile] = useState<ScopeProfile | undefined>(
    (["SOLO", "EMPRESA", "DESPACHO"].includes(initialProfile ?? "") ? initialProfile as ScopeProfile : undefined)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Config del país elegido: taxIdLabel ("RIF"), placeholder y regex de validación
  const cfg = useMemo(() => getFiscalConfig(country), [country]);

  function validate() {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "El nombre es obligatorio";
    if (name.trim().length < 2) newErrors.name = "El nombre debe tener al menos 2 caracteres";
    if (rif.trim() && !cfg.taxIdRegex.test(rif.trim())) {
      newErrors.rif = `${cfg.taxIdLabel} inválido (ej: ${cfg.taxIdPlaceholder})`;
    }
    if (!phone.trim()) {
      newErrors.phone = "El teléfono es obligatorio";
    } else if (phone.replace(/\D/g, "").length < 10) {
      newErrors.phone = "Teléfono inválido (incluye código de área, ej: 0412-1234567)";
    }
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
        country,
        rif: rif.trim() || undefined,
        address: address.trim() || undefined,
        telefono: phone.trim(),
        scopeProfile: profile,
      });

      if (result.success) {
        toast.success(`Empresa "${result.data.name}" creada correctamente`);
        // Si no eligió perfil, redirige al activate-modules para completarlo
        if (!profile) {
          router.push(`/company/${result.data.id}/activate-modules`);
        } else {
          router.push(`/company/${result.data.id}`);
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <div className="space-y-5">
        {/* Selector de perfil */}
        <div>
          <p className="mb-2 text-sm font-medium text-zinc-700">
            ¿Cómo describes tu operación?
            <span className="ml-1 font-normal text-zinc-400">(opcional — puedes cambiarlo después)</span>
          </p>
          <div className="grid gap-2">
            {PROFILES.map(({ value, label, description, Icon }) => {
              const isSelected = profile === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setProfile(isSelected ? undefined : value)}
                  className={cn(
                    "flex items-start gap-3 w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1",
                    isSelected
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                      : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
                  )}
                >
                  <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", isSelected ? "text-blue-600" : "text-zinc-400")} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-medium", isSelected ? "text-blue-700 dark:text-blue-400" : "text-zinc-800 dark:text-zinc-100")}>
                        {label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

        {/* País — decide el formato del ID tributario y la config fiscal (ADR-042).
            Con un solo país soportado el select tiene una opción; cuando exista un
            segundo país basta registrarlo en SUPPORTED_COUNTRIES. */}
        <div>
          <label htmlFor="new-company-country" className="mb-1 block text-sm font-medium text-zinc-700">
            País <span className="text-red-500">*</span>
          </label>
          <select
            id="new-company-country"
            value={country}
            onChange={(e) => {
              const next = e.target.value as CountryCode;
              setCountry(next);
              // La regex del ID tributario cambió: limpiar un error obsoleto
              setErrors((prev) => {
                const { rif: _drop, ...rest } = prev;
                return rest;
              });
            }}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm transition-colors outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
          >
            {SUPPORTED_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

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

        {/* ID tributario — etiqueta y placeholder según el país (RIF en VEN) */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {cfg.taxIdLabel}
            <span className="ml-1 font-normal text-zinc-400">(opcional)</span>
          </label>
          <input
            type="text"
            value={rif}
            onChange={(e) => setRif(e.target.value)}
            placeholder={`Ej: ${cfg.taxIdPlaceholder}`}
            className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
              errors.rif ? "border-red-400" : "border-zinc-300"
            }`}
          />
          {errors.rif && <p className="mt-1 text-xs text-red-500">{errors.rif}</p>}
        </div>

        {/* Teléfono — obligatorio (recordatorios de renovación) */}
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Teléfono / WhatsApp <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ej: 0412-1234567"
            className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
              errors.phone ? "border-red-400" : "border-zinc-300"
            }`}
          />
          {errors.phone ? (
            <p className="mt-1 text-xs text-red-500">{errors.phone}</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">Te avisaremos por aquí antes de que venza tu suscripción.</p>
          )}
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
        <Button onClick={handleSubmit} disabled={isPending} aria-busy={isPending} className="w-full gap-2">
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {isPending ? "Creando empresa..." : "Crear Empresa"}
        </Button>
      </div>
      <Toaster richColors position="top-right" />
    </>
  );
}
