// src/app/(dashboard)/company/[companyId]/payroll/overtime/page.tsx
// LOTTT Art. 183 — registro de horas extraordinarias.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { OvertimeService } from "@/modules/payroll/services/OvertimeService";
import OvertimeRegistry from "@/modules/payroll/components/OvertimeRegistry";

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function OvertimePage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No tienes acceso al registro de horas extraordinarias.
      </div>
    );
  }

  const [entries, employees] = await Promise.all([
    OvertimeService.list(companyId),
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, workShift: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8 px-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Horas Extraordinarias</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Registro obligatorio — LOTTT Art. 183
          </p>
        </div>
        <Link
          href={`/company/${companyId}/payroll`}
          className="text-sm text-gray-500 hover:underline"
        >
          ← Nómina
        </Link>
      </div>

      <OvertimeRegistry
        companyId={companyId}
        initial={entries}
        employees={employees.map((e) => ({
          id: e.id,
          name: `${e.lastName}, ${e.firstName}`,
          workShift: e.workShift,
        }))}
      />
    </div>
  );
}
