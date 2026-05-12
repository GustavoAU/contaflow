// src/app/offline/page.tsx
// Served by the service worker when navigation fails and the page isn't cached.
"use client";

import { WifiOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="max-w-sm space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-zinc-100 p-5">
            <WifiOff className="h-10 w-10 text-zinc-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-zinc-900">Sin conexión</h1>
          <p className="text-sm text-zinc-500">
            ContaFlow necesita conexión a internet para operar. Verifica tu
            conexión y vuelve a intentarlo.
          </p>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      </div>
    </div>
  );
}
