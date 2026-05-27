"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, ChevronDownIcon, ChevronRightIcon, PackageSearchIcon } from "lucide-react";
import { createFixedAssetAction, getExpensesForAssetImportAction } from "../actions/fixed-asset.actions";
import type { ExpenseForAssetImport } from "../actions/fixed-asset.actions";

type AccountOption = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  accounts: AccountOption[];
  onSuccess?: (assetId: string) => void;
  onCancel?: () => void;
};

const METHOD_OPTIONS = [
  { value: "LINEA_RECTA", label: "Línea Recta" },
  { value: "SUMA_DIGITOS", label: "Suma de Dígitos de los Años" },
  { value: "UNIDADES_PRODUCCION", label: "Unidades de Producción" },
] as const;

function findBestMatch(pool: AccountOption[], keywords: string[]): string {
  if (pool.length === 0) return "";
  if (pool.length === 1) return pool[0]!.id;
  const lower = keywords.map((k) => k.toLowerCase());
  let bestId = "";
  let bestScore = 0;
  for (const a of pool) {
    const text = `${a.code} ${a.name}`.toLowerCase();
    const score = lower.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = a.id;
    }
  }
  return bestId;
}

type AssetInput = {
  companyId: string;
  name: string;
  description: string | null;
  assetAccountId: string;
  depreciationAccountId: string;
  accDepreciationAccountId: string;
  acquisitionDate: Date;
  acquisitionCost: string;
  acquisitionCurrency: "VES" | "USD" | "EUR";
  bcvRateAtAcquisition: string | null;
  residualValue: string;
  usefulLifeMonths: number;
  depreciationMethod: "LINEA_RECTA" | "SUMA_DIGITOS" | "UNIDADES_PRODUCCION";
  totalUnits: number | null;
  location: string | null;
  responsible: string | null;
  invoiceNumber: string | null;
  providerRif: string | null;
  serialNumber: string | null;
  serviceStartDate: Date | null;
  internalCode: string | null;
};

