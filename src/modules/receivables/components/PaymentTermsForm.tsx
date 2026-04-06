"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePaymentTermsAction } from "../actions/receivable.actions";

type Props = {
  companyId: string;
  currentPaymentTermDays: number;
};

export function PaymentTermsForm({ companyId, currentPaymentTermDays }: Props) {
  const [days, setDays] = useState(String(currentPaymentTermDays));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const parsed = parseInt(days, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 365) {
      toast.error("El plazo debe ser entre 1 y 365 días");
      return;
    }

    startTransition(async () => {
      const result = await updatePaymentTermsAction({
        companyId,
        paymentTermDays: parsed,
      });

      if (result.success) {
        toast.success(`Plazo de pago actualizado: ${result.data.paymentTermDays} días`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const isChanged = parseInt(days, 10) !== currentPaymentTermDays;

  return (
    <div className="flex items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="paymentTermDays">Plazo de pago (días)</Label>
        <Input
          id="paymentTermDays"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-32"
        />
        <p className="text-muted-foreground text-xs">
          Las nuevas facturas tendrán vencimiento = fecha + {days || "?"} días
        </p>
      </div>
      <Button
        onClick={handleSave}
        disabled={isPending || !isChanged}
        variant="outline"
        size="sm"
      >
        {isPending ? "Guardando..." : "Guardar"}
      </Button>
    </div>
  );
}
