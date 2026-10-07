"use client";

// src/modules/inventory/components/MovementForm.tsx
// Registro de movimientos físicos (ENTRADA / SALIDA / AJUSTE) — dominio ADMINISTRATIVE
// Auditoría SENIAT:
//   R-02: tasa BCV histórica obligatoria en ENTRADA
//   R-03: referencia de documento obligatoria (min 3 chars)
//   R-04: cuenta contrapartida para completar partida doble en ENTRADA/AJUSTE
//   R-06: SERVICE bloquea ENTRADA/SALIDA (solo AJUSTE permitido)
//   SPEC-007: en ENTRADA la contrapartida es obligatoria (Dr Inventario / Cr contrapartida):
//     Activo (Banco/Caja), Patrimonio (Capital, solo aporte de socios), Pasivo o Gasto que no
//     exijan tercero (ADR-054; una compra a crédito va con su factura); nunca la cuenta de
//     inventario del propio producto. El servidor
//     lo revalida (el cliente solo evita el viaje de ida y vuelta).
//     AJUSTE no cambia: el servicio ignora esa cuenta (PA-4, decisión pendiente).
// SPEC-012 B3: la contrapartida es un `AccountCombobox` con ESTADO (antes <select> con <optgroup> +
//   `FormData`). `counterpartAccounts` trae títulos Y cuentas de movimiento; los títulos solo se ven como
//   encabezados no elegibles. El filtro de «cuenta de inventario del producto» y el de «exige tercero» (solo
//   ENTRADA) se aplican SOLO a cuentas de movimiento: un título se filtra únicamente por tipo, para no perder
//   el encabezado de sus cuentas elegibles. Sin `required` nativo: el envío valida con `isSelectableAccountId`
//   en ENTRADA y en AJUSTE. El id elegido se CONSERVA en el estado y su validez se calcula contra la lista
//   vigente en cada render: si deja de ser elegible (otro tipo o producto) se ve vacío e inválido y no se
//   envía, y si vuelve a serlo reaparece.

import { useId, useState, useTransition, useEffect } from "react";
import { createMovementAction } from "../actions/inventory-operations.actions";
import { listUomsAction } from "../actions/inventory-uom.actions";
import { todayLocalISO } from "@/lib/today";
import { MoneyInput } from "@/components/ui/money-input";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import {
  isSelectableAccountId,
  selectableAccounts,
  type AccountWithType,
} from "@/lib/account-search";

type ItemOption = {
  id: string;
  sku: string;
  name: string;
  unit: string; // baseUnitName — para mostrar stock
  stockQuantity: string;
  averageCost: string;
  itemType: string; // R-06: para bloquear SERVICE
  accountId?: string | null; // cuenta de inventario: no puede ser su propia contrapartida (SPEC-007)
};

type UnitOption = {
  id: string;
  name: string;
  abbreviation: string;
  conversionFactor: string;
  isBase: boolean;
};

// `isPostable` es OBLIGATORIO: sin él el combobox trataría todas las cuentas como títulos.
type AccountOption = AccountWithType & {
  /** ADR-054: la cuenta exige tercero en cada línea del asiento (p. ej. Cuentas por pagar a proveedores). */
  requiresThirdParty?: boolean;
};

type Props = {
  companyId: string;
  items: ItemOption[];
  counterpartAccounts: AccountOption[]; // R-04: títulos Y cuentas para el otro lado del asiento
  currentBcvRate?: string; // R-02: tasa BCV actual para autocompletar
  onSuccess?: () => void;
};

const MOVEMENT_TYPES = [
  { value: "ENTRADA", label: "Entrada", description: "Ingreso de mercancía al inventario" },
  { value: "SALIDA", label: "Salida", description: "Egreso de mercancía del inventario" },
  { value: "AJUSTE", label: "Ajuste", description: "Corrección de inventario físico" },
] as const;

type MovementType = (typeof MOVEMENT_TYPES)[number]["value"];

