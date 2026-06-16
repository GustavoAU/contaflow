"use client";

// Enlace de cerrar sesión para la landing (nav + footer) cuando hay sesión activa.
import { SignOutButton } from "@clerk/nextjs";

type Props = {
  className?: string;
  label?: string;
};

// Estilo "link plano" cuando no se pasa className (uso en footer).
const plainLinkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

export function SignOutLink({ className, label = "Cerrar sesión" }: Props) {
  return (
    <SignOutButton redirectUrl="/">
      <button
        type="button"
        className={className}
        style={className ? undefined : plainLinkStyle}
      >
        {label}
      </button>
    </SignOutButton>
  );
}
