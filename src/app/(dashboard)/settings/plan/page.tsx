import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { PlanChangePanel } from "./PlanChangePanel";

interface PageProps {
  searchParams: Promise<{ change?: string }>;
}

export default async function PlanSettingsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { change } = await searchParams;

  // Empresas donde el usuario es OWNER con suscripción
  const memberships = await prisma.companyMember.findMany({
    where: { userId, role: "OWNER" },
    include: {
      company: {
        include: {
          subscription: {
            include: {
              changeRequests: {
                where: { status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const withSub = memberships.filter((m) => m.company.subscription);

  if (withSub.length === 0) {
    redirect("/dashboard");
  }

  // Normalizar el plan del query param
  const preselectedPlan = change?.toUpperCase().replace(/-/g, "_");

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Mi Plan</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Gestiona tu suscripción a ContaFlow.
        </p>
      </div>

      {withSub.map(({ company }) => {
        const sub = company.subscription!;
        const pending = sub.changeRequests[0] ?? null;
        return (
          <PlanChangePanel
            key={company.id}
            companyId={company.id}
            companyName={company.name}
            currentPlan={sub.plan}
            currentPeriodEnd={sub.currentPeriodEnd.toISOString()}
            priceUsdCents={sub.priceUsdCents}
            pendingChange={
              pending
                ? {
                    id: pending.id,
                    toPlan: pending.toPlan,
                    effectiveDate: pending.effectiveDate.toISOString(),
                    newPriceUsdCents: pending.newPriceUsdCents,
                    status: pending.status,
                  }
                : null
            }
            preselectedPlan={preselectedPlan}
          />
        );
      })}

      <p className="text-center text-xs text-slate-400">
        Los cambios al plan Anual se confirman al recibir el pago USDT.
        Escríbenos por WhatsApp si necesitas ayuda.
      </p>
    </div>
  );
}
