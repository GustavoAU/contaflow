// src/app/employee/[token]/layout.tsx
// Portal del Empleado — layout mínimo sin Clerk ni sidebar.
// Ruta pública protegida por JWT en el token de la URL.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal del Empleado — ContaFlow",
  description: "Consulta tu información laboral: recibos de pago, vacaciones y préstamos.",
  robots: { index: false, follow: false }, // no indexar portales personales
};

export default function EmployeePortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="border-b bg-white px-4 py-3 shadow-sm">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="text-lg font-bold text-blue-600">ContaFlow</span>
            <span className="text-xs text-gray-400">Portal del Empleado</span>
          </div>
        </header>
        <main id="portal-main" className="mx-auto max-w-3xl px-4 py-8">
          {children}
        </main>
        <footer className="mt-12 border-t bg-white px-4 py-4 text-center text-xs text-gray-400">
          Este portal es de solo lectura. Los datos son provistos por tu empleador.
        </footer>
      </body>
    </html>
  );
}
