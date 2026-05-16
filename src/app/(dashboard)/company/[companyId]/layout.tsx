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

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      {/* Sidebar vertical */}
      <Sidebar
        companyId={companyId}
        userRole={company.role}
        grantedModules={grantedModules}
      />

      {/* Columna principal */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Topbar lean */}
        <TopbarInner
          companyId={companyId}
          companyName={company.name}
          userRole={company.role}
          notificationSlot={
            showNotifications ? <NotificationBell companyId={companyId} /> : null
          }
        />

        {/* Contenido de página — scroll aquí, no en body */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          {children}
        </main>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}
