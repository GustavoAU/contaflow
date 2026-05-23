"use client";

// src/modules/notifications/components/NotificationBell.tsx
// Campana de alertas en la navbar — se monta solo para roles ACCOUNTING.

import { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { Bell, AlertCircle, AlertTriangle, Info, X, Loader2Icon } from "lucide-react";
import { getNotificationsAction } from "../actions/notifications.actions";
import type { NotificationAlert, AlertSeverity } from "../services/NotificationService";

type Props = { companyId: string };

const SEVERITY_ICON: Record<AlertSeverity, React.ElementType> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-blue-500",
};

const SEVERITY_BG: Record<AlertSeverity, string> = {
  error: "bg-red-50 border-red-100",
  warning: "bg-amber-50 border-amber-100",
  info: "bg-blue-50 border-blue-100",
};

export function NotificationBell({ companyId }: Props) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<NotificationAlert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cargar alertas al abrir por primera vez, o al re-abrir para refrescar
  function handleToggle() {
    setOpen((v) => !v);
    if (!open) {
      startTransition(async () => {
        const r = await getNotificationsAction(companyId);
        if (r.success) {
          setAlerts(r.data);
          setLoaded(true);
        }
      });
    }
  }

  const errorCount = alerts.filter((a) => a.severity === "error").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const totalCount = alerts.length;

  // Badge color: rojo si hay errores, amarillo si hay warnings, azul si solo info
  const badgeColor =
    errorCount > 0 ? "bg-red-500" : warningCount > 0 ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleToggle}
        className="relative rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {totalCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-10 font-bold text-white ${badgeColor}`}
          >
            {totalCount > 9 ? "9+" : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 rounded-xl border bg-white shadow-lg dark:bg-zinc-950">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Notificaciones
              {totalCount > 0 && (
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {totalCount}
                </span>
              )}
            </h3>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="max-h-80 overflow-y-auto">
            {isPending && !loaded && (
              <p className="py-8 text-center text-xs text-zinc-400">Cargando alertas...</p>
            )}

            {loaded && alerts.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8">
                <Bell className="h-8 w-8 text-zinc-200" />
                <p className="text-xs text-zinc-400">Sin alertas pendientes</p>
              </div>
            )}

            {alerts.map((alert) => {
              const Icon = SEVERITY_ICON[alert.severity];
              return (
                <Link
                  key={alert.id}
                  href={alert.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 last:border-b-0 ${SEVERITY_BG[alert.severity]}`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SEVERITY_COLOR[alert.severity]}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
                      {alert.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                      {alert.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Footer — refresh */}
          {loaded && (
            <div className="border-t px-4 py-2">
              <button
                onClick={() => {
                  startTransition(async () => {
                    const r = await getNotificationsAction(companyId);
                    if (r.success) setAlerts(r.data);
                  });
                }}
                disabled={isPending}
                className="text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-50"
              >
                {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Actualizando..." : "Actualizar"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
