// src/app/(dashboard)/company/[companyId]/payroll/employees/new/page.tsx
// Fase NOM-B: Formulario de creación de empleado — solo ADMIN_ONLY

"use client";

import { useParams, useRouter } from "next/navigation";
import EmployeeForm from "@/modules/payroll/components/EmployeeForm";
import type { EmployeeRow } from "@/modules/payroll/services/EmployeeService";

export default function NewEmployeePage() {
  const { companyId } = useParams<{ companyId: string }>();
  const router = useRouter();

  function handleSaved(_emp: EmployeeRow) {
    router.push(`/company/${companyId}/payroll/employees`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Registrar empleado</h1>
      <EmployeeForm companyId={companyId} onSaved={handleSaved} />
    </div>
  );
}
