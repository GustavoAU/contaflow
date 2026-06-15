// src/app/(dashboard)/company/[companyId]/layout.tsx
import { Sidebar }     from "@/components/layout/Sidebar";
import { TopbarInner } from "@/components/layout/TopbarInner";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { NotificationBell } from "@/modules/notifications/components/NotificationBell";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { getCompanyGrants } from "@/lib/get-company-grants";
import { getActivePeriodAction } from "@/modules/accounting/actions/period.actions";
import { FloatingAIAssistant } from "@/modules/ai-assistant/components/FloatingAIAssistant";
import type { UserRole } from "@/lib/nav-items";
import { getViewMode } from "@/lib/view-mode";
import { APP_VERSION, CERTIFIED_VERSION } from "@/lib/version";
import { AlertTriangleIcon, SlidersHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { getLatestRatesWithDeltaAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";

type Props = {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
};

export default async function CompanyLayout({ children, params }: Props) {
  const { companyId } = await params;
  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);

  if (!company) redirect("/dashboard");

  const { userId } = await auth();
  Sentry.setUser(userId ? { id: userId } : null);
  Sentry.setTag("companyId", companyId);
  Sentry.setTag("userRole", company.role);

  const showNotifications = canAccess(company.role, ROLES.ACCOUNTING);
  const showAIAssistant = canAccess(company.role, ROLES.ACCOUNTING);

  // getCompanyGrants usa unstable_cache pero la query interna puede lanzar (cold start).
  // Si lanza, continuamos con permisos vacíos para no bloquear el layout.
  const grantsSet = await getCompanyGrants(companyId).catch(() => new Set<string>());
  const rolePrefix = `${company.role}:`;
  const grantedModules = Array.from(grantsSet).filter((g) => g.startsWith(rolePrefix));

  // NOTA: las tasas se obtienen aquí (server) y se pasan como props iniciales, en lugar de
  // pedirlas vía Server Action en useEffect al montar BcvRateWidget — eso disparaba un bug
  // de Next (useActionQueue/useOptimistic en app-router.tsx → "Rendered more hooks").
  // Consultas livianas; NO incluir aquí el detector de anomalías (pesado) para no saturar
  // el pool de Neon concurrentemente con las consultas de la página (causaba redirect a /dashboard).
  const [periodResult, viewMode, ratesResult] = await Promise.all([
    getActivePeriodAction(companyId),
    getViewMode(),
    getLatestRatesWithDeltaAction(companyId).catch(() => null),
  ]);

  const initialRates = ratesResult && ratesResult.success ? ratesResult.data : null;
  // El badge de anomalías se obtiene de forma diferida (ver FloatingAIAssistant); no bloquea
  // el render del layout ni compite por conexiones durante el cold start.
  const initialAnomaly = null;
  // eslint-disable-next-line react-hooks/purity -- Server Component: no re-renders, Date.now() es seguro aquí
  const nowMs = Date.now();
  const activePeriod = periodResult.success && periodResult.data
    ? (() => {
        const daysOpen = Math.floor(
          (nowMs - new Date(periodResult.data.openedAt).getTime()) / 86_400_000
        );
        return { year: periodResult.data.year, month: periodResult.data.month, daysOpen, isStale: daysOpen > 30 };
      })()
    : null;

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Skip-to-content — WCAG 2.4.1: bypass blocks */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-9999 focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none"
      >
        Saltar al contenido
      </a>

      {/* Sidebar vertical */}
      <Sidebar
        companyId={companyId}
        userRole={company.role}
        grantedModules={grantedModules}
        companies={companies.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        viewMode={viewMode}
        scopeProfile={company.scopeProfile ?? null}
      />

      {/* Columna principal */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar lean */}
        <TopbarInner
          companyId={companyId}
          companyName={company.name}
          userRole={company.role as UserRole}
          grantedModules={grantedModules}
          activePeriod={activePeriod}
          initialRates={initialRates}
          notificationSlot={
            showNotifications ? <NotificationBell companyId={companyId} /> : null
          }
        />

        {/* Banner: versión en uso ≠ versión homologada SENIAT (equivalente al aviso de Gálac Adm. 30.0) */}
        {CERTIFIED_VERSION !== null && APP_VERSION !== CERTIFIED_VERSION && (
          <div
            role="alert"
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm"
          >
            <AlertTriangleIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>Versión no homologada en uso.</strong> La versión certificada ante el SENIAT es{" "}
              <strong>v{CERTIFIED_VERSION}</strong>. Versión actual:{" "}
              <strong>v{APP_VERSION}</strong>. Actualiza o contacta al administrador.
            </span>
          </div>
        )}

        {/* Banner: perfil de alcance no declarado — solo para OWNER/ADMIN (ADR-033) */}
        {company.scopeProfile == null && canAccess(company.role, ROLES.ADMIN_ONLY) && (
          <div
            role="status"
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-sm"
          >
            <SlidersHorizontalIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">
              <strong>Personaliza tu experiencia.</strong> Dinos cómo opera tu empresa para adaptar los módulos disponibles.
            </span>
            <Link
              href={`/company/${companyId}/activate-modules`}
              className="shrink-0 text-sm font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              Configurar →
            </Link>
          </div>
        )}

        {/* Contenido de página — scroll global (body) */}
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none">
          {children}
        </main>
      </div>

      <Toaster richColors position="top-right" />

      {/* Asistente IA flotante — solo para roles Contador o superior */}
      {showAIAssistant && (
        <FloatingAIAssistant
          companyId={companyId}
          companyName={company.name}
          initialAnomaly={initialAnomaly}
        />
      )}
    </div>
  );
}
