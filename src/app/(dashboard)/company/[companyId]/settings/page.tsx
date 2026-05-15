// src/app/(dashboard)/company/[companyId]/settings/page.tsx
import { getLocaleAction } from "@/modules/settings/actions/locale.actions";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { getFiscalConfigAction } from "@/modules/fiscal-close/actions/fiscal-close.actions";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { getGLConfigAction } from "@/modules/settings/actions/gl-config.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LanguageSelector } from "@/modules/settings/LanguageSelector";
import { ArchiveCompany } from "@/components/company/ArchiveCompany";
import { FiscalConfigForm } from "@/modules/fiscal-close/components/FiscalConfigForm";
import { PaymentTermsForm } from "@/modules/receivables/components/PaymentTermsForm";
import { CertificatePanel } from "@/modules/certificates/components/CertificatePanel";
import { getCertificateStatusAction } from "@/modules/certificates/actions/certificate.actions";
import { MembersPanel } from "@/modules/company/components/MembersPanel";
import { getMembersAction } from "@/modules/company/actions/member.actions";
import { PermissionsMatrix } from "@/modules/company/components/PermissionsMatrix";
import { getGrantsAction } from "@/modules/company/actions/permission.actions";
import { CompanySeniatDataForm } from "@/modules/company/components/CompanySeniatDataForm";
import { GLAccountsForm } from "@/modules/settings/components/GLAccountsForm";
import { AccountantSignatureForm } from "@/modules/settings/components/AccountantSignatureForm";
import { getAccountantConfigAction } from "@/modules/settings/actions/accountant-config.actions";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function SettingsPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [locale, companies, fiscalConfigResult, accountsResult, certStatusResult, membersResult, grantsResult, glConfigResult, accountantConfigResult] =
    await Promise.all([
      getLocaleAction(),
      getUserCompaniesAction(),
      getFiscalConfigAction(companyId),
      getAccountsAction(companyId),
      getCertificateStatusAction({ companyId }),
      getMembersAction(companyId),
      getGrantsAction(companyId),
      getGLConfigAction(companyId),
      getAccountantConfigAction(companyId),
    ]);

  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  const members = membersResult.success ? membersResult.data : [];
  const grants = grantsResult.success ? grantsResult.data : [];
  const fiscalConfig = fiscalConfigResult.success ? fiscalConfigResult.data : null;
  const certStatus = certStatusResult.success ? certStatusResult.data : { exists: false as const };
  const equityAccounts = accountsResult.success
    ? accountsResult.data
        .filter((a) => a.type === "EQUITY")
        .map((a) => ({ id: a.id, code: a.code, name: a.name }))
    : [];
  const allAccounts = accountsResult.success
    ? accountsResult.data.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
    : [];
  const glConfig = glConfigResult.success ? glConfigResult.data : null;
  const accountantConfig = accountantConfigResult.success
    ? accountantConfigResult.data
    : { accountantName: null, accountantTitle: null, accountantCpcNumber: null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Administra las preferencias, equipo y configuración fiscal de tu empresa
        </p>
      </div>

      <LanguageSelector currentLocale={locale} />

      {/* ── Datos Fiscales SENIAT — PA-121 ───────────────────────────────── */}
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Datos Fiscales (SENIAT)</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Información requerida en los encabezados de la Forma 30, Libro Mayor y reportes PA-121 del SENIAT.
          </p>
        </div>
        <CompanySeniatDataForm
          companyId={companyId}
          initialData={{
            name: company.name,
            rif: company.rif ?? null,
            address: company.address ?? null,
            telefono: company.telefono ?? null,
            email: company.email ?? null,
            ciiu: company.ciiu ?? null,
            actividad: company.actividad ?? null,
            isSpecialContributor: company.isSpecialContributor,
          }}
        />
      </div>

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

      {/* ── Integración Libro Mayor (GL) — ADR-026 ───────────────────────── */}
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Integración con Libro Mayor</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Define las cuentas contables para la causación automática de facturas.
            Al guardar esta configuración, cada nueva factura generará su asiento en el Libro Diario.
          </p>
        </div>
        {allAccounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay cuentas en el plan de cuentas. Crea cuentas contables antes de configurar la integración.
          </p>
        ) : (
          <GLAccountsForm
            companyId={companyId}
            allAccounts={allAccounts}
            initialConfig={{
              arAccountId: glConfig?.arAccountId ?? null,
              apAccountId: glConfig?.apAccountId ?? null,
              salesAccountId: glConfig?.salesAccountId ?? null,
              purchaseExpenseAccountId: glConfig?.purchaseExpenseAccountId ?? null,
              ivaDFAccountId: glConfig?.ivaDFAccountId ?? null,
              ivaCFAccountId: glConfig?.ivaCFAccountId ?? null,
              fxGainAccountId: glConfig?.fxGainAccountId ?? null,
              fxLossAccountId: glConfig?.fxLossAccountId ?? null,
            }}
            initialUnbookedCount={glConfig?.unbookedCount ?? 0}
          />
        )}
      </div>

      {/* ── Firma del Contador (CPC) — Bloque B ──────────────────────────── */}
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Firma del Contador Público (CPC)</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Datos del Contador Público Colegiado que aparecerán en el bloque de firma
            de los reportes financieros (VEN-NIF — requerido por SENIAT).
          </p>
        </div>
        <AccountantSignatureForm
          companyId={companyId}
          initialConfig={accountantConfig}
        />
      </div>

      {/* ── Firma Digital — Fase 35I ──────────────────────────────────────── */}
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Firma Digital</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Certificado X.509 para firma electrónica de documentos fiscales (PA 121 · ADR-020).
          </p>
        </div>
        <CertificatePanel companyId={companyId} initialStatus={certStatus} />
      </div>

      {/* ── Equipo — Sprint 2 ─────────────────────────────────────────────── */}
      <MembersPanel
        companyId={companyId}
        currentUserId={user.id}
        currentUserRole={company.role}
        initialMembers={members}
      />

      {/* ── Permisos por Rol ──────────────────────────────────────────────── */}
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Permisos por Rol</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Define qué módulos puede ver y usar cada rol en esta empresa.
            Los permisos base son fijos; los checkboxes editables amplían el acceso.
          </p>
        </div>
        <PermissionsMatrix
          companyId={companyId}
          currentUserRole={company.role}
          initialGrants={grants}
        />
      </div>

      <ArchiveCompany companyId={companyId} companyName={company.name} userId={user.id} />

    </div>
  );
}
