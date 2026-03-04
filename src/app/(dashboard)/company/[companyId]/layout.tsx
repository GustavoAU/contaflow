// src/app/(dashboard)/company/[companyId]/layout.tsx
import { Navbar } from "@/components/layout/Navbar";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { redirect } from "next/navigation";

type Props = {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
};

export default async function CompanyLayout({ children, params }: Props) {
  const { companyId } = await params;
  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);

  if (!company) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <Navbar companyId={companyId} companyName={company.name} />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
