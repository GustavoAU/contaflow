"use client";

import Link from "next/link";
import { HomeIcon, ChevronLeftIcon } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md text-center">
        {/* Logo */}
        <div className="mb-6 flex justify-center">
          <span className="text-2xl font-bold tracking-tight text-zinc-900">
            Conta<span className="text-blue-600">Flow</span>
          </span>
        </div>

        {/* Error code */}
        <p className="text-8xl font-extrabold text-zinc-200 select-none">404</p>

        {/* Message */}
        <h1 className="mt-2 text-xl font-semibold text-zinc-900">
          Página no encontrada
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          La página que buscas no existe o fue movida.
          Si llegaste aquí desde un enlace, por favor repórtalo.
        </p>

        {/* Actions */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <HomeIcon className="h-4 w-4" />
            Ir al Inicio
          </Link>
          <button
            type="button"
            onClick={() => history.back()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
