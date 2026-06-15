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
    <div className="rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <BriefcaseIcon className="h-5 w-5 text-violet-600 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-violet-900 dark:text-violet-300">
          Activa tu tier Despacho
        </p>
        <p className="text-sm text-violet-700 dark:text-violet-400">
          Gestiona los RIFs de tus clientes desde un solo lugar. Elige un plan y empieza.
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
        onClick={() => router.push(`/company/${companyId}/despacho/upgrade`)}
      >
        Ver planes
        <ArrowRightIcon className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
      </Button>
    </div>
  );
}
