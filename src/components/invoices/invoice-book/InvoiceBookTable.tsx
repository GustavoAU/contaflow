// src/components/invoices/invoice-book/InvoiceBookTable.tsx
// Presentacional — extraído MECÁNICAMENTE desde InvoiceBook.tsx (sin cambios) — split por tamaño de archivo.

import React from "react";
import { CopyIcon } from "lucide-react";
import type { InvoiceBookResult, InvoiceBookRow } from "@/modules/invoices/services/InvoiceService";
import { CreditDebitNotesPanel } from "@/components/invoices/CreditDebitNotesPanel";
import { MoneyBadge } from "@/components/ui/MoneyBadge";
import { fmtDate } from "@/lib/format";

const TAX_LINE_LABELS: Record<string, string> = {
  IVA_GENERAL: "IVA General",
  IVA_REDUCIDO: "IVA Reducido",
  IVA_ADICIONAL: "IVA Adicional",
  EXENTO: "Exento",
};

// ─── Badge estado SENIAT (PA-121) ─────────────────────────────────────────────

type SeniatStatus = "PENDING" | "SENT" | "FAILED";

const SENIAT_BADGE: Record<SeniatStatus, { label: string; title: string; className: string }> = {
  SENT:    { label: "SENIAT ✓", title: "Transmitido al SENIAT",        className: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  PENDING: { label: "SENIAT ◌", title: "Pendiente de transmisión",     className: "bg-amber-50 text-amber-700 border border-amber-200" },
  FAILED:  { label: "SENIAT ✗", title: "Error en transmisión SENIAT",  className: "bg-red-50 text-red-700 border border-red-200" },
};

function SeniatBadge({ status }: { status: SeniatStatus }) {
  const cfg = SENIAT_BADGE[status];
  return (
    <span
      title={cfg.title}
      aria-label={cfg.title}
      className={`rounded px-1.5 py-0.5 text-10 font-semibold whitespace-nowrap ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

type Props = {
  result: InvoiceBookResult;
  type: "SALE" | "PURCHASE";
  companyId: string;
  expandedNcNdId: string | null;
  onToggleNcNd: (rowId: string) => void;
  pendingVoucherId: string | null;
  isPendingVoucher: boolean;
  onExportVoucher: (invoiceId: string, invoiceNumber: string) => void;
  onDuplicate: (row: InvoiceBookRow) => void;
};

export function InvoiceBookTable({
  result,
  type,
  companyId,
  expandedNcNdId,
  onToggleNcNd,
  pendingVoucherId,
  isPendingVoucher,
  onExportVoucher,
  onDuplicate,
}: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-separate border-spacing-0">
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr className="[&>th]:border-b [&>th]:border-zinc-200">
            <th scope="col" className="px-4 py-3 text-left w-25 whitespace-nowrap">Fecha</th>
            <th scope="col" className="sticky left-0 z-10 bg-zinc-50 px-4 py-3 text-left min-w-50">
              {type === "PURCHASE" ? "Proveedor" : "Cliente"}
            </th>
            <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">RIF</th>
            <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">N° Factura</th>
            <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">N° Control</th>
            <th scope="col" className="px-4 py-3 text-left"></th>
            <th scope="col" className="px-4 py-3 text-left whitespace-nowrap">Impuesto</th>
            <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">Base</th>
            <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-20">Tasa %</th>
            <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">IVA</th>
            <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">IVA Ret.</th>
            {type === "PURCHASE" && <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">ISLR Ret.</th>}
            {type === "SALE" && <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">IGTF</th>}
            <th scope="col" className="px-4 py-3 text-right whitespace-nowrap min-w-44">Total</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => {
            const isFactura = row.docType === "FACTURA";
            const ncNdOpen = expandedNcNdId === row.id;
            const totalBase = row.taxLines.reduce((acc, l) => acc + parseFloat(l.base), 0);
            const totalIva  = row.taxLines.reduce((acc, l) => acc + parseFloat(l.amount), 0);
            const igtf = parseFloat(row.igtfAmount);
            const rowTotal = totalBase + totalIva + igtf;


            // Botón NC/ND solo para FACTURAs
            const ncNdButton = isFactura ? (
              <button
                type="button"
                onClick={() => onToggleNcNd(row.id)}
                title={ncNdOpen ? "Ocultar NC/ND" : "Ver Notas de Crédito/Débito vinculadas"}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${ncNdOpen ? "bg-purple-100 text-purple-700" : "text-purple-600 hover:bg-purple-50"}`}
              >
                NC/ND
              </button>
            ) : null;

            const expansionRow = ncNdOpen ? (
              <tr key={`ncnd-${row.id}`} className="bg-zinc-50">
                <td colSpan={13} className="border-t p-0">
                  <CreditDebitNotesPanel companyId={companyId} invoiceId={row.id} />
                </td>
              </tr>
            ) : null;

            return (
              <React.Fragment key={row.id}>
                {row.taxLines.length === 0 ? (
                  <tr className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {fmtDate(row.date)}
                    </td>
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 min-w-50"
                        title={row.counterpartName}>
                      {row.counterpartName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.counterpartRif}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.invoiceNumber}</span>
                        {(row.docType === "NOTA_CREDITO" || row.docType === "NOTA_DEBITO") &&
                          row.relatedDocNumber && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-10 font-medium text-amber-800">
                              &#8594; Factura {row.relatedDocNumber}
                            </span>
                          )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.controlNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 items-center">
                        <button
                          type="button"
                          onClick={() => onExportVoucher(row.id, row.invoiceNumber)}
                          disabled={isPendingVoucher && pendingVoucherId === row.id}
                          title="Descargar PDF de factura"
                          className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                          aria-label={`Descargar PDF factura ${row.invoiceNumber}`}
                        >
                          {isPendingVoucher && pendingVoucherId === row.id ? "…" : "PDF"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicate(row)}
                          title="Duplicar esta factura (pre-llena el formulario con los mismos datos)"
                          className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                          aria-label={`Duplicar factura ${row.invoiceNumber}`}
                        >
                          <CopyIcon className="inline h-3 w-3" />
                        </button>
                        {ncNdButton}
                        {type === "SALE" && row.seniatStatus && (
                          <SeniatBadge status={row.seniatStatus} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">—</td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">—</td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">—</td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">—</td>
                    <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                      <MoneyBadge amount={row.ivaRetentionAmount} currency="VES" align="right" />
                    </td>
                    {type === "PURCHASE" && (
                      <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                        <MoneyBadge amount={row.islrRetentionAmount} currency="VES" align="right" />
                      </td>
                    )}
                    {type === "SALE" && (
                      <td className="px-4 py-3 text-right text-yellow-700 whitespace-nowrap">
                        <MoneyBadge amount={row.igtfAmount} currency="VES" align="right" />
                      </td>
                    )}
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                      {rowTotal > 0
                        ? <MoneyBadge amount={rowTotal} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                        : "—"}
                    </td>
                  </tr>
                ) : (
                  row.taxLines.map((line, idx) => (
                    <tr key={`${row.id}-${line.id}`} className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {idx === 0 ? fmtDate(row.date) : ""}
                  </td>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 min-w-50"
                      title={idx === 0 ? row.counterpartName : undefined}>
                    {idx === 0 ? row.counterpartName : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    {idx === 0 ? row.counterpartRif : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {idx === 0 ? (
                      <div className="flex flex-col gap-0.5">
                        <span>{row.invoiceNumber}</span>
                        {(row.docType === "NOTA_CREDITO" || row.docType === "NOTA_DEBITO") &&
                          row.relatedDocNumber && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-10 font-medium text-amber-800">
                              &#8594; Factura {row.relatedDocNumber}
                            </span>
                          )}
                      </div>
                    ) : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {idx === 0 ? (row.controlNumber ?? "—") : ""}
                  </td>
                  <td className="px-4 py-3">
                    {idx === 0 && (
                      <div className="flex flex-wrap gap-1 items-center">
                        <button
                          type="button"
                          onClick={() => onExportVoucher(row.id, row.invoiceNumber)}
                          disabled={isPendingVoucher && pendingVoucherId === row.id}
                          title="Descargar PDF de factura"
                          className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                          aria-label={`Descargar PDF factura ${row.invoiceNumber}`}
                        >
                          {isPendingVoucher && pendingVoucherId === row.id ? "…" : "PDF"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicate(row)}
                          title="Duplicar esta factura"
                          className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                          aria-label={`Duplicar factura ${row.invoiceNumber}`}
                        >
                          <CopyIcon className="inline h-3 w-3" />
                        </button>
                        {ncNdButton}
                        {type === "SALE" && row.seniatStatus && (
                          <SeniatBadge status={row.seniatStatus} />
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {TAX_LINE_LABELS[line.taxType] ?? line.taxType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <MoneyBadge amount={line.base} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono whitespace-nowrap">{line.rate}%</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <MoneyBadge amount={line.amount} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                  </td>
                  <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                    {idx === 0 ? <MoneyBadge amount={row.ivaRetentionAmount} currency="VES" align="right" /> : ""}
                  </td>
                  {type === "PURCHASE" && (
                    <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                      {idx === 0 ? <MoneyBadge amount={row.islrRetentionAmount} currency="VES" align="right" /> : ""}
                    </td>
                  )}
                  {type === "SALE" && (
                    <td className="px-4 py-3 text-right text-yellow-700 whitespace-nowrap">
                      {idx === 0 ? <MoneyBadge amount={row.igtfAmount} currency="VES" align="right" /> : ""}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                    {idx === 0 && (
                      <MoneyBadge amount={rowTotal} currency="VES" exchangeRate={row.exchangeRate ?? undefined} />
                    )}
                  </td>
                </tr>
                  ))
                )}
                {expansionRow}
              </React.Fragment>
            );
          })}
        </tbody>

        {/* Totales */}
        <tfoot className="bg-zinc-50 font-semibold text-sm">
          <tr className="[&>td]:border-t-2 [&>td]:border-zinc-200">
            <td className="px-4 py-3" />
            <td className="sticky left-0 z-10 bg-zinc-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-zinc-500 whitespace-nowrap">
              TOTALES
            </td>
            <td colSpan={4} className="px-4 py-3" />
            <td className="px-4 py-3" />{/* Impuesto col */}
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <MoneyBadge amount={result.summary.totalBaseGeneral} currency="VES" />
            </td>
            <td className="px-4 py-3" />{/* Tasa% col */}
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <MoneyBadge amount={result.summary.totalIvaGeneral} currency="VES" />
            </td>
            <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
              <MoneyBadge amount={result.summary.totalIvaRetention} currency="VES" align="right" />
            </td>
            {type === "PURCHASE" && (
              <td className="px-4 py-3 text-right text-orange-700 whitespace-nowrap">
                <MoneyBadge amount={result.summary.totalIslrRetention} currency="VES" align="right" />
              </td>
            )}
            {type === "SALE" && (
              <td className="px-4 py-3 text-right text-yellow-700 whitespace-nowrap">
                <MoneyBadge amount={result.summary.totalIgtf} currency="VES" align="right" />
              </td>
            )}
            <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
              <MoneyBadge
                amount={result.rows.reduce((acc, row) => {
                  const rt = row.taxLines.reduce(
                    (a, l) => a + parseFloat(l.base) + parseFloat(l.amount),
                    0
                  ) + parseFloat(row.igtfAmount);
                  return acc + rt;
                }, 0)}
                currency="VES"
              />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
