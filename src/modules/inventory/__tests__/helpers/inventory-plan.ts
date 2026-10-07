// src/modules/inventory/__tests__/helpers/inventory-plan.ts
//
// SPEC-012 (Entrega B3) — plan de cuentas COMPARTIDO por los tests de `InventoryItemForm`,
// `MovementForm` y `InventoryItemList`. Es un helper de TEST, no de producción.
//
// Es lo que entrega `inventory/page.tsx` a los formularios: títulos Y cuentas de movimiento de los
// tipos ASSET, LIABILITY, EQUITY y EXPENSE, con `requiresThirdParty` (ADR-054). Los nombres de los
// títulos van en MAYÚSCULAS y no se repiten (ni como palabra) con los de las cuentas de movimiento: el
// helper `headerEl` de `account-combobox-forms` los busca por nombre distinguiendo mayúsculas.
//
// Los arreglos van en orden de código (la lista del combobox sale en ese orden), así que
// `movementLabels(...)` de un subconjunto es EXACTAMENTE lo que el combobox debe listar.

import { moveAcc, titleAcc, type PlanAccount } from "@/__tests__/helpers/account-combobox-forms";

export type InventoryPlanAccount = PlanAccount & { requiresThirdParty: boolean };

const title = (code: string, name: string, type: string): InventoryPlanAccount => ({
  ...titleAcc(code, name, type),
  requiresThirdParty: false,
});

const move = (
  code: string,
  name: string,
  type: string,
  requiresThirdParty = false
): InventoryPlanAccount => ({ ...moveAcc(code, name, type), requiresThirdParty });

// ─── ASSET ───────────────────────────────────────────────────────────────────────────────────────
export const T_ACTIVO = title("1", "ACTIVO", "ASSET");
export const T_CORRIENTE = title("1.1", "CORRIENTE", "ASSET");
export const T_DISPONIBLE = title("1.1.01", "DISPONIBLE", "ASSET");
export const T_CAJAS = title("1.1.01.01", "CAJAS", "ASSET");
export const A_CAJA = move("1.1.01.01.001", "Caja Principal", "ASSET");
export const T_BANCOS = title("1.1.01.02", "BANCOS", "ASSET");
export const A_BANCO = move("1.1.01.02.001", "Banco Mercantil", "ASSET");
export const T_INVENTARIOS = title("1.1.03", "INVENTARIOS", "ASSET");
export const T_EXISTENCIAS = title("1.1.03.01", "EXISTENCIAS", "ASSET");
export const A_INV_MERC = move("1.1.03.01.001", "Inventario de Mercancía", "ASSET");
export const A_INV_MP = move("1.1.03.01.002", "Inventario de Materia Prima", "ASSET");

// ─── LIABILITY ───────────────────────────────────────────────────────────────────────────────────
export const T_PASIVO = title("2", "PASIVO", "LIABILITY");
export const T_EXIGIBLE = title("2.1", "EXIGIBLE", "LIABILITY");
export const T_OBLIGACIONES = title("2.1.01", "OBLIGACIONES", "LIABILITY");
export const T_POR_PAGAR = title("2.1.01.01", "POR PAGAR", "LIABILITY");
export const L_RETENCIONES = move("2.1.01.01.001", "Retenciones por Pagar", "LIABILITY");
/** Exige tercero (ADR-054): MovementForm no la ofrece en una ENTRADA, sí en un AJUSTE. */
export const L_PROVEEDORES = move(
  "2.1.01.01.002",
  "Cuentas por Pagar Proveedores",
  "LIABILITY",
  true
);

// ─── EQUITY ──────────────────────────────────────────────────────────────────────────────────────
export const T_PATRIMONIO = title("3", "PATRIMONIO", "EQUITY");
export const T_CAPITALES = title("3.1", "CAPITALES", "EQUITY");
export const T_APORTES = title("3.1.01", "APORTES", "EQUITY");
export const T_CAPITAL = title("3.1.01.01", "CAPITAL", "EQUITY");
export const Q_CAPITAL = move("3.1.01.01.001", "Capital Social", "EQUITY");
export const Q_RESERVA = move("3.1.01.01.002", "Reserva Legal", "EQUITY");

