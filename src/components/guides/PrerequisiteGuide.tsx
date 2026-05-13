"use client";
// src/components/guides/PrerequisiteGuide.tsx
// Driver.js guided tour when a prerequisite is missing.
// Renders a static banner immediately + starts the tour on mount to
// highlight the nav link that takes the user to the correct setup page.

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircleIcon } from "lucide-react";

export type PrerequisiteType = "period" | "accounts" | "employees";

interface PrerequisiteConfig {
  title: string;
  description: string;
  fixLabel: string;
  fixHref: (companyId: string) => string;
  tourDescription: string;
}

const CONFIGS: Record<PrerequisiteType, PrerequisiteConfig> = {
  period: {
    title: "Sin período contable abierto",
    description:
      "Para registrar movimientos necesitas un período contable activo. Abre uno antes de continuar.",
    fixLabel: "Gestionar Períodos",
    fixHref: (id) => `/company/${id}/periods`,
    tourDescription:
      'Haz clic en "Períodos" en la barra de navegación para crear o abrir un período contable.',
  },
  accounts: {
    title: "Sin plan de cuentas configurado",
    description:
      "Para registrar asientos necesitas cuentas contables. Configura el plan de cuentas primero.",
    fixLabel: "Plan de Cuentas",
    fixHref: (id) => `/company/${id}/accounts`,
    tourDescription: 'Ve a "Plan de Cuentas" para importar o crear las cuentas contables.',
  },
  employees: {
    title: "Sin empleados activos",
    description:
      "Para procesar una nómina necesitas al menos un empleado activo registrado en el sistema.",
    fixLabel: "Registrar Empleados",
    fixHref: (id) => `/company/${id}/payroll/employees/new`,
    tourDescription:
      'Ve a "Empleados" en el módulo de Nómina para registrar el primer empleado.',
  },
};

interface Props {
  type: PrerequisiteType;
  companyId: string;
}

export function PrerequisiteGuide({ type, companyId }: Props) {
  const cfg = CONFIGS[type];
  const href = cfg.fixHref(companyId);

  useEffect(() => {
    let driverObj: { drive: () => void; destroy: () => void } | null = null;

    async function startTour() {
      const [{ driver }, driverCss] = await Promise.all([
        import("driver.js"),
        import("driver.js/dist/driver.css"),
      ]);
      void driverCss;

      const anchor = document.querySelector<HTMLElement>(`a[href="${href}"]`);
      if (!anchor) return;

      driverObj = driver({
        animate: true,
        overlayOpacity: 0.25,
        popoverClass: "cf-guide-popover",
        steps: [
          {
            element: `a[href="${href}"]`,
            popover: {
              title: cfg.title,
              description: cfg.tourDescription,
              side: "bottom",
              align: "start",
              nextBtnText: "Entendido →",
              showButtons: ["next"],
            },
          },
        ],
      });
      driverObj.drive();
    }

    startTour();

    return () => {
      driverObj?.destroy();
    };
  }, [href, cfg.title, cfg.tourDescription]);

  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="font-semibold text-amber-800">{cfg.title}</p>
          <p className="mt-1 text-sm text-amber-700">{cfg.description}</p>
        </div>
      </div>
      <Link
        href={href}
        className="inline-flex items-center rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
      >
        {cfg.fixLabel} →
      </Link>
    </div>
  );
}
