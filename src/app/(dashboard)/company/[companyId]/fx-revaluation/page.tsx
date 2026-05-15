// src/app/(dashboard)/company/[companyId]/fx-revaluation/page.tsx
// ADR-027: Página de revaluación de diferencial cambiario (NIC 21 / VEN-NIF BA-5).

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ChevronLeftIcon, ArrowLeftRightIcon } from "lucide-react";
import prisma from "@/lib/prisma";
import { FxRevaluationClient } from "@/modules/exchange-rates/components/FxRevaluationClient";

type Props = { params: Promise<{ companyId: string }> };

export default async function FxRevaluationPage({ params }: Props) {
  const { companyId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const [settings, latestUsd, latestEur, openPeriod] = await Promise.all([
    prisma.companySettings.findUnique({
      where: { companyId },
      select: { fxGainAccountId: true, fxLossAccountId: true },
    }),
    prisma.exchangeRate.findFirst({
      where: { companyId, currency: "USD" },
      orderBy: { date: "desc" },
      select: { rate: true },
    }),
    prisma.exchangeRate.findFirst({
      where: { companyId, currency: "EUR" },
      orderBy: { date: "desc" },
      select: { rate: true },
    }),
    prisma.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true, year: true, month: true },
    }),
  ]);

  const hasGLConfig = !!(settings?.fxGainAccountId && settings.fxLossAccountId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Dashboard
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Diferencial Cambiario
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Revaluación de saldos en moneda extranjera · NIC 21 / VEN-NIF BA-5
              {openPeriod && (
                <span className="ml-2 font-medium text-zinc-700">
                  · Período abierto:{" "}
                  {openPeriod.month.toString().padStart(2, "0")}/{openPeriod.year}
                </span>
              )}
            </p>
          </div>
          <ArrowLeftRightIcon className="h-6 w-6 text-zinc-400" />
        </div>
      </div>

      <FxRevaluationClient
        companyId={companyId}
        latestRates={{
          USD: latestUsd?.rate?.toString() ?? null,
          EUR: latestEur?.rate?.toString() ?? null,
        }}
        hasGLConfig={hasGLConfig}
        openPeriodId={openPeriod?.id ?? null}
      />
    </div>
  );
}
