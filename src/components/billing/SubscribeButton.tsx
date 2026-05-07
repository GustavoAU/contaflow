// src/components/billing/SubscribeButton.tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCheckoutAction } from "@/modules/billing/actions/billing.actions";
import type { PaidPlan } from "@/modules/billing/services/BillingService";

type Props = {
  companyId: string;
  plan: PaidPlan;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "outline";
};

export function SubscribeButton({
  companyId,
  plan,
  children,
  className,
  variant = "default",
}: Props) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createCheckoutAction({
        companyId,
        plan,
        payCurrency: "usdterc20",
      });

      if (result.success) {
        window.location.href = result.data.invoiceUrl;
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      variant={variant}
      className={className}
      onClick={handleClick}
      disabled={isPending}
      aria-busy={isPending}
    >
      {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
