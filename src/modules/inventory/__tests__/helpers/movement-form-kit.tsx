// src/modules/inventory/__tests__/helpers/movement-form-kit.tsx
//
// SPEC-012 (Entrega B3) — utilidades COMPARTIDAS por los tests de `MovementForm` (el de la SPEC-007,
// adaptado al combobox, y el de las reglas nuevas de B3). Es un helper de TEST, no de producción.
//
// Se escribe contra ROLES, etiquetas y texto visible. `listUomsAction` se mockea en cada archivo de test
// (`vi.mock` aplica a todo el grafo de módulos de ese archivo, incluido este helper).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { ComponentProps } from "react";

import { MovementForm } from "../../components/MovementForm";
import { createMovementAction } from "../../actions/inventory-operations.actions";
import { listUomsAction } from "../../actions/inventory-uom.actions";
import { pickByCode, type PlanAccount } from "@/__tests__/helpers/account-combobox-forms";
import { A_INV_MERC, A_INV_MP, INV_PLAN } from "./inventory-plan";

export const COMPANY_ID = "company-1";

// ─── Productos ───────────────────────────────────────────────────────────────────────────────────

const base = { unit: "kg", stockQuantity: "10", averageCost: "5", itemType: "GOODS" };

/** Su cuenta de inventario es `Inventario de Mercancía`: no puede ser su propia contrapartida (SPEC-007). */
export const ITEM_MERC = {
  ...base,
  id: "item-merc",
  sku: "SKU-001",
  name: "Harina de trigo",
  accountId: A_INV_MERC.id,
};
/** Su cuenta de inventario es `Inventario de Materia Prima`. */
export const ITEM_MP = {
  ...base,
  id: "item-mp",
  sku: "SKU-002",
  name: "Azúcar refinada",
  accountId: A_INV_MP.id,
};
/** Sin cuenta de inventario: ninguna cuenta se excluye de la contrapartida. */
export const ITEM_SIN_CUENTA = {
  ...base,
  id: "item-sin",
  sku: "SKU-003",
  name: "Sal gruesa",
  accountId: null,
};
/** R-06: un Servicio no tiene stock físico, solo admite Ajustes. */
export const ITEM_SERVICIO = {
  id: "item-srv",
  sku: "SRV-001",
  name: "Asesoría contable",
  unit: "hr",
  stockQuantity: "0",
  averageCost: "0",
  itemType: "SERVICE",
  accountId: null,
};
export const ITEMS = [ITEM_MERC, ITEM_MP, ITEM_SIN_CUENTA, ITEM_SERVICIO];

// ─── Textos que el formulario conserva ───────────────────────────────────────────────────────────

export const COUNTERPART_LABEL = /Cuenta contrapartida/;

export const COUNTERPART_REQUIRED_MESSAGE =
  "Seleccione la cuenta de contrapartida: Banco o Caja si fue de contado, o Capital solo si es un aporte de socios. Una compra a crédito se registra con su factura de compra.";

export const COUNTERPART_EMPTY_MESSAGE =
  "No hay cuentas disponibles para la contrapartida. Cree en el Plan de Cuentas una cuenta de movimiento de Banco, Caja o Capital.";

export const ENTRADA_HINT =
  "Seleccione de dónde sale el dinero o qué origina la entrada: Banco o Caja si fue de contado, o Capital solo si es un aporte de socios (por ejemplo, al constituir la empresa). Una compra a crédito se registra con su factura de compra.";

export const AJUSTE_HINT =
  "Seleccione la cuenta de ajuste: Mermas (gasto) para sobrantes/faltas, o la cuenta operativa correspondiente.";

export const SERVICE_BLOCKED_MESSAGE =
  "Los productos de tipo Servicio no tienen stock físico. Solo se permiten Ajustes. (R-06 NIIF Sec.13)";

// ─── Render ──────────────────────────────────────────────────────────────────────────────────────

type Props = ComponentProps<typeof MovementForm>;

export function mountForm(overrides: Partial<Props> = {}) {
  const onSuccess = vi.fn();
  const props: Props = {
    companyId: COMPANY_ID,
    items: ITEMS,
    counterpartAccounts: [...INV_PLAN],
    currentBcvRate: "36.5",
    onSuccess,
    ...overrides,
  };
  const utils = render(<MovementForm {...props} />);
  return {
    ...utils,
    onSuccess,
    /** Re-renderiza con otras props (p. ej. una lista de cuentas refrescada). */
    refresh: (next: Partial<Props>) => utils.rerender(<MovementForm {...props} {...next} />),
  };
}

// ─── Localizar los controles ─────────────────────────────────────────────────────────────────────

/**
 * El control de contrapartida por su etiqueta. Falla con un mensaje claro mientras siga siendo un
 * <select> nativo (el contrato de B3 es un `AccountCombobox`: `<input role="combobox">`).
 */
export function counterpart(): HTMLInputElement {
  const el = screen.getByLabelText(COUNTERPART_LABEL);
  if (el.tagName !== "INPUT") {
    throw new Error(
      `La contrapartida debe ser un <input role="combobox"> (AccountCombobox) y es un <${el.tagName.toLowerCase()}> (¿sigue siendo un <select> nativo?)`
    );
  }
  return el as HTMLInputElement;
}

export const formEl = () => document.querySelector("form") as HTMLFormElement;
export const productSelect = () =>
  document.querySelector('select[name="itemId"]') as HTMLSelectElement;
export const submitButton = () =>
  screen.getByRole("button", { name: /Registrar movimiento|Registrando/ });
export const field = (name: string) =>
  document.querySelector(`[name="${name}"]`) as HTMLInputElement;

export const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

// ─── Interacción ─────────────────────────────────────────────────────────────────────────────────

export function chooseType(label: "Entrada" | "Salida" | "Ajuste") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
}

/** Elige el producto y espera a que termine la carga de unidades (evita avisos de act()). */
export async function chooseItem(id: string = ITEM_MERC.id) {
  fireEvent.change(productSelect(), { target: { value: id } });
  await waitFor(() =>
    expect(listUomsAction).toHaveBeenLastCalledWith({ companyId: COMPANY_ID, itemId: id })
  );
  await flush();
}

/** Cantidad y referencia (obligatorias en todos los tipos); la fecha y la tasa traen valor por defecto. */
export function fillCommon(reference = "F-001-2345", quantity = "5") {
  fireEvent.change(field("quantity"), { target: { value: quantity } });
  fireEvent.change(field("reference"), { target: { value: reference } });
}

/** Costo unitario (solo ENTRADA). */
export function fillUnitCost(value = "10") {
  fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value } });
}

/** Una ENTRADA completa: producto, cantidad, costo, referencia y, si se pasa, la contrapartida (por código). */
export async function fillEntrada(account?: PlanAccount, itemId: string = ITEM_MERC.id) {
  await chooseItem(itemId);
  fillCommon("F-001-2345");
  fillUnitCost("10");
  if (account) pickByCode(counterpart(), account.code);
}

/** El payload (primer argumento) de la llamada `n` a `createMovementAction` (mockeada por el test). */
export function sentPayload(n = 0): Record<string, unknown> {
  return vi.mocked(createMovementAction).mock.calls[n][0] as Record<string, unknown>;
}

/** Envía el formulario SIN pasar por la validación nativa (la red del cliente es la del formulario). */
export function submitForm() {
  fireEvent.submit(formEl());
}
