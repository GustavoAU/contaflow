"use client";

// ADR-034: Flujo de selección y pago del tier Despacho (NOWPayments en USDT)
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ZapIcon,
  StarIcon,
  InfinityIcon,
  CheckIcon,
  Loader2Icon,
  ChevronLeftIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { upgradeDespachoTierAction } from "../actions/despacho.actions";
import type { DespachoTier } from "@prisma/client";

type TierMeta = {
  tier: DespachoTier;
  name: string;
  Icon: React.ElementType;
  priceUsdCents: number;
  rifLimit: number | null;
  highlighted: boolean;
  badge: string | null;
  features: string[];
};

type Props = {
  companyId: string;
  currentTier: DespachoTier | null;
  currentCount: number;
  priceCents: Record<DespachoTier, number>;
  rifLimits: Record<DespachoTier, number | null>;
};

const TIER_ORDER: DespachoTier[] = ["STARTER", "PRO", "UNLIMITED"];

const TIER_STATIC: Record<
  DespachoTier,
  { name: string; Icon: React.ElementType; highlighted: boolean; badge: string | null }
> = {
  STARTER: { name: "Starter", Icon: ZapIcon, highlighted: false, badge: null },
  PRO: { name: "Pro", Icon: StarIcon, highlighted: true, badge: "Más popular" },
  UNLIMITED: { name: "Ilimitado", Icon: InfinityIcon, highlighted: false, badge: null },
};

function rifLabel(limit: number | null): string {
  return limit === null ? "RIFs ilimitados" : `Hasta ${limit} RIFs gestionados`;
}

export function DespachoUpgradeFlow({
  companyId,
  currentTier,
  currentCount,
  priceCents,
  rifLimits,
}: Props) {
  const router = useRouter();
  const [pendingTier, setPendingTier] = useState<DespachoTier | null>(null);
  const [isPending, startTransition] = useTransition();

  const tiers: TierMeta[] = TIER_ORDER.map((tier) => ({
    tier,
    ...TIER_STATIC[tier],
    priceUsdCents: priceCents[tier],
    rifLimit: rifLimits[tier],
    features: [
      "Tu empresa propia incluida",
      rifLabel(rifLimits[tier]),
      "Facturas, nómina e inventario ilimitados",
      "Usuarios ilimitados",
      tier === "UNLIMITED" ? "Soporte prioritario dedicado" : "Soporte por email",
    ],
  }));

  function handleSelect(tier: DespachoTier) {
    setPendingTier(tier);
    startTransition(async () => {
      const result = await upgradeDespachoTierAction({ companyId, tier });
      if (result.success) {
        window.location.href = result.paymentUrl;
      } else {
        toast.error(result.error);
        setPendingTier(null);
      }
    });
  }

  return (
    <div className="mx-auto max-w-5xl py-8 px-4">
      <Link
        href={`/company/${companyId}/despacho/rifs`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Volver a Clientes del Despacho
      </Link>

      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Plan Despacho</h1>
        <p className="mt-2 text-muted-foreground">
          Gestiona los RIFs de tus clientes desde una sola cuenta. Todo incluido —
          sin módulos separados ni límites de facturas.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pago mensual en USDT (Tether) vía NOWPayments. 1 USDT = 1 USD.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {tiers.map((t) => {
          const Icon = t.Icon;
          const isCurrent = currentTier === t.tier;
          // Downgrade bloqueado si el count actual no cabe en el límite del tier
          const exceedsLimit = t.rifLimit !== null && currentCount > t.rifLimit;
          const disabled = isCurrent || exceedsLimit || isPending;

          return (
            <div
              key={t.tier}
              className={`relative flex flex-col rounded-xl border p-6 shadow-sm ${
                t.highlighted
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-background"
              }`}
            >
              {t.badge && (
                <Badge
                  className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap"
                  variant={t.highlighted ? "default" : "secondary"}
                >
                  {t.badge}
                </Badge>
              )}

              <div className="mb-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  Despacho {t.name}
                </p>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">
                    ${(t.priceUsdCents / 100).toFixed(0)}
                  </span>
                  <span className="text-sm text-muted-foreground">/mes</span>
                </div>
              </div>

              <ul className="mb-6 flex-1 space-y-2">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={t.highlighted ? "default" : "outline"}
                className="w-full"
                disabled={disabled}
                aria-busy={isPending && pendingTier === t.tier}
                onClick={() => handleSelect(t.tier)}
              >
                {isPending && pendingTier === t.tier && (
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {isCurrent
                  ? "Tu plan actual"
                  : exceedsLimit
                    ? `Tienes ${currentCount} RIFs`
                    : "Elegir este plan"}
              </Button>

              {exceedsLimit && (
                <p className="mt-2 text-center text-xs text-amber-600">
                  Archiva clientes para bajar a este tier.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-lg border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Serás redirigido a NOWPayments para completar el pago en USDT. Tu tier se
        activa automáticamente al confirmar el pago en la blockchain.
      </div>
    </div>
  );
}
