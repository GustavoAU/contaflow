// src/app/client-portal/[token]/page.tsx
// Portal del Cliente — Server Component.
// Verifica JWT, muestra CxC pendiente + historial de pagos sin requerir sesión Clerk.

import { notFound } from "next/navigation";
import { verifyClientToken } from "@/lib/client-portal-jwt";
import prisma from "@/lib/prisma";
import Decimal from "decimal.js";

interface Props {
  params: Promise<{ token: string }>;
}

function fmt(amount: Decimal | string | number | null | undefined, fractionDigits = 2): string {
  if (amount === null || amount === undefined) return "—";
  const n = new Decimal(amount.toString());
  return n.toNumber().toLocaleString("es-VE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  UNPAID:  { label: "Pendiente",    className: "bg-red-50 text-red-700" },
  PARTIAL: { label: "Parcial",      className: "bg-amber-50 text-amber-700" },
  PAID:    { label: "Pagada",       className: "bg-green-50 text-green-700" },
  VOIDED:  { label: "Anulada",      className: "bg-gray-100 text-gray-500" },
};

export default async function ClientPortalPage({ params }: Props) {
  const { token } = await params;

  // 1. Verificar JWT
  const payload = verifyClientToken(token);
  if (!payload) notFound();

  const { sub: customerId, cid: companyId } = payload;

  // 2. Cargar datos del cliente
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId, deletedAt: null },
    select: { id: true, name: true, rif: true, email: true, phone: true },
  });
  if (!customer) notFound();

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, rif: true, email: true, telefono: true },
  });
  if (!company) notFound();

  // 3. Facturas pendientes (UNPAID + PARTIAL) — máx. 50
  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      companyId,
      customerId,
      type: "SALE",
      paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      deletedAt: null,
    },
    orderBy: { date: "desc" },
    take: 50,
    select: {
      id: true,
      date: true,
      dueDate: true,
      invoiceNumber: true,
      controlNumber: true,
      currency: true,
      totalAmountVes: true,
      pendingAmount: true,
      paymentStatus: true,
    },
  });

  // 4. Historial de pagos (PAID) — últimas 20
  const paidInvoices = await prisma.invoice.findMany({
    where: {
      companyId,
      customerId,
      type: "SALE",
      paymentStatus: "PAID",
      deletedAt: null,
    },
    orderBy: { date: "desc" },
    take: 20,
    select: {
      id: true,
      date: true,
      invoiceNumber: true,
      controlNumber: true,
      currency: true,
      totalAmountVes: true,
      paymentStatus: true,
    },
  });

  // 5. Total CxC pendiente
  const totalCxC = pendingInvoices.reduce(
    (acc, inv) => acc.plus(new Decimal(inv.pendingAmount?.toString() ?? "0")),
    new Decimal(0)
  );

  return (
    <div className="space-y-8">
      {/* Encabezado empresa */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <p className="text-xs text-gray-400">Proveedor de servicios</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{company.name}</p>
        {company.rif      && <p className="text-sm text-gray-500">RIF: {company.rif}</p>}
        {company.email    && <p className="text-sm text-gray-500">Email: {company.email}</p>}
        {company.telefono && <p className="text-sm text-gray-500">Tel.: {company.telefono}</p>}
      </div>

      {/* Datos del cliente */}
      <section aria-labelledby="client-heading">
        <h2 id="client-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Información del cliente
        </h2>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="text-xl font-bold text-gray-900">{customer.name}</p>
          {customer.rif   && <p className="mt-0.5 text-sm text-gray-500">RIF: {customer.rif}</p>}
          {customer.email && <p className="text-sm text-gray-500">Email: {customer.email}</p>}
          {customer.phone && <p className="text-sm text-gray-500">Tel.: {customer.phone}</p>}
        </div>
      </section>

      {/* Resumen CxC */}
      <section aria-labelledby="cxc-summary-heading">
        <h2 id="cxc-summary-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Saldo pendiente
        </h2>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-red-600">{fmt(totalCxC)}</span>
            <span className="mb-0.5 text-sm text-gray-400">VES</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {pendingInvoices.length === 0
              ? "No tienes facturas pendientes."
              : `${pendingInvoices.length} factura(s) por pagar.`}
          </p>
        </div>
      </section>

      {/* Facturas pendientes */}
      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Facturas pendientes ({pendingInvoices.length})
        </h2>
        {pendingInvoices.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-gray-400">
            Sin facturas pendientes — estás al día ✓
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Fecha</th>
                  <th scope="col" className="px-4 py-2 text-left">N° Factura</th>
                  <th scope="col" className="px-4 py-2 text-left">N° Control</th>
                  <th scope="col" className="px-4 py-2 text-left">Vence</th>
                  <th scope="col" className="px-4 py-2 text-right">Total</th>
                  <th scope="col" className="px-4 py-2 text-right">Pendiente</th>
                  <th scope="col" className="px-4 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingInvoices.map((inv) => {
                  const status = STATUS_LABELS[inv.paymentStatus] ?? { label: inv.paymentStatus, className: "bg-gray-100 text-gray-600" };
                  const isOverdue = inv.dueDate && new Date(inv.dueDate) < new Date() && inv.paymentStatus !== "PAID";
                  return (
                    <tr key={inv.id} className={`hover:bg-gray-50 ${isOverdue ? "bg-red-50/30" : ""}`}>
                      <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(inv.date)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{inv.controlNumber ?? "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {inv.dueDate ? (
                          <span className={isOverdue ? "font-semibold text-red-600" : ""}>
                            {fmtDate(inv.dueDate)}
                            {isOverdue && " ⚠"}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
                        {fmt(inv.totalAmountVes)} {inv.currency}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap text-red-600">
                        {fmt(inv.pendingAmount)} {inv.currency}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Historial de pagos */}
      <section aria-labelledby="paid-heading">
        <h2 id="paid-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Historial de pagos ({paidInvoices.length} últimas)
        </h2>
        {paidInvoices.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-gray-400">
            Sin historial de pagos.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Fecha</th>
                  <th scope="col" className="px-4 py-2 text-left">N° Factura</th>
                  <th scope="col" className="px-4 py-2 text-left">N° Control</th>
                  <th scope="col" className="px-4 py-2 text-right">Total pagado</th>
                  <th scope="col" className="px-4 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paidInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(inv.date)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{inv.controlNumber ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap text-green-700">
                      {fmt(inv.totalAmountVes)} {inv.currency}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        Pagada
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-xs text-gray-400">
        Enlace generado el {new Date().toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" })}. Válido por 30 días.
        <br />
        Si tienes consultas, contacta directamente con {company.name}.
      </p>
    </div>
  );
}
