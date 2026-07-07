// @vitest-environment jsdom
// Smoke tests del refactor RHF de PaymentForm (rama refactor/forms-payment-rhf).
// Red de seguridad del comportamiento actual — en especial H6 (ADR-032):
// la idempotencyKey vive FUERA de RHF, es ESTABLE entre reintentos fallidos
// y rota SOLO tras un éxito. Si un refactor futuro la mete en el form state
// (reset() la tocaría) o la regenera por render, estos tests deben caer en rojo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PaymentForm } from "../components/PaymentForm";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// genIdempotencyKey determinista: "key-1", "key-2", ... por test (reset en beforeEach).
// El contador vive en vi.hoisted para ser accesible dentro de la factory de vi.mock.
const idemCounter = vi.hoisted(() => ({ n: 0 }));

vi.mock("../utils/idempotency", () => ({
  genIdempotencyKey: () => {
    idemCounter.n += 1;
    return `key-${idemCounter.n}`;
  },
}));

vi.mock("../actions/payment.actions", () => ({
  createPaymentAction: vi.fn(),
  listBankAccountsAction: vi.fn(),
}));

vi.mock("@/modules/exchange-rates/actions/exchange-rate.actions", () => ({
  getLatestRateAction: vi.fn(),
}));

import { createPaymentAction, listBankAccountsAction } from "../actions/payment.actions";
import { getLatestRateAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  companyId: "company-1",
  userId: "user-1",
};

// Misma computación que makeDefaultValues() del componente.
function today(): string {
  return new Date().toISOString().split("T")[0];
}

function submitBtn(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Registrar pago|Guardando/ }) as HTMLButtonElement;
}

// Selects en PAGOMOVIL (sin cuentas bancarias): [0]=método, [1]=banco origen, [2]=banco destino
function methodSelect(): HTMLSelectElement {
  return screen.getAllByRole("combobox")[0] as HTMLSelectElement;
}

