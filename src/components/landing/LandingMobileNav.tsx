"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Menu, X, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { label: "Funcionalidades", href: "#funcionalidades" },
  { label: "Precios", href: "#precios" },
];

export function LandingMobileNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // WCAG 4.1.2: mover foco al botón de cierre al abrir; restaurar al trigger al cerrar
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => closeRef.current?.focus(), 40);
      return () => clearTimeout(t);
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 md:hidden"
        aria-label={open ? "Cerrar menú" : "Abrir menú de navegación"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* WCAG 4.1.2 (A): role=dialog + aria-modal — screen readers saben que es modal */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
          className="fixed inset-0 z-50 flex flex-col bg-background md:hidden"
        >
          {/* Header del drawer */}
          <div className="flex h-14 items-center justify-between border-b border-border/40 px-4">
            <Link
              href="/"
              className="flex items-center gap-2"
              onClick={() => setOpen(false)}
            >
              <ZapIcon className="h-5 w-5 text-primary" aria-hidden />
              <span className="text-lg font-semibold tracking-tight">ContaFlow</span>
            </Link>
            <button
              ref={closeRef}
              className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Links de navegación */}
          <nav aria-label="Menú principal" className="flex flex-col gap-1 p-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-3 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="border-t border-border/40" />

          {/* CTAs */}
          <div className="flex flex-col gap-3 p-4">
            {isAuthenticated ? (
              <Button asChild className="w-full" onClick={() => setOpen(false)}>
                <Link href="/dashboard">Ir al panel</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline" className="w-full" onClick={() => setOpen(false)}>
                  <Link href="/sign-in">Iniciar sesión</Link>
                </Button>
                <Button asChild className="w-full" onClick={() => setOpen(false)}>
                  <Link href="/sign-up">Crear cuenta gratis</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
