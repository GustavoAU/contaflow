// @vitest-environment jsdom

// src/components/ui/money-input.test.tsx
// Caso reportado por la contadora (2026-10-03): teclear "100,99" en un asiento rompía
// con DecimalError al contabilizar. El componente debe entregar SIEMPRE el valor
// canónico ("100.99") y mostrar separadores de miles solo al salir del campo.

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

import { MoneyInput } from "./money-input";

afterEach(cleanup);

function Harness({ allowNegative }: { allowNegative?: boolean }) {
  const [v, setV] = useState("");
  return (
    <>
      <MoneyInput aria-label="monto" value={v} onValueChange={setV} allowNegative={allowNegative} />
      <output data-testid="canon">{v}</output>
    </>
  );
}

const input = () => screen.getByLabelText("monto") as HTMLInputElement;
const canon = () => screen.getByTestId("canon").textContent;

describe("MoneyInput", () => {
  it('"100,99" → valor canónico "100.99" mientras se teclea', () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "100,99" } });
    expect(canon()).toBe("100.99");
    expect(input().value).toBe("100,99");
  });

  it("al salir del campo muestra separadores de miles; al volver, el texto editable", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "20000" } });
    fireEvent.blur(input());
    expect(input().value).toBe("20.000,00");
    expect(canon()).toBe("20000");
    fireEvent.focus(input());
    expect(input().value).toBe("20000");
  });

  it("descarta letras y, sin allowNegative, el signo", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "-1a2,5" } });
    expect(canon()).toBe("12.5");
  });

  it("con allowNegative conserva el signo", () => {
    render(<Harness allowNegative />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "-1.500,25" } });
    expect(canon()).toBe("-1500.25");
    fireEvent.blur(input());
    expect(input().value).toBe("-1.500,25");
  });
});
