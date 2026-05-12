import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  CheckIcon,
  ArrowRightIcon,
  FileTextIcon,
  UsersIcon,
  PackageIcon,
  LandmarkIcon,
  BuildingIcon,
  ShieldCheckIcon,
  StarIcon,
  ZapIcon,
  MailIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoModal } from "@/components/landing/VideoModal";

// ─── Constantes ───────────────────────────────────────────────────────────────

const EARLY_ADOPTER_SLOTS_TOTAL = 10;
const EARLY_ADOPTER_SLOTS_TAKEN = 3; // Actualizar manualmente hasta automatizar

const FEATURES = [
  {
    icon: FileTextIcon,
    title: "Facturación Fiscal SENIAT",
    description:
      "Emite facturas, notas de crédito/débito y retenciones conformes a PA 121. Correlativo automático con control de duplicados.",
  },
  {
    icon: UsersIcon,
    title: "Nómina Venezolana",
    description:
      "Cálculo automático de cestaticket, utilidades, vacaciones y liquidación según LOTTT. Soporte para múltiples trabajadores.",
  },
  {
    icon: PackageIcon,
    title: "Inventario y Almacén",
    description:
      "Control por lotes, seriales y múltiples unidades de medida. Alertas de bajo stock y trazabilidad completa.",
  },
  {
    icon: LandmarkIcon,
    title: "Conciliación Bancaria",
    description:
      "Importa extractos bancarios, sugiere asientos automáticamente y detecta diferencias en segundos.",
  },
  {
    icon: BuildingIcon,
    title: "Multi-empresa y Roles",
    description:
      "Gestiona varias empresas desde una sola cuenta. Roles diferenciados: Propietario, Admin, Contador, Administrativo, SENIAT.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Firma Digital Certificada",
    description:
      "Certifica PDFs con tu certificado P12. Compatible con los estándares SENIAT para documentos fiscales.",
  },
];

const TRUST_ITEMS = [
  "Conforme a PA 121 — SENIAT",
  "Retenciones IVA / ISLR / INCES",
  "Nómina LOTTT Venezuela",
  "Libro Mayor y Diario VEN-NIF",
];

const PLANS = [
  {
    key: "trial",
    name: "Prueba Gratis",
    price: "$0",
    period: "14 días",
    description: "Acceso completo sin tarjeta de crédito.",
    features: [
      "Todas las funcionalidades incluidas",
      "Hasta 3 usuarios",
      "Soporte por email",
    ],
    cta: "Crear cuenta gratis",
    ctaHref: "/sign-up",
    highlighted: false,
    badge: null,
  },
  {
    key: "monthly",
    name: "Mensual",
    price: "$59",
    period: "/mes",
    description: "Sin compromisos, cancela cuando quieras.",
    features: [
      "Todas las funcionalidades incluidas",
      "Usuarios ilimitados",
      "Soporte por email",
    ],
    cta: "Activar plan mensual",
    ctaHref: "/sign-up",
    highlighted: false,
    badge: null,
  },
  {
    key: "annual",
    name: "Anual",
    price: "$565",
    period: "/año",
    priceMonthly: "$47/mes",
    description: "Equivale a 2 meses gratis respecto al plan mensual.",
    features: [
      "Todo lo del plan mensual",
      "Ahorra $143 al año",
      "Soporte prioritario",
    ],
    cta: "Suscribirme anual",
    ctaHref: "/sign-up",
    highlighted: true,
    badge: "Más popular",
  },
  {
    key: "early_adopter",
    name: "Early Adopter",
    price: "$25",
    period: "/mes — año 1",
    description: `Primeras ${EARLY_ADOPTER_SLOTS_TOTAL} empresas. Solo quedan ${EARLY_ADOPTER_SLOTS_TOTAL - EARLY_ADOPTER_SLOTS_TAKEN} slots.`,
    features: [
      "Todo lo del plan anual",
      "Sesión de onboarding 1.5h (videollamada)",
      "Chat prioritario el primer mes",
      "Precio especial bloqueado para siempre",
    ],
    cta: "Reclamar mi slot",
    ctaHref: "/sign-up",
    highlighted: false,
    badge: `${EARLY_ADOPTER_SLOTS_TOTAL - EARLY_ADOPTER_SLOTS_TAKEN}/${EARLY_ADOPTER_SLOTS_TOTAL} slots`,
  },
];

// ─── Componente ───────────────────────────────────────────────────────────────

