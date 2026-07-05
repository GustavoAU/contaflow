// src/app/(dashboard)/company/[companyId]/orders/page.tsx
// Módulo Compras y Ventas — Fase 28
// Roles:
//   ADMINISTRATIVE:          crear cotizaciones + crear órdenes + enviar a aprobación
//   ACCOUNTANT/OWNER/ADMIN:  aprobar/rechazar cotizaciones + aprobar órdenes + convertir a factura

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { QuotationService } from "@/modules/orders/services/QuotationService";
import { OrderService } from "@/modules/orders/services/OrderService";
import { PeriodService } from "@/modules/accounting/services/PeriodService";
import { QuotationForm } from "@/modules/orders/components/QuotationForm";
import { QuotationList } from "@/modules/orders/components/QuotationList";
import { OrderForm } from "@/modules/orders/components/OrderForm";
import { OrderList } from "@/modules/orders/components/OrderList";

type Props = { params: Promise<{ companyId: string }> };

export default async function OrdersPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    include: { company: true },
  });
  if (!member) redirect("/");

  const role = member.role;
  const isOperations = canAccess(role, ROLES.OPERATIONS);   // OWNER, ADMIN, ADMINISTRATIVE
  const isAccounting = canAccess(role, ROLES.ACCOUNTING);   // OWNER, ADMIN, ACCOUNTANT

  // Cargar cotizaciones, órdenes y período activo en paralelo
  const [quotations, orders, activePeriod] = await Promise.all([
    QuotationService.getQuotations(companyId),
    OrderService.getOrders(companyId),
    PeriodService.getActivePeriod(companyId),
  ]);

  // Para el OrderForm: mostrar solo cotizaciones aprobadas que aún no tienen orden
  const approvedQuotations = quotations.filter((q) => q.status === "APPROVED");

  // E-14: fecha por defecto para el modal "Convertir a Factura" dentro del período
  // abierto. Si hoy cae en el período abierto → hoy; si no → último día de ese mes
  // (día alto para evitar el desfase de mes en husos negativos como Venezuela UTC-4).
  // Sin período abierto → hoy (el guard del servidor decide igualmente).
  let defaultInvoiceDate = new Date().toISOString().split("T")[0]!;
  if (activePeriod) {
    const now = new Date();
    const inOpenPeriod =
      now.getFullYear() === activePeriod.year && now.getMonth() + 1 === activePeriod.month;
    if (!inOpenPeriod) {
      const lastDay = new Date(activePeriod.year, activePeriod.month, 0).getDate();
      defaultInvoiceDate = `${activePeriod.year}-${String(activePeriod.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compras y Ventas</h1>
        <p className="mt-1 text-sm text-gray-500">
          {member.company.name} — Cotizaciones, Órdenes de Compra y Órdenes de Venta
        </p>
      </div>

      {/* ── Cotizaciones ─────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-gray-800">
          Cotizaciones / Presupuestos
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({quotations.length})
          </span>
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          Pre-contables — no generan asiento. Flujo: Borrador → Aprobada → Orden.
        </p>

        {isOperations && (
          <details className="mb-6">
            <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline mb-3">
              + Nueva cotización / presupuesto
            </summary>
            <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-4">
              <QuotationForm companyId={companyId} />
            </div>
          </details>
        )}

        <QuotationList
          companyId={companyId}
          quotations={quotations}
          canApprove={isAccounting}
          canOperate={isOperations}
        />
      </section>

      {/* ── Órdenes de Compra / Venta ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-gray-800">
          Órdenes de Compra y Venta
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({orders.length})
          </span>
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          Pre-contables — no generan asiento. Flujo: Borrador → Aprobada → Factura.
          La conversión a Factura genera el asiento contable.
        </p>

        {isOperations && (
          <details className="mb-6">
            <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline mb-3">
              + Nueva orden de compra / venta
            </summary>
            <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-4">
              <OrderForm
                companyId={companyId}
                approvedQuotations={approvedQuotations}
              />
            </div>
          </details>
        )}

        <OrderList
          companyId={companyId}
          orders={orders}
          canApprove={isAccounting}
          canOperate={isOperations}
          defaultInvoiceDate={defaultInvoiceDate}
        />
      </section>
    </div>
  );
}
