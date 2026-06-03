import { SignUp } from "@clerk/nextjs";

type PlanKey = "mensual" | "anual" | "early_adopter";

const PLAN_SUMMARIES: Record<
  PlanKey,
  {
    name: string;
    displayPrice: string;
    billingNote: string;
    totalToday: string;
    features: string[];
    badge?: string;
    badgeColor?: "blue" | "amber";
  }
> = {
  mensual: {
    name: "Plan Mensual",
    displayPrice: "$59/mes",
    billingNote: "Facturado mensualmente en USDT. Cancela cuando quieras.",
    totalToday: "$59 USDT / mes",
    features: [
      "1 empresa (RIF) incluida",
      "Facturas, nómina e inventario ilimitados",
      "Usuarios ilimitados",
      "Soporte por email",
    ],
  },
  anual: {
    name: "Plan Anual",
    displayPrice: "$47/mes",
    billingNote: "Facturado como $565/año en USDT · Incluye 2 meses gratis",
    totalToday: "$565 USDT / año",
    features: [
      "1 empresa (RIF) incluida",
      "Facturas, nómina e inventario ilimitados",
      "Usuarios ilimitados",
      "Soporte prioritario",
    ],
    badge: "Más popular",
    badgeColor: "blue",
  },
  early_adopter: {
    name: "Plan Early Adopter",
    displayPrice: "$19/mes",
    billingNote:
      "Año 1 · Facturado como $228/año en USDT. A partir del año 2: $565/año.",
    totalToday: "$228 USDT / año 1",
    features: [
      "1 empresa (RIF) incluida",
      "Sesión de onboarding 1.5 h (videollamada)",
      "Chat prioritario el primer mes",
      "Precio especial bloqueado permanentemente",
    ],
    badge: "Oferta limitada",
    badgeColor: "amber",
  },
};

interface PageProps {
  searchParams: Promise<{ plan?: string }>;
}

export default async function SignUpPage({ searchParams }: PageProps) {
  const { plan } = await searchParams;
  const normalizedPlan = plan?.replace(/-/g, "_");
  const validPlan =
    normalizedPlan && normalizedPlan in PLAN_SUMMARIES
      ? (normalizedPlan as PlanKey)
      : null;
  const summary = validPlan ? PLAN_SUMMARIES[validPlan] : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      {summary ? (
        <div className="flex w-full max-w-4xl flex-col items-center gap-8 lg:flex-row lg:items-start">
          {/* Plan summary */}
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-7 shadow-sm lg:max-w-75 lg:sticky lg:top-12">
            {summary.badge && (
              <span
                className={`mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                  summary.badgeColor === "amber"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-blue-50 text-blue-700"
                }`}
              >
                {summary.badge}
              </span>
            )}
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Estás contratando
            </p>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {summary.name}
            </h2>
            <div className="mb-0.5 text-3xl font-extrabold text-slate-900">
              {summary.displayPrice}
            </div>
            <p className="mb-5 text-xs text-slate-500">{summary.billingNote}</p>

            <div className="mb-5 rounded-lg bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">
                Total a pagar
              </p>
              <p className="text-lg font-bold text-blue-900">
                {summary.totalToday}
              </p>
            </div>

            <ul className="mb-5 space-y-2">
              {summary.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                  <svg
                    className="mt-0.5 h-4 w-4 shrink-0 text-blue-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>

            <p className="text-xs text-slate-400">
              Nunca se te cobrará sin confirmación previa. Cancela en cualquier
              momento desde tu cuenta.
            </p>

            <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
              <svg
                className="h-3.5 w-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Información protegida con cifrado SSL
            </div>
          </div>

          {/* Clerk form */}
          <div className="flex w-full flex-col items-center lg:flex-1">
            <p className="mb-3 text-sm text-slate-500">
              <span className="font-semibold text-slate-700">Paso 1 de 2:</span>{" "}
              Crea tu cuenta para activar el plan
            </p>
            <SignUp />
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen items-center justify-center">
          <SignUp />
        </div>
      )}
    </div>
  );
}