// Cuentas de contrapartida relevantes por tipo de movimiento
const COUNTERPART_HINT: Record<MovementType, string> = {
  ENTRADA:
    "Seleccione de dónde sale el dinero o qué origina la entrada: Banco o Caja si fue de contado, o Capital solo si es un aporte de socios (por ejemplo, al constituir la empresa). Una compra a crédito se registra con su factura de compra.",
  SALIDA: "", // SALIDA no necesita contrapartida — Dr COGS / Cr Inventario es autosuficiente
  AJUSTE:
    "Seleccione la cuenta de ajuste: Mermas (gasto) para sobrantes/faltas, o la cuenta operativa correspondiente.",
};

const COUNTERPART_REQUIRED_MESSAGE =
  "Seleccione la cuenta de contrapartida: Banco o Caja si fue de contado, o Capital solo si es un aporte de socios. Una compra a crédito se registra con su factura de compra.";

const COUNTERPART_EMPTY_MESSAGE =
  "No hay cuentas disponibles para la contrapartida. Cree en el Plan de Cuentas una cuenta de movimiento de Banco, Caja o Capital.";

// AJUSTE: el servicio ignora la cuenta (PA-4) pero el formulario la sigue exigiendo; la que se sugiere
// crear es la de Mermas (gasto), como dice su ayuda.
const AJUSTE_COUNTERPART_REQUIRED_MESSAGE = "Seleccione la cuenta de ajuste (contrapartida).";

const AJUSTE_COUNTERPART_EMPTY_MESSAGE =
  "No hay cuentas disponibles para la contrapartida. Cree en el Plan de Cuentas una cuenta de movimiento de Gasto (por ejemplo, Mermas).";

// Tipos de cuenta que se ofrecen como contrapartida (con sus títulos como encabezados del combobox; la
// búsqueda por código o nombre —p. ej. «Capital»— sustituye a los antiguos grupos). Patrimonio solo
// aplica a ENTRADA (aporte de socios).
const ENTRADA_COUNTERPART_TYPES: readonly string[] = ["ASSET", "LIABILITY", "EQUITY", "EXPENSE"];
const AJUSTE_COUNTERPART_TYPES: readonly string[] = ["ASSET", "LIABILITY", "EXPENSE"];

const fieldClass =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

