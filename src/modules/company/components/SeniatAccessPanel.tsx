// src/modules/company/components/SeniatAccessPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import {
  ShieldCheckIcon,
  ShieldAlertIcon,
  CopyIcon,
  PrinterIcon,
  UserXIcon,
  UserPlusIcon,
  Loader2Icon,
  CheckCircle2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  addMemberAction,
  removeMemberAction,
  getMembersAction,
} from "../actions/member.actions";
import type { MemberRow } from "../services/MemberService";
import type { UserRole } from "@prisma/client";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
  currentUserRole: UserRole;
  companyName: string;
  companyRif: string | null;
  initialSeniatMember: MemberRow | null;
};

// ─── Texto de credenciales — equivalente al "sobre sellado" de Gálac ─────────

function buildCredentialSummary(
  companyName: string,
  companyRif: string | null,
  member: MemberRow,
  companyId: string
): string {
  const fecha = new Date().toLocaleDateString("es-VE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return [
    "════════════════════════════════════════════════════════",
    "       CREDENCIALES DE ACCESO — AUDITORÍA SENIAT",
    "         (Providencia Administrativa PA 121)",
    "════════════════════════════════════════════════════════",
    "",
    `Empresa : ${companyName}`,
    `RIF     : ${companyRif ?? "No registrado"}`,
    `Fecha   : ${fecha}`,
    "",
    "── DATOS DEL AUDITOR ────────────────────────────────────",
    `Nombre  : ${member.user.name ?? "(no especificado)"}`,
    `Email   : ${member.user.email}`,
    `Rol     : Auditor SENIAT (acceso de solo lectura)`,
    "",
    "── ACCESO AL SISTEMA ────────────────────────────────────",
    `URL     : ${origin}/sign-in`,
    `Empresa : Seleccionar "${companyName}" al ingresar`,
    "",
    "── MÓDULOS HABILITADOS ──────────────────────────────────",
    "• Informe de Auditoría de Facturas (Libro de Ventas)",
    "• Informe de Auditoría de Caja (Registros de Cobro/Pago)",
    "",
    "── INSTRUCCIONES DE SEGURIDAD ───────────────────────────",
    "1. El auditor debe registrarse en ContaFlow con el email",
    `   indicado (${member.user.email}) antes de ingresar.`,
    "2. Este documento es confidencial. Entregar en mano al",
    "   funcionario del SENIAT designado para la fiscalización.",
    "3. El acceso es de SOLO LECTURA. No puede emitir, modificar",
    "   ni eliminar documentos fiscales ni contables.",
    "4. El acceso puede ser revocado por el Propietario en",
    "   cualquier momento desde Configuración → Equipo.",
    "",
    "════════════════════════════════════════════════════════",
    `Sistema ContaFlow — Conforme PA 121 SENIAT`,
    `Empresa ID: ${companyId}`,
    "════════════════════════════════════════════════════════",
  ].join("\n");
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function SeniatAccessPanel({
  companyId,
  currentUserRole,
  companyName,
  companyRif,
  initialSeniatMember,
}: Props) {
  const [seniatMember, setSeniatMember] = useState<MemberRow | null>(initialSeniatMember);
  const [assignEmail, setAssignEmail] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentialText, setCredentialText] = useState("");
  const [copied, setCopied] = useState(false);
  const [isPendingAssign, startAssignTransition] = useTransition();
  const [isPendingRevoke, startRevokeTransition] = useTransition();

  const removeMemberWithStepUp = useReverification(removeMemberAction);

  // Guard ADR-019 D-3: solo OWNER gestiona el acceso SENIAT
  if (currentUserRole !== "OWNER") return null;

  // ── Asignar ────────────────────────────────────────────────────────────────

  function handleAssign() {
    setAssignError(null);
    startAssignTransition(async () => {
      const result = await addMemberAction({ companyId, email: assignEmail, role: "SENIAT" });
      if (!result.success) {
        setAssignError(result.error);
        return;
      }
      toast.success("Acceso SENIAT asignado correctamente.");
      setAssignEmail("");
      const refreshed = await getMembersAction(companyId);
      if (refreshed.success) {
        const found = refreshed.data.find((m) => m.role === "SENIAT") ?? null;
        setSeniatMember(found);
        if (found) {
          const text = buildCredentialSummary(companyName, companyRif, found, companyId);
          setCredentialText(text);
          setShowCredentials(true);
        }
      }
    });
  }

  // ── Revocar (con step-up — mismo patrón que MembersPanel) ─────────────────

  function handleRevoke() {
    if (!seniatMember) return;
    startRevokeTransition(async () => {
      try {
        const result = await removeMemberWithStepUp({
          companyId,
          targetUserId: seniatMember.userId,
        });
        if (!result) return;
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("Acceso SENIAT revocado.");
        setSeniatMember(null);
      } catch (e) {
        if (isReverificationCancelledError(e)) return;
        throw e;
      }
    });
  }

  // ── Ver credenciales ───────────────────────────────────────────────────────

  function handleViewCredentials() {
    if (!seniatMember) return;
    const text = buildCredentialSummary(companyName, companyRif, seniatMember, companyId);
    setCredentialText(text);
    setShowCredentials(true);
  }

  async function handleCopyCredentials() {
    await navigator.clipboard.writeText(credentialText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrintCredentials() {
    const win = window.open("", "_blank", "width=620,height=720");
    if (!win) return;
    win.document.write(
      `<html><head><title>Credenciales SENIAT — ${companyName}</title>` +
        `<style>body{font-family:monospace;white-space:pre;padding:28px;font-size:13px;color:#111;}</style>` +
        `</head><body>${credentialText}</body></html>`
    );
    win.document.close();
    win.print();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="rounded-lg border p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold">Acceso Auditoría SENIAT</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Gestiona el acceso del funcionario SENIAT conforme a la PA 121. Solo visible para el Propietario.
            </p>
          </div>
        </div>

        {/* Estado: sin miembro SENIAT asignado */}
        {!seniatMember && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlertIcon className="h-4 w-4 text-amber-600 dark:text-amber-500" aria-hidden />
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-500">
                Sin acceso SENIAT configurado (PA 121)
              </p>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              La PA 121 exige que el SENIAT pueda auditar el sistema en cualquier momento. Asigna un
              usuario con rol <strong>Auditor SENIAT</strong> para cumplir este requisito.
            </p>

            <div className="space-y-2 pt-1">
              <Label
                htmlFor="seniat-email"
                className="block text-sm font-semibold text-gray-900 dark:text-white"
              >
                Email del funcionario SENIAT
              </Label>
              <div className="flex gap-2">
                <Input
                  id="seniat-email"
                  type="email"
                  placeholder="funcionario@seniat.gob.ve"
                  value={assignEmail}
                  onChange={(e) => setAssignEmail(e.target.value)}
                  disabled={isPendingAssign}
                  aria-describedby={assignError ? "seniat-assign-error" : undefined}
                  className="flex-1"
                />
                <Button
                  onClick={handleAssign}
                  disabled={isPendingAssign || !assignEmail.trim()}
                  aria-busy={isPendingAssign}
                >
                  {isPendingAssign ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <UserPlusIcon className="h-4 w-4" aria-hidden />
                  )}
                  <span className="ml-2">Asignar acceso</span>
                </Button>
              </div>
              {assignError && (
                <p id="seniat-assign-error" className="text-sm text-red-600 dark:text-red-400">
                  {assignError}
                </p>
              )}
              <p className="text-xs text-gray-600 dark:text-gray-400">
                El funcionario debe haberse registrado en ContaFlow con ese email al menos una vez.
                Solo tendrá acceso de lectura a los informes de auditoría.
              </p>
            </div>
          </div>
        )}

        {/* Estado: acceso SENIAT activo */}
        {seniatMember && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-500">
                Acceso SENIAT activo — PA 121 cumplida
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {seniatMember.user.name ?? "Auditor SENIAT"}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {seniatMember.user.email}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleViewCredentials}
                  className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  <CopyIcon className="h-4 w-4 mr-1.5" aria-hidden />
                  Ver credenciales
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRevoke}
                  disabled={isPendingRevoke}
                  aria-busy={isPendingRevoke}
                  className="focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  {isPendingRevoke ? (
                    <Loader2Icon className="h-4 w-4 animate-spin mr-1.5" aria-hidden />
                  ) : (
                    <UserXIcon className="h-4 w-4 mr-1.5" aria-hidden />
                  )}
                  Revocar acceso
                </Button>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 px-3 py-2.5 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Acceso de lectura incluye
              </p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                <li className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  Informe de Auditoría de Facturas (Libros de Ventas y Compras)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  Informe de Auditoría de Caja (Registros de Cobro/Pago)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  Estado de transmisiones PA-121 (PENDING / SENT / FAILED)
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Dialog de credenciales — "sobre sellado digital" (equivalente a Gálac) */}
      <Dialog open={showCredentials} onOpenChange={setShowCredentials}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="h-5 w-5 text-emerald-600" aria-hidden />
              Credenciales de Acceso SENIAT
            </DialogTitle>
            <DialogDescription>
              Equivalente al &ldquo;sobre sellado&rdquo; requerido por PA 121. Entrega este documento
              en mano al funcionario del SENIAT.
            </DialogDescription>
          </DialogHeader>

          <pre className="rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-72 font-mono whitespace-pre-wrap">
            {credentialText}
          </pre>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={handleCopyCredentials}
              className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              {copied ? (
                <CheckCircle2Icon className="h-4 w-4 mr-1.5 text-emerald-500" aria-hidden />
              ) : (
                <CopyIcon className="h-4 w-4 mr-1.5" aria-hidden />
              )}
              {copied ? "Copiado" : "Copiar al portapapeles"}
            </Button>
            <Button
              onClick={handlePrintCredentials}
              className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              <PrinterIcon className="h-4 w-4 mr-1.5" aria-hidden />
              Imprimir / PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
