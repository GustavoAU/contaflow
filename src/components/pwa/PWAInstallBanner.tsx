"use client";

import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

const DISMISSED_KEY = "cf-pwa-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isRunningAsPWA() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari iOS
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PWAInstallBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isRunningAsPWA()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // iOS Safari: no hay beforeinstallprompt — mostrar instrucciones manuales
    if (isIOS()) {
      setShowIOS(true);
      setVisible(true);
      return;
    }

    function handler(e: Event) {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstall() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted") setVisible(false);
    setPromptEvent(null);
  }

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="rounded-xl border border-slate-700 bg-slate-800 shadow-2xl px-4 py-3 flex items-start gap-3">

        <div className="rounded-lg bg-slate-700 p-2 shrink-0 mt-0.5">
          {showIOS ? (
            <Share className="h-5 w-5 text-slate-300" />
          ) : (
            <Download className="h-5 w-5 text-slate-300" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">
            Instala ContaFlow
          </p>
          {showIOS ? (
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              Toca <strong className="text-slate-300">Compartir</strong> →{" "}
              <strong className="text-slate-300">Añadir a pantalla de inicio</strong>
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-0.5">
              Acceso rápido desde tu escritorio
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!showIOS && (
            <button
              onClick={handleInstall}
              className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Instalar
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="rounded-md p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

      </div>
    </div>
  );
}
