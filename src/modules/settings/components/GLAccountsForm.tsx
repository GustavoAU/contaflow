"use client";

// ADR-026: Formulario de configuración de cuentas GL para causación automática de facturas.
// Permite seleccionar las 6 cuentas contables requeridas y causar retroactivamente
// las facturas que aún no tienen asiento en el Libro Mayor.

import { useState, useTransition } from "react";
import { BookOpenIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveGLConfigAction, postUnbookedInvoicesAction } from "../actions/gl-config.actions";

type Account = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  allAccounts: Account[];
  initialConfig: {
    arAccountId: string | null;
    apAccountId: string | null;
    salesAccountId: string | null;
    purchaseExpenseAccountId: string | null;
    ivaDFAccountId: string | null;
    ivaCFAccountId: string | null;
    fxGainAccountId: string | null;
    fxLossAccountId: string | null;
  };
  initialUnbookedCount: number;
};

const NONE = "__none__";

function AccountSelect({
  id,
  label,
  hint,
  value,
  onChange,
  accounts,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  accounts: Account[];
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Sin asignar..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— Sin asignar —</SelectItem>
          {accounts.map((acc) => (
            <SelectItem key={acc.id} value={acc.id}>
              {acc.code} — {acc.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

export function GLAccountsForm({
  companyId,
  allAccounts,
  initialConfig,
  initialUnbookedCount,
}: Props) {
  const [arAccountId, setArAccountId] = useState(initialConfig.arAccountId ?? NONE);
  const [apAccountId, setApAccountId] = useState(initialConfig.apAccountId ?? NONE);
  const [salesAccountId, setSalesAccountId] = useState(initialConfig.salesAccountId ?? NONE);
  const [purchaseExpenseAccountId, setPurchaseExpenseAccountId] = useState(
    initialConfig.purchaseExpenseAccountId ?? NONE
  );
  const [ivaDFAccountId, setIvaDFAccountId] = useState(initialConfig.ivaDFAccountId ?? NONE);
  const [ivaCFAccountId, setIvaCFAccountId] = useState(initialConfig.ivaCFAccountId ?? NONE);
  const [fxGainAccountId, setFxGainAccountId] = useState(initialConfig.fxGainAccountId ?? NONE);
  const [fxLossAccountId, setFxLossAccountId] = useState(initialConfig.fxLossAccountId ?? NONE);
  const [unbookedCount, setUnbookedCount] = useState(initialUnbookedCount);

  const [isSaving, startSave] = useTransition();
  const [isPosting, startPost] = useTransition();

  const assetAccounts = allAccounts.filter((a) => a.type === "ASSET");
  const liabilityAccounts = allAccounts.filter((a) => a.type === "LIABILITY");
  const revenueAccounts = allAccounts.filter((a) => a.type === "REVENUE");
  const expenseAccounts = allAccounts.filter((a) => a.type === "EXPENSE");

  const toNull = (v: string) => (v === NONE ? null : v);

  const saleConfigComplete =
    arAccountId !== NONE && salesAccountId !== NONE && ivaDFAccountId !== NONE;
  const purchaseConfigComplete =
    apAccountId !== NONE && purchaseExpenseAccountId !== NONE && ivaCFAccountId !== NONE;
  const anyConfigComplete = saleConfigComplete || purchaseConfigComplete;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const result = await saveGLConfigAction({
        companyId,
        arAccountId: toNull(arAccountId),
        apAccountId: toNull(apAccountId),
        salesAccountId: toNull(salesAccountId),
        purchaseExpenseAccountId: toNull(purchaseExpenseAccountId),
        ivaDFAccountId: toNull(ivaDFAccountId),
        ivaCFAccountId: toNull(ivaCFAccountId),
        fxGainAccountId: toNull(fxGainAccountId),
        fxLossAccountId: toNull(fxLossAccountId),
      });
      if (result.success) {
        toast.success("Configuración del Libro Mayor guardada.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handlePostUnbooked() {
    startPost(async () => {
      const result = await postUnbookedInvoicesAction(companyId);
      if (result.success) {
        const { posted, skipped } = result.data;
        setUnbookedCount(0);
        if (posted === 0) {
          toast.info("No había facturas pendientes de causar.");
        } else {
          toast.success(
            `${posted} factura${posted !== 1 ? "s" : ""} causada${posted !== 1 ? "s" : ""} al Libro Mayor.${skipped > 0 ? ` (${skipped} omitida${skipped !== 1 ? "s" : ""} — config incompleta)` : ""}`
          );
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* ── Facturas de Venta ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Facturas de Venta</h3>
          {saleConfigComplete ? (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">
              Activo
            </span>
          ) : (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              Incompleto
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AccountSelect
            id="arAccountId"
            label="Cuentas por Cobrar (CxC)"
            hint="ACTIVO — Dr al emitir factura"
            value={arAccountId}
            onChange={setArAccountId}
            accounts={assetAccounts}
          />
          <AccountSelect
            id="salesAccountId"
            label="Ingresos por Ventas"
            hint="INGRESO — Cr al emitir factura"
            value={salesAccountId}
            onChange={setSalesAccountId}
            accounts={revenueAccounts}
          />
          <AccountSelect
            id="ivaDFAccountId"
            label="IVA Débito Fiscal"
            hint="PASIVO — Cr IVA causado en ventas"
            value={ivaDFAccountId}
            onChange={setIvaDFAccountId}
            accounts={liabilityAccounts}
          />
        </div>
      </div>

      {/* ── Facturas de Compra ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Facturas de Compra</h3>
          {purchaseConfigComplete ? (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">
              Activo
            </span>
          ) : (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              Incompleto
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AccountSelect
            id="purchaseExpenseAccountId"
            label="Gasto / Costo de Compras"
            hint="GASTO — Dr al registrar compra"
            value={purchaseExpenseAccountId}
            onChange={setPurchaseExpenseAccountId}
            accounts={expenseAccounts}
          />
          <AccountSelect
            id="apAccountId"
            label="Cuentas por Pagar (CxP)"
            hint="PASIVO — Cr al registrar compra"
            value={apAccountId}
            onChange={setApAccountId}
            accounts={liabilityAccounts}
          />
          <AccountSelect
            id="ivaCFAccountId"
            label="IVA Crédito Fiscal"
            hint="ACTIVO — Dr IVA soportado en compras"
            value={ivaCFAccountId}
            onChange={setIvaCFAccountId}
            accounts={assetAccounts}
          />
        </div>
      </div>

      {/* ── Diferencial Cambiario (NIC 21 / VEN-NIF BA-5) ─────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Diferencial Cambiario</h3>
          <span className="text-xs text-zinc-400">(NIC 21 / VEN-NIF BA-5)</span>
          {fxGainAccountId !== NONE && fxLossAccountId !== NONE ? (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-0.5">
              Activo
            </span>
          ) : (
            <span className="text-xs text-zinc-400 bg-zinc-50 border border-zinc-200 rounded px-2 py-0.5">
              Opcional
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AccountSelect
            id="fxGainAccountId"
            label="Ganancia Cambiaria"
            hint="INGRESO — Cr cuando la tasa sube en CxC (devaluación)"
            value={fxGainAccountId}
            onChange={setFxGainAccountId}
            accounts={revenueAccounts}
          />
          <AccountSelect
            id="fxLossAccountId"
            label="Pérdida Cambiaria"
            hint="GASTO — Dr cuando la tasa sube en CxP (devaluación)"
            value={fxLossAccountId}
            onChange={setFxLossAccountId}
            accounts={expenseAccounts}
          />
        </div>
      </div>

      {/* ── Acciones ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-4">
        <Button type="submit" disabled={isSaving || isPosting} aria-busy={isSaving}>
          {isSaving && <Loader2Icon className="animate-spin" />}
          <BookOpenIcon />
          {isSaving ? "Guardando..." : "Guardar configuración"}
        </Button>

        {unbookedCount > 0 && anyConfigComplete && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-amber-700">
              <TriangleAlertIcon className="size-4 shrink-0" />
              <span>
                {unbookedCount} factura{unbookedCount !== 1 ? "s" : ""} sin asiento contable
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePostUnbooked}
              disabled={isPosting || isSaving}
              aria-busy={isPosting}
            >
              {isPosting ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              {isPosting ? "Causando..." : "Causar ahora"}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
