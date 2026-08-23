"use client";

// src/components/ui/MoneyRateTooltip.tsx
// Frontera de cliente para el tooltip de tasa de MoneyBadge (punto 7 del
// handoff de UI).
//
// Vive aparte a propósito. MoneyBadge no lleva "use client": se renderiza en el
// servidor dentro de tablas que pueden tener 40 filas × 3 celdas de dinero. Si
// el tooltip de Radix viviera dentro de MoneyBadge, esas 120 celdas montarían
// un Root + Provider cada una. Así solo pagan ese coste las celdas que de
// verdad traen tasa de cambio.

import * as React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type Props = {
  content: React.ReactNode;
  /** Borde de la celda al que se ancla — el mismo `align` de MoneyBadge. */
  align?: "left" | "right";
  children: React.ReactNode;
};

export function MoneyRateTooltip({ content, align = "right", children }: Props) {
  return (
    <Tooltip>
      {/* El trigger NO es focusable a propósito: son decenas por tabla y
          arruinarían el orden de tabulación. No se pierde información — el
          equivalente ya se muestra como segunda línea, siempre visible; el
          tooltip solo añade fuente y fecha de la tasa. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" align={align === "right" ? "end" : "start"}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
