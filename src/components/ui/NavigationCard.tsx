// src/components/ui/NavigationCard.tsx
// Tarjeta de navegación con estado de carga por elemento.
//
// • Ctrl / Cmd / Shift + clic → comportamiento nativo del <Link> (nueva pestaña, etc.)
// • Clic normal → llama navigate() de PageTransitionProvider:
//     1. Muestra el PageTransitionBar (barra azul superior)
//     2. Superpone un spinner sobre la tarjeta que se pulsó
// • Cuando la navegación finaliza el componente se desmonta, isNavigating se descarta.

"use client";

import Link from "next/link";
import { useState } from "react";
import { usePageTransition } from "@/components/layout/PageTransitionProvider";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  className?: string;
  children: React.ReactNode;
};

export function NavigationCard({ href, className, children }: Props) {
  const { navigate } = usePageTransition();
  const [isNavigating, setIsNavigating] = useState(false);

  return (
    <Link
      href={href}
      className={cn("relative block", className)}
      onClick={(e) => {
        // Ctrl / Cmd / Shift + clic: dejar que el navegador maneje (nueva pestaña, etc.)
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        if (!isNavigating) {
          setIsNavigating(true);
          navigate(href);
        }
      }}
    >
      {children}

      {/* Spinner overlay mientras carga esta tarjeta específica */}
      {isNavigating && (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-white/70 dark:bg-zinc-950/70"
        >
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </span>
      )}
    </Link>
  );
}
