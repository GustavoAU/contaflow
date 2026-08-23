"use client";

// src/components/onboarding/SetupWizardTrigger.tsx
// Wrapper que combina SetupWizard + botón "Reabrir guía de configuración"
// Usado en el dashboard para renderizar el wizard y su trigger al mismo tiempo.

import { useState } from "react";
import { LifeBuoyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      {/* Botón siempre visible en el dashboard para reabrir la guía.
          Era un <button> crudo con px-3 py-1.5 text-xs (~h-7) al lado de dos
          <Button> de h-9: 8px mas bajo, con su propio anillo de foco y el icono
          a 14px en vez de 16. Accion secundaria en cabecera = outline + h-9. */}
      <Button
        variant="outline"
        onClick={() => setForceOpen(true)}
        title="Abrir guía de configuración inicial"
      >
        <LifeBuoyIcon />
        Guía de configuración
      </Button>

      <SetupWizard
        {...props}
        forceOpen={forceOpen}
        onClose={() => setForceOpen(false)}
      />
    </>
  );
}
