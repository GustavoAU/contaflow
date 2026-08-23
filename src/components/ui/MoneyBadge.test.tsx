// @vitest-environment jsdom

// src/components/ui/MoneyBadge.test.tsx
// Punto 7 del handoff de UI. MoneyBadge no tenía tests y acaba de cambiar de
// tooltip CSS a Radix en portal. Lo que hay que fijar no es el tooltip en sí
// —eso depende del hover— sino las dos propiedades que lo hacen seguro:
//
//   1. Sin tasa de cambio NO se cruza la frontera de cliente. Es lo que evita
//      que una tabla de 40 filas monte 120 Roots de Radix.
//   2. El equivalente en la otra moneda se ve SIN hover. El tooltip solo añade
//      fuente y fecha, así que su trigger puede quedarse fuera del orden de
//      tabulación sin esconder información.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyBadge } from "./MoneyBadge";

const RATE = {
  foreignCurrency: "USD",
  rate: "732.480000",
  date: "2026-08-23",
  source: "BCV",
};

describe("MoneyBadge — frontera de cliente", () => {
  it("sin exchangeRate no monta el tooltip", () => {
    const { container } = render(<MoneyBadge amount="1200.00" currency="USD" />);
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it("con exchangeRate sí lo monta", () => {
    const { container } = render(
      <MoneyBadge amount="1200.00" currency="USD" exchangeRate={RATE} />
    );
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeTruthy();
  });
});

describe("MoneyBadge — información visible sin hover", () => {
  it("muestra el equivalente como segunda línea", () => {
    render(<MoneyBadge amount="1200.00" currency="USD" exchangeRate={RATE} />);
    // 1200 USD × 732,48 = 878.976
    expect(screen.getByText(/≈ Bs\. 878\.976/)).toBeTruthy();
  });

  it("convierte en la otra dirección cuando el monto está en VES", () => {
    render(<MoneyBadge amount="732480.00" currency="VES" exchangeRate={RATE} />);
    expect(screen.getByText(/≈ \$ 1\.000/)).toBeTruthy();
  });
});

describe("MoneyBadge — formato", () => {
  it("un monto no numérico degrada a guion en vez de romper", () => {
    render(<MoneyBadge amount="no-es-un-numero" currency="USD" />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("los negativos usan el signo menos tipográfico", () => {
    render(<MoneyBadge amount="-50.00" currency="USD" />);
    expect(screen.getByText(/−/)).toBeTruthy();
  });
});
