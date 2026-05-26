"use client";

// src/components/onboarding/SetupWizard.tsx
// Wizard de configuración inicial — modal Dialog con dos paths:
//   • Empezar de cero (4 pasos)
//   • Migrar desde otro sistema (guía visual + redirect a pasos de configuración)

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BuildingIcon,
  BookOpenIcon,
  CalendarIcon,
  LinkIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  FileSpreadsheetIcon,
  DatabaseIcon,
  PackageIcon,
  InfoIcon,
} from "lucide-react";
import { openPeriodAction } from "@/modules/accounting/actions/period.actions";
import { onboardingUpdateCompanyProfileAction } from "@/modules/company/actions/onboarding.actions";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type WizardPath = "scratch" | "migrate";
type MigrationSystem = "excel" | "monica" | "odoo";

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

// ─── Constantes ───────────────────────────────────────────────────────────────

const SCRATCH_STEPS = [
  { id: 1, label: "Empresa",          icon: BuildingIcon },
  { id: 2, label: "Plan de Cuentas",  icon: BookOpenIcon },
  { id: 3, label: "Período",          icon: CalendarIcon },
  { id: 4, label: "Cuentas GL",       icon: LinkIcon },
];

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

// ─── Guías de migración ───────────────────────────────────────────────────────

const MIGRATION_GUIDES: Record<MigrationSystem, { title: string; steps: { what: string; how: string; where: string }[] }> = {
  excel: {
    title: "Excel / CSV",
    steps: [
      {
        what: "Plan de Cuentas",
        how: "Exporta tu catálogo con columnas: Código, Nombre, Tipo (Activo/Pasivo/Patrimonio/Ingreso/Egreso).",
        where: "ContaFlow → Importar → Descargar Plantilla → Llenar y Subir",
      },
      {
        what: "Clientes y Proveedores",
        how: "Lista con columnas: RIF, Nombre, Dirección, Email, Teléfono.",
        where: "ContaFlow → Clientes (o Proveedores) → agregar uno a uno o pedir importación masiva",
      },
      {
        what: "Saldos iniciales (apertura)",
        how: "Balance de comprobación a la fecha de corte con saldo de cada cuenta.",
        where: "ContaFlow → Asientos → Nuevo → Tipo: Apertura (un asiento con débitos y créditos que cuadren)",
      },
      {
        what: "Facturas pendientes de cobro/pago",
        how: "Exporta las facturas con status Pendiente o Parcial.",
        where: "ContaFlow → Facturas → Nueva Factura (ingresar manualmente las pendientes) → Registrar Pago para las parciales",
      },
    ],
  },
  monica: {
    title: "Mónica / Profit Plus",
    steps: [
      {
        what: "Plan de Cuentas",
        how: "Mónica: Utilidades → Exportar → Catálogo de Cuentas. Profit Plus: Contabilidad → Plan de Cuentas → Exportar Excel.",
        where: "ContaFlow → Importar → Subir el Excel (revisa que las columnas coincidan con la plantilla)",
      },
      {
        what: "Clientes / Proveedores",
        how: "Mónica: Reportes → Clientes → Listado general. Profit Plus: CxC/CxP → Clientes → Exportar.",
        where: "ContaFlow → Clientes / Proveedores → agregar desde el listado exportado",
      },
      {
        what: "Cartera pendiente CxC",
        how: "Mónica: Reportes → CxC → Antigüedad de Saldos. Profit Plus: CxC → Antigüedad → Exportar.",
        where: "ContaFlow → Facturas (una factura por cada documento pendiente) → Cuentas por Cobrar",
      },
      {
        what: "Cartera pendiente CxP",
        how: "Mónica: Reportes → CxP → Antigüedad. Profit Plus: CxP → Antigüedad → Exportar.",
        where: "ContaFlow → Facturas (tipo Compra) → Cuentas por Pagar",
      },
      {
        what: "Saldo de cuentas (apertura)",
        how: "Mónica: Contabilidad → Balance de Comprobación a la fecha de corte. Profit Plus: GL → Balance.",
        where: "ContaFlow → Asientos → Nuevo → Asiento de Apertura (un solo asiento que cuadre el balance)",
      },
    ],
  },
  odoo: {
    title: "Odoo / SAP / ERP",
    steps: [
      {
        what: "Plan de Cuentas",
        how: "Odoo: Contabilidad → Configuración → Plan de Cuentas → ⬇ Exportar. SAP: Transacción FS00 o S_ALR_87012326.",
        where: "ContaFlow → Importar → Adaptar el Excel a la plantilla y subir",
      },
      {
        what: "Clientes y Proveedores",
        how: "Odoo: Clientes → ☰ Acción → Exportar. SAP: XD03 clientes / XK03 proveedores.",
        where: "ContaFlow → Clientes o Proveedores → ingresar o pedir importación masiva al soporte",
      },
      {
        what: "Antigüedad CxC",
        how: "Odoo: Contabilidad → Clientes → Facturas → filtrar Pendiente → Exportar. SAP: S_ALR_87012172.",
        where: "ContaFlow → Facturas de Venta (una por cliente pendiente)",
      },
      {
        what: "Antigüedad CxP",
        how: "Odoo: Contabilidad → Proveedores → Facturas → filtrar Pendiente. SAP: S_ALR_87012103.",
        where: "ContaFlow → Facturas de Compra (una por proveedor pendiente)",
      },
      {
        what: "Balance de apertura",
        how: "Odoo: Contabilidad → Reportes → Balance General a fecha de corte. SAP: F.01 o S_ALR_87012284.",
        where: "ContaFlow → Asientos → Asiento de Apertura que refleje el saldo de cada cuenta",
      },
    ],
  },
};

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

