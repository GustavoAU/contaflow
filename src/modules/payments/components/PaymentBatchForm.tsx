"use client";

import { useTransition, useState, useEffect, useMemo } from "react";
import { Loader2Icon, PlusIcon, TrashIcon } from "lucide-react";
import { Decimal } from "decimal.js";
import {
  createPaymentBatchAction,
  applyPaymentBatchAction,
  UnpaidPurchaseInvoice,
} from "../actions/payment-batch.actions";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "../schemas/payment.schema";
import { getLatestRateAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";
import { formatAmount } from "@/lib/format";
import { VENEZUELA_BANKS } from "../constants/venezuela-banks";
import { listBankAccountsAction, type BankAccountOption } from "../actions/payment.actions";

type Props = {
  companyId: string;
  invoices: UnpaidPurchaseInvoice[];
  onSuccess?: () => void;
};

type Line = {
  key: number;
  invoiceId: string;
  amountVes: string;
};

function fmtVes(v: string) {
  const n = parseFloat(v);
  return isNaN(n)
    ? v
    : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function genIdempotencyKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

let lineKeySeq = 0;

// Métodos que requieren campos de banco
const BANK_METHODS: PaymentMethodType[] = ["TRANSFERENCIA", "PAGOMOVIL"];

export function PaymentBatchForm({ companyId, invoices, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethodType>("TRANSFERENCIA");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [originBank, setOriginBank] = useState("");
  const [destBank, setDestBank] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: ++lineKeySeq, invoiceId: "", amountVes: "" }]);

  // Zelle — monto en USD + tasa BCV (#4)
  const [zelleUsd, setZelleUsd] = useState("");
  const [bcvRate, setBcvRate] = useState<number | null>(null);
  const [bcvLoading, setBcvLoading] = useState(false);

  // Cashea — comisión (#11)
  const [commissionPct, setCommissionPct] = useState("3.50");
  const [casheaIgtf, setCasheaIgtf] = useState(false);

  // ADR-030: cuentas bancarias para GL auto-posting
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");

  // Filtro por proveedor (#15)
  const [supplierFilter, setSupplierFilter] = useState("");

  const invoiceMap = new Map(invoices.map((inv) => [inv.id, inv]));
  const usedInvoiceIds = new Set(lines.map((l) => l.invoiceId).filter(Boolean));

  // Lista de proveedores únicos para el filtro
  const suppliers = useMemo(() => {
    const names = Array.from(new Set(invoices.map((i) => i.counterpartName).filter(Boolean)));
    return names.sort();
  }, [invoices]);

  // Facturas filtradas por proveedor
  const filteredInvoices = useMemo(() => {
    if (!supplierFilter) return invoices;
    return invoices.filter((i) => i.counterpartName === supplierFilter);
  }, [invoices, supplierFilter]);

  // Cargar cuentas bancarias (ADR-030)
  useEffect(() => {
    void (async () => {
      const res = await listBankAccountsAction(companyId);
      if (res.success) setBankAccounts(res.data);
    })();
  }, [companyId]);

  // Cargar tasa BCV para Zelle
  useEffect(() => {
    if (method !== "ZELLE") return;
    void (async () => {
      setBcvRate(null);
      setBcvLoading(true);
      try {
        const res = await getLatestRateAction(companyId, "USD");
        if (res.success && res.data) setBcvRate(parseFloat(res.data.rate));
      } finally {
        setBcvLoading(false);
      }
    })();
  }, [method, companyId]);

  // Auto-calcular total VES cuando zelleUsd + bcvRate están disponibles
  useEffect(() => {
    if (method !== "ZELLE" || !bcvRate || !zelleUsd) return;
    const usd = parseFloat(zelleUsd);
    if (!isNaN(usd) && usd > 0) {
      // Distribuir el monto VES auto-calculado a todas las líneas de forma proporcional
      // Por ahora actualiza solo si hay una línea vacía
      const totalVes = (usd * bcvRate).toFixed(2);
      if (lines.length === 1 && lines[0].amountVes === "") {
        setLines((prev) => prev.map((l) => l.key === prev[0].key ? { ...l, amountVes: totalVes } : l));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zelleUsd, bcvRate]);

  function handleMethodChange(m: PaymentMethodType) {
    setMethod(m);
    setReferenceNumber("");
    setOriginBank("");
    setDestBank("");
    setZelleUsd("");
    setBcvRate(null);
  }

  function addLine() {
    setLines((prev) => [...prev, { key: ++lineKeySeq, invoiceId: "", amountVes: "" }]);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateLine(key: number, field: "invoiceId" | "amountVes", value: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, [field]: value };
        if (field === "invoiceId" && value) {
          const inv = invoiceMap.get(value);
          if (inv) updated.amountVes = new Decimal(inv.pendingAmount).toFixed(2);
        }
        return updated;
      })
    );
  }

  function fillMaxAmount(key: number, invoiceId: string) {
    const inv = invoiceMap.get(invoiceId);
    if (!inv) return;
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, amountVes: new Decimal(inv.pendingAmount).toFixed(2) } : l))
    );
  }

  const totalVes = lines.reduce((sum, l) => {
    try {
      const d = new Decimal(l.amountVes || "0");
      return sum.plus(d.gt(0) ? d : 0);
    } catch {
      return sum;
    }
  }, new Decimal(0));

  const commPct = parseFloat(commissionPct) || 0;
  const commAmount = totalVes.gt(0)
    ? totalVes.mul(commPct).div(100).toDecimalPlaces(2).toString()
    : "0.00";
  const igtfCashea = casheaIgtf && totalVes.gt(0)
    ? totalVes.mul("0.03").toDecimalPlaces(2).toString()
    : "0.00";

  const canSubmit =
    !isPending &&
    lines.length > 0 &&
    lines.every((l) => {
      try { return l.invoiceId && new Decimal(l.amountVes || "0").gt(0); } catch { return false; }
    }) &&
    totalVes.gt(0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const idempotencyKey = genIdempotencyKey();

      const isUsd = method === "ZELLE";
      const currency = isUsd ? "USD" : "VES";

      const createResult = await createPaymentBatchAction({
        companyId,
        method,
        totalAmountVes: totalVes.toFixed(4),
        currency,
        totalAmountOriginal: isUsd && zelleUsd ? zelleUsd : undefined,
        date,
        referenceNumber: referenceNumber || undefined,
        originBank: originBank || undefined,
        destBank: destBank || undefined,
        commissionPct: method === "CASHEA" ? commissionPct : undefined,
        commissionAmount: method === "CASHEA" ? commAmount : undefined,
        notes: notes || undefined,
        idempotencyKey,
        bankAccountId: bankAccountId || undefined, // ADR-030
        lines: lines.map((l) => ({
          invoiceId: l.invoiceId,
          amountVes: new Decimal(l.amountVes).toFixed(4),
        })),
      });

      if (!createResult.success) {
        setError(createResult.error);
        return;
      }

      const applyResult = await applyPaymentBatchAction({
        companyId,
        batchId: createResult.data.id,
      });

      if (!applyResult.success) {
        setError(`Lote creado pero no aplicado: ${applyResult.error}`);
        return;
      }

      setSuccess(true);
      setLines([{ key: ++lineKeySeq, invoiceId: "", amountVes: "" }]);
      setReferenceNumber("");
      setOriginBank("");
      setDestBank("");
      setZelleUsd("");
      setNotes("");
      setBankAccountId("");
      onSuccess?.();
    });
  }

  const inputCls = "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-zinc-800">Distribución de Pago A/P</h2>
      <p className="text-xs text-zinc-500">
        Crea un lote de pago que cancela múltiples facturas de proveedor con un solo comprobante.
      </p>

      {/* Fecha + Método */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Fecha</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Medio de pago</label>
          <select value={method} onChange={(e) => handleMethodChange(e.target.value as PaymentMethodType)} className={inputCls}>
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodType[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Campos bancarios — solo para Transferencia y PagoMóvil (#5) ─── */}
      {BANK_METHODS.includes(method) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Referencia{method === "PAGOMOVIL" && <span className="text-red-500"> *</span>}
              {method === "TRANSFERENCIA" && <span className="text-red-500"> *</span>}
            </label>
            <input type="text" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="REF-00123456" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Banco origen</label>
            <select value={originBank} onChange={(e) => setOriginBank(e.target.value)} className={inputCls}>
              <option value="">— Seleccionar —</option>
              {VENEZUELA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Banco destino</label>
            <select value={destBank} onChange={(e) => setDestBank(e.target.value)} className={inputCls}>
              <option value="">— Seleccionar —</option>
              {VENEZUELA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ─── Zelle — USD + BCV (#4) ─── */}
      {method === "ZELLE" && (
        <div className="space-y-3 rounded-md border border-green-100 bg-green-50 p-3">
          <p className="text-xs font-medium text-green-700">Datos Zelle (USD)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Monto total en USD <span className="text-red-500">*</span>
              {bcvLoading && <span className="ml-2 text-xs font-normal text-zinc-400">Cargando tasa BCV...</span>}
              {!bcvLoading && bcvRate && <span className="ml-2 text-xs font-normal text-zinc-400">Tasa BCV: {formatAmount(bcvRate)} Bs.D/USD</span>}
              {!bcvLoading && !bcvRate && <span className="ml-2 text-xs font-normal text-amber-600">Sin tasa BCV — ingrese los montos VES manualmente</span>}
            </label>
            <input type="number" min="0.01" step="0.01" value={zelleUsd}
              onChange={(e) => setZelleUsd(e.target.value)} placeholder="0.00" required
              className={`${inputCls} font-mono`} />
          </div>
          {totalVes.gt(0) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3% (aplica automáticamente por ser pago en USD):
              <span className="ml-1 font-mono font-semibold">Bs.D {fmtVes(totalVes.mul("0.03").toDecimalPlaces(2).toString())}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Cashea — comisión (#11) ─── */}
      {method === "CASHEA" && (
        <div className="space-y-3 rounded-md border border-purple-100 bg-purple-50 p-3">
          <p className="text-xs font-medium text-purple-700">Datos Cashea (BNPL)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Comisión Cashea (%) <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="0.01" value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
                className="w-28 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none" />
              {totalVes.gt(0) && (
                <span className="text-sm text-zinc-600">
                  = <span className="font-mono font-semibold">Bs.D {fmtVes(commAmount)}</span>
                </span>
              )}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={casheaIgtf} onChange={(e) => setCasheaIgtf(e.target.checked)} className="rounded" />
            Cashea liquida en USD (aplica IGTF 3%)
          </label>
          {casheaIgtf && totalVes.gt(0) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3%: <span className="font-mono font-semibold">Bs.D {fmtVes(igtfCashea)}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Líneas de facturas ─── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-700">
            Facturas a pagar <span className="text-red-500">*</span>
          </label>
          <button type="button" onClick={addLine}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50">
            <PlusIcon className="size-3" />Agregar factura
          </button>
        </div>

        {/* Filtro por proveedor (#15) */}
        {suppliers.length > 1 && (
          <div className="mb-3">
            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 focus:border-blue-400 focus:outline-none">
              <option value="">— Todos los proveedores ({invoices.length}) —</option>
              {suppliers.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {filteredInvoices.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-zinc-400">
            No hay facturas pendientes {supplierFilter ? `de "${supplierFilter}"` : "de pago"}.
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => {
              const inv = invoiceMap.get(line.invoiceId);
              return (
                <div key={line.key} className="flex items-start gap-2">
                  <div className="flex-1">
                    <select value={line.invoiceId}
                      onChange={(e) => updateLine(line.key, "invoiceId", e.target.value)}
                      required
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
                      <option value="">— Seleccionar factura —</option>
                      {filteredInvoices.map((inv) => (
                        <option key={inv.id} value={inv.id}
                          disabled={usedInvoiceIds.has(inv.id) && inv.id !== line.invoiceId}>
                          {inv.invoiceNumber} — {inv.counterpartName} (Bs.D {fmtVes(inv.pendingAmount)})
                        </option>
                      ))}
                    </select>
                    {inv && (
                      <p className="mt-0.5 text-xs text-zinc-400">
                        Saldo pendiente: Bs.D {fmtVes(inv.pendingAmount)} / {inv.date}
                      </p>
                    )}
                  </div>
                  <div className="w-36">
                    <input type="number" min="0.01" step="0.01" value={line.amountVes}
                      onChange={(e) => updateLine(line.key, "amountVes", e.target.value)}
                      placeholder="0.00" required
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    {inv && (
                      <button type="button" onClick={() => fillMaxAmount(line.key, line.invoiceId)}
                        className="mt-0.5 text-xs text-blue-500 hover:underline">
                        Máximo
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    className="mt-1.5 rounded p-1 text-zinc-400 hover:text-red-500 disabled:opacity-30">
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Total */}
      {totalVes.gt(0) && (
        <div className="flex justify-end rounded-md bg-zinc-50 px-4 py-3">
          <span className="text-sm font-medium text-zinc-700">
            Total lote:{" "}
            <span className="font-mono font-bold text-zinc-900">Bs.D {fmtVes(totalVes.toFixed(2))}</span>
            {method === "ZELLE" && (
              <span className="ml-2 text-xs font-normal text-zinc-400">
                + IGTF {fmtVes(totalVes.mul("0.03").toDecimalPlaces(2).toString())}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Notas */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Notas (opcional)</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones..." className={inputCls} />
      </div>

      {/* ─── Cuenta Bancaria para GL auto-posting (ADR-030) ─── */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Cuenta bancaria{" "}
          <span className="text-xs font-normal text-zinc-400">(opcional — genera asiento GL automático)</span>
        </label>
        {bankAccounts.length === 0 ? (
          <p className="text-xs text-zinc-400">
            No hay cuentas bancarias configuradas. Configure una en Conciliación Bancaria para habilitar el asiento automático.
          </p>
        ) : (
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className={inputCls}
          >
            <option value="">— Sin asiento automático —</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.bankName} ({a.currency})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Feedback */}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Lote aplicado correctamente. Las facturas fueron actualizadas.
        </div>
      )}

      <button type="submit" disabled={!canSubmit} aria-busy={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
        {isPending && <Loader2Icon className="size-4 animate-spin" />}
        {isPending ? "Aplicando lote..." : "Crear y Aplicar Lote"}
      </button>
    </form>
  );
}
