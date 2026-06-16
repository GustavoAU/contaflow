// ADR-034: Página de selección/pago del tier Despacho
import { redirect } from "next/navigation";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { getDespachoStatusAction } from "@/modules/despacho/actions/despacho.actions";
import { DespachoUpgradeFlow } from "@/modules/despacho/components/DespachoUpgradeFlow";
import {
  DESPACHO_TIER_PRICES_USD_CENTS,
  DESPACHO_TIER_RIF_LIMITS,
} from "@/modules/despacho/services/DespachoService";

type Props = { params: Promise<{ companyId: string }> };

export default async function DespachoUpgradePage({ params }: Props) {
  const { companyId } = await params;

  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  // Solo visible para perfil DESPACHO
  if (company.scopeProfile !== "DESPACHO") {
    redirect(`/company/${companyId}`);
  }

  const status = await getDespachoStatusAction(companyId);
  if (!status.success) redirect(`/company/${companyId}`);

  return (
    <DespachoUpgradeFlow
      companyId={companyId}
      currentTier={status.despachoTier}
      currentCount={status.currentCount}
      priceCents={DESPACHO_TIER_PRICES_USD_CENTS}
      rifLimits={DESPACHO_TIER_RIF_LIMITS}
    />
  );
}
