"use client";

// src/components/onboarding/SetupWizardTrigger.tsx
// Wrapper que combina SetupWizard + botón "Reabrir guía de configuración"
// Usado en el dashboard para renderizar el wizard y su trigger al mismo tiempo.

import { useState } from "react";
import { LifeBuoyIcon } from "lucide-react";
import { SetupWizard } from "./SetupWizard";

interface Props {
  companyId:   string;
  companyName: string;
  companyRif:  string | null;
  hasAccounts: boolean;
  hasPeriod:   boolean;
}

export function SetupWizardTrigger(props: Props) {
  const [forceOpen, setForceOpen] = useState(false);

  return (
    <>
      {/* Botón siempre visible en el dashboard para reabrir la guía */}
      <button
        onClick={() => setForceOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none"
        title="Abrir guía de configuración inicial"
      >
        <LifeBuoyIcon className="h-3.5 w-3.5" />
        Guía de configuración
      </button>

      <SetupWizard
        {...props}
        forceOpen={forceOpen}
        onClose={() => setForceOpen(false)}
      />
    </>
  );
}
