"use client";

import { useEffect, useState, startTransition } from "react";
import { Loader2 } from "lucide-react";
import { usePageTransition } from "./PageTransitionProvider";

// §4 ui-patterns: Level 2 (300ms–1s) → barra; Level 3 (>1s) → overlay
export function PageTransitionBar() {
  const { isPending } = usePageTransition();
  const [showBar, setShowBar] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    if (!isPending) {
      startTransition(() => {
        setShowBar(false);
        setShowOverlay(false);
      });
      return;
    }
    const barTimer = setTimeout(() => setShowBar(true), 300);
    const overlayTimer = setTimeout(() => setShowOverlay(true), 1000);
    return () => {
      clearTimeout(barTimer);
      clearTimeout(overlayTimer);
    };
  }, [isPending]);

  if (!showBar && !showOverlay) return null;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-50 h-1 bg-primary animate-pulse"
        role="progressbar"
        aria-label="Cargando página"
        aria-busy="true"
      />
      {showOverlay && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
            <p
              className="text-sm text-zinc-700 dark:text-zinc-300"
              role="status"
              aria-live="polite"
            >
              Cargando…
            </p>
          </div>
        </div>
      )}
    </>
  );
}
