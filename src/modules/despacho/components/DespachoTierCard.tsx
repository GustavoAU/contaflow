"use client";

// ADR-034: Tarjeta de tier Despacho visible en Settings
import { ZapIcon, StarIcon, InfinityIcon, ArrowUpRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import type { DespachoTier } from "@prisma/client";

type Props = {
  companyId: string;
  despachoTier: DespachoTier | null;
  currentCount: number;
  limit: number | null;
};

const TIER_META: Record<
  DespachoTier,
  { label: string; Icon: React.ElementType; color: string }
> = {
  STARTER: { label: "Starter", Icon: ZapIcon, color: "text-sky-600" },
  PRO: { label: "Pro", Icon: StarIcon, color: "text-violet-600" },
  UNLIMITED: { label: "Ilimitado", Icon: InfinityIcon, color: "text-emerald-600" },
};

export function DespachoTierCard({ companyId, despachoTier, currentCount, limit }: Props) {
  const router = useRouter();

  if (!despachoTier) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-3">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
          Sin tier Despacho activo
        </p>
        <p className="text-sm text-amber-700 dark:text-amber-500">
          Activa un tier para gestionar RIFs de clientes.
        </p>
        <Button
          size="sm"
          onClick={() => router.push(`/company/${companyId}/despacho/upgrade`)}
        >
          Ver planes Despacho
          <ArrowUpRightIcon className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const meta = TIER_META[despachoTier];
  const Icon = meta.Icon;
  const usageLabel = limit === null ? `${currentCount} RIFs` : `${currentCount} / ${limit} RIFs`;
  const pct = limit !== null ? Math.round((currentCount / limit) * 100) : 0;
  const nearLimit = limit !== null && pct >= 80;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${meta.color}`} aria-hidden="true" />
          <span className="font-semibold text-gray-900 dark:text-white">
            Despacho {meta.label}
          </span>
        </div>
        <Badge variant="outline" className={`${meta.color} border-current`}>
          {meta.label}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">RIFs gestionados</span>
          <span className={`font-medium ${nearLimit ? "text-amber-600" : "text-gray-900 dark:text-white"}`}>
            {usageLabel}
          </span>
        </div>
        {limit !== null && (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${nearLimit ? "bg-amber-500" : "bg-blue-500"}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
              role="progressbar"
              aria-valuenow={currentCount}
              aria-valuemax={limit}
              aria-label="Uso de RIFs"
            />
          </div>
        )}
      </div>

      {despachoTier !== "UNLIMITED" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/company/${companyId}/despacho/upgrade`)}
        >
          Mejorar plan
          <ArrowUpRightIcon className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
