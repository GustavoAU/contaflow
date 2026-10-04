// @vitest-environment jsdom

// src/components/ui/money-field.test.tsx
// El adaptador RHF debe dejar en el formulario el valor canónico, no el texto con separadores.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";

import { MoneyField } from "./money-field";

afterEach(cleanup);

type V = { amount: string };

function Harness({ initial = "" }: { initial?: string }) {
  const { control, watch } = useForm<V>({ defaultValues: { amount: initial } });
  return (
    <>
      <MoneyField control={control} name="amount" aria-label="monto" />
      <output data-testid="canon">{watch("amount")}</output>
    </>
  );
}

describe("MoneyField", () => {
  it("guarda el valor canónico en el formulario", () => {
    render(<Harness />);
    const el = screen.getByLabelText("monto") as HTMLInputElement;
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "1.234,56" } });
    expect(screen.getByTestId("canon").textContent).toBe("1234.56");
    fireEvent.blur(el);
    expect(el.value).toBe("1.234,56");
  });

  it("muestra con separadores el valor inicial del formulario", () => {
    render(<Harness initial="20000.5" />);
    expect((screen.getByLabelText("monto") as HTMLInputElement).value).toBe("20.000,50");
  });
});
