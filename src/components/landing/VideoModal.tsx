"use client";

import { useState } from "react";
import { PlayCircleIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function VideoModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group relative w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-xl aspect-video flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
        aria-label="Ver demo en video"
      >
        {/* Placeholder screenshot */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-muted flex items-center justify-center">
          <div className="text-center space-y-2 text-muted-foreground">
            <div className="text-5xl font-bold tracking-tight text-primary/30">ContaFlow</div>
            <p className="text-sm">Sistema Contable Venezolano</p>
          </div>
        </div>

        {/* Play button */}
        <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-background/90 shadow-lg ring-2 ring-primary/20 group-hover:ring-primary/50 transition-all group-hover:scale-105">
          <PlayCircleIcon className="h-12 w-12 text-primary fill-primary/20" />
        </div>

        {/* Caption */}
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <span className="rounded-full bg-background/80 px-3 py-1 text-xs font-medium backdrop-blur-sm">
            Ver demo — 3 min
          </span>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          <div className="aspect-video bg-black flex items-center justify-center">
            {/* Replace with actual YouTube/Vimeo embed URL */}
            <div className="text-center text-white/60 space-y-2 p-8">
              <PlayCircleIcon className="h-16 w-16 mx-auto opacity-30" />
              <p className="text-lg font-medium">Video demo próximamente</p>
              <p className="text-sm opacity-60">Mientras tanto, crea tu cuenta gratis y explora la app.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
