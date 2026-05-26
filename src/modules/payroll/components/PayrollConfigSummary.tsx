"use client";
// src/modules/payroll/components/PayrollConfigSummary.tsx
// Vista de solo lectura de la configuración de nómina (para ACCOUNTANT / ADMINISTRATIVE)

import type { PayrollConfigRow } from "../services/PayrollConfigService";

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);
  if (secs < 60) return "hace un momento";
  if (mins < 60) return `hace ${mins} minuto${mins === 1 ? "" : "s"}`;
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? "" : "s"}`;
  if (days < 30) return `hace ${days} día${days === 1 ? "" : "s"}`;
  if (months < 12) return `hace ${months} mes${months === 1 ? "" : "es"}`;
  return `hace ${years} año${years === 1 ? "" : "s"}`;
}

const SIZE_LABELS: Record<string, string> = {
  SMALL: "< 20 empleados",
  MEDIUM: "20–100 empleados",
  LARGE: "> 100 empleados",
};
const LOTT_LABELS: Record<string, string> = {
  POST_2012: "Post-LOTTT 2012",
  MIXED: "Mixto (pre-1997 + post-2012)",
};
const CURRENCY_LABELS: Record<string, string> = { VES: "VES", USD: "USD", MIXED: "VES + USD" };
const FREQUENCY_LABELS: Record<string, string> = { BIWEEKLY: "Quincenal", MONTHLY: "Mensual" };
const FIDEICOMISO_LABELS: Record<string, string> = {
  EXTERNAL_BANK: "Banco externo",
  INTERNAL: "Contabilidad interna",
};
const CESTA_LABELS: Record<string, string> = { CARD: "Tarjeta", CASH: "Efectivo", NONE: "No aplica" };

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"
      }`}
    >
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

export default function PayrollConfigSummary({ cfg }: { cfg: PayrollConfigRow }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-5 text-sm">
      <div>
        <dt className="text-xs font-medium text-gray-500">Tamaño empresa</dt>
        <dd className="mt-0.5 font-medium">{SIZE_LABELS[cfg.sizeRange]}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">Régimen LOTTT</dt>
        <dd className="mt-0.5 font-medium">{LOTT_LABELS[cfg.lottRegime]}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">IVSS</dt>
        <dd className="mt-0.5"><Badge active={cfg.ivssEnabled} /></dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">INCES</dt>
        <dd className="mt-0.5"><Badge active={cfg.incesEnabled} /></dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">Banavih / FAOV</dt>
        <dd className="mt-0.5"><Badge active={cfg.banavihEnabled} /></dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">Cesta Ticket</dt>
        <dd className="mt-0.5 font-medium">{CESTA_LABELS[cfg.cestaTicketType]}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">Moneda de pago</dt>
        <dd className="mt-0.5 font-medium">{CURRENCY_LABELS[cfg.paymentCurrency]}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-gray-500">Frecuencia</dt>
        <dd className="mt-0.5 font-medium">{FREQUENCY_LABELS[cfg.frequency]}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-xs font-medium text-gray-500">Fideicomiso</dt>
        <dd className="mt-0.5 font-medium">{FIDEICOMISO_LABELS[cfg.fideicomiso]}</dd>
      </div>
      <div className="col-span-2 border-t pt-2">
        <dt className="text-xs text-gray-400">Última actualización</dt>
        <dd className="mt-0.5 text-xs text-gray-500" title={new Date(cfg.updatedAt).toLocaleString("es-VE")}>
          {formatRelative(cfg.updatedAt)}
        </dd>
      </div>
    </dl>
  );
}
