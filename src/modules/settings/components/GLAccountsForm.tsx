"use client";

// ADR-026: Formulario de configuración de cuentas GL para causación automática de facturas.
// Permite seleccionar las 6 cuentas contables requeridas y causar retroactivamente
// las facturas que aún no tienen asiento en el Libro Mayor.
//
// SPEC-012 B2: los once selectores son `AccountCombobox` (`clearable`: todos son opcionales). «Sin asignar» es
// "" en el estado y viaja como `null`. `allAccounts` trae títulos Y cuentas de movimiento; los títulos solo se
// ven como encabezados. Q4: si un valor guardado ya no es elegible EN LA LISTA DE SU CAMPO (título, cuenta
// eliminada o de otro tipo), `SavedAccountsAlert` lo lista desde el primer render y el guardado queda bloqueado
// (botón deshabilitado + `submit` que retorna) hasta reemplazarlo o quitarlo.

import { useId, useState, useTransition } from "react";
import { BookOpenIcon, Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { SavedAccountsAlert } from "@/components/accounting/SavedAccountsAlert";
import {
  isSelectableAccountId,
  unselectableSavedAccounts,
  type AccountWithType,
} from "@/lib/account-search";
import { saveGLConfigAction, postUnbookedInvoicesAction } from "../actions/gl-config.actions";

// `isPostable` es OBLIGATORIO: sin él el combobox trataría todas las cuentas como títulos.
type Account = AccountWithType;

type Props = {
  companyId: string;
  allAccounts: Account[];
  isSpecialContributor: boolean; // ADR-030 audit fix: CE debe configurar IGTF payable
  initialConfig: {
    arAccountId: string | null;
    apAccountId: string | null;
    salesAccountId: string | null;
    purchaseExpenseAccountId: string | null;
    inventoryAccountId: string | null;
    ivaDFAccountId: string | null;
    ivaCFAccountId: string | null;
    ivaRetentionPayableAccountId: string | null; // GAP-03
    fxGainAccountId: string | null;
    fxLossAccountId: string | null;
    igtfPayableAccountId: string | null; // ADR-030
    ivaRetentionReceivableAccountId: string | null; // Riesgo-6 audit
  };
  initialUnbookedCount: number;
};

// Los 11 campos de cuenta, en el orden en que aparecen en pantalla (es también el orden de la alerta de Q4).
// `type` es el tipo de cuenta que ESE campo ofrece: cada valor se evalúa contra su propia lista, no contra el plan.
const GL_FIELDS = {
  arAccountId: {
    label: "Cuentas por Cobrar (CxC)",
    hint: "ACTIVO — Dr al emitir factura",
    type: "ASSET",
  },
  salesAccountId: {
    label: "Ingresos por Ventas",
    hint: "INGRESO — Cr al emitir factura",
    type: "REVENUE",
  },
  ivaDFAccountId: {
    label: "IVA Débito Fiscal",
    hint: "PASIVO — Cr IVA causado en ventas",
    type: "LIABILITY",
  },
  inventoryAccountId: {
    label: "Inventario de Mercancías",
    hint: "ACTIVO — Dr al registrar compra (inventario perpetuo)",
    type: "ASSET",
  },
  apAccountId: {
    label: "Cuentas por Pagar (CxP)",
    hint: "PASIVO — Cr al registrar compra (neto si hay retención)",
    type: "LIABILITY",
  },
  ivaCFAccountId: {
    label: "IVA Crédito Fiscal",
    hint: "ACTIVO — Dr IVA soportado en compras",
    type: "ASSET",
  },
  // GAP-03: cuenta de retenciones IVA por pagar (opcional)
  ivaRetentionPayableAccountId: {
    label: "Retenciones IVA por Pagar",
    hint: "PASIVO — Cr retención IVA al registrar compra con agente de retención (opcional)",
    type: "LIABILITY",
  },
  // Riesgo-6 / Prov. 0049: solo se muestra a Contribuyentes Especiales.
  ivaRetentionReceivableAccountId: {
    label: "IVA Retenido por Cobrar",
    hint: "ACTIVO — Dr IVA retenido al cobrar de un cliente CE (Prov. 0049)",
    type: "ASSET",
  },
  // ADR-030
  igtfPayableAccountId: {
    label: "IGTF por Pagar",
    hint: "PASIVO — Cr IGTF 3% causado en cobros en divisas (opcional)",
    type: "LIABILITY",
  },
  fxGainAccountId: {
    label: "Ganancia Cambiaria",
    hint: "INGRESO — Cr cuando la tasa sube en CxC (devaluación)",
    type: "REVENUE",
  },
  fxLossAccountId: {
    label: "Pérdida Cambiaria",
    hint: "GASTO — Dr cuando la tasa sube en CxP (devaluación)",
    type: "EXPENSE",
  },
} as const;

type GLKey = keyof typeof GL_FIELDS;
const GL_KEYS = Object.keys(GL_FIELDS) as GLKey[];

/** Un selector de cuenta opcional: etiqueta asociada, ayuda enlazada y botón «Quitar la cuenta». */
function GLAccountField({
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
      <AccountCombobox
        id={id}
        accounts={accounts}
        value={value}
        onChange={onChange}
        clearable
        placeholder="Sin asignar — buscar cuenta…"
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {hint}
      </p>
    </div>
  );
}

export function GLAccountsForm({
  companyId,
  allAccounts,
  isSpecialContributor,
  initialConfig,
  initialUnbookedCount,
}: Props) {
  const alertId = useId();
  // «Sin asignar» es "" (ya no hay centinela): las cuentas guardadas entran tal cual, `null` = "".
  const [values, setValues] = useState<Record<GLKey, string>>(
    () =>
      Object.fromEntries(GL_KEYS.map((key) => [key, initialConfig[key] ?? ""])) as Record<
        GLKey,
        string
      >
  );
  const [unbookedCount, setUnbookedCount] = useState(initialUnbookedCount);

  const [isSaving, startSave] = useTransition();
  const [isPosting, startPost] = useTransition();

  // Cada lista lleva los títulos de su tipo (encabezados del combobox); el combobox decide qué es elegible.
  const pools: Record<(typeof GL_FIELDS)[GLKey]["type"], Account[]> = {
    ASSET: allAccounts.filter((a) => a.type === "ASSET"),
    LIABILITY: allAccounts.filter((a) => a.type === "LIABILITY"),
    REVENUE: allAccounts.filter((a) => a.type === "REVENUE"),
    EXPENSE: allAccounts.filter((a) => a.type === "EXPENSE"),
  };
  const poolOf = (key: GLKey) => pools[GL_FIELDS[key].type];
  // D1 / Q4: un campo está «configurado» solo si su valor es una cuenta de MOVIMIENTO de SU lista; un título o
  // una cuenta que ya no existe NO cuenta (antes bastaba con `!== NONE`).
  const isSet = (key: GLKey) => isSelectableAccountId(poolOf(key), values[key]);

  // «IVA Retenido por Cobrar» solo se muestra a Contribuyentes Especiales: oculto, no se puede corregir y
  // por tanto no entra en la alerta; si su valor guardado no es elegible se guarda como null.
  const visibleKeys = GL_KEYS.filter(
    (key) => key !== "ivaRetentionReceivableAccountId" || isSpecialContributor
  );
  const problems = unselectableSavedAccounts(
    visibleKeys.map((key) => ({
      key,
      label: GL_FIELDS[key].label,
      value: values[key],
      accounts: poolOf(key),
    }))
  );
  const blocked = problems.length > 0;

  const toNull = (key: GLKey) => {
    const value = values[key];
    if (value === "") return null;
    // Oculto y no elegible → null. Los valores válidos (también los del campo oculto) no se tocan.
    return visibleKeys.includes(key) || isSet(key) ? value : null;
  };

  const saleConfigComplete =
    isSet("arAccountId") && isSet("salesAccountId") && isSet("ivaDFAccountId");
  // COMPRA usa inventoryAccountId (ASSET 1115) — método inventario perpetuo
  const purchaseConfigComplete =
    isSet("apAccountId") && isSet("inventoryAccountId") && isSet("ivaCFAccountId");
  const anyConfigComplete = saleConfigComplete || purchaseConfigComplete;

  function renderField(key: GLKey) {
    const { label, hint } = GL_FIELDS[key];
    return (
      <GLAccountField
        key={key}
        id={key}
        label={label}
        hint={hint}
        value={values[key]}
        onChange={(next) => setValues((prev) => ({ ...prev, [key]: next }))}
        accounts={poolOf(key)}
      />
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Defensa en profundidad (Q4): el botón ya está deshabilitado, pero un `submit` (Enter) no debe guardar.
    if (blocked) return;
    startSave(async () => {
      const result = await saveGLConfigAction({
        companyId,
        arAccountId: toNull("arAccountId"),
        apAccountId: toNull("apAccountId"),
        salesAccountId: toNull("salesAccountId"),
        purchaseExpenseAccountId: null, // legacy periódico — no usado en causación perpetua
        inventoryAccountId: toNull("inventoryAccountId"),
        ivaDFAccountId: toNull("ivaDFAccountId"),
        ivaCFAccountId: toNull("ivaCFAccountId"),
        ivaRetentionPayableAccountId: toNull("ivaRetentionPayableAccountId"), // GAP-03
        fxGainAccountId: toNull("fxGainAccountId"),
        fxLossAccountId: toNull("fxLossAccountId"),
        igtfPayableAccountId: toNull("igtfPayableAccountId"), // ADR-030
        ivaRetentionReceivableAccountId: toNull("ivaRetentionReceivableAccountId"), // Riesgo-6
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
      {/* Q4: cuentas guardadas que ya no se pueden usar; bloquean el guardado hasta corregirlas. */}
      <SavedAccountsAlert id={alertId} problems={problems} />

      {/* ── Facturas de Venta ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Facturas de Venta</h3>
          {saleConfigComplete ? (
            <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">
              Activo
            </span>
          ) : (
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
              Incompleto
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {renderField("arAccountId")}
          {renderField("salesAccountId")}
          {renderField("ivaDFAccountId")}
        </div>
      </div>

      {/* ── Facturas de Compra ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Facturas de Compra</h3>
          {purchaseConfigComplete ? (
            <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">
              Activo
            </span>
          ) : (
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
              Incompleto
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {renderField("inventoryAccountId")}
          {renderField("apAccountId")}
          {renderField("ivaCFAccountId")}
        </div>
        {/* GAP-03: cuenta de retenciones IVA por pagar (opcional) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {renderField("ivaRetentionPayableAccountId")}
        </div>
      </div>

      {/* ── IVA Retenido por Cobrar (Riesgo-6 / Prov. 0049) ──────────────────── */}
      {isSpecialContributor && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">IVA Retenido en Cobros</h3>
            <span className="text-xs text-zinc-400">(Prov. 0049 — Agente de Retención CE)</span>
            {isSet("ivaRetentionReceivableAccountId") ? (
              <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">
                Activo
              </span>
            ) : (
              <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                ⚠️ Recomendado — Contribuyente Especial
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Cuando un cliente CE retiene el IVA (75%/100%), el cobro recibido es menor al total
            facturado. Configure esta cuenta para que el asiento sea{" "}
            <span className="font-medium">
              Dr. Banco (neto) + Dr. IVA Ret. x Cobrar = Cr. CxC (total)
            </span>
            . La cuenta debe ser de tipo <span className="font-medium">ACTIVO</span> (cuenta 1135 o
            equivalente).
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {renderField("ivaRetentionReceivableAccountId")}
          </div>
        </div>
      )}

      {/* ── Pagos en Divisas — IGTF (ADR-030) ───────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Pagos en Divisas (IGTF)</h3>
          <span className="text-xs text-zinc-400">(ADR-030 · GL auto-posting)</span>
          {isSet("igtfPayableAccountId") ? (
            <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">
              Activo
            </span>
          ) : isSpecialContributor ? (
            <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
              ⚠️ Requerido — Contribuyente Especial
            </span>
          ) : (
            <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-400">
              Opcional
            </span>
          )}
        </div>
        {isSpecialContributor && !isSet("igtfPayableAccountId") && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <strong>Atención:</strong> Esta empresa es Contribuyente Especial. Bajo la Ley IGTF
            (Art. 4 núm. 3) y la Providencia SNAT/2022/000013, debe actuar como agente de percepción
            del 3% IGTF en todos los cobros en divisas. Configure esta cuenta para que los asientos
            GL reflejen correctamente el pasivo IGTF por enterar al SENIAT.
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          Si se configura, cada cobro en divisas generará automáticamente el asiento{" "}
          <span className="font-medium">Dr. Banco / Cr. CxC / Cr. IGTF por Pagar</span>. La cuenta
          debe ser de tipo <span className="font-medium">PASIVO</span> (cuenta 2115 o equivalente).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {renderField("igtfPayableAccountId")}
        </div>
      </div>

      {/* ── Diferencial Cambiario (NIC 21 / VEN-NIF BA-5) ─────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Diferencial Cambiario</h3>
          <span className="text-xs text-zinc-400">(NIC 21 / VEN-NIF BA-5)</span>
          {isSet("fxGainAccountId") && isSet("fxLossAccountId") ? (
            <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-600">
              Activo
            </span>
          ) : (
            <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-400">
              Opcional
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {renderField("fxGainAccountId")}
          {renderField("fxLossAccountId")}
        </div>
      </div>

      {/* ── Acciones ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="submit"
          disabled={isSaving || isPosting || blocked}
          aria-busy={isSaving}
          aria-describedby={blocked ? alertId : undefined}
        >
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
              {isPosting ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              {isPosting ? "Causando..." : "Causar ahora"}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
