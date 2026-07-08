// @vitest-environment jsdom
// Smoke tests del refactor RHF de FixedAssetForm (rama refactor/forms-fixedasset-rhf).
// Red de seguridad del comportamiento actual — en especial:
//   - FC-03 / FA-5 F3: advertencia deducibilidad SENIAT (Art. 76 LISLR) cuando faltan
//     facturaNumber + providerRif, con "Continuar sin datos SENIAT" → submit del pendingInput.
//   - Paridad FormData: bcvRateAtAcquisition (N2) se limpia al volver a VES; los campos
//     legales NO-controlados (serial/internalCode/serviceStartDate) se anulan al colapsar;
//     totalUnits se limpia al cambiar de método.
//   - N4: importar-desde-gasto pre-llena campos SIN pisar lo que el usuario ya tipeó.
// Los labels no usan htmlFor → selección por placeholder/displayValue + querySelector
// para inputs type="date" (patrón PaymentForm.component.test.tsx).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FixedAssetForm } from "../components/FixedAssetForm";
import type { ExpenseForAssetImport } from "../actions/fixed-asset.actions";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../actions/fixed-asset.actions", () => ({
  createFixedAssetAction: vi.fn(),
  getExpensesForAssetImportAction: vi.fn(),
}));

import {
  createFixedAssetAction,
  getExpensesForAssetImportAction,
} from "../actions/fixed-asset.actions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Pools con ≥2 cuentas por tipo para ejercitar el scoring real de findBestMatch
// (con 1 sola cuenta hay shortcut `pool[0].id` y el default no se probaría).
const ACCOUNTS = [
  { id: "acc-ppe",      code: "1201", name: "Propiedad, Planta y Equipo", type: "ASSET" },
  { id: "acc-terreno",  code: "1202", name: "Terrenos",                   type: "ASSET" },
  { id: "acc-dep-gasto", code: "6101", name: "Gasto Depreciación",        type: "EXPENSE" },
  { id: "acc-alquiler",  code: "6102", name: "Gasto Alquiler",            type: "EXPENSE" },
  { id: "acc-dep-acum",  code: "1301", name: "Depreciación Acumulada",    type: "CONTRA_ASSET" },
  { id: "acc-contra-2",  code: "1302", name: "Provisión Otra",            type: "CONTRA_ASSET" },
  { id: "acc-banco",     code: "1101", name: "Banco Mercantil",           type: "ASSET" },
];

const BASE_PROPS = {
  companyId: "company-1",
  accounts: ACCOUNTS,
};

const EXPENSE_CONFIRMED: ExpenseForAssetImport = {
  id: "exp-1",
  concept: "Compra laptop Dell",
  amount: "1200.00",
  currency: "USD",
  invoiceNumber: "F-555",
  invoiceDate: "2026-05-10",
  vendorName: "Dell de Venezuela C.A.",
  vendorRif: "J-98765432-1",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function submitBtn(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Registrar Activo|Guardando/ }) as HTMLButtonElement;
}

// [0] = acquisitionDate (grid básico, siempre primero en el DOM);
// [1] = serviceStartDate (solo con la sección legal expandida)
function dateInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[type="date"]'));
}

function currencySelect(): HTMLSelectElement {
  // El select de moneda es el único cuyo option seleccionado empieza con el código ISO
  return screen.getByDisplayValue(/^(VES|USD|EUR) — /) as HTMLSelectElement;
}

function methodSelect(): HTMLSelectElement {
  return screen.getByDisplayValue(
    /Línea Recta|Suma de Dígitos de los Años|Unidades de Producción/
  ) as HTMLSelectElement;
}

// Llena los campos base obligatorios (el único input "0.00" es acquisitionCost;
// residualValue no tiene placeholder y conserva su default "0").
function fillBase() {
  fireEvent.change(screen.getByPlaceholderText("Ej: Vehículo Toyota Hilux 2026"), {
    target: { value: "Vehículo Hilux" },
  });
  fireEvent.change(dateInputs()[0]!, { target: { value: "2026-06-01" } });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "25000.00" } });
  fireEvent.change(screen.getByPlaceholderText("Ej: 60"), { target: { value: "60" } });
}

function toggleLegal() {
  fireEvent.click(screen.getByRole("button", { name: /Datos Legales \/ SENIAT/ }));
}

