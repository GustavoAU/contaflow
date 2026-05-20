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
import { getNavItems } from "@/lib/nav-items";
import type { UserRole } from "@/lib/nav-items";

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

  const grantsSet = await getCompanyGrants(companyId);
  const rolePrefix = `${company.role}:`;
  const grantedModules = Array.from(grantsSet).filter((g) => g.startsWith(rolePrefix));
  const navConfig = getNavItems(company.role as UserRole, companyId, grantsSet);

  const periodResult = await getActivePeriodAction(companyId);
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
    <div className="flex min-h-screen bg-zinc-50">
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
      />

      {/* Columna principal */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar lean */}
        <TopbarInner
          companyId={companyId}
          companyName={company.name}
          userRole={company.role as UserRole}
          activePeriod={activePeriod}
          navSections={navConfig.sections}
          navPrimary={navConfig.primary}
          notificationSlot={
            showNotifications ? <NotificationBell companyId={companyId} /> : null
          }
        />

        {/* Contenido de página — scroll global (body) */}
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none">
          {children}
        </main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}
