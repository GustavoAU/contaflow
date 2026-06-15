// src/app/(dashboard)/company/[companyId]/activate-modules/page.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BuildingIcon, UserIcon, LayoutGridIcon, Loader2Icon, CheckCircle2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateScopeProfileAction } from "@/modules/company/actions/company.actions";
import { cn } from "@/lib/utils";
import { use } from "react";

type ScopeProfile = "SOLO" | "EMPRESA" | "DESPACHO";

const PROFILES: {
  value: ScopeProfile;
  label: string;
  description: string;
  features: string[];
  Icon: React.ElementType;
  disabled?: boolean;
}[] = [
  {
    value: "SOLO",
    label: "Empresa Individual",
    description: "Un solo RIF, operación directa.",
    features: [
      "Facturación y Libro IVA",
      "Contabilidad y asientos",
      "Retenciones y declaración IVA",
      "Reportes y exportación",
      "Portal de clientes",
    ],
    Icon: UserIcon,
  },
  {
    value: "EMPRESA",
    label: "Empresa con Equipo",
    description: "Equipo contable, nómina e inventario.",
    features: [
      "Todo lo de Individual",
      "Nómina y gestión de personal",
      "Control de inventario y COGS",
      "Órdenes de compra / venta",
      "Distribución de ingresos",
    ],
    Icon: BuildingIcon,
  },
  {
    value: "DESPACHO",
    label: "Despacho / Grupo",
    description: "Múltiples RIFs bajo un mismo usuario.",
    features: [
      "Todo lo de Empresa",
      "Múltiples empresas vinculadas",
      "Vista consolidada de despacho",
      "Facturación entre empresas del grupo",
    ],
    Icon: LayoutGridIcon,
    disabled: true,
  },
];

export default function ActivateModulesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = use(params);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ScopeProfile | null>(null);

  function handleConfirm() {
    if (!selected) return;

    startTransition(async () => {
      const result = await updateScopeProfileAction({ companyId, scopeProfile: selected });
      if (result.success) {
        toast.success("Perfil actualizado correctamente");
        router.push(`/company/${companyId}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSkip() {
    router.push(`/company/${companyId}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          ¿Cómo opera tu empresa?
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          Selecciona el perfil que mejor describe tu operación. Esto adapta los módulos visibles en el menú. Puedes cambiarlo en cualquier momento desde Configuración.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PROFILES.map(({ value, label, description, features, Icon, disabled }) => {
          const isSelected = selected === value;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && setSelected(isSelected ? null : value)}
              className={cn(
                "relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all",
                "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2",
                disabled && "opacity-40 cursor-not-allowed",
                isSelected
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-sm"
                  : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              )}
            >
              {/* Check mark */}
              {isSelected && (
                <CheckCircle2Icon className="absolute top-3 right-3 h-4 w-4 text-blue-600 dark:text-blue-400" />
              )}

              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                isSelected ? "bg-blue-100 dark:bg-blue-900/40" : "bg-zinc-100 dark:bg-zinc-800"
              )}>
                <Icon className={cn("h-5 w-5", isSelected ? "text-blue-600 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400")} />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <p className={cn("text-sm font-semibold", isSelected ? "text-blue-700 dark:text-blue-300" : "text-zinc-800 dark:text-zinc-100")}>
                    {label}
                  </p>
                  {disabled && (
                    <span className="text-10 font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-full">
                      Pronto
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
              </div>

              <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <span className="mt-0.5 text-zinc-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button
          onClick={handleConfirm}
          disabled={!selected || isPending}
          aria-busy={isPending}
          className="w-full sm:w-auto gap-2 min-w-[200px]"
        >
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {isPending ? "Guardando..." : "Confirmar perfil"}
        </Button>
        <button
          onClick={handleSkip}
          className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          Decidir después
        </button>
      </div>
    </div>
  );
}
