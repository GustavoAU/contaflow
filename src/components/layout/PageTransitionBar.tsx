"use client";

import { useEffect, useState } from "react";
import { usePageTransition } from "./PageTransitionProvider";

/**
 * Barra de progreso estilo NProgress en la parte superior de la página.
 *
 * Fases:
 *  "growing"    → aparece al instante, animación de 0 % → 85 % en 5 s
 *  "completing" → salta a 100 % en 250 ms cuando la navegación termina
 *  "fading"     → desaparece con opacidad 0 en 300 ms
 *  null         → desmontada
 */
type Phase = "growing" | "completing" | "fading";

export function PageTransitionBar() {
  const { isPending } = usePageTransition();
  const [phase, setPhase] = useState<Phase | null>(null);

  useEffect(() => {
    if (isPending) {
      // Mostrar inmediatamente — sin delay
      setPhase("growing");
      return;
    }

    // Navegación completa: completar la barra y desvanecerla
    setPhase((prev) => (prev === null ? null : "completing"));

    const t1 = setTimeout(
      () => setPhase((p) => (p === "completing" ? "fading" : p)),
      250
    );
    const t2 = setTimeout(
      () => setPhase((p) => (p === "fading" ? null : p)),
      550
    );

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isPending]);

  if (phase === null) return null;

  return (
    <div
      aria-hidden
      role="progressbar"
      aria-label="Cargando página"
      className={[
        // Base
        "pointer-events-none fixed left-0 top-0 z-9999 h-0.5 bg-blue-500",
        "shadow-progress-glow",
        // Fase growing: animación CSS de 0 % a 85 %
        phase === "growing" && "animate-[progress-grow_5s_cubic-bezier(0.05,0.8,0.5,1)_forwards]",
        // Fase completing: salto inmediato al 100 %
        phase === "completing" && "w-full! transition-[width] duration-200",
        // Fase fading: desvanece
        phase === "fading" && "w-full! opacity-0 transition-opacity duration-300",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
