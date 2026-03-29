// @vitest-environment jsdom
// src/components/onboarding/OnboardingWizard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingWizard } from "./OnboardingWizard";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("OnboardingWizard", () => {
  it("muestra el paso 1 al abrir", () => {
    render(<OnboardingWizard companyId="company-1" companyName="Empresa Test" />);
    expect(screen.getByText("¡Bienvenido a ContaFlow!")).toBeTruthy();
    expect(screen.getByText("Configura tu Plan de Cuentas")).toBeTruthy();
  });

  it("avanza al paso 2 al hacer click en Siguiente", () => {
    render(<OnboardingWizard companyId="company-1" companyName="Empresa Test" />);
    fireEvent.click(screen.getByText("Siguiente"));
    expect(screen.getByText("Abre tu primer período contable")).toBeTruthy();
  });

  it("avanza al paso 3 y muestra botón final", () => {
    render(<OnboardingWizard companyId="company-1" companyName="Empresa Test" />);
    fireEvent.click(screen.getByText("Siguiente"));
    fireEvent.click(screen.getByText("Siguiente"));
    expect(screen.getByText("Registra tu primer asiento")).toBeTruthy();
    expect(screen.getByText("Nuevo Asiento")).toBeTruthy();
  });

  it("muestra el nombre de la empresa", () => {
    render(<OnboardingWizard companyId="company-1" companyName="Mi Empresa C.A." />);
    expect(screen.getByText(/Mi Empresa C.A./)).toBeTruthy();
  });
});