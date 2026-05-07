"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, MinusIcon, InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MODULE_CONFIG, MODULE_KEYS, GRANTABLE_ROLES, hasBaseAccess } from "@/lib/app-modules";
import { grantPermissionAction, revokePermissionAction } from "../actions/permission.actions";
import type { AppModule } from "@/lib/app-modules";
import type { UserRole } from "@prisma/client";

const ROLE_LABEL: Record<string, string> = {
  ACCOUNTANT: "Contador",
  ADMINISTRATIVE: "Administrativo",
  VIEWER: "Observador",
};

type Props = {
  companyId: string;
  currentUserRole: UserRole;
  /** Array {role, module} de la BD — grants activos */
  initialGrants: { role: string; module: string }[];
};

export function PermissionsMatrix({ companyId, currentUserRole, initialGrants }: Props) {
  const [grants, setGrants] = useState(
    () => new Set(initialGrants.map((g) => `${g.role}:${g.module}`))
  );
  const [pending, setIsPending] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isManager = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  function handleToggle(role: UserRole, module: AppModule) {
    if (!isManager) return;
    const key = `${role}:${module}`;
    const isGranted = grants.has(key);
    setIsPending(key);

    startTransition(async () => {
      const result = isGranted
        ? await revokePermissionAction({ companyId, role, module })
        : await grantPermissionAction({ companyId, role, module });

      if (!result.success) {
        toast.error(result.error);
      } else {
        setGrants((prev) => {
          const next = new Set(prev);
          if (isGranted) next.delete(key);
          else next.add(key);
          return next;
        });
        toast.success(isGranted ? "Permiso revocado." : "Permiso otorgado.");
      }
      setIsPending(null);
    });
  }

  return (
    <div className="space-y-4">
      {/* Leyenda */}
      <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Los checkboxes verdes fijos son permisos del rol base (no se pueden quitar).
          Los checkboxes editables amplían el acceso de ese rol en <strong>esta empresa</strong> solamente.
          OWNER y ADMIN siempre tienen acceso total.
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900">
              <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">
                Módulo
              </th>
              {GRANTABLE_ROLES.map((role) => (
                <th
                  key={role}
                  className="px-4 py-3 text-center font-medium text-zinc-600 dark:text-zinc-400"
                >
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {MODULE_KEYS.map((module) => {
              const config = MODULE_CONFIG[module];
              return (
                <tr key={module} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  {/* Nombre del módulo */}
                  <td className="px-4 py-3">
                    <p className="font-medium">{config.label}</p>
                    <p className="text-xs text-zinc-500">{config.description}</p>
                  </td>

                  {/* Celdas por rol */}
                  {GRANTABLE_ROLES.map((role) => {
                    const isBase = hasBaseAccess(role, module);
                    const isGranted = grants.has(`${role}:${module}`);
                    const hasAccess = isBase || isGranted;
                    const cellKey = `${role}:${module}`;
                    const isLoading = pending === cellKey;

                    return (
                      <td key={role} className="px-4 py-3 text-center">
                        {isBase ? (
                          // Permiso base — fijo, no editable
                          <div className="flex items-center justify-center" title="Permiso del rol base">
                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-green-100 dark:bg-green-900/40">
                              <CheckIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                            </div>
                          </div>
                        ) : isManager ? (
                          // Editable por ADMIN/OWNER
                          <button
                            onClick={() => handleToggle(role, module)}
                            disabled={isLoading}
                            aria-busy={isLoading}
                            aria-label={
                              hasAccess
                                ? `Revocar ${config.label} para ${ROLE_LABEL[role]}`
                                : `Otorgar ${config.label} para ${ROLE_LABEL[role]}`
                            }
                            className="mx-auto flex h-7 w-7 items-center justify-center rounded-md border-2 transition-colors disabled:opacity-50"
                            style={
                              isGranted
                                ? { backgroundColor: "rgb(220 252 231)", borderColor: "rgb(134 239 172)" }
                                : { borderColor: "rgb(212 212 216)", backgroundColor: "transparent" }
                            }
                          >
                            {isLoading ? (
                              <MinusIcon className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                            ) : isGranted ? (
                              <CheckIcon className="h-4 w-4 text-green-600" />
                            ) : null}
                          </button>
                        ) : (
                          // Solo lectura (VIEWER, ACCOUNTANT no-manager)
                          <div className="flex items-center justify-center">
                            {hasAccess ? (
                              <Badge variant="secondary" className="text-xs">Sí</Badge>
                            ) : (
                              <span className="text-xs text-zinc-400">—</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isManager && (
        <p className="text-xs text-zinc-500">
          Solo el Propietario o Administrador pueden modificar permisos.
        </p>
      )}
    </div>
  );
}
