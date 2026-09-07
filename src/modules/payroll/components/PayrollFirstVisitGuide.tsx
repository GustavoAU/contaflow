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
// Montada en company/[companyId]/layout.tsx (no en la página de Nómina) a
// propósito: ese layout NO se remonta al navegar entre páginas hermanas
// (Nómina, Tasas de Cambio, Topes Legales, Prestaciones son todas rutas bajo
// el mismo layout), así que el estado sobrevive cuando el usuario sigue el
// link de un paso — antes se perdía la guía al navegar (reportado en vivo
// por Gustavo probando el paso 1: el modal bloqueaba la página destino y al
// cerrarlo se marcaba "vista" para siempre, sin poder retomarla).
//
// Por eso el link de cada paso no cierra el modal, lo MINIMIZA: navega y
// deja un pill flotante ("Continuar guía") en vez de un overlay bloqueando
// la página destino — el usuario puede interactuar libremente con Topes
// Legales/Tasas de Cambio/Prestaciones y retomar el tour cuando quiera, en
// el mismo paso donde lo dejó. El trigger de "primera vez" solo dispara
// estando en el hub de Nómina.
//
// "Vista" es permanente vía localStorage (mismo patrón que cf-ai-tip-shown
// en FloatingAIAssistant y cf-ocr-privacy-ack en InvoiceUploader — try/catch
// porque localStorage puede no estar disponible) y solo se marca al cerrar
// con la X o terminar el tour — nunca al hacer clic en el link de un paso.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

type Visibility = "hidden" | "modal" | "minimized";

export function PayrollFirstVisitGuide({ companyId }: Props) {
  const [visibility, setVisibility] = useState<Visibility>("hidden");
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const steps = useSteps(companyId);
  const pathname = usePathname();
  const hubPath = `/company/${companyId}/payroll`;
  const onHub = pathname === hubPath;

  useEffect(() => {
    // Se re-evalúa en cada navegación (el layout no remonta), pero solo
    // dispara estando en el hub — así el link de un paso puede llevar a otra
    // página sin reabrir/reiniciar la guía. Update funcional: si ya estaba
    // "minimized" (mitad de tour) no la pisa de vuelta a "modal".
    if (!onHub) return;
    queueMicrotask(() => {
      try {
        if (!localStorage.getItem(storageKey(companyId))) {
          setVisibility((v) => (v === "hidden" ? "modal" : v));
        }
      } catch {
        // localStorage no disponible (SSR, cookies bloqueadas) — no mostrar
      }
    });
  }, [companyId, onHub]);

  useEffect(() => {
    if (visibility !== "modal") return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onEscape);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility]);

  function close() {
    setVisibility("hidden");
    setStep(0);
    try { localStorage.setItem(storageKey(companyId), "1"); } catch { /* noop */ }
  }

  function minimize() {
    setVisibility("minimized");
  }

  function reopenFresh() {
    setStep(0);
    setVisibility("modal");
  }

  function resume() {
    setVisibility("modal");
  }

  if (visibility === "hidden") {
    // El pill de reabrir desde cero solo aparece en el hub — en las páginas
    // destino de cada paso no hay dónde "volver" a montarlo si el usuario
    // cerró del todo, así que evitamos mostrarlo fuera de lugar.
    if (!onHub) return null;
    return (
      <button
        type="button"
        onClick={reopenFresh}
        className="fixed bottom-24 right-6 z-40 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <CircleHelpIcon className="size-3.5" />
        Ver guía de Nómina
      </button>
    );
  }

  if (visibility === "minimized") {
    // Sin overlay: el usuario está aquí para interactuar de verdad con la
    // página destino (Topes Legales / Tasas de Cambio / Prestaciones).
    return (
      <button
        type="button"
        onClick={resume}
        className="fixed bottom-24 right-6 z-40 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
      >
        <CircleHelpIcon className="size-3.5" />
        Continuar guía ({step + 1}/{steps.length})
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
          onClick={minimize}
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
