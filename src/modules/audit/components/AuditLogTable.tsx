"use client";

// src/modules/audit/components/AuditLogTable.tsx
// Tabla paginada de auditoría con filtros y diff oldValue↔newValue

import { useState, useTransition, useCallback } from "react";
import { Loader2Icon, FileDownIcon } from "lucide-react";
import { listAuditLogsAction, exportAuditLogPDFAction } from "../actions/audit.actions";
import type { AuditLogRow, AuditLogPage } from "../services/AuditLogService";

const ENTITY_LABELS: Record<string, string> = {
  Transaction: "Asiento",
  Invoice: "Factura",
  InvoicePayment: "Pago",
  Account: "Cuenta",
  AccountingPeriod: "Período",
  BankStatement: "Estado Bancario",
  BankTransaction: "Transacción Bancaria",
  Company: "Empresa",
  ExchangeRate: "Tasa de Cambio",
  FiscalYearClose: "Cierre Fiscal",
  FixedAsset: "Activo Fijo",
  IGTFTransaction: "IGTF",
  INPCRate: "INPC",
  InflationAdjustment: "Ajuste por Inflación",
  InventoryItem: "Ítem Inventario",
  InventoryMovement: "Movimiento Inventario",
  PaymentRecord: "Registro de Pago",
  Retencion: "Retención",
};

type Props = {
  companyId: string;
  entityNames: string[];
  initialData: AuditLogPage;
};

function DiffView({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs text-blue-600 hover:underline"
      >
        Ver cambios
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {oldValue != null && (
        <div>
          <p className="text-xs font-semibold text-red-600 mb-0.5">Antes</p>
          <pre className="overflow-x-auto rounded bg-red-50 border border-red-100 px-2 py-1.5 text-xs text-red-800 max-w-xs">
            {JSON.stringify(oldValue, null, 2)}
          </pre>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-green-600 mb-0.5">Después</p>
        <pre className="overflow-x-auto rounded bg-green-50 border border-green-100 px-2 py-1.5 text-xs text-green-800 max-w-xs">
          {JSON.stringify(newValue, null, 2)}
        </pre>
      </div>
      <button
        onClick={() => setExpanded(false)}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        Colapsar
      </button>
    </div>
  );
}

export function AuditLogTable({ companyId, entityNames, initialData }: Props) {
  const [data, setData] = useState<AuditLogPage>(initialData);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [entityName, setEntityName] = useState("");
  const [userId, setUserId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // OM-04: PDF export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const fetchPage = useCallback(
    (page: number) => {
      startTransition(async () => {
        const r = await listAuditLogsAction({
          companyId,
          entityName: entityName || undefined,
          userId: userId || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          pageSize: 25,
        });
        if (r.success) {
          setData(r.data);
          setError(null);
        } else {
          setError(r.error);
        }
      });
    },
    [companyId, entityName, userId, dateFrom, dateTo]
  );

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchPage(1);
  }

  // OM-04: descarga PDF firmado del registro de auditoría
  async function handleExportPDF() {
    setIsExporting(true);
    setExportMsg(null);
    try {
      const result = await exportAuditLogPDFAction(companyId, {
        entityName: entityName || undefined,
        userId: userId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      if (!result.success) {
        setExportMsg(`Error: ${result.error}`);
        return;
      }
      // Descargar el PDF
      const binary = atob(result.data.pdf);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(
        `${result.data.rowCount} registros exportados. SHA-256: ${result.data.contentHash.slice(0, 16)}…${result.data.signed ? " ✓ Firmado" : " (sin firma)"}`
      );
    } finally {
      setIsExporting(false);
    }
  }

  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <form
        onSubmit={handleFilterSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      >
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Entidad</label>
          <select
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todas</option>
            {entityNames.map((n) => (
              <option key={n} value={n}>
                {ENTITY_LABELS[n] ?? n}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ID de usuario</label>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="user_..."
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Cargando..." : "Filtrar"}
        </button>

        <button
          type="button"
          onClick={() => {
            setEntityName("");
            setUserId("");
            setDateFrom("");
            setDateTo("");
            fetchPage(1);
          }}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
        >
          Limpiar
        </button>

        {/* OM-04: Exportar PDF firmado */}
        <button
          type="button"
          onClick={handleExportPDF}
          disabled={isExporting}
          aria-busy={isExporting}
          className="ml-auto flex items-center gap-1.5 rounded border border-emerald-600 px-4 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {isExporting ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <FileDownIcon className="h-3.5 w-3.5" />}
          {isExporting ? "Generando PDF..." : "Exportar PDF"}
        </button>
      </form>

      {/* OM-04: Mensaje post-exportación */}
      {exportMsg && (
        <div className={`rounded border px-4 py-2 text-xs font-mono ${exportMsg.startsWith("Error") ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {exportMsg}
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">Fecha / Hora</th>
              <th className="px-4 py-3 text-left">Entidad</th>
              <th className="px-4 py-3 text-left">Acción</th>
              <th className="px-4 py-3 text-left">ID Entidad</th>
              <th className="px-4 py-3 text-left">Usuario</th>
              <th className="px-4 py-3 text-left">Cambios</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  No hay registros de auditoría con los filtros aplicados.
                </td>
              </tr>
            ) : (
              data.rows.map((row: AuditLogRow) => (
                <tr key={row.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    <div>{new Date(row.createdAt).toLocaleDateString("es-VE")}</div>
                    <div className="font-mono text-gray-400">
                      {new Date(row.createdAt).toLocaleTimeString("es-VE")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                      {ENTITY_LABELS[row.entityName] ?? row.entityName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-700">
                      {row.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 max-w-[120px] truncate">
                    {row.entityId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 max-w-[140px] truncate">
                    {row.userId}
                  </td>
                  <td className="px-4 py-3">
                    <DiffView oldValue={row.oldValue} newValue={row.newValue} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <p>
          {data.total === 0
            ? "Sin resultados"
            : `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} de ${data.total.toLocaleString("es-VE")} registros`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => fetchPage(data.page - 1)}
            disabled={data.page <= 1 || isPending}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Anterior
          </button>
          <span className="px-3 py-1 text-gray-500">
            Pág. {data.page} / {totalPages || 1}
          </span>
          <button
            onClick={() => fetchPage(data.page + 1)}
            disabled={data.page >= totalPages || isPending}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
