// src/components/ui/SubmitButton.tsx
// Botón de submit con guard anti-doble-submit (DECISIONS.md — Neon cold start).
//
// Uso:
//   <SubmitButton isPending={isPending} label="Guardar" pendingLabel="Guardando…" />
//
// Equivalente a:
//   <button type="submit" disabled={isPending} aria-busy={isPending}>
//     {isPending ? pendingLabel : label}
//   </button>
//
// Por qué: cold start de Neon puede demorar 200–800ms en el primer submit.
// Sin disabled el usuario hace doble-click y crea dos documentos fiscales
// (factura duplicada, asiento duplicado, etc.).

import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "./button";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

interface SubmitButtonProps extends VariantProps<typeof buttonVariants> {
  isPending: boolean;
  label: string;
  pendingLabel?: string;
  className?: string;
  /** Keyboard shortcut hint rendered inside the button, e.g. "Ctrl+↵" */
  kbdHint?: string;
}

/**
 * Botón de submit con patrón anti-doble-submit.
 *
 * - `disabled={isPending}` previene el segundo click
 * - `aria-busy={isPending}` anuncia el estado a lectores de pantalla
 * - Muestra spinner + texto alternativo mientras está pendiente
 */
export function SubmitButton({
  isPending,
  label,
  pendingLabel,
  className,
  variant = "default",
  size = "default",
  kbdHint,
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={isPending}
      aria-busy={isPending}
      kbdHint={!isPending ? kbdHint : undefined}
      className={cn(className)}
    >
      {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
      {isPending ? (pendingLabel ?? `${label}…`) : label}
    </Button>
  );
}
