"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import type { AgingReport, AgingBucket } from "../services/ReceivableService";

type Props = {
  report: AgingReport;
  companyId: string;
};

const BUCKET_BADGE_VARIANT: Record<AgingBucket, "default" | "secondary" | "destructive" | "outline"> = {
  CURRENT: "secondary",
  OVERDUE_31_60: "outline",
  OVERDUE_61_90: "outline",
  OVERDUE_91_120: "destructive",
  OVERDUE_120_PLUS: "destructive",
};

const BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: "Corriente",
  OVERDUE_31_60: "31–60 días",
  OVERDUE_61_90: "61–90 días",
  OVERDUE_91_120: "91–120 días",
  OVERDUE_120_PLUS: "+120 días",
};

function formatVes(value: string): string {
  return Number(value).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function AgingReportTable({ report, companyId }: Props) {
  const [rows, setRows] = useState(report.rows);

  const titleLabel = report.type === "CXC" ? "Cuentas por Cobrar" : "Cuentas por Pagar";
  const emptyLabel = report.type === "CXC"
    ? "No hay facturas de venta con saldo pendiente"
    : "No hay facturas de compra con saldo pendiente";

  return (
    <div className="space-y-6">
      {/* Resumen por bucket */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {report.bucketSummary.map((b) => (
          <div
            key={b.bucket}
            className="rounded-lg border p-3 text-center"
          >
            <p className="text-muted-foreground text-xs font-medium">{b.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {b.count}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              Bs. {formatVes(b.totalPendingVes)}
            </p>
          </div>
        ))}
      </div>

      {/* Totales */}
      <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <span>
          <span className="text-muted-foreground">Total cartera: </span>
          <span className="font-semibold tabular-nums">Bs. {formatVes(report.grandTotalPendingVes)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Corriente: </span>
          <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
            Bs. {formatVes(report.grandTotalCurrentVes)}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Vencido: </span>
          <span className="font-semibold tabular-nums text-destructive">
            Bs. {formatVes(report.grandTotalOverdueVes)}
          </span>
        </span>
        <span className="text-muted-foreground ml-auto text-xs">
          Corte: {formatDate(report.asOf)}
        </span>
      </div>

      {/* Tabla */}
      {rows.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{emptyLabel}</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contraparte</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Total Bs.</TableHead>
                <TableHead className="text-right">Pagado Bs.</TableHead>
                <TableHead className="text-right">Pendiente Bs.</TableHead>
                <TableHead>Antigüedad</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.invoiceId}>
                  <TableCell>
                    <div className="font-medium">{row.counterpartName}</div>
                    <div className="text-muted-foreground text-xs">{row.counterpartRif}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{row.invoiceNumber}</div>
                    {row.controlNumber && (
                      <div className="text-muted-foreground text-xs">{row.controlNumber}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(row.invoiceDate)}</TableCell>
                  <TableCell className="text-sm">{formatDate(row.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatVes(row.totalAmountVes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatVes(row.paidAmountVes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-semibold">
                    {formatVes(row.pendingAmountVes)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={BUCKET_BADGE_VARIANT[row.bucket]}>
                      {BUCKET_LABELS[row.bucket]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <RecordPaymentDialog
                      companyId={companyId}
                      row={row}
                      onSuccess={() => {
                        // Optimistic: marcar como parcialmente pagada
                        setRows((prev) =>
                          prev.map((r) =>
                            r.invoiceId === row.invoiceId
                              ? { ...r, paymentStatus: "PARTIAL" }
                              : r
                          )
                        );
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
