// src/modules/company/components/MembersPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { UserPlusIcon, Trash2Icon, Loader2Icon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ROLE_LABELS } from "@/lib/auth-helpers";
import {
  addMemberAction,
  updateMemberRoleAction,
  removeMemberAction,
} from "../actions/member.actions";
import type { MemberRow } from "../services/MemberService";
import type { UserRole } from "@prisma/client";
import type { AddMemberInput } from "../schemas/member.schema";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AssignableRole = AddMemberInput["role"];

type Props = {
  companyId: string;
  currentUserId: string;
  currentUserRole: UserRole;
  initialMembers: MemberRow[];
};

const ASSIGNABLE_ROLES: AssignableRole[] = [
  "ADMIN",
  "ACCOUNTANT",
  "ADMINISTRATIVE",
  "VIEWER",
  "SENIAT",
];

const ROLE_BADGE_VARIANT: Record<UserRole, "default" | "secondary" | "outline"> = {
  OWNER: "default",
  ADMIN: "default",
  ACCOUNTANT: "secondary",
  ADMINISTRATIVE: "secondary",
  VIEWER: "outline",
  SENIAT: "outline",
};

const canManage = (role: UserRole) => role === "OWNER" || role === "ADMIN";

// ─── Componente ───────────────────────────────────────────────────────────────

export function MembersPanel({
  companyId,
  currentUserId,
  currentUserRole,
  initialMembers,
}: Props) {
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [isPending, startTransition] = useTransition();

  // Add form state
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<AssignableRole>("ACCOUNTANT");
  const [addError, setAddError] = useState<string | null>(null);

  // Confirm remove dialog
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [isRemoving, startRemoveTransition] = useTransition();

  // Q2-3: wrap removeMember con step-up
  const removeMemberWithStepUp = useReverification(removeMemberAction);

  const isManager = canManage(currentUserRole);

  // ─── Agregar ─────────────────────────────────────────────────────────────

  function handleAdd() {
    setAddError(null);
    startTransition(async () => {
      const result = await addMemberAction({ companyId, email: addEmail, role: addRole });
      if (!result.success) {
        setAddError(result.error);
        return;
      }
      toast.success("Miembro agregado correctamente.");
      setAddEmail("");
      setAddRole("ACCOUNTANT");
      // Refresh list via server action
      const { getMembersAction } = await import("../actions/member.actions");
      const refreshed = await getMembersAction(companyId);
      if (refreshed.success) setMembers(refreshed.data);
    });
  }

  // ─── Cambiar rol ─────────────────────────────────────────────────────────

  function handleRoleChange(member: MemberRow, newRole: AssignableRole) {
    startTransition(async () => {
      const result = await updateMemberRoleAction({
        companyId,
        targetUserId: member.userId,
        role: newRole,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Rol actualizado.");
      setMembers((prev) =>
        prev.map((m) => (m.userId === member.userId ? { ...m, role: newRole } : m))
      );
    });
  }

  // ─── Eliminar ────────────────────────────────────────────────────────────

  function handleConfirmRemove() {
    if (!removeTarget) return;
    startRemoveTransition(async () => {
      try {
        const result = await removeMemberWithStepUp({
          companyId,
          targetUserId: removeTarget.userId,
        });
        if (!result) return; // cancelado
        if (!result.success) {
          toast.error(result.error);
          setRemoveTarget(null);
          return;
        }
        toast.success("Miembro eliminado.");
        setMembers((prev) => prev.filter((m) => m.userId !== removeTarget.userId));
        setRemoveTarget(null);
      } catch (e) {
        if (isReverificationCancelledError(e)) return;
        throw e;
      }
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <UsersIcon className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Equipo</h2>
          <p className="text-muted-foreground text-sm">
            Gestiona los usuarios con acceso a esta empresa.
          </p>
        </div>
      </div>

      {/* Lista de miembros */}
      <div className="divide-y rounded-md border">
        {members.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay miembros registrados.
          </p>
        )}
        {members.map((member) => {
          const isCurrentUser = member.userId === currentUserId;
          const isOwner = member.role === "OWNER";
          const canEdit = isManager && !isOwner && !isCurrentUser;

          return (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.user.name ?? member.user.email}
                  {isCurrentUser && (
                    <span className="ml-2 text-xs text-muted-foreground">(tú)</span>
                  )}
                </p>
                {member.user.name && (
                  <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                )}
              </div>

              {/* Rol */}
              {canEdit ? (
                <Select
                  value={member.role}
                  onValueChange={(v) => handleRoleChange(member, v as AssignableRole)}
                  disabled={isPending}
                >
                  <SelectTrigger className="w-40 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={ROLE_BADGE_VARIANT[member.role]}>
                  {ROLE_LABELS[member.role]}
                </Badge>
              )}

              {/* Acción eliminar */}
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setRemoveTarget(member)}
                  disabled={isPending}
                >
                  <Trash2Icon className="h-4 w-4" />
                </Button>
              ) : (
                <div className="w-8" />
              )}
            </div>
          );
        })}
      </div>

      {/* Formulario agregar miembro */}
      {isManager && (
        <div className="space-y-3 pt-1">
          <p className="text-sm font-medium">Agregar miembro</p>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="member-email" className="sr-only">
                Email
              </Label>
              <Input
                id="member-email"
                type="email"
                placeholder="correo@ejemplo.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                disabled={isPending}
              />
            </div>
            <Select
              value={addRole}
              onValueChange={(v) => setAddRole(v as AssignableRole)}
              disabled={isPending}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleAdd}
              disabled={isPending || !addEmail.trim()}
            >
              {isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlusIcon className="h-4 w-4" />
              )}
              <span className="ml-2">Agregar</span>
            </Button>
          </div>
          {addError && <p className="text-sm text-destructive">{addError}</p>}
          <p className="text-xs text-muted-foreground">
            El usuario debe haber iniciado sesión en ContaFlow al menos una vez.
          </p>
        </div>
      )}

      {/* Diálogo confirmación eliminar */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar miembro</DialogTitle>
            <DialogDescription>
              ¿Eliminar a{" "}
              <span className="font-medium">
                {removeTarget?.user.name ?? removeTarget?.user.email}
              </span>{" "}
              de esta empresa? Esta acción revoca su acceso de inmediato.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              disabled={isRemoving}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRemove}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
