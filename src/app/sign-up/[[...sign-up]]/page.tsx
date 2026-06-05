import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AlreadySignedInPanel } from "./AlreadySignedInPanel";

type PlanKey = "mensual" | "anual" | "early_adopter";

const PLAN_SUMMARIES: Record<
  PlanKey,
  {
    name: string;
    displayPrice: string;
    billingNote: string;
    expandDetails?: string;
    totalToday: string;
    chargeNote?: string;
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
    billingNote: "Pagas $565 USDT una sola vez al año — equivale a $47/mes",
    totalToday: "$565 USDT",
    chargeNote: "Cobro único anual (no mensual) · 12 meses pagados, 14 de acceso",
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
    billingNote: "Año 1 · Facturado como $228 USDT/año",
    expandDetails:
      "A partir del año 2: $565/año (precio regular de $47/mes). Tu precio de $19/mes queda fijo de por vida mientras mantengas la suscripción activa.",
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

  const { userId } = await auth();
  // Usuario ya logueado sin plan seleccionado → ir al dashboard
  if (userId && !validPlan) redirect("/dashboard");

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
            {summary.expandDetails ? (
              <details className="mb-5 group">
                <summary className="cursor-pointer list-none text-xs text-slate-500">
                  {summary.billingNote} ·{" "}
                  <span className="font-semibold text-blue-600 group-open:hidden">
                    Ver detalles ▸
                  </span>
                  <span className="hidden font-semibold text-blue-600 group-open:inline">
                    Ocultar ▴
                  </span>
                </summary>
                <p className="mt-1.5 text-xs text-slate-500">{summary.expandDetails}</p>
              </details>
            ) : (
              <p className="mb-5 text-xs text-slate-500">{summary.billingNote}</p>
            )}

            <div className="mb-5 rounded-lg bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">
                Total a pagar
              </p>
              <p className="text-lg font-bold text-blue-900">
                {summary.totalToday}
              </p>
              {summary.chargeNote && (
                <p className="mt-1 text-xs text-blue-600">{summary.chargeNote}</p>
              )}
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

            {/* SUPPORT_CONTACT — reemplazar WHATSAPP_NUMBER con número real antes de producción */}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">
                ¿Tienes dudas antes de continuar?
              </p>
              <a
                href="https://wa.me/WHATSAPP_NUMBER?text=Hola%2C+tengo+una+duda+sobre+ContaFlow"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                </svg>
                Escríbenos por WhatsApp
              </a>
            </div>
          </div>

          {/* Clerk form */}
          <div className="flex w-full flex-col items-center lg:flex-1">
            <div className="mb-5 w-full max-w-sm rounded-xl border border-slate-100 bg-white px-5 py-4 shadow-sm">
              <div className="flex items-start">
                {/* Step 1 — active */}
                <div className="flex flex-col items-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm">
                    1
                  </div>
                  <div className="mt-2 text-center">
                    <p className="text-xs font-semibold text-slate-900">Crea tu cuenta</p>
                    <p className="mt-0.5 text-xs text-slate-500">Regístrate en ContaFlow</p>
                  </div>
                </div>

                {/* Connector */}
                <div className="mt-4 flex-1 border-t-2 border-slate-100 mx-3" />

                {/* Step 2 — pending */}
                <div className="flex flex-col items-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-200 bg-slate-50 text-sm font-semibold text-slate-400">
                    2
                  </div>
                  <div className="mt-2 text-center">
                    <p className="text-xs font-semibold text-slate-400">Realiza el pago</p>
                    <p className="mt-0.5 text-xs text-slate-400">Transferencia USDT</p>
                  </div>
                </div>
              </div>
            </div>
            {userId ? (
              <AlreadySignedInPanel
                planName={summary.name}
                displayPrice={summary.displayPrice}
                toPlanKey={(validPlan ?? "MONTHLY").toUpperCase()}
              />
            ) : (
              <SignUp />
            )}
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
