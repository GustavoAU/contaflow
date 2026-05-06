// src/app/(dashboard)/company/[companyId]/upgrade/page.tsx
import Link from "next/link";
import { ChevronLeftIcon, CheckIcon, ZapIcon, StarIcon, TrendingUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SubscribeButton } from "@/components/billing/SubscribeButton";
import { PLAN_PRICES_CENTS } from "@/modules/billing/services/BillingService";

type Props = {
  params: Promise<{ companyId: string }>;
};

const PLANS = [
  {
    plan: "MONTHLY" as const,
    name: "Mensual",
    price: "$59",
    period: "/mes",
    description: "Sin compromisos. Cancela cuando quieras.",
    features: [
      "Todas las funcionalidades incluidas",
      "Usuarios ilimitados",
      "Soporte por email",
    ],
    icon: ZapIcon,
    highlighted: false,
    badge: null,
  },
  {
    plan: "ANNUAL" as const,
    name: "Anual",
    price: "$565",
    period: "/año",
    priceMonthly: "≈ $47/mes — ahorras $143",
    description: "Equivale a 2 meses gratis respecto al plan mensual.",
    features: [
      "Todo lo del plan mensual",
      "Ahorras $143 al año",
      "Soporte prioritario",
    ],
    icon: TrendingUpIcon,
    highlighted: true,
    badge: "Más popular",
  },
  {
    plan: "EARLY_ADOPTER" as const,
    name: "Early Adopter",
    price: "$25",
    period: "/mes — año 1",
    description: "Precio especial para las primeras 10 empresas.",
    features: [
      "Todo lo del plan anual",
      "Sesión de onboarding 1.5h (videollamada)",
      "Chat prioritario el primer mes",
      "Precio especial bloqueado para siempre",
    ],
    icon: StarIcon,
    highlighted: false,
    badge: "Oferta limitada",
  },
];

export default async function UpgradePage({ params }: Props) {
  const { companyId } = await params;

  return (
    <div className="mx-auto max-w-4xl py-10 px-4">
      <Link
        href={`/company/${companyId}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Volver al panel
      </Link>

      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Elige tu plan</h1>
        <p className="mt-2 text-muted-foreground">
          Pago único en USDT (Tether) a través de NOWPayments. Sin suscripciones automáticas.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map(({ plan, name, price, period, priceMonthly, description, features, icon: Icon, highlighted, badge }) => (
          <div
            key={plan}
            className={`relative flex flex-col rounded-xl border p-6 shadow-sm ${
              highlighted
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-background"
            }`}
          >
            {badge && (
              <Badge
                className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap"
                variant={highlighted ? "default" : "secondary"}
              >
                {badge}
              </Badge>
            )}

            <div className="mb-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">{name}</p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{price}</span>
                <span className="text-sm text-muted-foreground">{period}</span>
              </div>
              {priceMonthly && (
                <p className="mt-0.5 text-xs text-muted-foreground">{priceMonthly}</p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            </div>

            <ul className="mb-6 flex-1 space-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <SubscribeButton
              companyId={companyId}
              plan={plan}
              variant={highlighted ? "default" : "outline"}
              className="w-full"
            >
              {plan === "MONTHLY" && "Suscribirme mensual"}
              {plan === "ANNUAL" && "Suscribirme anual"}
              {plan === "EARLY_ADOPTER" && "Reclamar mi slot"}
            </SubscribeButton>

            <p className="mt-2 text-center text-xs text-muted-foreground">
              {(PLAN_PRICES_CENTS[plan] / 100).toFixed(2)} USD en USDT
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Serás redirigido a NOWPayments para completar el pago en USDT (Tether ERC-20 u otras redes).
        Tu suscripción se activa automáticamente al confirmar el pago en la blockchain.
      </div>
    </div>
  );
}
