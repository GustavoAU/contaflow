// src/app/(dashboard)/company/[companyId]/exchange-rates/page.tsx
// Vista eliminada — la tasa BCV se actualiza desde el widget en el encabezado.
import { redirect } from "next/navigation";

type Props = { params: Promise<{ companyId: string }> };

export default async function ExchangeRatesPage({ params }: Props) {
  const { companyId } = await params;
  redirect(`/company/${companyId}`);
}
