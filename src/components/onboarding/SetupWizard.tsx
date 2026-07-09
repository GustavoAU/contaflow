"use client";

// src/components/onboarding/SetupWizard.tsx
// Wizard de configuración inicial — modal Dialog con dos paths:
//   • Empezar de cero (4 pasos)
//   • Migrar desde otro sistema (guía visual + redirect a pasos de configuración)
// Componentes de paso + guías de migración: src/components/onboarding/setup-wizard-steps.tsx (split por tamaño de archivo)

import { useState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openPeriodAction } from "@/modules/accounting/actions/period.actions";
import { onboardingUpdateCompanyProfileAction } from "@/modules/company/actions/onboarding.actions";
import {
  MONTHS,
  PathChoice,
  ScratchStepBar,
  StepCompanyData,
  StepChartOfAccounts,
  StepOpenPeriod,
  StepGLConfig,
  MigrateSystemChoice,
  MigrationGuide,
  CompletedScreen,
  type WizardPath,
  type MigrationSystem,
} from "./setup-wizard-steps";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface WizardProgress {
  path:            WizardPath | null;
  step:            number;
  migSystem:       MigrationSystem | null;
  completed:       boolean;
}

function defaultProgress(): WizardProgress {
  return { path: null, step: 0, migSystem: null, completed: false };
}

function loadProgress(companyId: string): WizardProgress {
  try {
    const raw = localStorage.getItem(`cf-wizard-${companyId}`);
    if (!raw) return defaultProgress();
    return { ...defaultProgress(), ...JSON.parse(raw) } as WizardProgress;
  } catch {
    return defaultProgress();
  }
}

function saveProgress(companyId: string, p: WizardProgress) {
  try { localStorage.setItem(`cf-wizard-${companyId}`, JSON.stringify(p)); } catch { /* silent */ }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  companyId:   string;
  companyName: string;
  companyRif:  string | null;
  hasAccounts: boolean;   // true si ya hay cuentas → skip account step
  hasPeriod:   boolean;   // true si ya hay período abierto → skip period step
  forceOpen?:  boolean;   // para el botón "Reabrir guía" en el dashboard
  onClose?:    () => void;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function SetupWizard({
  companyId,
  companyName,
  companyRif,
  hasAccounts,
  hasPeriod,
  forceOpen,
  onClose,
}: Props) {
  const [open,       setOpen]      = useState(false);
  const [progress,   setProgress]  = useState<WizardProgress>(defaultProgress);
  const [isPending,  startTransition] = useTransition();

  // Estado local de los formularios
  const [companyForm, setCompanyForm] = useState({
    address: "", telefono: "", email: "", ciiu: "", actividad: "", isSpecialContributor: false,
  });
  const [periodForm, setPeriodForm] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [accountsConfirmed, setAccountsConfirmed] = useState(hasAccounts);

  // ─── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const p = loadProgress(companyId);
    setProgress(p);
    // Auto-abrir si no está completado/descartado Y la empresa no tiene cuentas aún
    if (!p.completed && !hasAccounts) {
      setOpen(true);
    }
  }, [companyId, hasAccounts]);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function updateProgress(patch: Partial<WizardProgress>) {
    setProgress((prev) => {
      const next = { ...prev, ...patch };
      saveProgress(companyId, next);
      return next;
    });
  }

  function handleClose() {
    setOpen(false);
    onClose?.();
  }

  function markCompleted() {
    updateProgress({ completed: true });
    handleClose();
    toast.success("¡Configuración inicial completada! Tu empresa está lista.", { duration: 5000 });
  }

  // ─── Actions de pasos ────────────────────────────────────────────────────────

  function handleSaveCompanyProfile() {
    startTransition(async () => {
      const res = await onboardingUpdateCompanyProfileAction({
        companyId,
        ...companyForm,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Datos guardados");
      updateProgress({ step: 2 });
    });
  }

  function handleOpenPeriod() {
    startTransition(async () => {
      const res = await openPeriodAction({
        companyId,
        year: periodForm.year,
        month: periodForm.month,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(`Período ${MONTHS[periodForm.month - 1]} ${periodForm.year} abierto`);
      updateProgress({ step: 4 });
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const { path, step, migSystem } = progress;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {progress.completed
              ? "✅ Configuración completada"
              : path === null
              ? "¡Bienvenido a ContaFlow!"
              : path === "migrate"
              ? "Guía de migración"
              : "Configuración inicial"}
          </DialogTitle>
          <p className="text-sm text-zinc-500 mt-0.5">
            {companyName}{companyRif ? ` · ${companyRif}` : ""}
          </p>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {/* ── PATH CHOICE ──────────────────────────────────────────────── */}
          {path === null && (
            <PathChoice
              onChoose={(p) => updateProgress({ path: p, step: 1 })}
              onClose={handleClose}
            />
          )}

          {/* ── SCRATCH PATH ─────────────────────────────────────────────── */}
          {path === "scratch" && step > 0 && step < 5 && (
            <>
              <ScratchStepBar current={step} />
              {step === 1 && (
                <StepCompanyData
                  form={companyForm}
                  onChange={(f) => setCompanyForm((p) => ({ ...p, ...f }))}
                  onSave={handleSaveCompanyProfile}
                  onSkip={() => updateProgress({ step: 2 })}
                  isPending={isPending}
                />
              )}
              {step === 2 && (
                <StepChartOfAccounts
                  companyId={companyId}
                  confirmed={accountsConfirmed}
                  onConfirm={() => setAccountsConfirmed(true)}
                  onBack={() => updateProgress({ step: 1 })}
                  onNext={() => updateProgress({ step: hasPeriod ? 4 : 3 })}
                />
              )}
              {step === 3 && (
                <StepOpenPeriod
                  form={periodForm}
                  onChange={(f) => setPeriodForm((p) => ({ ...p, ...f }))}
                  onOpen={handleOpenPeriod}
                  onBack={() => updateProgress({ step: 2 })}
                  onSkip={() => updateProgress({ step: 4 })}
                  isPending={isPending}
                  hasPeriod={hasPeriod}
                />
              )}
              {step === 4 && (
                <StepGLConfig
                  companyId={companyId}
                  onBack={() => updateProgress({ step: hasPeriod ? 2 : 3 })}
                  onDone={markCompleted}
                />
              )}
            </>
          )}

          {/* ── MIGRATE PATH ─────────────────────────────────────────────── */}
          {path === "migrate" && step === 1 && (
            <MigrateSystemChoice
              onChoose={(s) => updateProgress({ migSystem: s, step: 2 })}
              onBack={() => updateProgress({ path: null, step: 0 })}
            />
          )}
          {path === "migrate" && step === 2 && migSystem && (
            <MigrationGuide
              system={migSystem}
              companyId={companyId}
              onBack={() => updateProgress({ step: 1 })}
              onStartSetup={() => updateProgress({ path: "scratch", step: 1 })}
            />
          )}

          {/* ── COMPLETED ────────────────────────────────────────────────── */}
          {progress.completed && (
            <CompletedScreen companyId={companyId} onClose={handleClose} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
