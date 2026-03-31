"use client";

import { useState, useTransition } from "react";
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
import type { ReceivableRow } from "../services/ReceivableService";

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
        date: new Date(date + "T12:00:00"),
        createdBy: "",
        idempotencyKey: crypto.randomUUID(),
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
  const isAmountValid = enteredAmount > 0 && enteredAmount <= maxAmount;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
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
              max={maxAmount}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-[tabular-nums]"
            />
            {enteredAmount > maxAmount && (
              <p className="text-destructive text-xs">El monto excede el saldo pendiente</p>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !isAmountValid}>
            {isPending ? "Registrando..." : "Confirmar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