// Abre la sección legal y llena factura+RIF para pasar el guard FC-03 sin advertencia
function fillLegalSeniat() {
  toggleLegal();
  fireEvent.change(screen.getByPlaceholderText("Ej: 00-000123"), {
    target: { value: "00-000123" },
  });
  fireEvent.change(screen.getByPlaceholderText("Ej: J-12345678-9"), {
    target: { value: "J-12345678-9" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createFixedAssetAction).mockResolvedValue({ success: true, data: "asset-1" } as never);
  vi.mocked(getExpensesForAssetImportAction).mockResolvedValue({
    success: true,
    data: [],
  } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FixedAssetForm — smoke del refactor RHF (FC-03 + paridad FormData + N4)", () => {
  it("render: campos base + defaults de cuentas GL vía findBestMatch en defaultValues", () => {
    render(<FixedAssetForm {...BASE_PROPS} />);

    // Campos base visibles
    expect(screen.getByPlaceholderText("Ej: Vehículo Toyota Hilux 2026")).toBeTruthy();
    expect(screen.getByPlaceholderText("0.00")).toBeTruthy(); // costo
    expect(screen.getByPlaceholderText("Ej: 60")).toBeTruthy(); // vida útil
    expect(dateInputs()).toHaveLength(1); // solo acquisitionDate (legal colapsada)
    expect(currencySelect().value).toBe("VES");
    expect(methodSelect().value).toBe("LINEA_RECTA");

    // findBestMatch pre-selecciona la mejor cuenta de cada pool (no la primera):
    // ASSET: "Propiedad, Planta y Equipo" (3 keywords) le gana a Terrenos y Banco
    expect(
      (screen.getByDisplayValue("1201 — Propiedad, Planta y Equipo") as HTMLSelectElement).value
    ).toBe("acc-ppe");
    // EXPENSE: "Gasto Depreciación" (keyword "depreci") le gana a Gasto Alquiler
    expect(
      (screen.getByDisplayValue("6101 — Gasto Depreciación") as HTMLSelectElement).value
    ).toBe("acc-dep-gasto");
    // CONTRA_ASSET: "Depreciación Acumulada" (acumul+depreci) le gana a Provisión Otra
    expect(
      (screen.getByDisplayValue("1301 — Depreciación Acumulada") as HTMLSelectElement).value
    ).toBe("acc-dep-acum");
    // Contrapartida GL: opcional, sin default
    expect(
      (screen.getByDisplayValue("Sin asiento automático (registrar manualmente)") as HTMLSelectElement).value
    ).toBe("");

    // Condicionales ocultos en el estado inicial
    expect(screen.queryByPlaceholderText("Ej: 36.50")).toBeNull(); // tasa BCV (VES)
    expect(screen.queryByPlaceholderText("Ej: 100000")).toBeNull(); // totalUnits (LINEA_RECTA)
    expect(screen.queryByPlaceholderText("Ej: 00-000123")).toBeNull(); // legal colapsada
  });

  it("submit válido mínimo (con datos SENIAT) → payload exacto a createFixedAssetAction + onSuccess", async () => {
    const onSuccess = vi.fn();
    render(<FixedAssetForm {...BASE_PROPS} onSuccess={onSuccess} />);

    fillBase();
    fillLegalSeniat();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(createFixedAssetAction).toHaveBeenCalledTimes(1));
    expect(createFixedAssetAction).toHaveBeenCalledWith({
      companyId: "company-1",
      name: "Vehículo Hilux",
      description: null,
      assetAccountId: "acc-ppe",
      depreciationAccountId: "acc-dep-gasto",
      accDepreciationAccountId: "acc-dep-acum",
      acquisitionDate: new Date("2026-06-01"),
      acquisitionCost: "25000.00", // monto como string — R-5, el server lo pasa a Decimal
      acquisitionCurrency: "VES",
      bcvRateAtAcquisition: null,
      residualValue: "0", // default sin tocar
      usefulLifeMonths: 60, // coaccionado a number en buildInput
      depreciationMethod: "LINEA_RECTA",
      totalUnits: null,
      location: null,
      responsible: null,
      invoiceNumber: "00-000123",
      providerRif: "J-12345678-9",
      serialNumber: null,
      serviceStartDate: null,
      internalCode: null,
      acquisitionCounterpartAccountId: null,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("asset-1"));
  });

  it("FC-03: submit SIN factura+RIF → advertencia deducibilidad (action NO llamada); 'Continuar' → submit del pendingInput", async () => {
    render(<FixedAssetForm {...BASE_PROPS} />);

    fillBase();
    fireEvent.click(submitBtn()); // sección legal colapsada → sin factura ni RIF

    // Advertencia visible (pendingInput !== null) y la action NO se llamó
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Datos SENIAT incompletos");
    expect(alert.textContent).toContain("Art. 76 LISLR");
    expect(createFixedAssetAction).not.toHaveBeenCalled();

    // FC-03 también expande la sección legal para que el usuario pueda completar
    expect(screen.getByPlaceholderText("Ej: 00-000123")).toBeTruthy();

    // Confirmar en la advertencia → la action se llama con los datos pendientes
    fireEvent.click(screen.getByRole("button", { name: "Continuar sin datos SENIAT" }));
    await waitFor(() => expect(createFixedAssetAction).toHaveBeenCalledTimes(1));
    expect(createFixedAssetAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        name: "Vehículo Hilux",
        acquisitionCost: "25000.00",
        invoiceNumber: null,
        providerRif: null,
      })
    );
    // La advertencia se cierra al confirmar
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("N2 / paridad FormData: USD muestra tasa BCV; volver a VES la desmonta y el payload lleva bcvRateAtAcquisition null", async () => {
    render(<FixedAssetForm {...BASE_PROPS} />);

    // USD → aparece el campo tasa BCV (N2) y se tipea un valor
    fireEvent.change(currencySelect(), { target: { value: "USD" } });
    const bcvInput = screen.getByPlaceholderText("Ej: 36.50") as HTMLInputElement;
    fireEvent.change(bcvInput, { target: { value: "36.50" } });
    expect(bcvInput.value).toBe("36.50");

    // Volver a VES → el campo se desmonta (paridad con el input no-controlado anterior)
    fireEvent.change(currencySelect(), { target: { value: "VES" } });
    expect(screen.queryByPlaceholderText("Ej: 36.50")).toBeNull();

    fillBase();
    fillLegalSeniat();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(createFixedAssetAction).toHaveBeenCalledTimes(1));
    expect(createFixedAssetAction).toHaveBeenCalledWith(
      expect.objectContaining({
        acquisitionCurrency: "VES",
        bcvRateAtAcquisition: null, // el clear replicado: NO viaja la tasa tipeada en USD
      })
    );

    // Y el clear es real (setValue al cambiar a VES): re-seleccionar USD muestra el campo vacío
    fireEvent.change(currencySelect(), { target: { value: "USD" } });
    expect((screen.getByPlaceholderText("Ej: 36.50") as HTMLInputElement).value).toBe("");
  });

  it("sección legal: tipear serial y colapsar → campos anulados en el payload (FC-03 media); factura conserva valor pero no viaja", async () => {
    render(<FixedAssetForm {...BASE_PROPS} />);

    // Abrir legal y llenar campos
    toggleLegal();
    fireEvent.change(screen.getByPlaceholderText("Ej: VIN/placa/serial de fabricación"), {
      target: { value: "VIN-123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Ej: AF-2026-001"), {
      target: { value: "AF-2026-001" },
    });
    fireEvent.change(dateInputs()[1]!, { target: { value: "2026-06-05" } }); // serviceStartDate
    fireEvent.change(screen.getByPlaceholderText("Ej: 00-000123"), {
      target: { value: "00-9" },
    });

    // Colapsar → inputs desmontados
    toggleLegal();
    expect(screen.queryByPlaceholderText("Ej: VIN/placa/serial de fabricación")).toBeNull();

    fillBase();
    fireEvent.click(submitBtn());

    // La factura NO viajó (sección colapsada) → dispara FC-03 y re-expande la sección
    await screen.findByRole("alert");
    // Paridad FormData: serial/interno/fecha servicio quedaron anulados (setValue al colapsar)…
    expect(
      (screen.getByPlaceholderText("Ej: VIN/placa/serial de fabricación") as HTMLInputElement).value
    ).toBe("");
    expect((screen.getByPlaceholderText("Ej: AF-2026-001") as HTMLInputElement).value).toBe("");
    expect(dateInputs()[1]!.value).toBe("");
    // …pero factura (antes controlada) conserva su valor en el input
    expect((screen.getByPlaceholderText("Ej: 00-000123") as HTMLInputElement).value).toBe("00-9");

    fireEvent.click(screen.getByRole("button", { name: "Continuar sin datos SENIAT" }));
    await waitFor(() => expect(createFixedAssetAction).toHaveBeenCalledTimes(1));
    expect(createFixedAssetAction).toHaveBeenCalledWith(
      expect.objectContaining({
        serialNumber: null,
        internalCode: null,
        serviceStartDate: null,
        invoiceNumber: null, // no viaja con la sección colapsada
        providerRif: null,
      })
    );
  });

  it("N4: seleccionar gasto CONFIRMED pre-llena costo/fecha/factura/RIF/moneda SIN pisar el nombre ya tipeado", async () => {
    vi.mocked(getExpensesForAssetImportAction).mockResolvedValue({
      success: true,
      data: [EXPENSE_CONFIRMED],
    } as never);

    render(<FixedAssetForm {...BASE_PROPS} />);

    // El usuario YA tipeó un nombre antes de importar
    const nameInput = screen.getByPlaceholderText("Ej: Vehículo Toyota Hilux 2026") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Servidor HP" } });

    // Abrir la sección de importación → fetch de gastos
    fireEvent.click(screen.getByRole("button", { name: /Importar desde Gasto confirmado/ }));
    const expenseSelect = (await screen.findByDisplayValue("— Seleccionar gasto —")) as HTMLSelectElement;
    expect(getExpensesForAssetImportAction).toHaveBeenCalledWith("company-1");

    fireEvent.change(expenseSelect, { target: { value: "exp-1" } });

    // Pre-llenado desde el gasto
    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("1200.00");
    expect(dateInputs()[0]!.value).toBe("2026-05-10");
    expect(currencySelect().value).toBe("USD"); // moneda del gasto (N2)
    // Sección legal auto-expandida con los datos SENIAT del gasto
    expect((screen.getByPlaceholderText("Ej: 00-000123") as HTMLInputElement).value).toBe("F-555");
    expect((screen.getByPlaceholderText("Ej: J-12345678-9") as HTMLInputElement).value).toBe("J-98765432-1");
    // El nombre tipeado por el usuario NO se sobreescribe…
    expect(nameInput.value).toBe("Servidor HP");
    // …pero la descripción (vacía) sí se completa con el concepto
    expect((screen.getByPlaceholderText("Descripción opcional") as HTMLInputElement).value).toBe(
      "Compra laptop Dell"
    );
  });

  it("UNIDADES_PRODUCCION: aparece totalUnits (coaccionado a number en el payload); cambiar de método lo limpia", async () => {
    render(<FixedAssetForm {...BASE_PROPS} />);

    // Aparece al seleccionar el método
    fireEvent.change(methodSelect(), { target: { value: "UNIDADES_PRODUCCION" } });
    const totalUnits = screen.getByPlaceholderText("Ej: 100000") as HTMLInputElement;
    fireEvent.change(totalUnits, { target: { value: "5000" } });

    // Cambiar de método → se desmonta y se limpia (paridad FormData)
    fireEvent.change(methodSelect(), { target: { value: "LINEA_RECTA" } });
    expect(screen.queryByPlaceholderText("Ej: 100000")).toBeNull();
    fireEvent.change(methodSelect(), { target: { value: "UNIDADES_PRODUCCION" } });
    expect((screen.getByPlaceholderText("Ej: 100000") as HTMLInputElement).value).toBe("");

    // Con el método activo y unidades tipeadas → viaja como number
    fireEvent.change(screen.getByPlaceholderText("Ej: 100000"), { target: { value: "5000" } });
    fillBase();
    fillLegalSeniat();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(createFixedAssetAction).toHaveBeenCalledTimes(1));
    expect(createFixedAssetAction).toHaveBeenCalledWith(
      expect.objectContaining({
        depreciationMethod: "UNIDADES_PRODUCCION",
        totalUnits: 5000,
      })
    );
  });

  it("guard doble-submit: disabled={isPending} + aria-busy mientras la action está en vuelo", async () => {
    // Promise controlada: la action queda "en vuelo" hasta que la resolvamos
    let resolveCreate!: (v: unknown) => void;
    vi.mocked(createFixedAssetAction).mockReturnValue(
      new Promise((res) => {
        resolveCreate = res;
      }) as never
    );
    const onSuccess = vi.fn();

    render(<FixedAssetForm {...BASE_PROPS} onSuccess={onSuccess} />);

    // Idle: habilitado, sin aria-busy activo
    expect(submitBtn().disabled).toBe(false);
    expect(submitBtn().getAttribute("aria-busy")).toBe("false");

    fillBase();
    fillLegalSeniat();
    fireEvent.click(submitBtn());

    // Pendiente: deshabilitado + aria-busy + label "Guardando…"
    await waitFor(() => {
      const btn = submitBtn();
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("aria-busy")).toBe("true");
      expect(btn.textContent).toContain("Guardando…");
    });

    resolveCreate({ success: true, data: "asset-1" });
    await waitFor(() => {
      const btn = submitBtn();
      expect(btn.disabled).toBe(false);
      expect(btn.getAttribute("aria-busy")).toBe("false");
    });
    expect(onSuccess).toHaveBeenCalledWith("asset-1");
  });
});
