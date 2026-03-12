// src/app/(dashboard)/company/[companyId]/upgrade/page.tsx
import Link from "next/link";
import { ChevronLeftIcon, ScanIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function UpgradePage({ params }: Props) {
  const { companyId } = await params;

  return (
    <div className="mx-auto max-w-lg py-12">
      <Link
        href={`/company/${companyId}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Dashboard
      </Link>

      <div className="overflow-hidden rounded-lg border bg-white">
        {/* Header */}
        <div className="bg-linear-to-r from-blue-600 to-blue-500 px-6 py-8 text-center text-white">
          <SparklesIcon className="mx-auto mb-3 h-10 w-10" />
          <h1 className="text-2xl font-bold">ContaFlow Pro</h1>
          <p className="mt-1 text-sm text-blue-100">
            Desbloquea funcionalidades avanzadas para tu empresa
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3 px-6 py-6">
          <p className="mb-4 text-sm font-semibold text-zinc-700">¿Qué incluye el plan Pro?</p>

          {[
            "OCR de facturas con inteligencia artificial",
            "Extracción automática de datos (RIF, monto, IVA)",
            "Soporte para facturas venezolanas y en divisas",
            "Detección de método de pago (Pago Móvil, Zelle, Cashea)",
            "Procesamiento ilimitado de facturas",
            "Soporte prioritario",
          ].map((feature) => (
            <div key={feature} className="flex items-start gap-3">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <span className="text-sm text-zinc-600">{feature}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="border-t bg-zinc-50 px-6 py-5 text-center">
          <p className="mb-4 text-sm text-zinc-500">
            Contacta con nosotros para activar el plan Pro en tu empresa
          </p>
          <Button className="w-full gap-2" asChild>
            <a href="mailto:contacto@contaflow.app">
              <ScanIcon className="h-4 w-4" />
              Solicitar Plan Pro
            </a>
          </Button>
          <p className="mt-3 text-xs text-zinc-400">Te responderemos en menos de 24 horas</p>
        </div>
      </div>
    </div>
  );
}