// Llena TODOS los campos de PagoMóvil (método por defecto). Los labels no usan
// htmlFor → seleccionamos por placeholder (único por campo en esta vista:
// el único input "0.00" visible es amountVes; ivaRetentionAmount solo aparece
// con bankAccountId seleccionado y aquí mockeamos 0 cuentas).
function fillPagomovil(amount = "1500.00") {
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: amount } });
  fireEvent.change(screen.getByPlaceholderText("REF-12345678"), { target: { value: "REF-001" } });
  fireEvent.change(screen.getByPlaceholderText("0414-1234567"), { target: { value: "0414-1234567" } });
  fireEvent.change(screen.getByPlaceholderText("0424-7654321"), { target: { value: "0424-7654321" } });
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[1], { target: { value: "Banco Mercantil" } }); // banco origen
  fireEvent.change(selects[2], { target: { value: "Banesco" } }); // banco destino
  fireEvent.change(screen.getByPlaceholderText(/Pago factura proveedor/), {
    target: { value: "Pago factura mayo 2026" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  idemCounter.n = 0;
  vi.mocked(listBankAccountsAction).mockResolvedValue({ success: true, data: [] } as never);
  vi.mocked(getLatestRateAction).mockResolvedValue({ success: true, data: null } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PaymentForm — smoke del refactor RHF (H6 + payloads por método)", () => {
  it("H6: la idempotencyKey es LA MISMA en dos reintentos tras fallo (no rota sin éxito)", async () => {
    vi.mocked(createPaymentAction).mockResolvedValue({
      success: false,
      error: "Error transitorio — intenta de nuevo.",
    } as never);

    render(<PaymentForm {...BASE_PROPS} />);
    fillPagomovil();

    // Primer intento → falla
    fireEvent.click(submitBtn());
    expect(await screen.findByText("Error transitorio — intenta de nuevo.")).toBeTruthy();

    // Reintento del MISMO pago (los campos siguen llenos — no hubo reset)
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createPaymentAction).toHaveBeenCalledTimes(2));

    const calls = vi.mocked(createPaymentAction).mock.calls;
    // LA regresión H6: retry con la misma key → el servidor deduplica (ADR-032)
    expect(calls[0][0].idempotencyKey).toBe("key-1");
    expect(calls[1][0].idempotencyKey).toBe("key-1");
  });

  it("H6: tras un submit exitoso la key ROTA — el siguiente pago lleva key-2", async () => {
    vi.mocked(createPaymentAction).mockResolvedValue({ success: true, data: {} } as never);

    render(<PaymentForm {...BASE_PROPS} />);
    fillPagomovil();
    fireEvent.click(submitBtn());
    expect(await screen.findByText("Pago registrado correctamente.")).toBeTruthy();

    // Segundo pago = operación nueva → resetForm rotó la key
    fillPagomovil("2000.00");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(createPaymentAction).toHaveBeenCalledTimes(2));

    const calls = vi.mocked(createPaymentAction).mock.calls;
    expect(calls[0][0].idempotencyKey).toBe("key-1");
    expect(calls[1][0].idempotencyKey).toBe("key-2");
  });

  it("PAGOMOVIL: payload exacto — referencia, teléfonos, bancos, currency VES", async () => {
    vi.mocked(createPaymentAction).mockResolvedValue({ success: true, data: {} } as never);

    render(<PaymentForm {...BASE_PROPS} />);
    fillPagomovil();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(createPaymentAction).toHaveBeenCalledTimes(1));
    expect(createPaymentAction).toHaveBeenCalledWith({
      companyId: "company-1",
      method: "PAGOMOVIL",
      amountVes: "1500.00",
      currency: "VES",
      date: today(),
      notes: "Pago factura mayo 2026",
      createdBy: "user-1",
      idempotencyKey: "key-1",
      referenceNumber: "REF-001",
      originBank: "Banco Mercantil",
      destBank: "Banesco",
      senderPhone: "0414-1234567",
      destPhone: "0424-7654321",
      // Sin bankAccountId (0 cuentas), sin ivaRetentionAmount, sin amountOriginal,
      // sin commissionPct/commissionAmount — campos condicionales de OTROS métodos
      // no deben filtrarse al payload de PagoMóvil.
    });
  });

  it("cambiar de método limpia los campos condicionales (clearMethodFields, #9)", () => {
    render(<PaymentForm {...BASE_PROPS} />);

    fireEvent.change(screen.getByPlaceholderText("REF-12345678"), { target: { value: "REF-999" } });
    expect((screen.getByPlaceholderText("REF-12345678") as HTMLInputElement).value).toBe("REF-999");

    // PAGOMOVIL → EFECTIVO → PAGOMOVIL
    fireEvent.change(methodSelect(), { target: { value: "EFECTIVO" } });
    expect(screen.queryByPlaceholderText("REF-12345678")).toBeNull();
    fireEvent.change(methodSelect(), { target: { value: "PAGOMOVIL" } });

    expect((screen.getByPlaceholderText("REF-12345678") as HTMLInputElement).value).toBe("");
  });

  it("ZELLE: auto-calcula VES = USD × tasa BCV en el campo readOnly y el payload lleva amountOriginal + currency USD", async () => {
    vi.mocked(getLatestRateAction).mockResolvedValue({
      success: true,
      data: { rate: "600" },
    } as never);
    vi.mocked(createPaymentAction).mockResolvedValue({ success: true, data: {} } as never);

    render(<PaymentForm {...BASE_PROPS} />);
    fireEvent.change(methodSelect(), { target: { value: "ZELLE" } });

    // Espera la tasa BCV cargada (fetch async del useEffect)
    await screen.findByText(/Tasa BCV:/);
    expect(getLatestRateAction).toHaveBeenCalledWith("company-1", "USD");

    // En Zelle hay dos inputs "0.00": [0]=Monto USD (editable), [1]=Equivalente VES (readOnly)
    const [usdInput, vesInput] = screen.getAllByPlaceholderText("0.00") as HTMLInputElement[];
    expect(vesInput.readOnly).toBe(true);
    expect(usdInput.readOnly).toBe(false);

    fireEvent.change(usdInput, { target: { value: "50" } });
    // H-003: 50 × 600 = 30000.00 auto-calculado (el servidor lo recalcula al guardar)
    await waitFor(() => expect(vesInput.value).toBe("30000.00"));

    fireEvent.change(screen.getByPlaceholderText(/Pago factura proveedor/), {
      target: { value: "Cobro Zelle" },
    });
    fireEvent.click(submitBtn());

    await waitFor(() => expect(createPaymentAction).toHaveBeenCalledTimes(1));
    expect(createPaymentAction).toHaveBeenCalledWith({
      companyId: "company-1",
      method: "ZELLE",
      amountVes: "30000.00",
      amountOriginal: "50",
      currency: "USD",
      date: today(),
      notes: "Cobro Zelle",
      createdBy: "user-1",
      idempotencyKey: "key-1",
    });
  });

  it("monto vacío → banner 'El monto debe ser mayor a Bs.D 0,00' y la action NO se llama", async () => {
    render(<PaymentForm {...BASE_PROPS} />);

    // Todo lleno MENOS el monto (amountVes no tiene `required` nativo en PagoMóvil)
    fillPagomovil();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "" } });
    fireEvent.click(submitBtn());

    expect(await screen.findByText("El monto debe ser mayor a Bs.D 0,00")).toBeTruthy();
    expect(createPaymentAction).not.toHaveBeenCalled();
  });

  it("monto 0 → mismo banner y action NO llamada", async () => {
    render(<PaymentForm {...BASE_PROPS} />);

    fillPagomovil("0");
    // fireEvent.submit directo: el guard client-side debe atrapar el 0 aunque
    // la validación nativa (min=0.01) no corra
    fireEvent.submit(submitBtn().closest("form") as HTMLFormElement);

    expect(await screen.findByText("El monto debe ser mayor a Bs.D 0,00")).toBeTruthy();
    expect(createPaymentAction).not.toHaveBeenCalled();
  });

  it("success → resetForm (campos vacíos, método vuelve a PAGOMOVIL) + onSuccess llamado", async () => {
    vi.mocked(createPaymentAction).mockResolvedValue({ success: true, data: {} } as never);
    const onSuccess = vi.fn();

    render(<PaymentForm {...BASE_PROPS} onSuccess={onSuccess} />);
    // Cambiamos de método para verificar que reset() lo devuelve al default
    fireEvent.change(methodSelect(), { target: { value: "TRANSFERENCIA" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "500.00" } });
    fireEvent.change(screen.getByPlaceholderText("REF-00123456"), { target: { value: "REF-T-1" } });
    fireEvent.change(screen.getByPlaceholderText(/Pago factura proveedor/), {
      target: { value: "Transferencia prueba" },
    });
    fireEvent.click(submitBtn());

    expect(await screen.findByText("Pago registrado correctamente.")).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // reset(makeDefaultValues()): método de vuelta a PAGOMOVIL y campos limpios
    expect(methodSelect().value).toBe("PAGOMOVIL");
    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("");
    expect((screen.getByPlaceholderText("REF-12345678") as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByPlaceholderText(/Pago factura proveedor/) as HTMLInputElement).value
    ).toBe("");
  });

  it("guard doble-submit: disabled={isPending} + aria-busy mientras la action está en vuelo", async () => {
    // Promise controlada: la action queda "en vuelo" hasta que la resolvamos
    let resolvePayment!: (v: unknown) => void;
    vi.mocked(createPaymentAction).mockReturnValue(
      new Promise((res) => {
        resolvePayment = res;
      }) as never
    );

    render(<PaymentForm {...BASE_PROPS} />);

    // Idle: habilitado, sin aria-busy activo
    expect(submitBtn().disabled).toBe(false);
    expect(submitBtn().getAttribute("aria-busy")).toBe("false");

    fillPagomovil();
    fireEvent.click(submitBtn());

    // Pendiente: deshabilitado + aria-busy + label "Guardando..."
    await waitFor(() => {
      const btn = submitBtn();
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("aria-busy")).toBe("true");
      expect(btn.textContent).toContain("Guardando...");
    });

    resolvePayment({ success: true, data: {} });
    await waitFor(() => {
      const btn = submitBtn();
      expect(btn.disabled).toBe(false);
      expect(btn.getAttribute("aria-busy")).toBe("false");
    });
  });
});
