// @vitest-environment jsdom

// src/components/invoices/invoice-form/FormMoneyInput.test.tsx
// Las retenciones de la factura se leen con FormData(form) por `name`. El input visible
// muestra "1.234,50" pero FormData debe ver el valor canónico, y form.reset() (que
// InvoiceForm llama tras guardar) debe devolver el campo a "0".

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FormMoneyInput } from "./InvoiceRetentionsIgtfSection";

afterEach(cleanup);

function setup() {
  const { container } = render(
    <form data-testid="f">
      <FormMoneyInput name="ivaRetentionAmount" ariaLabel="IVA retenido" className="x" />
    </form>
  );
  const form = container.querySelector("form") as HTMLFormElement;
  const input = screen.getByLabelText("IVA retenido") as HTMLInputElement;
  const sent = () => new FormData(form).get("ivaRetentionAmount");
  return { form, input, sent };
}

describe("FormMoneyInput", () => {
  it('arranca en "0" y FormData lo ve', () => {
    const { sent } = setup();
    expect(sent()).toBe("0");
  });

  it("FormData recibe el valor canónico aunque se muestre con separadores", () => {
    const { input, sent } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.234,50" } });
    expect(sent()).toBe("1234.50");
    fireEvent.blur(input);
    expect(input.value).toBe("1.234,50");
  });

  it("un campo vaciado envía 0, nunca cadena vacía", () => {
    const { input, sent } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(sent()).toBe("0");
  });

  it('form.reset() devuelve el campo a "0"', () => {
    const { form, input, sent } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(sent()).toBe("500");
    act(() => form.reset());
    expect(sent()).toBe("0");
  });
});
