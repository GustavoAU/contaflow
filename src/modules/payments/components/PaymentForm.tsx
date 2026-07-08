"use client";
// src/modules/payments/components/PaymentForm.tsx
// P2 (audit 2026-07-05): refactor de legibilidad EXTRA-CONSERVADOR a React Hook Form.
// 22 useState → 6 useState + useForm. Form FISCAL (Z-2-adyacente): payload, mensajes,
// visual y semántica de idempotencyKey (H6, ADR-032) intactos.
//
// DECISIÓN DE VALIDACIÓN (documentada a propósito): SIN zodResolver. La única
// validación client-side visible hoy es el check manual de monto ("El monto debe ser
// mayor a Bs.D 0,00" en el banner de error) + atributos nativos required/pattern.
// Meter CreatePaymentSchema (superRefine por método) al client mostraría mensajes
// nuevos en lugares nuevos → delta visible. RHF se usa SOLO para estado de campos;
// el server sigue validando con CreatePaymentSchema (fuente única de verdad).
//
// FUERA de RHF (estado async/derivado, no son campos de usuario):
//   idempotencyKey (H6 — estable entre retries, rota SOLO tras éxito),
//   bankAccounts (fetch), bcvRate/bcvLoading (fetch), error, success.

import { useTransition, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Loader2Icon, BuildingIcon } from "lucide-react";
import { Decimal } from "decimal.js";
import { createPaymentAction, listBankAccountsAction, type BankAccountOption } from "../actions/payment.actions";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "../schemas/payment.schema";
import { getLatestRateAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";
import { formatAmount } from "@/lib/format";
import { VENEZUELA_BANKS } from "../constants/venezuela-banks";
import { genIdempotencyKey } from "../utils/idempotency";

type Props = {
  companyId: string;
  userId: string;
  onSuccess?: () => void;
};

const fmtNum = formatAmount;

function calcIgtf(amountVes: string): string {
  try {
    const d = new Decimal(amountVes);
    return d.gt(0) ? d.mul("0.03").toDecimalPlaces(2).toString() : "0.00";
  } catch {
    return "0.00";
  }
}

const METHODS_WITH_BANK: PaymentMethodType[] = ["TRANSFERENCIA", "PAGOMOVIL"];
const METHODS_USD: PaymentMethodType[] = ["ZELLE"];
const PHONE_PATTERN = /^[\d\s\-+()]{7,20}$/;

// Campos de usuario del form. Todos strings (el server recibe strings; R-5:
// Decimal.js solo en cálculos) salvo el checkbox casheaIgtf.
type PaymentFormValues = {
  date: string;
  method: PaymentMethodType;
  amountVes: string;
  /** Concepto obligatorio (#12) — se envía como `notes`. */
  concept: string;
  // Transferencia / PagoMóvil
  referenceNumber: string;
  originBank: string;
  destBank: string;
  // PagoMóvil teléfonos (#1/#16)
  senderPhone: string;
  destPhone: string;
  // Zelle / Efectivo USD — se envía como `amountOriginal`
  amountUsd: string;
  // Efectivo — moneda (toggle, no input registrado: setValue/watch)
  efectivoCurrency: "VES" | "USD";
  // Cashea
  commissionPct: string;
  casheaIgtf: boolean;
  // ADR-030
  bankAccountId: string;
  // Riesgo-6 (Prov. 0049)
  ivaRetentionAmount: string;
};

// Fecha calculada al momento de la llamada (mount y cada resetForm) — misma
// semántica que el `today` de render del código anterior.
function makeDefaultValues(): PaymentFormValues {
  return {
    date: new Date().toISOString().split("T")[0],
    method: "PAGOMOVIL",
    amountVes: "",
    concept: "",
    referenceNumber: "",
    originBank: "",
    destBank: "",
    senderPhone: "",
    destPhone: "",
    amountUsd: "",
    efectivoCurrency: "USD",
    commissionPct: "3.50",
    casheaIgtf: false,
    bankAccountId: "",
    ivaRetentionAmount: "",
  };
}

export function PaymentForm({ companyId, userId, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ADR-030: cuentas bancarias para GL auto-posting
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);

  // H6 (ADR-032): clave de idempotencia ESTABLE mientras el usuario reintenta el mismo
  // pago (timeout de red → retry usa la misma key → el servidor deduplica). Se rota
  // solo tras un éxito (el siguiente pago es una operación nueva).
  // Vive FUERA de RHF a propósito: reset() del form no debe tocarla.
  const [idempotencyKey, setIdempotencyKey] = useState(genIdempotencyKey);

  const [bcvRate, setBcvRate] = useState<number | null>(null);
  const [bcvLoading, setBcvLoading] = useState(false);

  const { register, handleSubmit, watch, setValue, reset } = useForm<PaymentFormValues>({
    defaultValues: makeDefaultValues(),
  });

  // Campos observados: alimentan render condicional por método y derivados.
  const method = watch("method");
  const amountVes = watch("amountVes");
  const amountUsd = watch("amountUsd");
  const efectivoCurrency = watch("efectivoCurrency");
  const commissionPct = watch("commissionPct");
  const casheaIgtf = watch("casheaIgtf");
  const bankAccountId = watch("bankAccountId");

  const vesNum = parseFloat(amountVes) || 0;
  const commPct = parseFloat(commissionPct) || 0;

  const igtfZelle = method === "ZELLE" && amountVes ? calcIgtf(amountVes) : "0.00";
  const igtfEfectivo = efectivoCurrency === "USD" && amountVes ? calcIgtf(amountVes) : "0.00";
  const igtfCashea = casheaIgtf && amountVes ? calcIgtf(amountVes) : "0.00";
  const commAmount = vesNum > 0
    ? new Decimal(vesNum).mul(commPct).div(100).toDecimalPlaces(2).toString()
    : "0.00";

  const needsBcv = method === "ZELLE" || (method === "EFECTIVO" && efectivoCurrency === "USD");

  // ─── Cargar cuentas bancarias (ADR-030) ──────────────────────────────────
  useEffect(() => {
    void (async () => {
      const res = await listBankAccountsAction(companyId);
      if (res.success) setBankAccounts(res.data);
    })();
  }, [companyId]);

  // ─── Cargar tasa BCV cuando el método requiere USD ───────────────────────
  useEffect(() => {
    if (!needsBcv) return;
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
  }, [needsBcv, companyId]);

  // ─── Auto-calcular VES = USD × tasa BCV ──────────────────────────────────
  // H-003: el campo mostrado es solo-lectura; el servidor recalcula al guardar.
  useEffect(() => {
    if (!needsBcv || !bcvRate || !amountUsd) return;
    const usdNum = parseFloat(amountUsd);
    if (!isNaN(usdNum) && usdNum > 0) setValue("amountVes", (usdNum * bcvRate).toFixed(2));
  }, [amountUsd, bcvRate, needsBcv, setValue]);

  // ─── Limpiar campos al cambiar método (#9) ────────────────────────────────
  // Mismos campos que el handleMethodChange anterior; `method` lo actualiza RHF
  // vía register("method", { onChange }).
  function clearMethodFields() {
    setValue("amountVes", "");
    setValue("amountUsd", "");
    setValue("referenceNumber", "");
    setValue("originBank", "");
    setValue("destBank", "");
    setValue("senderPhone", "");
    setValue("destPhone", "");
    setValue("efectivoCurrency", "USD");
  }

  function resetForm() {
    // Repone TODOS los defaults (fecha de hoy incluida) — mismo efecto que el
    // resetForm anterior campo a campo.
    reset(makeDefaultValues());
    setBcvRate(null);
    // H6: el siguiente pago es una operación nueva → key nueva
    setIdempotencyKey(genIdempotencyKey());
  }

  function submitPayment(values: PaymentFormValues) {
    setError(null);
    setSuccess(false);

    // Validación de monto en español (#7) — único mensaje client-side, intacto.
    const vesFloat = parseFloat(values.amountVes);
    if (!values.amountVes || isNaN(vesFloat) || vesFloat < 0.01) {
      setError("El monto debe ser mayor a Bs.D 0,00");
      return;
    }

    startTransition(async () => {
      const isUsdMethod = values.method === "ZELLE" || (values.method === "EFECTIVO" && values.efectivoCurrency === "USD");

      const payload: Record<string, string | undefined> = {
        companyId,
        method: values.method,
        amountVes: values.amountVes,
        currency: isUsdMethod ? "USD" : "VES",
        date: values.date,
        notes: values.concept,
        createdBy: userId,
        // H6 (ADR-032): dedupe de doble-submit — misma key en cada retry de ESTE pago
        idempotencyKey,
      };

      if (values.method === "PAGOMOVIL" || values.method === "TRANSFERENCIA") {
        payload.referenceNumber = values.referenceNumber;
        payload.originBank = values.originBank || undefined;
        payload.destBank = values.destBank || undefined;
      }

      if (values.method === "PAGOMOVIL") {
        payload.senderPhone = values.senderPhone || undefined;
        payload.destPhone = values.destPhone || undefined;
      }

      if (values.method === "ZELLE") {
        payload.amountOriginal = values.amountUsd;
      }

      if (values.method === "EFECTIVO" && values.efectivoCurrency === "USD") {
        payload.amountOriginal = values.amountUsd;
      }

      if (values.method === "CASHEA") {
        payload.commissionPct = values.commissionPct;
        payload.commissionAmount = commAmount;
      }

      // ADR-030: incluir bankAccountId si se seleccionó
      if (values.bankAccountId) {
        payload.bankAccountId = values.bankAccountId;
      }

      // Riesgo-6: IVA retenido por cliente CE (Prov. 0049) — solo si se ingresó
      if (values.ivaRetentionAmount && parseFloat(values.ivaRetentionAmount) > 0) {
        payload.ivaRetentionAmount = values.ivaRetentionAmount;
      }

      const result = await createPaymentAction(payload);
      if (result.success) {
        setSuccess(true);
        resetForm();
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  }

  const inputCls = "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none";

  return (
    <form onSubmit={(e) => void handleSubmit(submitPayment)(e)} className="space-y-4 rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-zinc-800">Registrar Pago</h2>

      {/* Fecha + Método */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Fecha</label>
          <input type="date" required className={inputCls} {...register("date")} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Medio de pago</label>
          <select
            className={inputCls}
            {...register("method", { onChange: clearMethodFields })}
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodType[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Zelle ─── */}
      {method === "ZELLE" && (
        <div className="space-y-3 rounded-md border border-green-100 bg-green-50 p-3">
          <p className="text-xs font-medium text-green-700">Datos Zelle (USD)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Monto en USD <span className="text-red-500">*</span>
            </label>
            <input type="number" min="0.01" step="0.01" placeholder="0.00" required
              className={`${inputCls} font-mono`} {...register("amountUsd")} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Equivalente en Bs.D (VES) <span className="text-xs font-normal text-zinc-400">— calculado con la tasa BCV</span>
              {bcvLoading && <span className="ml-2 text-xs font-normal text-zinc-400">Cargando tasa BCV...</span>}
              {!bcvLoading && bcvRate && <span className="ml-2 text-xs font-normal text-zinc-400">Tasa BCV: {fmtNum(bcvRate)} Bs.D/USD</span>}
              {!bcvLoading && !bcvRate && <span className="ml-2 text-xs font-normal text-amber-600">Sin tasa BCV — regístrela antes de guardar</span>}
            </label>
            {/* H-003: solo-lectura — el servidor recalcula amountVes = USD × tasa BCV oficial */}
            <input type="number" readOnly tabIndex={-1} placeholder="0.00"
              title="Calculado con la tasa BCV; el servidor lo recalcula al guardar"
              className={`${inputCls} font-mono bg-zinc-100 text-zinc-600`} {...register("amountVes")} />
          </div>
          {vesNum > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3% (aplica por ser pago en USD):
              <span className="ml-1 font-mono font-semibold">Bs.D {fmtNum(igtfZelle)}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Efectivo ─── */}
      {method === "EFECTIVO" && (
        <div className="space-y-3 rounded-md border border-orange-100 bg-orange-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-orange-700">Moneda del efectivo</p>
            <div className="flex overflow-hidden rounded-md border border-orange-200 text-xs">
              <button type="button"
                onClick={() => { setValue("efectivoCurrency", "USD"); setValue("amountVes", ""); setValue("amountUsd", ""); }}
                className={`px-3 py-1 transition-colors ${efectivoCurrency === "USD" ? "bg-orange-600 text-white" : "bg-white text-orange-700 hover:bg-orange-50"}`}>
                USD
              </button>
              <button type="button"
                onClick={() => { setValue("efectivoCurrency", "VES"); setValue("amountVes", ""); setValue("amountUsd", ""); }}
                className={`px-3 py-1 transition-colors ${efectivoCurrency === "VES" ? "bg-orange-600 text-white" : "bg-white text-orange-700 hover:bg-orange-50"}`}>
                Bs.D
              </button>
            </div>
          </div>
          {efectivoCurrency === "USD" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Monto en USD <span className="text-red-500">*</span>
                </label>
                <input type="number" min="0.01" step="0.01" placeholder="0.00" required
                  className={`${inputCls} font-mono`} {...register("amountUsd")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Equivalente en Bs.D <span className="text-xs font-normal text-zinc-400">— calculado con la tasa BCV</span>
                  {bcvLoading && <span className="ml-2 text-xs font-normal text-zinc-400">Cargando...</span>}
                  {!bcvLoading && bcvRate && <span className="ml-2 text-xs font-normal text-zinc-400">Tasa: {fmtNum(bcvRate)}</span>}
                  {!bcvLoading && !bcvRate && <span className="ml-2 text-xs font-normal text-amber-600">Sin tasa BCV — regístrela antes de guardar</span>}
                </label>
                {/* H-003: solo-lectura — el servidor recalcula amountVes = USD × tasa BCV oficial */}
                <input type="number" readOnly tabIndex={-1} placeholder="0.00"
                  title="Calculado con la tasa BCV; el servidor lo recalcula al guardar"
                  className={`${inputCls} font-mono bg-zinc-100 text-zinc-600`} {...register("amountVes")} />
              </div>
              {vesNum > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  IGTF 3%: <span className="font-mono font-semibold">Bs.D {fmtNum(igtfEfectivo)}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Monto VES genérico (no Zelle, no Efectivo) */}
      {method !== "ZELLE" && method !== "EFECTIVO" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Monto <span className="font-mono text-xs text-zinc-500">Bs.D (VES)</span>{" "}
            <span className="text-red-500">*</span>
          </label>
          <input type="number" min="0.01" step="0.01" placeholder="0.00"
            className={`${inputCls} font-mono`} {...register("amountVes")} />
        </div>
      )}

      {/* VES input para Efectivo en Bs.D */}
      {method === "EFECTIVO" && efectivoCurrency === "VES" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Monto <span className="font-mono text-xs text-zinc-500">Bs.D</span>{" "}
            <span className="text-red-500">*</span>
          </label>
          <input type="number" min="0.01" step="0.01" placeholder="0.00"
            className={`${inputCls} font-mono`} {...register("amountVes")} />
        </div>
      )}

      {/* ─── Transferencia Bancaria (#2) ─── */}
      {method === "TRANSFERENCIA" && (
        <div className="space-y-3 rounded-md border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-medium text-blue-700">Datos Transferencia Bancaria</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Número de referencia <span className="text-red-500">*</span>
            </label>
            <input type="text" placeholder="REF-00123456" required className={inputCls}
              {...register("referenceNumber")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Banco origen</label>
              <select className={inputCls} {...register("originBank")}>
                <option value="">— Seleccionar —</option>
                {VENEZUELA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Banco destino</label>
              <select className={inputCls} {...register("destBank")}>
                <option value="">— Seleccionar —</option>
                {VENEZUELA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ─── PagoMóvil ─── */}
      {method === "PAGOMOVIL" && (
        <div className="space-y-3 rounded-md border border-indigo-100 bg-indigo-50 p-3">
          <p className="text-xs font-medium text-indigo-700">Datos PagoMóvil</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Número de referencia <span className="text-red-500">*</span>
            </label>
            <input type="text" placeholder="REF-12345678" required className={inputCls}
              {...register("referenceNumber")} />
          </div>
          {/* Teléfono del emisor (#1) */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Teléfono del emisor <span className="text-red-500">*</span>
            </label>
            <input type="tel" placeholder="0414-1234567" required
              pattern={PHONE_PATTERN.source}
              title="Formato: 04XX-XXXXXXX o +58-4XX-XXXXXXX"
              className={inputCls} {...register("senderPhone")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Banco origen</label>
              <select className={inputCls} {...register("originBank")}>
                <option value="">— Seleccionar —</option>
                {VENEZUELA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Banco destino <span className="text-red-500">*</span>
              </label>
              <select required className={inputCls} {...register("destBank")}>
                <option value="">— Seleccionar —</option>
                {VENEZUELA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          {/* Teléfono del receptor (#16) */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Teléfono del receptor</label>
            <input type="tel" placeholder="0424-7654321" className={inputCls}
              {...register("destPhone")} />
          </div>
        </div>
      )}

      {/* ─── Cashea ─── */}
      {method === "CASHEA" && (
        <div className="space-y-3 rounded-md border border-purple-100 bg-purple-50 p-3">
          <p className="text-xs font-medium text-purple-700">Datos Cashea (BNPL)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Comisión Cashea (%) <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="0.01"
                className="w-28 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                {...register("commissionPct")} />
              {vesNum > 0 && (
                <span className="text-sm text-zinc-600">
                  = <span className="font-mono font-semibold">Bs.D {fmtNum(commAmount)}</span>
                </span>
              )}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" className="rounded" {...register("casheaIgtf")} />
            Cashea liquida en USD (aplica IGTF 3%)
          </label>
          {casheaIgtf && vesNum > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3%: <span className="font-mono font-semibold">Bs.D {fmtNum(igtfCashea)}</span>
            </div>
          )}
        </div>
      )}

      {/* Concepto / Descripción — obligatorio (#12) */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Concepto / Descripción <span className="text-red-500">*</span>
        </label>
        <input type="text" placeholder="Ej: Pago factura proveedor ABC, período mayo 2026"
          required
          className={inputCls} {...register("concept")} />
      </div>

      {/* ─── Cuenta Bancaria para GL auto-posting (ADR-030) ─── */}
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-zinc-700">
          <BuildingIcon className="size-3.5 text-zinc-400" />
          Cuenta bancaria
          <span className="ml-1 text-xs font-normal text-zinc-400">(opcional — asiento automático si hay cuentas GL configuradas)</span>
        </label>
        {bankAccounts.length === 0 ? (
          <p className="text-xs text-zinc-400">
            No hay cuentas bancarias configuradas. Configure una en Conciliación Bancaria para habilitar el asiento automático.
          </p>
        ) : (
          <select className={inputCls} {...register("bankAccountId")}>
            <option value="">— Sin asiento automático —</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.bankName} ({a.currency})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Riesgo-6: IVA retenido por cliente CE (Prov. 0049) — solo visible si hay bankAccount */}
      {bankAccountId && (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-zinc-700">
            IVA retenido por el cliente
            <span className="ml-1 text-xs font-normal text-zinc-400">(Prov. 0049 — solo CE) — opcional</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            {...register("ivaRetentionAmount")}
          />
          <p className="text-xs text-zinc-400">
            Si el cliente es Contribuyente Especial y retuvo el IVA (75%/100%), ingrese el monto retenido en Bs.
            El asiento será Dr. Banco + Dr. IVA Ret. x Cobrar = Cr. CxC.
          </p>
        </div>
      )}

      {/* Feedback */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Pago registrado correctamente.
        </div>
      )}

      <button type="submit" disabled={isPending} aria-busy={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
        {isPending && <Loader2Icon className="size-4 animate-spin" />}
        {isPending ? "Guardando..." : "Registrar pago"}
      </button>

      {!METHODS_WITH_BANK.includes(method) && !METHODS_USD.includes(method) && method !== "EFECTIVO" && method !== "CASHEA" && (
        <p className="text-center text-xs text-zinc-400">
          Método sin campos adicionales requeridos
        </p>
      )}
    </form>
  );
}
