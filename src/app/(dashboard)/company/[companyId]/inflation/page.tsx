// src/app/(dashboard)/company/[companyId]/inflation/page.tsx
import prisma from "@/lib/prisma";
import { selectableAccounts } from "@/lib/account-search";
import { requireCompanyPage } from "@/lib/company-page-guard";
import { INPCService } from "@/modules/inflation/services/INPCService";
import { INPCRateForm } from "@/modules/inflation/components/INPCRateForm";
import { INPCRateTable } from "@/modules/inflation/components/INPCRateTable";
import { InflationBaseForm } from "@/modules/inflation/components/InflationBaseForm";
import { InflationAdjustmentPanel } from "@/modules/inflation/components/InflationAdjustmentPanel";

type Props = { params: Promise<{ companyId: string }> };

export default async function InflationPage({ params }: Props) {
  const { companyId } = await params;

  // La membresía y los datos de la empresa eran DOS queries concurrentes: la fila
  // ajena se cargaba aunque el check posterior la descartara. Ahora es una sola,
  // atada al usuario (ADR-004).
  const [{ company, role }, rates, equityAccounts, repomoAccounts] = await Promise.all([
    requireCompanyPage(companyId, {
      id: true,
      name: true,
      inflationBaseYear: true,
      inflationBaseMonth: true,
    }),
    INPCService.getRates(companyId, prisma),
    // SPEC-012: ambas consultas entregan títulos Y cuentas de movimiento (sin filtrar `isPostable`);
    // el selector muestra los títulos como encabezados y solo deja elegir las de movimiento.
    prisma.account.findMany({
      where: { companyId, type: "EQUITY", deletedAt: null },
      select: { id: true, code: true, name: true, isPostable: true },
      orderBy: { code: "asc" },
    }),
    // Cuentas de Ingreso/Gasto para registrar el REPOMO (VEN-NIF 3 §36.4)
    prisma.account.findMany({
      where: { companyId, type: { in: ["REVENUE", "EXPENSE"] }, deletedAt: null },
      select: { id: true, code: true, name: true, isPostable: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const isAdmin = role === "ADMIN";

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ajuste por Inflación (INPC)</h1>
        <p className="mt-1 text-sm text-gray-500">
          VEN-NIF 3 — Reexpresión de estados financieros en economía hiperinflacionaria
        </p>
      </div>

      {/* Configuración: período base */}
      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-800">Período Base de Reexpresión</h2>
          <p className="text-xs text-gray-500">
            Define el mes de referencia (base = 100). Todos los factores se calculan como{" "}
            <span className="font-mono">INPC(período) / INPC(base)</span>.
          </p>
          <InflationBaseForm
            companyId={companyId}
            currentBaseYear={company.inflationBaseYear}
            currentBaseMonth={company.inflationBaseMonth}
          />
        </section>
      )}

      {/* Índices INPC */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Índices INPC Cargados</h2>
        {isAdmin && <INPCRateForm companyId={companyId} />}
        <INPCRateTable
          rates={rates.map((r) => ({
            ...r,
            indexValue: r.indexValue.toFixed(6),
            createdAt: r.createdAt.toISOString(),
          }))}
        />
      </section>

      {/* Panel de ajuste — solo ADMIN */}
      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-800">Ejecutar Ajuste por Inflación</h2>
          <p className="text-xs text-gray-500">
            Genera un asiento contable (tipo AJUSTE) que reexpresa todos los saldos de cuentas al
            poder adquisitivo del período seleccionado.
          </p>
          {/* RN-19: los títulos no cuentan; sin ninguna cuenta de movimiento no hay qué elegir. */}
          {selectableAccounts(equityAccounts).length === 0 ? (
            <p className="rounded border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-700">
              No hay cuentas de Patrimonio (EQUITY) disponibles como cuenta actualizadora. Cree una
              primero.
            </p>
          ) : (
            <InflationAdjustmentPanel
              companyId={companyId}
              equityAccounts={equityAccounts}
              repomoAccounts={repomoAccounts}
              inflationBaseYear={company.inflationBaseYear}
              inflationBaseMonth={company.inflationBaseMonth}
            />
          )}
        </section>
      )}
    </div>
  );
}
