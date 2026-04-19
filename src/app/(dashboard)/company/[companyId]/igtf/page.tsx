// src/app/(dashboard)/company/[companyId]/igtf/page.tsx
// Módulo IGTF eliminado — el cálculo de IGTF vive dentro del formulario de factura.
import { redirect } from "next/navigation";

type Props = { params: Promise<{ companyId: string }> };

export default async function IgtfPage({ params }: Props) {
  const { companyId } = await params;
  redirect(`/company/${companyId}/invoices`);
}