// ─────────────────────────────────────────────────────────────────────────────
// STEP COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Path choice ───────────────────────────────────────────────────────────────

function PathChoice({
  onChoose,
  onClose,
}: {
  onChoose: (p: WizardPath) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        Antes de empezar, cuéntanos: ¿cómo quieres comenzar con ContaFlow?
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChoose("scratch")}
          className="flex flex-col gap-2 rounded-xl border-2 p-4 text-left hover:border-blue-500 hover:bg-blue-50 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
            <BuildingIcon className="h-5 w-5 text-blue-600" />
          </div>
          <p className="font-semibold text-zinc-800">Empezar de cero</p>
          <p className="text-xs text-zinc-500">
            Nueva empresa o primera vez usando software contable. Te guiamos paso a paso.
          </p>
        </button>
        <button
          onClick={() => onChoose("migrate")}
          className="flex flex-col gap-2 rounded-xl border-2 p-4 text-left hover:border-purple-500 hover:bg-purple-50 transition-colors focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:outline-none"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
            <DatabaseIcon className="h-5 w-5 text-purple-600" />
          </div>
          <p className="font-semibold text-zinc-800">Migrar datos</p>
          <p className="text-xs text-zinc-500">
            Ya tienes contabilidad en Mónica, Profit Plus, Odoo, SAP u hojas de cálculo.
          </p>
        </button>
      </div>
      <div className="pt-1 text-right">
        <button
          onClick={onClose}
          className="text-xs text-zinc-400 hover:text-zinc-600"
        >
          Omitir por ahora
        </button>
      </div>
    </div>
  );
}

// ── Progress bar scratch ──────────────────────────────────────────────────────

function ScratchStepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {SCRATCH_STEPS.map((s, i) => {
        const done    = current > s.id;
        const active  = current === s.id;
        return (
          <div key={s.id} className="flex flex-1 items-center gap-1.5">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              done   ? "bg-green-500 text-white" :
              active ? "bg-blue-600 text-white"  :
                       "bg-zinc-100 text-zinc-400"
            }`}>
              {done ? <CheckCircleIcon className="h-3.5 w-3.5" /> : s.id}
            </div>
            <span className={`hidden text-xs sm:inline ${active ? "text-zinc-700 font-medium" : "text-zinc-400"}`}>
              {s.label}
            </span>
            {i < SCRATCH_STEPS.length - 1 && (
              <div className={`h-px flex-1 ${done ? "bg-green-400" : "bg-zinc-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Company Data ──────────────────────────────────────────────────────

type CompanyFormState = {
  address: string; telefono: string; email: string;
  ciiu: string; actividad: string; isSpecialContributor: boolean;
};

function StepCompanyData({
  form, onChange, onSave, onSkip, isPending,
}: {
  form: CompanyFormState;
  onChange: (f: Partial<CompanyFormState>) => void;
  onSave: () => void;
  onSkip: () => void;
  isPending: boolean;
}) {
  const inputCls = "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
        <BuildingIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-800">Paso 1 — Datos de tu empresa</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Esta información aparece en tus reportes fiscales y comprobantes. Puedes editarla después en Configuración.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">Dirección</label>
          <input
            className={inputCls}
            placeholder="Av. Principal, Local 1..."
            value={form.address}
            onChange={(e) => onChange({ address: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">Teléfono</label>
          <input
            className={inputCls}
            placeholder="0212-555-0100"
            value={form.telefono}
            onChange={(e) => onChange({ telefono: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">Email fiscal</label>
          <input
            type="email"
            className={inputCls}
            placeholder="contabilidad@miempresa.com"
            value={form.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">CIIU</label>
          <input
            className={inputCls}
            placeholder="6512"
            value={form.ciiu}
            onChange={(e) => onChange({ ciiu: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-xs font-medium text-zinc-600">Actividad económica</label>
          <input
            className={inputCls}
            placeholder="Actividad principal de tu empresa..."
            value={form.actividad}
            onChange={(e) => onChange({ actividad: e.target.value })}
          />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input
            id="special"
            type="checkbox"
            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            checked={form.isSpecialContributor}
            onChange={(e) => onChange({ isSpecialContributor: e.target.checked })}
          />
          <label htmlFor="special" className="text-sm text-zinc-700">
            Contribuyente Especial (aplica IGTF en pagos en divisas y retenciones IVA)
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onSkip} className="text-xs text-zinc-400 hover:text-zinc-600">
          Completar después →
        </button>
        <button
          onClick={onSave}
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
        >
          {isPending ? "Guardando…" : "Guardar y continuar"}
          {!isPending && <ArrowRightIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Chart of Accounts ─────────────────────────────────────────────────

function StepChartOfAccounts({
  companyId, confirmed, onConfirm, onBack, onNext,
}: {
  companyId: string; confirmed: boolean;
  onConfirm: () => void; onBack: () => void; onNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
        <BookOpenIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-800">Paso 2 — Plan de Cuentas</p>
          <p className="text-xs text-blue-600 mt-0.5">
            El plan de cuentas es la base de toda la contabilidad. Sin él, no puedes registrar asientos ni emitir reportes.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-700">¿Cómo quieres crear tu plan de cuentas?</p>

        {/* Opción importar */}
        <Link
          href={`/company/${companyId}/import`}
          className="flex items-center gap-3 rounded-lg border p-3 hover:bg-zinc-50 transition-colors group"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100">
            <FileSpreadsheetIcon className="h-4 w-4 text-green-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-800">Importar desde Excel</p>
            <p className="text-xs text-zinc-500">
              Descarga la plantilla, llénala con tus cuentas (código, nombre, tipo) y súbela. Recomendado si vienes de otro sistema.
            </p>
          </div>
          <ArrowRightIcon className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600" />
        </Link>

        {/* Opción manual */}
        <Link
          href={`/company/${companyId}/accounts`}
          className="flex items-center gap-3 rounded-lg border p-3 hover:bg-zinc-50 transition-colors group"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
            <BookOpenIcon className="h-4 w-4 text-blue-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-800">Crear manualmente</p>
            <p className="text-xs text-zinc-500">
              Agrega las cuentas una a una con el codificador estándar venezolano (1000-Activos, 2000-Pasivos…).
            </p>
          </div>
          <ArrowRightIcon className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600" />
        </Link>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-3">
        <input
          id="accounts-done"
          type="checkbox"
          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          checked={confirmed}
          onChange={(e) => e.target.checked && onConfirm()}
        />
        <label htmlFor="accounts-done" className="text-sm text-zinc-600 cursor-pointer">
          Ya configuré mi plan de cuentas — continuar al siguiente paso
        </label>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600">
          <ArrowLeftIcon className="h-4 w-4" /> Atrás
        </button>
        <button
          onClick={onNext}
          disabled={!confirmed}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
        >
          Continuar <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Open Period ───────────────────────────────────────────────────────

function StepOpenPeriod({
  form, onChange, onOpen, onBack, onSkip, isPending, hasPeriod,
}: {
  form: { year: number; month: number };
  onChange: (f: Partial<{ year: number; month: number }>) => void;
  onOpen: () => void;
  onBack: () => void;
  onSkip: () => void;
  isPending: boolean;
  hasPeriod: boolean;
}) {
  const selectCls = "rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
        <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-800">Paso 3 — Período Contable</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Sin un período abierto no puedes registrar asientos ni facturas. Abre el mes en que empiezas a operar en ContaFlow.
          </p>
        </div>
      </div>

      {hasPeriod ? (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3">
          <CheckCircleIcon className="h-5 w-5 text-green-600" />
          <p className="text-sm text-green-700">Ya tienes un período contable abierto. ¡Puedes continuar!</p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="space-y-1 flex-1">
            <label className="text-xs font-medium text-zinc-600">Mes</label>
            <select
              className={selectCls + " w-full"}
              value={form.month}
              onChange={(e) => onChange({ month: parseInt(e.target.value) })}
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 flex-1">
            <label className="text-xs font-medium text-zinc-600">Año</label>
            <select
              className={selectCls + " w-full"}
              value={form.year}
              onChange={(e) => onChange({ year: parseInt(e.target.value) })}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600">
          <ArrowLeftIcon className="h-4 w-4" /> Atrás
        </button>
        {hasPeriod ? (
          <button
            onClick={onSkip}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
          >
            Continuar <ArrowRightIcon className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={onSkip} className="text-xs text-zinc-400 hover:text-zinc-600">
              Omitir
            </button>
            <button
              onClick={onOpen}
              disabled={isPending}
              aria-busy={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
            >
              {isPending ? "Abriendo…" : "Abrir período"}
              {!isPending && <ArrowRightIcon className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 4: GL Config ─────────────────────────────────────────────────────────

function StepGLConfig({
  companyId, onBack, onDone,
}: {
  companyId: string; onBack: () => void; onDone: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
        <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div>
          <p className="text-sm font-medium text-blue-800">Paso 4 — Cuentas GL</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Conecta las cuentas contables que usarán las facturas al causar en el Libro Mayor automáticamente.
          </p>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-2.5">
        <p className="text-sm font-medium text-zinc-700">Cuentas a mapear en Configuración → Contabilidad:</p>
        {[
          { label: "Cuentas por Cobrar (CxC)",    account: "1130 · Clientes" },
          { label: "Cuentas por Pagar (CxP)",      account: "2110 · Proveedores" },
          { label: "Ingresos por Ventas",           account: "4110 · Ventas" },
          { label: "Gastos de Compra",              account: "5110 · Costo de Ventas" },
          { label: "IVA Débito Fiscal",             account: "2112 · IVA por Pagar" },
          { label: "IVA Crédito Fiscal",            account: "1115 · IVA por Cobrar" },
        ].map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm">
            <span className="text-zinc-600">{r.label}</span>
            <span className="font-mono text-xs text-zinc-400">{r.account}</span>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-xs text-amber-700">
          Los nombres de cuenta mostrados son ejemplos. Selecciona las cuentas reales de <strong>tu plan de cuentas</strong> en la pantalla de configuración.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600">
          <ArrowLeftIcon className="h-4 w-4" /> Atrás
        </button>
        <div className="flex items-center gap-2">
          <Link
            href={`/company/${companyId}/settings`}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-4 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
          >
            Ir a Configuración <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <button
            onClick={onDone}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:outline-none"
          >
            Finalizar <CheckCircleIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Migration: System choice ──────────────────────────────────────────────────

function MigrateSystemChoice({
  onChoose, onBack,
}: {
  onChoose: (s: MigrationSystem) => void;
  onBack: () => void;
}) {
  const systems: { id: MigrationSystem; icon: typeof FileSpreadsheetIcon; label: string; desc: string; color: string; bg: string }[] = [
    { id: "excel",  icon: FileSpreadsheetIcon, label: "Excel / CSV",          desc: "Datos en hojas de cálculo propias",        color: "text-green-700", bg: "bg-green-100" },
    { id: "monica", icon: PackageIcon,          label: "Mónica / Profit Plus", desc: "Software contable venezolano",             color: "text-blue-700",  bg: "bg-blue-100"  },
    { id: "odoo",   icon: DatabaseIcon,         label: "Odoo / SAP / ERP",     desc: "Sistemas de gestión empresarial",          color: "text-purple-700", bg: "bg-purple-100" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">¿Desde qué sistema vienes? Te mostramos qué exportar y dónde cargarlo.</p>
      <div className="space-y-2">
        {systems.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => onChoose(s.id)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-zinc-50 transition-colors group focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none"
            >
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${s.bg}`}>
                <Icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-800">{s.label}</p>
                <p className="text-xs text-zinc-400">{s.desc}</p>
              </div>
              <ArrowRightIcon className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600" />
            </button>
          );
        })}
      </div>
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600">
        <ArrowLeftIcon className="h-4 w-4" /> Atrás
      </button>
    </div>
  );
}

// ── Migration: Guide ──────────────────────────────────────────────────────────

function MigrationGuide({
  system, companyId, onBack, onStartSetup,
}: {
  system: MigrationSystem;
  companyId: string;
  onBack: () => void;
  onStartSetup: () => void;
}) {
  const guide = MIGRATION_GUIDES[system];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg bg-purple-50 p-3">
        <DatabaseIcon className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
        <div>
          <p className="text-sm font-medium text-purple-800">Migración desde {guide.title}</p>
          <p className="text-xs text-purple-600 mt-0.5">
            Exporta estos datos de tu sistema actual y luego los cargas en ContaFlow.
          </p>
        </div>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {guide.steps.map((s, i) => (
          <div key={i} className="rounded-lg border bg-white p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white">
                {i + 1}
              </span>
              <p className="text-sm font-semibold text-zinc-800">{s.what}</p>
            </div>
            <p className="text-xs text-zinc-500 pl-7"><span className="font-medium text-zinc-600">Cómo:</span> {s.how}</p>
            <p className="text-xs pl-7">
              <span className="font-medium text-zinc-600">Dónde en ContaFlow:</span>{" "}
              <span className="text-blue-600">{s.where}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600">
          <ArrowLeftIcon className="h-4 w-4" /> Cambiar sistema
        </button>
        <button
          onClick={onStartSetup}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
        >
          He exportado mis datos. Comenzar configuración
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Completed screen ──────────────────────────────────────────────────────────

function CompletedScreen({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const links = [
    { label: "Registrar primer asiento",    href: `/company/${companyId}/transactions/new`,  desc: "Libro Diario" },
    { label: "Nueva factura de venta",       href: `/company/${companyId}/invoices/new`,        desc: "Facturación" },
    { label: "Agregar cliente",              href: `/company/${companyId}/customers`,            desc: "Cartera CxC" },
    { label: "Configurar nómina",            href: `/company/${companyId}/payroll/config`,       desc: "RR.HH." },
  ];

  return (
    <div className="space-y-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckCircleIcon className="h-8 w-8 text-green-600" />
        </div>
        <p className="text-lg font-bold text-zinc-800">¡Tu empresa está lista!</p>
        <p className="text-sm text-zinc-500">¿Por dónde quieres empezar?</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-left">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onClose}
            className="rounded-lg border p-3 hover:bg-zinc-50 transition-colors group"
          >
            <p className="text-sm font-medium text-zinc-800 group-hover:text-blue-600">{l.label}</p>
            <p className="text-xs text-zinc-400">{l.desc}</p>
          </Link>
        ))}
      </div>
      <button
        onClick={onClose}
        className="text-sm text-zinc-400 hover:text-zinc-600"
      >
        Cerrar e ir al dashboard
      </button>
    </div>
  );
}