export function FixedAssetForm({ companyId, accounts, onSuccess, onCancel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"LINEA_RECTA" | "SUMA_DIGITOS" | "UNIDADES_PRODUCCION">("LINEA_RECTA");
  const [showLegal, setShowLegal] = useState(false);
  // FC-03: warn if SENIAT deductibility fields are missing
  const [showLegalWarning, setShowLegalWarning] = useState(false);
  const [pendingInput, setPendingInput] = useState<AssetInput | null>(null);
  // N2: moneda de adquisición
  const [acquisitionCurrency, setAcquisitionCurrency] = useState<"VES" | "USD" | "EUR">("VES");
  // N4: pre-fillable controlled fields
  const [assetNameVal, setAssetNameVal] = useState("");
  const [descriptionVal, setDescriptionVal] = useState("");
  const [acquisitionDateVal, setAcquisitionDateVal] = useState("");
  const [acquisitionCostVal, setAcquisitionCostVal] = useState("");
  const [invoiceNumberVal, setInvoiceNumberVal] = useState("");
  const [providerRifVal, setProviderRifVal] = useState("");
  // N4: import from expense
  const [showExpenseImport, setShowExpenseImport] = useState(false);
  const [expenseList, setExpenseList] = useState<ExpenseForAssetImport[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [selectedExpenseId, setSelectedExpenseId] = useState("");

  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const contraAssetAccounts = accounts.filter((a) => a.type === "CONTRA_ASSET");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  const [assetAccountId, setAssetAccountId] = useState(() =>
    findBestMatch(assetAccounts, ["propiedad", "planta", "equipo", "inmueble", "vehiculo", "vehículo", "maquinaria", "mobiliario", "activo fijo"])
  );
  const [depreciationAccountId, setDepreciationAccountId] = useState(() =>
    findBestMatch(expenseAccounts, ["depreci", "amortiz"])
  );
  const [accDepreciationAccountId, setAccDepreciationAccountId] = useState(() =>
    findBestMatch(contraAssetAccounts, ["acumul", "depreci", "amortiz"])
  );

  function doSubmit(input: AssetInput) {
    startTransition(async () => {
      const r = await createFixedAssetAction(input);
      if (r.success) {
        onSuccess?.(r.data);
      } else {
        setError(r.error);
      }
    });
  }

  // N4: load expenses and toggle import panel
  async function handleToggleExpenseImport() {
    const opening = !showExpenseImport;
    setShowExpenseImport(opening);
    if (opening && expenseList.length === 0 && !expenseLoading) {
      setExpenseLoading(true);
      const res = await getExpensesForAssetImportAction(companyId);
      setExpenseLoading(false);
      if (res.success) setExpenseList(res.data);
    }
  }

  // N4: pre-fill form when expense is selected
  function handleExpenseSelect(expenseId: string) {
    setSelectedExpenseId(expenseId);
    const exp = expenseList.find((e) => e.id === expenseId);
    if (!exp) return;
    setAcquisitionCostVal(exp.amount);
    if (exp.invoiceDate) setAcquisitionDateVal(exp.invoiceDate);
    if (exp.invoiceNumber) setInvoiceNumberVal(exp.invoiceNumber);
    if (exp.vendorRif) setProviderRifVal(exp.vendorRif);
    if (exp.concept && !assetNameVal) setAssetNameVal(exp.concept);
    if (exp.concept && !descriptionVal) setDescriptionVal(exp.concept);
    const cur = exp.currency as "VES" | "USD" | "EUR";
    if (cur === "VES" || cur === "USD" || cur === "EUR") setAcquisitionCurrency(cur);
    // Expand legal section so user sees the pre-filled SENIAT fields
    setShowLegal(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setShowLegalWarning(false);
    const fd = new FormData(e.currentTarget);

    const input: AssetInput = {
      companyId,
      name: fd.get("name") as string,
      description: (fd.get("description") as string) || null,
      assetAccountId,
      depreciationAccountId,
      accDepreciationAccountId,
      acquisitionDate: new Date(fd.get("acquisitionDate") as string),
      acquisitionCost: fd.get("acquisitionCost") as string,
      acquisitionCurrency,
      bcvRateAtAcquisition: (fd.get("bcvRateAtAcquisition") as string) || null,
      residualValue: (fd.get("residualValue") as string) || "0",
      usefulLifeMonths: parseInt(fd.get("usefulLifeMonths") as string),
      depreciationMethod: method,
      totalUnits: method === "UNIDADES_PRODUCCION"
        ? parseInt(fd.get("totalUnits") as string)
        : null,
      location:    (fd.get("location") as string) || null,
      responsible: (fd.get("responsible") as string) || null,
      // FC-02 campos legales
      invoiceNumber:    (fd.get("invoiceNumber") as string) || null,
      providerRif:      (fd.get("providerRif") as string) || null,
      serialNumber:     (fd.get("serialNumber") as string) || null,
      serviceStartDate: fd.get("serviceStartDate") ? new Date(fd.get("serviceStartDate") as string) : null,
      internalCode:     (fd.get("internalCode") as string) || null,
    };

    // FC-03: si faltan ambos campos de deducibilidad SENIAT, advertir antes de guardar
    if (!input.invoiceNumber && !input.providerRif) {
      setPendingInput(input);
      setShowLegalWarning(true);
      setShowLegal(true); // expande la sección para que el usuario pueda completarla
      return;
    }

    doSubmit(input);
  }

  const fieldClass = "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* N4: Importar desde Gasto confirmado */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/40">
        <button
          type="button"
          onClick={handleToggleExpenseImport}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50/60"
        >
          <span className="flex items-center gap-2">
            {showExpenseImport ? (
              <ChevronDownIcon className="h-4 w-4 shrink-0" />
            ) : (
              <PackageSearchIcon className="h-4 w-4 shrink-0" />
            )}
            Importar desde Gasto confirmado
            <span className="text-xs font-normal text-emerald-600">(pre-llena datos desde Compras)</span>
          </span>
          {!showExpenseImport && <span className="text-xs font-normal text-emerald-500">clic para expandir</span>}
        </button>

        {showExpenseImport && (
          <div className="border-t border-emerald-100 px-4 pb-4 pt-3">
            {expenseLoading ? (
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Cargando gastos confirmados…
              </div>
            ) : expenseList.length === 0 ? (
              <p className="text-sm text-emerald-700">
                No hay gastos confirmados disponibles. Confirma un gasto en el módulo de Gastos primero.
              </p>
            ) : (
              <div className="space-y-2">
                <label className={labelClass}>Seleccionar gasto a importar</label>
                <select
                  value={selectedExpenseId}
                  onChange={(e) => handleExpenseSelect(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">— Seleccionar gasto —</option>
                  {expenseList.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.invoiceDate ? `[${e.invoiceDate}] ` : ""}
                      {e.concept} — {e.currency} {e.amount}
                      {e.vendorName ? ` | ${e.vendorName}` : ""}
                    </option>
                  ))}
                </select>
                {selectedExpenseId && (
                  <p className="text-xs text-emerald-700">
                    ✓ Datos importados. Revisa y ajusta los campos antes de guardar.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Datos básicos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nombre del activo *</label>
          <input
            name="name"
            required
            className={fieldClass}
            placeholder="Ej: Vehículo Toyota Hilux 2026"
            value={assetNameVal}
            onChange={(e) => setAssetNameVal(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Descripción</label>
          <input
            name="description"
            className={fieldClass}
            placeholder="Descripción opcional"
            value={descriptionVal}
            onChange={(e) => setDescriptionVal(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Ubicación</label>
          <input name="location" className={fieldClass} placeholder="Ej: Sede Caracas, Piso 3" maxLength={200} />
        </div>

        <div>
          <label className={labelClass}>Responsable / Custodio</label>
          <input name="responsible" className={fieldClass} placeholder="Nombre del custodio" maxLength={150} />
        </div>

        <div>
          <label className={labelClass}>Fecha de adquisición *</label>
          <input
            name="acquisitionDate"
            type="date"
            required
            className={fieldClass}
            value={acquisitionDateVal}
            onChange={(e) => setAcquisitionDateVal(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>Moneda de adquisición</label>
          <select
            value={acquisitionCurrency}
            onChange={(e) => setAcquisitionCurrency(e.target.value as "VES" | "USD" | "EUR")}
            className={fieldClass}
          >
            <option value="VES">VES — Bolívar Soberano</option>
            <option value="USD">USD — Dólar Americano</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </div>

        <div>
          <label className={labelClass}>
            Costo de adquisición <span className="font-normal text-zinc-400">({acquisitionCurrency})</span> *
          </label>
          <input
            name="acquisitionCost"
            type="number"
            step="0.01"
            min="0.01"
            required
            className={fieldClass}
            placeholder="0.00"
            value={acquisitionCostVal}
            onChange={(e) => setAcquisitionCostVal(e.target.value)}
          />
        </div>

        {acquisitionCurrency !== "VES" && (
          <div className="sm:col-span-2">
            <label className={labelClass}>
              Tasa BCV a la fecha de adquisición <span className="font-normal text-zinc-400">(Bs./{acquisitionCurrency})</span>
            </label>
            <input
              name="bcvRateAtAcquisition"
              type="number" step="0.0001" min="0.0001"
              className={fieldClass}
              placeholder="Ej: 36.50"
            />
            <p className="mt-1 text-xs text-zinc-400">
              Tasa de cambio BCV vigente al día de la compra. Permite calcular el costo histórico en VES para el Libro de Activos Fijos SENIAT.
            </p>
          </div>
        )}

        <div>
          <label className={labelClass}>Valor residual <span className="font-normal text-zinc-400">(Bs.)</span></label>
          <input name="residualValue" type="number" step="0.01" min="0" defaultValue="0" className={fieldClass} />
        </div>

        <div>
          <label className={labelClass}>Vida útil (meses) *</label>
          <input name="usefulLifeMonths" type="number" min="1" required className={fieldClass} placeholder="Ej: 60" />
        </div>
      </div>

      {/* Método de depreciación */}
      <div>
        <label className={labelClass}>Método de depreciación *</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className={fieldClass}
        >
          {METHOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {method === "UNIDADES_PRODUCCION" && (
        <div>
          <label className={labelClass}>Total de unidades a producir *</label>
          <input name="totalUnits" type="number" min="1" required className={fieldClass} placeholder="Ej: 100000" />
        </div>
      )}

      {/* Cuentas contables */}
      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="text-sm font-semibold text-gray-700 px-1">Cuentas contables</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-2">
          <div>
            <label className={labelClass}>Cuenta del activo *</label>
            {assetAccounts.length === 0 ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                Sin cuentas tipo Activo. Créalas en el Plan de Cuentas.
              </p>
            ) : (
              <select
                value={assetAccountId}
                onChange={(e) => setAssetAccountId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">Seleccionar cuenta ASSET…</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-11 text-zinc-400">Tipo ASSET — propiedad, planta y equipo</p>
          </div>
          <div>
            <label className={labelClass}>Gasto depreciación *</label>
            {expenseAccounts.length === 0 ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                Sin cuentas tipo Gasto. Créalas en el Plan de Cuentas.
              </p>
            ) : (
              <select
                value={depreciationAccountId}
                onChange={(e) => setDepreciationAccountId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">Seleccionar cuenta EXPENSE…</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-11 text-zinc-400">Tipo EXPENSE — gasto por depreciación</p>
          </div>
          <div>
            <label className={labelClass}>Dep. acumulada *</label>
            {contraAssetAccounts.length === 0 ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Sin cuentas tipo CONTRA_ASSET. Créalas en el Plan de Cuentas.
              </p>
            ) : (
              <select
                value={accDepreciationAccountId}
                onChange={(e) => setAccDepreciationAccountId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">Seleccionar cuenta CONTRA_ASSET…</option>
                {contraAssetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-11 text-zinc-400">Tipo CONTRA_ASSET — depreciación acumulada</p>
          </div>
        </div>
      </fieldset>

      {/* FC-02 — Datos Legales SENIAT (colapsable) */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/40">
        <button
          type="button"
          onClick={() => setShowLegal((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-50/60"
        >
          <span className="flex items-center gap-2">
            {showLegal ? (
              <ChevronDownIcon className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 shrink-0" />
            )}
            Datos Legales / SENIAT
            <span className="text-xs font-normal text-amber-600">(Art. 76 ISLR — requerido para Libro de Activos Fijos)</span>
          </span>
          {!showLegal && <span className="text-xs font-normal text-amber-500">clic para expandir</span>}
        </button>

        {showLegal && (
          <div className="border-t border-amber-100 px-4 pb-4 pt-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Nro. Factura de Compra</label>
                <input
                  name="invoiceNumber"
                  className={fieldClass}
                  placeholder="Ej: 00-000123"
                  maxLength={50}
                  value={invoiceNumberVal}
                  onChange={(e) => setInvoiceNumberVal(e.target.value)}
                />
                <p className="mt-1 text-11 text-zinc-400">Cruce con Libro de Compras IVA</p>
              </div>

              <div>
                <label className={labelClass}>RIF del Proveedor</label>
                <input
                  name="providerRif"
                  className={fieldClass}
                  placeholder="Ej: J-12345678-9"
                  maxLength={20}
                  value={providerRifVal}
                  onChange={(e) => setProviderRifVal(e.target.value)}
                />
                <p className="mt-1 text-11 text-zinc-400">Verificación retenciones ISLR/IVA</p>
              </div>

              <div>
                <label className={labelClass}>Nro. Serial / Placa del bien</label>
                <input
                  name="serialNumber"
                  className={fieldClass}
                  placeholder="Ej: VIN/placa/serial de fabricación"
                  maxLength={100}
                />
                <p className="mt-1 text-11 text-zinc-400">Identificación unívoca del activo físico</p>
              </div>

              <div>
                <label className={labelClass}>Nro. Inventario Interno</label>
                <input
                  name="internalCode"
                  className={fieldClass}
                  placeholder="Ej: AF-2026-001"
                  maxLength={50}
                />
              </div>

              <div>
                <label className={labelClass}>Fecha de Puesta en Servicio</label>
                <input
                  name="serviceStartDate"
                  type="date"
                  className={fieldClass}
                />
                <p className="mt-1 text-11 text-zinc-400">Puede diferir de la fecha de adquisición</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FC-03 — advertencia deducibilidad SENIAT */}
      {showLegalWarning && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm"
        >
          <p className="font-semibold text-amber-900 mb-1">
            ⚠️ Datos SENIAT incompletos — riesgo de rechazo fiscal
          </p>
          <p className="text-xs text-amber-800 mb-3">
            Sin <strong>Nro. de Factura de Compra</strong> y <strong>RIF del Proveedor</strong>,
            este activo puede no ser deducible a efectos del ISLR (Art. 76 LISLR). El SENIAT puede
            objetar la deducción en una fiscalización.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowLegalWarning(false);
                if (pendingInput) doSubmit(pendingInput);
              }}
              className="rounded bg-amber-200 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-300"
            >
              Continuar sin datos SENIAT
            </button>
            <button
              type="button"
              onClick={() => setShowLegalWarning(false)}
              className="rounded border border-amber-300 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
            >
              Completar datos primero
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-5 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {isPending ? "Guardando…" : "Registrar Activo"}
        </button>
      </div>
    </form>
  );
}
