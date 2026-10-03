"use client";

// ADR-034: Banner de onboarding para empresas DESPACHO sin tier activo
import { useRouter } from "next/navigation";
import { BriefcaseIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  companyId: string;
};

export function DespachoOnboardingBanner({ companyId }: Props) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center dark:border-violet-800 dark:bg-violet-950/20">
      <BriefcaseIcon className="h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-violet-900 dark:text-violet-300">
          Activa tu tier Despacho
        </p>
        <p className="text-sm text-violet-700 dark:text-violet-400">
          Gestiona los RIFs de tus clientes desde un solo lugar. Elige un plan y empieza.
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0 bg-violet-600 text-white hover:bg-violet-700"
        onClick={() => router.push(`/company/${companyId}/despacho/upgrade`)}
      >
        Ver planes
        <ArrowRightIcon className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
