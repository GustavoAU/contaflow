"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordPaymentAction } from "../actions/receivable.actions";
// ADR-032 F2: selector de cuenta bancaria para GL auto-posting (vía canónica)
import { listBankAccountsAction, type BankAccountOption } from "@/modules/payments/actions/payment.actions";
import { getLatestRateAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";
import type { ReceivableRow } from "../services/ReceivableService";
import { Decimal } from "decimal.js";

type Props = {
  companyId: string;
  row: ReceivableRow;
  onSuccess?: () => void;
};

const PAYMENT_METHODS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "PAGOMOVIL", label: "Pago Móvil" },
  { value: "ZELLE", label: "Zelle" },
  { value: "CASHEA", label: "Cashea" },
] as const;

const CURRENCY_ALLOWED_METHODS = ["EFECTIVO", "ZELLE"] as const;

const CURRENCY_LABELS: Record<"VES" | "USD" | "EUR", string> = {
  VES: "Bs.D",
  USD: "$",
  EUR: "€",
};

export function RecordPaymentDialog({ companyId, row, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState(row.pendingAmountVes);
  const [method, setMethod] = useState<string>("TRANSFERENCIA");
  const [selectedCurrency, setSelectedCurrency] = useState<"VES" | "USD" | "EUR">("VES");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  // ADR-032 F2: cuenta bancaria opcional — con ella el pago genera asiento GL automático
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  // Tasa BCV para cobros en divisa (el servidor recalcula el VES autoritativo al guardar)
  const [bcvRate, setBcvRate] = useState<number | null>(null);
  const [bcvLoading, setBcvLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBankAccountsAction(companyId).then((res) => {
      if (!cancelled && res.success) setBankAccounts(res.data);
    });
    return () => { cancelled = true; };
  }, [open, companyId]);

  useEffect(() => {
    if (!open || selectedCurrency === "VES") { setBcvRate(null); return; }
    let cancelled = false;
    setBcvLoading(true);
    setBcvRate(null);
    getLatestRateAction(companyId, selectedCurrency).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setBcvRate(parseFloat(res.data.rate));
      setBcvLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, selectedCurrency, companyId]);

  const currencyAllowed = (CURRENCY_ALLOWED_METHODS as readonly string[]).includes(method);

  function handleMethodChange(value: string) {
    setMethod(value);
    if (!(CURRENCY_ALLOWED_METHODS as readonly string[]).includes(value)) {
      setSelectedCurrency("VES");
    }
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await recordPaymentAction({
        companyId,
        invoiceId: row.invoiceId,
        amount,
        currency: selectedCurrency,
        method,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
        // Anclaje UTC (paridad con Medios de Pago): el guard de período usa getUTC*.
        date: new Date(date + "T00:00:00.000Z"),
        idempotencyKey: crypto.randomUUID(),
        // ADR-032 F2: con cuenta bancaria → asiento GL automático (cobro/pago)
        bankAccountId: bankAccountId || undefined,
      });

      if (result.success) {
        const currencyLabel = CURRENCY_LABELS[selectedCurrency];
        toast.success(`Pago registrado: ${currencyLabel} ${Number(amount).toLocaleString("es-VE", { minimumFractionDigits: 2 })}`);
        setOpen(false);
        onSuccess?.();
      } else {
        toast.error(result.error);
      }
    });
  }

  const maxAmount = parseFloat(row.pendingAmountVes);
  const enteredAmount = parseFloat(amount) || 0;
  const isForeign = selectedCurrency !== "VES";
  const rateMissing = isForeign && !bcvLoading && !bcvRate;

  // Equivalente en Bs.D: en divisa = monto × tasa BCV; en VES = el monto mismo.
  // El servidor recalcula este VES de forma autoritativa al guardar (H-003).
  const vesEquivalentDec = (() => {
    try {
      if (!isForeign) return new Decimal(amount || "0");
      if (!bcvRate) return new Decimal(0);
      return new Decimal(amount || "0").mul(bcvRate).toDecimalPlaces(2);
    } catch {
      return new Decimal(0);
    }
  })();
  const vesEquivalent = vesEquivalentDec.toNumber();

  // Validación contra el saldo pendiente (VES): se compara el equivalente en Bs.D.
  const isAmountValid =
    enteredAmount > 0 && vesEquivalent > 0 && vesEquivalent <= maxAmount && !rateMissing;

  // IGTF preview (3% del equivalente en Bs.D) — Decimal.js; servidor recalcula al guardar.
  const igtfPreview = isForeign && vesEquivalentDec.gt(0)
    ? vesEquivalentDec.mul("0.03").toDecimalPlaces(2).toString()
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-110">
        <DialogHeader>
          <DialogTitle>Registrar Pago</DialogTitle>
          <DialogDescription>
            Factura {row.invoiceNumber} — {row.counterpartName}
            <br />
            Saldo pendiente:{" "}
            <span className="font-semibold text-foreground">
              Bs. {Number(row.pendingAmountVes).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="amount">
              Monto ({selectedCurrency === "VES" ? "Bs.D" : selectedCurrency === "USD" ? "USD" : "EUR"})
            </Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              {...(isForeign ? {} : { max: maxAmount })}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-[tabular-nums]"
            />
            {/* H-003 follow-up: en divisa se muestra el equivalente en Bs.D (el servidor lo recalcula) */}
            {isForeign && (
              <p className="text-muted-foreground text-xs">
                {bcvLoading
                  ? "Cargando tasa BCV..."
                  : bcvRate
                    ? `Equivalente: Bs. ${vesEquivalent.toLocaleString("es-VE", { minimumFractionDigits: 2 })} (tasa BCV ${bcvRate.toLocaleString("es-VE", { minimumFractionDigits: 2 })})`
                    : "Sin tasa BCV registrada — regístrela antes de cobrar en divisa."}
              </p>
            )}
            {vesEquivalent > maxAmount && (
              <p className="text-destructive text-xs">
                {isForeign
                  ? "El equivalente en Bs.D excede el saldo pendiente"
                  : "El monto excede el saldo pendiente"}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="method">Medio de pago</Label>
            <Select value={method} onValueChange={handleMethodChange}>
              <SelectTrigger id="method">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {currencyAllowed && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-700">Moneda</label>
              <Select
                value={selectedCurrency}
                onValueChange={(v) => setSelectedCurrency(v as "VES" | "USD" | "EUR")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VES">Bs.D (VES)</SelectItem>
                  <SelectItem value="USD">$ USD</SelectItem>
                  <SelectItem value="EUR">€ EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="date">Fecha del pago</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bank-account">Cuenta bancaria (opcional — asiento automático si hay cuentas GL configuradas)</Label>
            <Select value={bankAccountId || "none"} onValueChange={(v) => setBankAccountId(v === "none" ? "" : v)}>
              <SelectTrigger id="bank-account">
                <SelectValue placeholder="Sin asiento contable" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asiento contable</SelectItem>
                {bankAccounts.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} — {b.bankName} ({b.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="reference">Referencia (opcional)</Label>
            <Input
              id="reference"
              placeholder="Nro. de referencia, confirmación..."
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Input
              id="notes"
              placeholder="Observaciones..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {igtfPreview && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3% (pago en {selectedCurrency}) — se aplicará automáticamente:
              <span className="ml-1 font-mono font-semibold">Bs.D {Number(igtfPreview).toLocaleString("es-VE", { minimumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isAmountValid} aria-busy={isPending}>
            {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Registrando..." : "Confirmar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
