"use client";

// src/components/ui/tooltip.tsx
// Punto 7 del handoff de UI. Los tooltips posicionados con `absolute` dentro de
// una tabla se recortan: table.tsx envuelve toda tabla en
// `<div className="relative w-full overflow-x-auto">`, y ese overflow corta
// también por arriba. En la primera fila de cualquier tabla, un tooltip que
// abre hacia arriba queda cortado.
//
// Radix lo resuelve con portal: el contenido se renderiza al final del <body>,
// fuera de cualquier contenedor con overflow, y se reposiciona solo si no cabe.

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function TooltipProvider({
  delayDuration = 120,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * Provider incluido: Radix exige uno como ancestro, y montar uno por tooltip es
 * más barato que obligar a cada página a envolver su árbol. Si algún día hay un
 * provider global, este se anida sin romper nada.
 */
function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-max max-w-70 rounded-lg bg-zinc-900 px-3 py-2 text-11 leading-snug text-white shadow-xl",
          "animate-in fade-in-0 zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
