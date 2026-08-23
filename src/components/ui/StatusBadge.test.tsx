// @vitest-environment jsdom

// src/components/ui/StatusBadge.test.tsx
// Punto 3 del handoff de UI: StatusBadge es el UNICO sistema de badge de estado.
// Estos tests fijan el contrato que hace que eso sea seguro — sobre todo el
// fallback, que es silencioso: un estado sin entrada en el mapa no rompe nada,
// solo renderiza "—" en produccion.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge — estados que faltaban (punto 4)", () => {
  // Un prestamo liquidado caia al FALLBACK y el usuario veia un guion.
  it.each([
    ["LIQUIDATED", "Liquidado"],
    ["OVERDUE", "En mora"],
    ["POSTED", "Contabilizado"],
    ["OPEN", "Abierto"],
    ["CLOSED", "Cerrado"],
  ])("%s renderiza «%s», no el fallback", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });
});

describe("StatusBadge — claves que eran clones", () => {
  it("UNPAID y PENDING ya no dicen lo mismo", () => {
    const { unmount } = render(<StatusBadge status="UNPAID" />);
    expect(screen.getByText("Por cobrar")).toBeTruthy();
    unmount();

    render(<StatusBadge status="PENDING" />);
    expect(screen.getByText("Pendiente")).toBeTruthy();
  });
});

describe("StatusBadge — eje de los estados terminados", () => {
  // Rojo = lo anulo una persona. Gris = termino sin efecto por si solo.
  it.each(["CANCELLED", "VOIDED", "REJECTED"])("%s es rojo (accion de una persona)", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(container.innerHTML).toContain("red");
  });

  it.each(["DRAFT", "INACTIVE", "CLOSED"])("%s es gris (termino solo)", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(container.innerHTML).toContain("zinc");
  });
});

describe("StatusBadge — contrato base", () => {
  it("un estado desconocido muestra el valor crudo, no un guion mudo", () => {
    render(<StatusBadge status="ESTADO_INVENTADO" />);
    expect(screen.getByText("ESTADO_INVENTADO")).toBeTruthy();
  });

  it("variant=pill omite el punto de color", () => {
    const { container: conDot } = render(<StatusBadge status="ACTIVE" />);
    const { container: sinDot } = render(<StatusBadge status="ACTIVE" variant="pill" />);
    expect(conDot.querySelectorAll("span[aria-hidden]").length).toBe(1);
    expect(sinDot.querySelectorAll("span[aria-hidden]").length).toBe(0);
  });

  it("compone Badge — hereda su base en vez de repetirla", () => {
    const { container } = render(<StatusBadge status="ACTIVE" />);
    expect(container.querySelector('[data-slot="badge"]')).toBeTruthy();
  });

  it("el color del estado gana sobre el del variant de Badge", () => {
    const { container } = render(<StatusBadge status="PAID" />);
    const el = container.querySelector('[data-slot="badge"]')!;
    expect(el.className).toContain("text-emerald-800");
    // "outline" aporta text-foreground; tailwind-merge debe descartarlo
    expect(el.className).not.toContain("text-foreground");
  });
});