// ─── EXPENSE ─────────────────────────────────────────────────────────────────────────────────────
export const T_EGRESOS = title("5", "EGRESOS", "EXPENSE");
export const T_OPERATIVOS = title("5.1", "OPERATIVOS", "EXPENSE");
export const T_COSTO_VENTAS = title("5.1.01", "COSTO DE VENTAS", "EXPENSE");
export const T_COSTOS_DIRECTOS = title("5.1.01.01", "COSTOS DIRECTOS", "EXPENSE");
export const E_COSTO = move("5.1.01.01.001", "Costo de Ventas Mercancía", "EXPENSE");
export const E_MERMAS = move("5.1.01.01.002", "Mermas y Faltantes", "EXPENSE");

/** TODO lo que `inventory/page.tsx` entrega a `MovementForm` (cuatro tipos, con títulos), en orden de código. */
export const INV_PLAN: readonly InventoryPlanAccount[] = [
  T_ACTIVO,
  T_CORRIENTE,
  T_DISPONIBLE,
  T_CAJAS,
  A_CAJA,
  T_BANCOS,
  A_BANCO,
  T_INVENTARIOS,
  T_EXISTENCIAS,
  A_INV_MERC,
  A_INV_MP,
  T_PASIVO,
  T_EXIGIBLE,
  T_OBLIGACIONES,
  T_POR_PAGAR,
  L_RETENCIONES,
  L_PROVEEDORES,
  T_PATRIMONIO,
  T_CAPITALES,
  T_APORTES,
  T_CAPITAL,
  Q_CAPITAL,
  Q_RESERVA,
  T_EGRESOS,
  T_OPERATIVOS,
  T_COSTO_VENTAS,
  T_COSTOS_DIRECTOS,
  E_COSTO,
  E_MERMAS,
];

/** Lo que la página entrega a `InventoryItemForm`/`InventoryItemList`: el mismo plan SIN Patrimonio. */
export const ITEM_ACCOUNTS: readonly InventoryPlanAccount[] = INV_PLAN.filter(
  (a) => a.type !== "EQUITY"
);

export const titleNamesOf = (accounts: readonly PlanAccount[]) =>
  accounts.filter((a) => !a.isPostable).map((a) => a.name);

/** Nombres de TODOS los títulos del plan (para `visibleHeaderNames`). */
export const ALL_TITLE_NAMES = titleNamesOf(INV_PLAN);

// ─── Qué debe ofrecer MovementForm (cuentas de MOVIMIENTO, en orden de código) ───────────────────

/** ENTRADA sin producto elegido: Activo/Pasivo/Patrimonio/Gasto, sin las que exigen tercero. */
export const ENTRADA_ACCOUNTS: readonly InventoryPlanAccount[] = [
  A_CAJA,
  A_BANCO,
  A_INV_MERC,
  A_INV_MP,
  L_RETENCIONES,
  Q_CAPITAL,
  Q_RESERVA,
  E_COSTO,
  E_MERMAS,
];

/** AJUSTE: Activo/Pasivo/Gasto, SIN Patrimonio y sin ningún otro filtro (ni tercero ni cuenta del producto). */
export const AJUSTE_ACCOUNTS: readonly InventoryPlanAccount[] = [
  A_CAJA,
  A_BANCO,
  A_INV_MERC,
  A_INV_MP,
  L_RETENCIONES,
  L_PROVEEDORES,
  E_COSTO,
  E_MERMAS,
];

export const without = (list: readonly PlanAccount[], ...targets: PlanAccount[]) =>
  list.filter((a) => !targets.some((t) => t.id === a.id));