export default async function LandingPage() {
  const { userId } = await auth();
  const isAuthenticated = !!userId;

  return (
    <div className="min-h-screen scroll-smooth bg-background text-foreground">
      {/* ── Navbar ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <ZapIcon className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold tracking-tight">ContaFlow</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400 md:flex">
            <Link href="#funcionalidades" className="rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
              Funcionalidades
            </Link>
            <Link href="#precios" className="rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
              Precios
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button asChild size="sm">
                <Link href="/dashboard">
                  Ir al panel <ArrowRightIcon className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/sign-in">Iniciar sesión</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/sign-up">Crear cuenta gratis</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:py-28">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          {/* Copy */}
          <div className="space-y-6">
            <Badge variant="secondary" className="gap-1.5">
              <StarIcon className="h-3 w-3 fill-current" />
              Conforme a PA 121 — SENIAT Venezuela
            </Badge>

            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              La contabilidad de tu empresa,{" "}
              <span className="text-primary">sin complicaciones.</span>
            </h1>

            <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
              ContaFlow es el sistema contable diseñado para Venezuela. Facturación
              fiscal, nómina, inventario y conciliación bancaria en una sola plataforma,
              a una fracción del costo de los sistemas tradicionales.
            </p>

            <div className="flex flex-wrap gap-3">
              {isAuthenticated ? (
                <Button asChild size="lg">
                  <Link href="/dashboard">
                    Ir al panel <ArrowRightIcon className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg">
                    <Link href="/sign-up">
                      Crear cuenta gratis — 14 días <ArrowRightIcon className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link href="#precios">Ver precios</Link>
                  </Button>
                </>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Sin tarjeta de crédito. Acceso completo los primeros 14 días.
            </p>
          </div>

          {/* Video */}
          <VideoModal />
        </div>
      </section>

      {/* ── Trust bar ─────────────────────────────────────────────────────── */}
      <div className="border-y border-border/40 bg-muted/20 py-4">
        <div className="mx-auto max-w-6xl px-4">
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
            {TRUST_ITEMS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <CheckIcon className="h-4 w-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Funcionalidades ───────────────────────────────────────────────── */}
      <section id="funcionalidades" className="border-b border-border/40 bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Todo lo que necesita tu empresa
            </h2>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              Un solo sistema. Sin módulos separados ni costos ocultos.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-background p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Precios ───────────────────────────────────────────────────────── */}
      <section id="precios" className="py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Precios transparentes</h2>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              Sin sorpresas. Cancela cuando quieras. Pago en USDT (crypto).
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.key}
                className={`relative flex flex-col rounded-xl border p-6 shadow-sm ${
                  plan.highlighted
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background"
                }`}
              >
                {plan.badge && (
                  <Badge
                    className={`absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap ${
                      plan.highlighted ? "" : "bg-muted text-muted-foreground"
                    }`}
                    variant={plan.highlighted ? "default" : "secondary"}
                  >
                    {plan.badge}
                  </Badge>
                )}

                <div className="mb-4">
                  <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">{plan.name}</p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{plan.period}</span>
                  </div>
                  {plan.priceMonthly && (
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{plan.priceMonthly}</p>
                  )}
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{plan.description}</p>
                </div>

                <ul className="mb-6 flex-1 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  variant={plan.highlighted ? "default" : "outline"}
                  className="w-full"
                >
                  <Link href={plan.ctaHref}>
                    {plan.cta}
                  </Link>
                </Button>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Los precios están en dólares estadounidenses (USD). El pago se procesa en USDT
            (Tether) a través de NOWPayments.
          </p>
        </div>
      </section>

      {/* ── CTA final ─────────────────────────────────────────────────────── */}
      <section className="border-t border-border/40 bg-primary/5 py-20">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Empieza hoy sin riesgos
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            14 días con acceso completo. Sin tarjeta de crédito. Si no es para ti,
            simplemente no continúas — sin cargos, sin complicaciones.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {isAuthenticated ? (
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Ir al panel <ArrowRightIcon className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Crear cuenta gratis <ArrowRightIcon className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 bg-muted/20 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-8 sm:grid-cols-3">
            {/* Marca */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <ZapIcon className="h-4 w-4 text-primary" />
                ContaFlow
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Sistema contable profesional venezolano. Conforme a PA 121 — SENIAT.
              </p>
            </div>

            {/* Links */}
            <div className="space-y-3">
              <p className="text-sm font-semibold">Plataforma</p>
              <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                {[
                  { href: "#funcionalidades", label: "Funcionalidades" },
                  { href: "#precios", label: "Precios" },
                  { href: "/sign-in", label: "Iniciar sesión" },
                  { href: "/sign-up", label: "Crear cuenta" },
                ].map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} className="rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contacto / Legal */}
            <div className="space-y-3">
              <p className="text-sm font-semibold">Soporte</p>
              <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li className="flex items-center gap-2">
                  <MailIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <a
                    href="mailto:soporte@contaflow.app"
                    className="rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                  >
                    soporte@contaflow.app
                  </a>
                </li>
                <li>
                  <Link href="/terms" className="rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                    Términos de servicio
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="rounded transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                    Política de privacidad
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 border-t border-border/40 pt-6 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} ContaFlow. Todos los derechos reservados. Sistema contable conforme a PA 121 — Venezuela.
          </div>
        </div>
      </footer>
    </div>
  );
}
