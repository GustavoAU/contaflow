"use client";
// src/modules/payroll/components/PayrollFirstVisitGuide.tsx
//
// Guía interactiva de primera visita al hub de Nómina — pedida por Gustavo
// (2026-09-07) después de una sesión real donde tuvo que ser guiado paso a
// paso para: confirmar el salario mínimo en Topes Legales, entender la
// diferencia Activa/Promedio de la tasa BCV para el interés sobre
// prestaciones, y saber cuándo usar "Poner al día trimestres atrasados" en
// vez de la acumulación trimestral normal. Nada de esto tenía guía dentro de
// la app — cubre justo esos huecos, no la configuración inicial (ya cubierta
// por PayrollWizard/activate-modules).
//
// Aparece solo una vez por empresa (localStorage, mismo patrón que
// cf-ai-tip-shown en FloatingAIAssistant y cf-ocr-privacy-ack en
// InvoiceUploader — try/catch porque localStorage puede no estar disponible).
// Un link "Ver guía" cerca del título permite reabrirla cuando se quiera.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { XIcon, ChevronRightIcon, ChevronLeftIcon, CircleHelpIcon } from "lucide-react";

type Props = { companyId: string };

function storageKey(companyId: string): string {
  return `cf-payroll-guide-seen-${companyId}`;
}

type Step = {
  title: string;
  body: React.ReactNode;
  href: string;
  hrefLabel: string;
};

function useSteps(companyId: string): Step[] {
  return [
    {
      title: "1/3 — Salario mínimo (Topes Legales)",
      body: (
        <>
          <p>
            Los topes de IVSS, INCES, FAOV y RPE son múltiplos del salario mínimo
            vigente. La app te avisa si el valor registrado no coincide con la
            referencia — pero un valor <strong>correcto que lleva años sin cambiar</strong> es
            normal en Venezuela (el salario mínimo está congelado en Bs. 130 desde
            marzo 2022), así que no debe tratarse como un error.
          </p>
          <p className="mt-2">
            Si el aviso de tu pantalla dice solo &laquo;confirma que sigue vigente&raquo;
            (no &laquo;no coincide&raquo;), basta con entrar a Topes Legales y darle{" "}
            <strong>&laquo;Sigue vigente&raquo;</strong> — no hace falta cambiar el número.
          </p>
        </>
      ),
      href: `/company/${companyId}/payroll/legal-thresholds`,
      hrefLabel: "Ir a Topes Legales",
    },
    {
      title: "2/3 — Tasas de Cambio (BCV)",
      body: (
        <>
          <p>
            El widget &laquo;BCV&raquo; del encabezado solo trae la tasa de <strong>hoy</strong>.
            Para completar un historial (ej. un trimestre de prestaciones atrasado),
            usa la página de Tasas de Cambio, que sí permite elegir una fecha pasada.
          </p>
          <p className="mt-2">
            Al registrar la tasa para <strong>intereses sobre prestaciones</strong> (Art. 143
            LOTTT), el aviso oficial del BCV publica dos tasas distintas — usa{" "}
            <strong>Promedio</strong> (Tercer Aparte), no Activa (esa es para mora/litigios,
            Cuarto Aparte). La pantalla ya lo explica y lo trae seleccionado por
            defecto.
          </p>
        </>
      ),
      href: `/company/${companyId}/exchange-rates`,
      hrefLabel: "Ir a Tasas de Cambio",
    },
    {
      title: "3/3 — Prestaciones Sociales",
      body: (
        <>
          <p>
            &laquo;Ejecutar acumulación&raquo; solo funciona para el trimestre en curso —
            exige un período contable abierto. Si un trimestre pasado quedó sin
            acumular (empresa nueva en ContaFlow, o el período ya cerró), ese botón
            no puede corregirlo.
          </p>
          <p className="mt-2">
            Para eso está <strong>&laquo;Poner al día trimestres atrasados&raquo;</strong>, un poco
            más abajo en la misma pantalla: revisa a cada empleado desde su fecha de
            contratación y acumula lo que falte, sin tocar lo que ya está registrado.
          </p>
        </>
      ),
      href: `/company/${companyId}/payroll/benefits`,
      hrefLabel: "Ir a Prestaciones Sociales",
    },
  ];
}

export function PayrollFirstVisitGuide({ companyId }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const steps = useSteps(companyId);

  useEffect(() => {
    // queueMicrotask (no un setState directo en el cuerpo del efecto) — mismo
    // patrón que el callout de FloatingAIAssistant (cf-ai-tip-shown).
    queueMicrotask(() => {
      try {
        if (!localStorage.getItem(storageKey(companyId))) setOpen(true);
      } catch {
        // localStorage no disponible (SSR, cookies bloqueadas) — no mostrar
      }
    });
  }, [companyId]);

  useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onEscape);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setStep(0);
    try { localStorage.setItem(storageKey(companyId), "1"); } catch { /* noop */ }
  }

  function reopen() {
    setStep(0);
    setOpen(true);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={reopen}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
      >
        <CircleHelpIcon className="size-3.5" />
        Ver guía
      </button>
    );
  }

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payroll-guide-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="payroll-guide-title" className="text-base font-semibold text-gray-900">
            {current.title}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar guía"
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="mt-3 text-sm text-gray-600">{current.body}</div>

        <Link
          href={current.href}
          onClick={close}
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline"
        >
          {current.hrefLabel} →
        </Link>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-blue-600" : "bg-gray-200"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeftIcon className="size-3.5" />
                Anterior
              </button>
            )}
            {isLast ? (
              <button
                type="button"
                onClick={close}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Entendido
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Siguiente
                <ChevronRightIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