export function MovementForm({
  companyId,
  items,
  counterpartAccounts,
  currentBcvRate,
  onSuccess,
}: Props) {
  const counterpartId = useId();
  const [isPending, startTransition] = useTransition();
  const [isLoadingUnits, startLoadUnits] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [movType, setMovType] = useState<MovementType>("ENTRADA");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [unitCost, setUnitCost] = useState("");
  // D6: estado, no FormData. Se conserva aunque deje de ser elegible (su validez se calcula en cada render).
  const [counterpartAccountId, setCounterpartAccountId] = useState("");
  // Tras un envío rechazado por falta de contrapartida, el campo se marca como inválido (aria-invalid + mensaje).
  const [counterpartChecked, setCounterpartChecked] = useState(false);

  const selectedItem = items.find((i) => i.id === selectedItemId);
  const selectedUnit = units.find((u) => u.id === selectedUnitId);
  const isService = selectedItem?.itemType === "SERVICE";

  // Opciones de contrapartida. ENTRADA: Activo/Pasivo/Patrimonio/Gasto; las CUENTAS excluyen la de
  // inventario del producto elegido y las que exigen tercero (el servidor las rechaza: el movimiento no
  // registra tercero, ADR-054). AJUSTE: Activo/Pasivo/Gasto, sin Patrimonio y sin otros filtros, porque el
  // servicio ignora esa cuenta (PA-4). Los TÍTULOS de esos tipos viajan siempre (solo se muestran como
  // encabezados): nunca se les aplica el filtro por cuenta, para no perder el encabezado de las elegibles.
  const isEntrada = movType === "ENTRADA";
  const needsCounterpart = isEntrada || movType === "AJUSTE";
  const inventoryAccountId = isEntrada ? selectedItem?.accountId : null;
  const counterpartTypes = isEntrada ? ENTRADA_COUNTERPART_TYPES : AJUSTE_COUNTERPART_TYPES;
  const counterpartOptions = counterpartAccounts.filter(
    (a) =>
      counterpartTypes.includes(a.type) &&
      (!a.isPostable || (a.id !== inventoryAccountId && !(isEntrada && a.requiresThirdParty)))
  );
  // RN-19: el aviso «no hay cuentas» cuenta SOLO cuentas de movimiento elegibles.
  const hasCounterpartOptions = selectableAccounts(counterpartOptions).length > 0;
  // D1: la validez se calcula contra la lista VIGENTE; un título, una cuenta ausente o una que dejó de
  // ofrecerse (otro tipo o producto) cuenta como «sin elegir».
  const counterpartValid = isSelectableAccountId(counterpartOptions, counterpartAccountId);
  const counterpartInvalid = counterpartChecked && !counterpartValid;

  // Cargar unidades cuando cambia el ítem seleccionado
  useEffect(() => {
    setUnits([]);
    setSelectedUnitId("");
    if (!selectedItemId) return;

    startLoadUnits(async () => {
      const r = await listUomsAction({ companyId, itemId: selectedItemId });
      if (r.success) {
        const mapped: UnitOption[] = r.data.map((u) => ({
          id: u.id,
          name: u.name,
          abbreviation: u.abbreviation,
          conversionFactor: u.conversionFactor.toString(),
          isBase: u.isBase,
        }));
        setUnits(mapped);
        const base = mapped.find((u) => u.isBase);
        setSelectedUnitId(base?.id ?? "");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Bloquear SERVICE con ENTRADA/SALIDA
    if (isService && movType !== "AJUSTE") {
      setError(
        `Los productos de tipo Servicio no tienen stock físico. Solo se permiten Ajustes. (R-06 NIIF Sec.13)`
      );
      return;
    }

    const fd = new FormData(e.currentTarget);

    const unitIsBase = units.find((u) => u.id === selectedUnitId)?.isBase ?? true;
    const unitId = selectedUnitId && !unitIsBase ? selectedUnitId : null;

    // SPEC-007 RN-1: toda ENTRADA lleva contrapartida (el servidor también lo exige). Ya no hay `required`
    // nativo (el combobox no lo lleva): ENTRADA y AJUSTE validan aquí contra la lista VIGENTE, así que un
    // título, una cuenta ausente o una que dejó de ofrecerse no se envían. SALIDA no usa contrapartida.
    if (needsCounterpart && !counterpartValid) {
      setCounterpartChecked(true);
      setError(isEntrada ? COUNTERPART_REQUIRED_MESSAGE : AJUSTE_COUNTERPART_REQUIRED_MESSAGE);
      return;
    }

    const exchangeRateVes = (fd.get("exchangeRateVes") as string) || null;

    const input = {
      companyId,
      itemId: fd.get("itemId") as string,
      type: movType,
      quantity: parseFloat(fd.get("quantity") as string),
      unitCost: movType === "ENTRADA" ? unitCost || undefined : undefined,
      reference: fd.get("reference") as string,
      notes: (fd.get("notes") as string) || null,
      date: new Date(fd.get("date") as string).toISOString(),
      idempotencyKey: crypto.randomUUID(),
      unitId: unitId ?? undefined,
      // SALIDA nunca envía la contrapartida que pudo quedar en el estado de una ENTRADA anterior.
      counterpartAccountId: needsCounterpart ? counterpartAccountId : undefined,
      exchangeRateVes: exchangeRateVes ?? undefined,
    };

    startTransition(async () => {
      const r = await createMovementAction(input);
      if (r.success) {
        setSuccess(`Movimiento registrado correctamente.`);
        (e.target as HTMLFormElement).reset();
        setSelectedItemId("");
        setMovType("ENTRADA");
        setUnits([]);
        setSelectedUnitId("");
        setUnitCost("");
        // D6: el combobox es controlado, `reset()` no lo vacía.
        setCounterpartAccountId("");
        setCounterpartChecked(false);
        onSuccess?.();
      } else {
        setError(r.error);
      }
    });
  }

  const today = todayLocalISO();
  const hasAltUnits = units.length > 1;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700"
        >
          {success}
        </div>
      )}

      {/* Tipo de movimiento */}
      <div>
        <label className={labelClass}>Tipo de movimiento *</label>
        <div className="grid grid-cols-3 gap-2">
          {MOVEMENT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setMovType(t.value)}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                movType === t.value
                  ? "border-blue-500 bg-blue-50 font-medium text-blue-800"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <div className="font-semibold">{t.label}</div>
              <div className="mt-0.5 text-xs text-gray-500">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Producto */}
        <div className="sm:col-span-2">
          <label className={labelClass}>Producto *</label>
          <select
            name="itemId"
            required
            className={fieldClass}
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
          >
            <option value="">Seleccionar producto...</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                [{item.sku}] {item.name}
                {item.itemType === "SERVICE" ? " 🔧 (Servicio)" : ""}
                {" — "}Stock:{" "}
                {parseFloat(item.stockQuantity).toLocaleString("es-VE", {
                  maximumFractionDigits: 2,
                })}{" "}
                {item.unit}
              </option>
            ))}
          </select>

          {selectedItem && (
            <div
              className={`mt-2 rounded border px-3 py-2 text-xs ${
                isService
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              {isService ? (
                <>
                  ⚠️ <strong>Servicio:</strong> sin stock físico. Solo se permiten Ajustes de
                  corrección.
                </>
              ) : (
                <>
                  Stock actual:{" "}
                  <span className="font-semibold text-gray-800">
                    {parseFloat(selectedItem.stockQuantity).toLocaleString("es-VE", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    {selectedItem.unit}
                  </span>
                  {" · "}
                  CPP vigente:{" "}
                  <span className="font-semibold text-gray-800">
                    {parseFloat(selectedItem.averageCost).toLocaleString("es-VE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}{" "}
                    Bs.
                  </span>
                  {movType === "SALIDA" && (
                    <span className="ml-2 text-blue-600">
                      — Costo unitario se toma del CPP vigente automáticamente
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Selector de unidad */}
        {selectedItemId && hasAltUnits && (
          <div className="sm:col-span-2">
            <label className={labelClass}>Unidad de registro</label>
            {isLoadingUnits ? (
              <p className="py-2 text-xs text-gray-400">Cargando unidades...</p>
            ) : (
              <>
                <select
                  className={fieldClass}
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.abbreviation})
                      {u.isBase
                        ? " — Base"
                        : ` — 1 ${u.abbreviation} = ${u.conversionFactor} ${selectedItem?.unit ?? ""}`}
                    </option>
                  ))}
                </select>
                {selectedUnit && !selectedUnit.isBase && (
                  <p className="mt-1 text-xs text-blue-700">
                    La cantidad se convertirá: 1 {selectedUnit.abbreviation} ={" "}
                    {selectedUnit.conversionFactor} {selectedItem?.unit}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Cantidad */}
        <div>
          <label className={labelClass}>Cantidad *</label>
          <input
            name="quantity"
            type="number"
            step="0.0001"
            min="0.0001"
            max="1000000"
            required
            className={fieldClass}
            placeholder="0.00"
          />
          {selectedItem && (
            <p className="mt-1 text-xs text-gray-500">
              Unidad:{" "}
              {selectedUnit
                ? `${selectedUnit.name} (${selectedUnit.abbreviation})`
                : selectedItem.unit}
            </p>
          )}
        </div>

        {/* Costo unitario — solo para ENTRADA */}
        {movType === "ENTRADA" && (
          <div>
            <label className={labelClass}>Costo unitario (VES) *</label>
            <MoneyInput
              bare
              required
              value={unitCost}
              onValueChange={setUnitCost}
              className={fieldClass}
              placeholder="0,00"
            />
            <p className="mt-1 text-xs text-gray-500">
              Actualizará el CPP del producto al contabilizarse.
            </p>
          </div>
        )}

        {/* Fecha */}
        <div>
          <label className={labelClass}>Fecha *</label>
          <input
            name="date"
            type="date"
            required
            defaultValue={today}
            max={today}
            className={fieldClass}
          />
        </div>

        {/* R-02: Tasa BCV histórica */}
        <div>
          <label className={labelClass}>
            Tasa BCV (Bs./$){" "}
            {movType === "ENTRADA" ? (
              <span className="text-red-500">*</span>
            ) : (
              <span className="font-normal text-gray-400">(referencial)</span>
            )}
          </label>
          <input
            name="exchangeRateVes"
            type="number"
            step="0.0001"
            min="0.0001"
            required={movType === "ENTRADA"}
            defaultValue={currentBcvRate ?? ""}
            className={fieldClass}
            placeholder="Ej: 549.3716"
          />
          <p className="mt-1 text-xs text-gray-400">
            Tasa BCV oficial a la fecha del movimiento. Se archiva permanentemente para
            trazabilidad.
          </p>
        </div>

        {/* R-03: Referencia obligatoria */}
        <div className="sm:col-span-2">
          <label className={labelClass}>
            Referencia de documento <span className="text-red-500">*</span>
          </label>
          <input
            name="reference"
            required
            minLength={3}
            className={fieldClass}
            placeholder={
              movType === "ENTRADA"
                ? "Nro. factura de compra o guía de entrega (ej: F-001-2345)"
                : movType === "SALIDA"
                  ? "Nro. orden de despacho o factura emitida (ej: FAC-2026-001)"
                  : "Nro. acta de ajuste de inventario (ej: ACTA-INV-001)"
            }
            maxLength={100}
          />
          <p className="mt-1 text-xs text-gray-400">
            Código de Comercio Art. 32: cada movimiento debe respaldarse con un documento fuente
            identificable.
          </p>
        </div>

        {/* R-04: Cuenta contrapartida */}
        {needsCounterpart && (
          <div className="sm:col-span-2">
            <label htmlFor={counterpartId} className={labelClass}>
              Cuenta contrapartida{" "}
              <span aria-hidden="true" className="text-red-600">
                *
              </span>
            </label>
            <AccountCombobox
              id={counterpartId}
              accounts={counterpartOptions}
              value={counterpartAccountId}
              onChange={setCounterpartAccountId}
              aria-invalid={counterpartInvalid || undefined}
              aria-describedby={`${counterpartId}-hint${counterpartInvalid ? ` ${counterpartId}-error` : ""}`}
            />
            <p id={`${counterpartId}-hint`} className="mt-1 text-xs text-gray-600">
              {COUNTERPART_HINT[movType]}
            </p>
            {!hasCounterpartOptions && (
              <p className="mt-1 text-xs text-amber-800">
                {isEntrada ? COUNTERPART_EMPTY_MESSAGE : AJUSTE_COUNTERPART_EMPTY_MESSAGE}
              </p>
            )}
            {counterpartInvalid && (
              <p id={`${counterpartId}-error`} className="mt-1 text-xs font-medium text-red-600">
                Selecciona una cuenta de movimiento.
              </p>
            )}
          </div>
        )}

        {/* Notas */}
        <div className="sm:col-span-2">
          <label className={labelClass}>Notas</label>
          <input
            name="notes"
            className={fieldClass}
            placeholder="Observaciones del movimiento"
            maxLength={500}
          />
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <strong>Nota:</strong> El movimiento quedará en estado <strong>BORRADOR</strong> hasta que
        el Contador lo contabilice. El stock físico no cambia hasta la contabilización.
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Registrando...
            </span>
          ) : (
            "Registrar movimiento"
          )}
        </button>
      </div>
    </form>
  );
}
