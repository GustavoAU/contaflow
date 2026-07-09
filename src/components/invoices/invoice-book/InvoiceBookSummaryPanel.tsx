// src/components/invoices/invoice-book/InvoiceBookSummaryPanel.tsx
// Presentacional — extraído MECÁNICAMENTE desde InvoiceBook.tsx (sin cambios) — split por tamaño de archivo.
// ALERTA 6: Subtotales por alícuota — requerido por Providencia 00071

import type { InvoiceBookResult } from "@/modules/invoices/services/InvoiceService";
import { MoneyBadge } from "@/components/ui/MoneyBadge";

type Props = {
  result: InvoiceBookResult;
  type: "SALE" | "PURCHASE";
};

export function InvoiceBookSummaryPanel({ result, type }: Props) {
  const s = result.summary;
  const hasReduced    = parseFloat(s.totalBaseReduced) > 0;
  const hasAdditional = parseFloat(s.totalBaseAdditional) > 0;
  const hasExempt     = parseFloat(s.totalExempt) > 0;
  const hasIslr       = type === "PURCHASE" && parseFloat(s.totalIslrRetention) > 0;
  const hasIgtf       = type === "SALE"     && parseFloat(s.totalIgtf) > 0;

  const Row = ({ label, base, iva, baseLabel = "Base", ivaLabel = "IVA" }: {
    label: string; base: string; iva: string; baseLabel?: string; ivaLabel?: string;
  }) => (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 last:border-0">
      <span className="text-zinc-600 whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className="text-10 font-medium text-zinc-400 uppercase tracking-wide">{baseLabel}</p>
          <MoneyBadge amount={base} currency="VES" />
        </div>
        <div className="text-right min-w-22.5">
          <p className="text-10 font-medium text-zinc-400 uppercase tracking-wide">{ivaLabel}</p>
          <MoneyBadge amount={iva} currency="VES" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-500">
        Resumen del Período — Subtotales por Alícuota
      </h3>
      <div className="divide-y divide-zinc-100">
        <Row label="Operaciones gravadas al 16%" base={s.totalBaseGeneral} iva={s.totalIvaGeneral} />
        {hasReduced    && <Row label="Operaciones gravadas al 8% (Reducido)" base={s.totalBaseReduced} iva={s.totalIvaReduced} />}
        {hasAdditional && <Row label="Operaciones gravadas al 31% (Lujo)" base={s.totalBaseAdditional} iva={s.totalIvaAdditional} />}
        {hasExempt && (
          <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100">
            <span className="text-zinc-600">Operaciones exentas / no sujetas</span>
            <MoneyBadge amount={s.totalExempt} currency="VES" />
          </div>
        )}
        {parseFloat(s.totalIvaRetention) > 0 && (
          <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 text-orange-700">
            <span>IVA Retenido (comprobantes)</span>
            <MoneyBadge amount={s.totalIvaRetention} currency="VES" />
          </div>
        )}
        {hasIslr && (
          <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 text-orange-700">
            <span>ISLR Retenido</span>
            <MoneyBadge amount={s.totalIslrRetention} currency="VES" />
          </div>
        )}
        {hasIgtf && (
          <div className="flex items-center justify-between gap-4 py-1.5 text-sm border-b border-zinc-100 text-yellow-700">
            <span>IGTF (3%)</span>
            <MoneyBadge amount={s.totalIgtf} currency="VES" />
          </div>
        )}
      </div>
    </div>
  );
}
