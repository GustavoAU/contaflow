// src/app/(dashboard)/company/[companyId]/transactions/new/page.tsx
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { getActivePeriodAction } from "@/modules/accounting/actions/period.actions";
import { JournalEntryForm } from "@/components/accounting/JournalEntryForm";
import { PrerequisiteGuide } from "@/components/guides/PrerequisiteGuide";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function NewTransactionPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [accountsResult, periodResult] = await Promise.all([
    // SPEC-012: sin `onlyPostable`. El selector recibe también los títulos (como encabezados no
    // elegibles) y decide qué se puede elegir por `isPostable`.
    getAccountsAction(companyId),
    getActivePeriodAction(companyId),
  ]);

  // Solo lo que el selector necesita (no el registro completo de Prisma) viaja al cliente.
  const accounts = accountsResult.success
    ? accountsResult.data.map(({ id, code, name, type, isPostable }) => ({
        id,
        code,
        name,
        type,
        isPostable,
      }))
    : [];
  const hasOpenPeriod = periodResult.success && periodResult.data !== null;
  // «Hay cuentas» cuenta SOLO las de movimiento: un plan con puros títulos no permite asentar nada.
  const hasAccounts = accounts.some((account) => account.isPostable);

  if (!hasOpenPeriod) {
    return (
      <div className="max-w-lg py-8">
        <PrerequisiteGuide type="period" companyId={companyId} />
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <div className="max-w-lg py-8">
        <PrerequisiteGuide type="accounts" companyId={companyId} />
      </div>
    );
  }

  return (
    <div>
      <JournalEntryForm companyId={companyId} userId={user.id} accounts={accounts} />
    </div>
  );
}
