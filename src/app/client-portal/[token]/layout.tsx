// src/app/client-portal/[token]/layout.tsx
// Portal del Cliente — layout mínimo sin Clerk ni sidebar.
// Ruta pública protegida por JWT en el token de la URL.
// NOTA: No puede tener <html>/<body> propios — solo el root layout (app/layout.tsx) los tiene.
// Se usa un wrapper <div> que aplica fondo neutro y aísla el contenido del portal.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal del Cliente — ContaFlow",
  description: "Consulta tus facturas pendientes y estado de cuenta.",
  robots: { index: false, follow: false }, // no indexar portales personales
};

export default function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 antialiased">
      <header className="border-b bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="text-lg font-bold text-blue-600">ContaFlow</span>
          <span className="text-xs text-gray-400">Portal del Cliente</span>
        </div>
      </header>
      <main id="portal-main" className="mx-auto max-w-3xl px-4 py-8">
        {children}
      </main>
      <footer className="mt-12 border-t bg-white px-4 py-4 text-center text-xs text-gray-400">
        Este portal es de solo lectura. Los datos son provistos por tu proveedor de servicios.
      </footer>
    </div>
  );
}
