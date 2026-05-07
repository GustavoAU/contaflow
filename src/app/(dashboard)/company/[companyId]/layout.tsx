// src/app/(dashboard)/company/[companyId]/layout.tsx
import { Navbar } from "@/components/layout/Navbar";
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

  // Inyectar contexto de empresa y rol en Sentry para que Seer pueda
  // correlacionar cualquier error en esta sesión con la empresa correcta.
  const { userId } = await auth();
  Sentry.setUser(userId ? { id: userId } : null);
  Sentry.setTag("companyId", companyId);
  Sentry.setTag("userRole", company.role);

  const showNotifications = canAccess(company.role, ROLES.ACCOUNTING);

  // Cargar grants para la navegación grant-aware (solo afecta a ADMINISTRATIVE).
  // Solo se pasan los grants del rol actual para no exponer la matriz completa al cliente.
  const grantsSet = await getCompanyGrants(companyId);
  const rolePrefix = `${company.role}:`;
  const grantedModules = Array.from(grantsSet).filter((g) => g.startsWith(rolePrefix));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <Navbar
        companyId={companyId}
        companyName={company.name}
        plan={company.plan}
        userRole={company.role}
        grantedModules={grantedModules}
        notificationSlot={showNotifications ? <NotificationBell companyId={companyId} /> : null}
      />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
