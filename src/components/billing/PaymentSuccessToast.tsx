// src/components/billing/PaymentSuccessToast.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Props = {
  payment?: string;
};

export function PaymentSuccessToast({ payment }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (payment === "success") {
      toast.success(
        "¡Pago recibido! Tu suscripción se activará en breve al confirmar la red.",
        { duration: 8000 },
      );
      router.replace(window.location.pathname);
    }
    if (payment === "cancelled") {
      toast.info("Pago cancelado. Puedes intentarlo de nuevo cuando quieras.");
      router.replace(window.location.pathname);
    }
  }, [payment, router]);

  return null;
}
