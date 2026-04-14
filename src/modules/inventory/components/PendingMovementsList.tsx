"use client";

// src/modules/inventory/components/PendingMovementsList.tsx
// Lista de movimientos DRAFT pendientes de contabilización — dominio ACCOUNTANT

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { postMovementAction } from "../actions/inventory-accounting.actions";
import { voidDraftMovementAction } from "../actions/inventory-operations.actions";

export type PendingMovement = {
  id: string;
  type: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  date: string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  item: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    stockQuantity: string;
    averageCost: string;
    accountId: string | null;
    cogsAccountId: string | null;
  };
};

type Props = {
  movements: PendingMovement[];
  companyId: string;
  canPost: boolean; // ACCOUNTING roles
};

const TYPE_LABELS: Record<string, { label: string; className: string }> = {
  ENTRADA: { label: "Entrada", className: "bg-green-100 text-green-800" },
  SALIDA: { label: "Salida", className: "bg-red-100 text-red-800" },
  AJUSTE: { label: "Ajuste", className: "bg-yellow-100 text-yellow-800" },
};

export function PendingMovementsList({ movements, companyId, canPost }: Props) {
  const [postingId, setPostingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [isPendingPost, startPost] = useTransition();
  const [isPendingVoid, startVoid] = useTransition();

  function handlePost(movementId: string, itemName: string) {
    if (
      !confirm(
        `¿Contabilizar el movimiento de "${itemName}"?\nSe generará un asiento contable automático y el stock se actualizará.`
      )
    )
      return;

    setPostingId(movementId);
    startPost(async () => {
      const r = await postMovementAction({ movementId, companyId });
      setPostingId(null);
      if (r.success) {
        toast.success(`Movimiento contabilizado — Asiento: ${r.data.transactionId}`);
      } else {
        toast.error(r.error);
      }
    });
  }

  function handleVoid(movementId: string, itemName: string) {
    if (!confirm(`¿Anular el borrador de movimiento de "${itemName}"? Esta acción no genera asiento.`))
      return;

    setVoidingId(movementId);
    startVoid(async () => {
      const r = await voidDraftMovementAction({ movementId, companyId });
      setVoidingId(null);
      if (r.success) {
        toast.success(`Movimiento anulado.`);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {movements.length === 0 ? (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-6 text-center">
          <p className="text-sm font-medium text-green-800">Sin movimientos pendientes</p>
          <p className="mt-1 text-xs text-green-600">
            Todos los movimientos han sido contabilizados.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-center">Tipo</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3 text-right">Costo Unit.</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Fecha</th>
                <th className="px-4 py-3 text-left">Referencia</th>
                <th className="px-4 py-3 text-left">Cuentas</th>
                {canPost && <th className="px-4 py-3 text-center">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map((mov) => {
                const typeInfo = TYPE_LABELS[mov.type] ?? {
                  label: mov.type,
                  className: "bg-gray-100 text-gray-600",
                };
                const hasAccounts = !!mov.item.accountId;
                const hasCogs = !!mov.item.cogsAccountId || mov.type === "ENTRADA";
                const canPostThis = canPost && hasAccounts && hasCogs;
                const isPosting = postingId === mov.id && isPendingPost;
                const isVoiding = voidingId === mov.id && isPendingVoid;

                return (
                  <tr key={mov.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{mov.item.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{mov.item.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeInfo.className}`}
                      >
                        {typeInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-800">
                      {parseFloat(mov.quantity).toLocaleString("es-VE", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      <span className="text-xs text-gray-400">{mov.item.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {parseFloat(mov.unitCost).toLocaleString("es-VE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                      {parseFloat(mov.totalCost).toLocaleString("es-VE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(mov.date).toLocaleDateString("es-VE")}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {mov.reference ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {!hasAccounts ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                          Sin cuenta inventario
                        </span>
                      ) : !hasCogs && mov.type !== "ENTRADA" ? (
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700">
                          Sin cuenta COGS
                        </span>
                      ) : (
                        <span className="text-xs text-green-600">Cuentas OK</span>
                      )}
                    </td>
                    {canPost && (
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handlePost(mov.id, mov.item.name)}
                            disabled={!canPostThis || isPosting || isVoiding}
                            title={!canPostThis ? "Configure las cuentas contables del producto primero" : ""}
                            className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isPosting ? (
                              <span className="flex items-center gap-1">
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Contabilizando...
                              </span>
                            ) : "Contabilizar"}
                          </button>
                          <button
                            onClick={() => handleVoid(mov.id, mov.item.name)}
                            disabled={isPosting || isVoiding}
                            className="text-xs text-red-600 hover:underline disabled:opacity-40"
                          >
                            {isVoiding ? "Anulando..." : "Anular"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
