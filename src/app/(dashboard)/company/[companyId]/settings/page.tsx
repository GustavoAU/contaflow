// src/app/(dashboard)/company/[companyId]/settings/page.tsx
import {
  getPeriodsAction,
  getActivePeriodAction,
} from "@/modules/accounting/actions/period.actions";
import { getLocaleAction } from "@/modules/settings/actions/locale.actions";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { getFiscalConfigAction } from "@/modules/fiscal-close/actions/fiscal-close.actions";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { PeriodManager } from "@/components/accounting/PeriodManager";
import { LanguageSelector } from "@/modules/settings/LanguageSelector";
import { ArchiveCompany } from "@/components/company/ArchiveCompany";
import { FiscalConfigForm } from "@/modules/fiscal-close/components/FiscalConfigForm";
import { PaymentTermsForm } from "@/modules/receivables/components/PaymentTermsForm";
import { Toaster } from "@/components/ui/sonner";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function SettingsPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [periodsResult, activePeriodResult, locale, companies, fiscalConfigResult, accountsResult] =
    await Promise.all([
      getPeriodsAction(companyId),
      getActivePeriodAction(companyId),
      getLocaleAction(),
      getUserCompaniesAction(),
      getFiscalConfigAction(companyId),
      getAccountsAction(companyId),
    ]);

  const periods = periodsResult.success ? periodsResult.data : [];
  const activePeriod = activePeriodResult.success ? activePeriodResult.data : null;
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  const fiscalConfig = fiscalConfigResult.success ? fiscalConfigResult.data : null;
  const equityAccounts = accountsResult.success
    ? accountsResult.data
        .filter((a) => a.type === "EQUITY")
        .map((a) => ({ id: a.id, code: a.code, name: a.name }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Administra los períodos contables y preferencias de tu empresa
        </p>
      </div>

      <LanguageSelector currentLocale={locale} />

      <PeriodManager
        companyId={companyId}
        userId={user.id}
        periods={periods}
        activePeriod={activePeriod}
      />

      {/* ── Configuración Contable — Fase 15 ─────────────────────────────── */}
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Configuración Contable</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Define las cuentas de patrimonio utilizadas para el Cierre de Ejercicio Económico (VEN-NIF).
            Ambas cuentas deben ser de tipo Patrimonio (EQUITY).
          </p>
        </div>
        {equityAccounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay cuentas de tipo Patrimonio (EQUITY) en tu plan de cuentas. Crea al menos dos
            cuentas EQUITY antes de configurar el cierre.
          </p>
        ) : (
          <FiscalConfigForm
            companyId={companyId}
            equityAccounts={equityAccounts}
            currentResultAccountId={fiscalConfig?.resultAccountId ?? null}
            currentRetainedEarningsAccountId={fiscalConfig?.retainedEarningsAccountId ?? null}
          />
        )}

        {/* Fase 16: Plazo de pago para CxC/CxP */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-3">Cartera CxC/CxP — Plazo de Pago</h3>
          <PaymentTermsForm
            companyId={companyId}
            currentPaymentTermDays={company.paymentTermDays}
          />
        </div>
      </div>

      <ArchiveCompany companyId={companyId} companyName={company.name} userId={user.id} />

      <Toaster richColors position="top-right" />
    </div>
  );
}
