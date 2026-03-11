// src/components/onboarding/OnboardingWizard.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpenIcon, CalendarIcon, FileTextIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  companyId: string;
  companyName: string;
};

const STEPS = [
  {
    id: 1,
    icon: BookOpenIcon,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    id: 2,
    icon: CalendarIcon,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    id: 3,
    icon: FileTextIcon,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
];

export function OnboardingWizard({ companyId, companyName }: Props) {
  const [open, setOpen] = useState(true);
  const [current, setCurrent] = useState(0);

  const step = STEPS[current];
  const Icon = step.icon;
  const isLast = current === STEPS.length - 1;

  const CONTENT = [
    {
      title: "Configura tu Plan de Cuentas",
      desc: "Agrega las cuentas contables de tu empresa. Puedes usar los códigos estándar venezolanos o personalizarlos.",
      action: {
        label: "Ir al Plan de Cuentas",
        href: `/company/${companyId}/accounts`,
      },
    },
    {
      title: "Abre tu primer período contable",
      desc: "Define el mes y año de inicio. Sin un período abierto no podrás registrar asientos.",
      action: {
        label: "Ir a Configuración",
        href: `/company/${companyId}/settings`,
      },
    },
    {
      title: "Registra tu primer asiento",
      desc: "Con el plan de cuentas listo y el período abierto, ya puedes comenzar a contabilizar tus operaciones.",
      action: {
        label: "Nuevo Asiento",
        href: `/company/${companyId}/transactions/new`,
      },
    },
  ];

  const content = CONTENT[current];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">¡Bienvenido a ContaFlow!</DialogTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {companyName} — sigue estos pasos para comenzar
          </p>
        </DialogHeader>

        {/* Indicador de pasos */}
        <div className="my-2 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i < current
                    ? "bg-green-500 text-white"
                    : i === current
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-400"
                }`}
              >
                {i < current ? <CheckIcon className="h-4 w-4" /> : s.id}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 ${i < current ? "bg-green-500" : "bg-zinc-100"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Contenido del paso */}
        <div className={`rounded-lg ${step.bg} flex gap-4 p-5`}>
          <div className={`shrink-0 rounded-lg bg-white p-2 shadow-sm`}>
            <Icon className={`h-6 w-6 ${step.color}`} />
          </div>
          <div>
            <p className="font-semibold text-zinc-800">{content.title}</p>
            <p className="mt-1 text-sm text-zinc-600">{content.desc}</p>
          </div>
        </div>

        {/* Acciones */}
        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={() => setOpen(false)}
            className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-600"
          >
            Omitir
          </button>

          <div className="flex gap-2">
            {current > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCurrent(current - 1)}>
                Atrás
              </Button>
            )}

            {!isLast ? (
              <Button size="sm" onClick={() => setCurrent(current + 1)}>
                Siguiente
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={content.action.href} onClick={() => setOpen(false)}>
                  {content.action.label}
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Link directo del paso actual */}
        {!isLast && (
          <div className="text-center">
            <Link
              href={content.action.href}
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 hover:underline"
            >
              {content.action.label} →
            </Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
