"use client";
// src/modules/receivables/components/AgingReportTable.tsx

import { useState } from "react";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import { MoneyBadge } from "@/components/ui/MoneyBadge";
import type { AgingReport, AgingBucket } from "../services/ReceivableService";

type Props = {
  report: AgingReport;
  companyId: string;
};

// ─── Configuración visual por bucket ─────────────────────────────────────────

const BUCKET_CONFIG: Record<
  AgingBucket,
  { label: string; cardBg: string; cardText: string; cardBorder: string; badgeCls: string }
> = {
  CURRENT: {
    label: "Corriente",
    cardBg: "bg-green-50",
    cardText: "text-green-700",
    cardBorder: "border-green-200",
    badgeCls: "bg-green-100 text-green-700",
  },
  OVERDUE_31_60: {
    label: "31–60 días",
    cardBg: "bg-yellow-50",
    cardText: "text-yellow-700",
    cardBorder: "border-yellow-200",
    badgeCls: "bg-yellow-100 text-yellow-700",
  },
  OVERDUE_61_90: {
    label: "61–90 días",
    cardBg: "bg-amber-50",
    cardText: "text-amber-700",
    cardBorder: "border-amber-200",
    badgeCls: "bg-amber-100 text-amber-700",
  },
  OVERDUE_91_120: {
    label: "91–120 días",
    cardBg: "bg-orange-50",
    cardText: "text-orange-700",
    cardBorder: "border-orange-200",
    badgeCls: "bg-orange-100 text-orange-700",
  },
  OVERDUE_120_PLUS: {
    label: "+120 días",
    cardBg: "bg-red-50",
    cardText: "text-red-700",
    cardBorder: "border-red-200",
    badgeCls: "bg-red-100 text-red-700",
  },
};

const BUCKET_ORDER: AgingBucket[] = [
  "CURRENT",
  "OVERDUE_31_60",
  "OVERDUE_61_90",
  "OVERDUE_91_120",
  "OVERDUE_120_PLUS",
];

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function AgingReportTable({ report, companyId }: Props) {
  const [rows, setRows] = useState(report.rows);

  const emptyLabel =
    report.type === "CXC"
      ? "No hay facturas de venta con saldo pendiente"
      : "No hay facturas de compra con saldo pendiente";

  const grandTotal   = parseFloat(report.grandTotalPendingVes);
  const currentTotal = parseFloat(report.grandTotalCurrentVes);
  const overdueTotal = parseFloat(report.grandTotalOverdueVes);
  const overdurePct  = grandTotal > 0 ? Math.round((overdueTotal / grandTotal) * 100) : 0;

  // Ordenar bucketSummary por BUCKET_ORDER
  const orderedSummary = BUCKET_ORDER.map(
    (b) => report.bucketSummary.find((s) => s.bucket === b)!
  ).filter(Boolean);

  return (
    <div className="space-y-5">

      {/* ─── Tarjetas de antigüedad ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {orderedSummary.map((b) => {
          const cfg = BUCKET_CONFIG[b.bucket];
          return (
            <div
              key={b.bucket}
              className={`rounded-lg border p-3 ${cfg.cardBg} ${cfg.cardBorder}`}
            >
              <p className={`text-xs font-semibold ${cfg.cardText}`}>{b.label}</p>
              <p className={`mt-1.5 text-2xl font-bold tabular-nums ${cfg.cardText}`}>
                {b.count}
              </p>
              <p className={`mt-0.5 text-xs tabular-nums ${cfg.cardText} opacity-80`}>
                {b.count === 0
                  ? "—"
                  : <MoneyBadge amount={b.totalPendingVes} currency="VES" className="text-xs" />}
              </p>
            </div>
          );
        })}
      </div>

      {/* ─── Resumen total + barra de vencimiento ───────────────────────── */}
      <div className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div>
            <span className="text-zinc-500">Total cartera </span>
            <span className="font-bold">
              <MoneyBadge amount={report.grandTotalPendingVes} currency="VES" />
            </span>
          </div>
          <div>
            <span className="text-zinc-500">Corriente </span>
            <span className="font-semibold text-green-700">
              <MoneyBadge amount={report.grandTotalCurrentVes} currency="VES" />
            </span>
          </div>
          <div>
            <span className="text-zinc-500">Vencido </span>
            <span className="font-semibold text-red-700">
              <MoneyBadge amount={report.grandTotalOverdueVes} currency="VES" />
            </span>
          </div>
          <span className="text-zinc-400 text-xs ml-auto">
            Corte: {formatDate(report.asOf)}
          </span>
        </div>

        {/* Barra de proporción corriente vs vencido */}
        {grandTotal > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-2 rounded-full bg-green-500 transition-all"
              style={{ width: `${100 - overdurePct}%` }}
            />
          </div>
        )}
        {grandTotal > 0 && (
          <p className="text-xs text-zinc-400">
            {100 - overdurePct}% corriente · {overdurePct}% vencido
          </p>
        )}
      </div>

      {/* ─── Tabla ──────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-white p-10 text-center">
          <p className="text-sm text-zinc-400">{emptyLabel}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr className="[&>th]:border-b [&>th]:border-zinc-200">
                  <th className="px-4 py-3 text-left min-w-45">
                    {report.type === "CXC" ? "Cliente" : "Proveedor"}
                  </th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Factura</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Fecha</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Vencimiento</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap min-w-44">Total</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap min-w-44">Pagado</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap min-w-44">Pendiente</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Antigüedad</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const cfg = BUCKET_CONFIG[row.bucket];
                  const isOverdue = row.bucket !== "CURRENT";
                  return (
                    <tr
                      key={row.invoiceId}
                      className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100"
                    >
                      {/* Contraparte */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-900">{row.counterpartName}</p>
                        {row.counterpartRif && (
                          <p className="text-xs text-zinc-400 font-mono">{row.counterpartRif}</p>
                        )}
                      </td>

                      {/* Factura */}
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                        <p>{row.invoiceNumber}</p>
                        {row.controlNumber && (
                          <p className="text-zinc-400">{row.controlNumber}</p>
                        )}
                      </td>

                      {/* Fecha emisión */}
                      <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                        {formatDate(row.invoiceDate)}
                      </td>

                      {/* Vencimiento */}
                      <td className={`px-4 py-3 whitespace-nowrap font-medium ${isOverdue ? cfg.cardText : "text-zinc-600"}`}>
                        {formatDate(row.dueDate)}
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <MoneyBadge amount={row.totalAmountVes} currency="VES" align="right" />
                      </td>

                      {/* Pagado */}
                      <td className="px-4 py-3 text-right whitespace-nowrap text-zinc-400">
                        <MoneyBadge amount={row.paidAmountVes} currency="VES" align="right" />
                      </td>

                      {/* Pendiente */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <MoneyBadge
                          amount={row.pendingAmountVes}
                          currency="VES"
                          align="right"
                          className={isOverdue ? cfg.cardText : undefined}
                        />
                      </td>

                      {/* Badge antigüedad */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.badgeCls}`}>
                          {cfg.label}
                          {row.daysOverdue > 0 && (
                            <span className="ml-1 opacity-70">({row.daysOverdue}d)</span>
                          )}
                        </span>
                      </td>

                      {/* Acción */}
                      <td className="px-4 py-3 text-right">
                        <RecordPaymentDialog
                          companyId={companyId}
                          row={row}
                          onSuccess={() => {
                            setRows((prev) =>
                              prev.map((r) =>
                                r.invoiceId === row.invoiceId
                                  ? { ...r, paymentStatus: "PARTIAL" }
                                  : r
                              )
                            );
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
