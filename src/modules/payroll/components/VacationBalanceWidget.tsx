// src/modules/payroll/components/VacationBalanceWidget.tsx
// Feature 9: widget de saldo de días de vacaciones para el perfil del empleado.

import { SunIcon, CalendarIcon, ClockIcon, CheckCircle2Icon } from "lucide-react";
import type { VacationBalanceRow } from "../services/VacationRequestService";

type Props = {
  balance: VacationBalanceRow;
};

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`flex flex-col items-center rounded-xl border p-3 ${color}`}>
      <Icon className="mb-1 h-4 w-4 opacity-70" aria-hidden />
      <span className="text-xl font-bold leading-none">{value}</span>
      <span className="mt-1 text-center text-xs opacity-80">{label}</span>
    </div>
  );
}

export function VacationBalanceWidget({ balance }: Props) {
  const {
    yearsOfService,
    daysAccrued,
    initialBalance,
    daysUsed,
    daysPending,
    daysAvailable,
  } = balance;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-4">
      <div className="flex items-center gap-2">
        <SunIcon className="h-4 w-4 text-amber-500" aria-hidden />
        <h3 className="text-sm font-semibold text-zinc-700">Saldo de Vacaciones</h3>
        <span className="text-xs text-zinc-400">
          ({yearsOfService} año{yearsOfService !== 1 ? "s" : ""} de servicio — LOTTT Art. 190)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          icon={SunIcon}
          label="Causados"
          value={daysAccrued + initialBalance}
          color="bg-amber-50 text-amber-700 border-amber-100"
        />
        <StatCard
          icon={CheckCircle2Icon}
          label="Usados"
          value={daysUsed}
          color="bg-zinc-50 text-zinc-600 border-zinc-100"
        />
        <StatCard
          icon={ClockIcon}
          label="Pendientes"
          value={daysPending}
          color="bg-blue-50 text-blue-600 border-blue-100"
        />
        <StatCard
          icon={CalendarIcon}
          label="Disponibles"
          value={daysAvailable}
          color={
            daysAvailable > 0
              ? "bg-green-50 text-green-700 border-green-100"
              : "bg-red-50 text-red-600 border-red-100"
          }
        />
      </div>

      {initialBalance > 0 && (
        <p className="text-xs text-zinc-400">
          Incluye {initialBalance} días de saldo inicial del sistema anterior.
        </p>
      )}
    </div>
  );
}
