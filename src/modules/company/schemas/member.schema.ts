// src/modules/company/schemas/member.schema.ts
import { z } from "zod";

// Roles que se pueden asignar — OWNER se excluye (se asigna solo en creación de empresa)
const ASSIGNABLE_ROLES = ["ADMIN", "ACCOUNTANT", "ADMINISTRATIVE", "VIEWER", "SENIAT"] as const;

export const AddMemberSchema = z.object({
  companyId: z.string().min(1, "Company ID requerido"),
  email: z.string().email("Email inválido"),
  role: z.enum(ASSIGNABLE_ROLES),
});

export const UpdateMemberRoleSchema = z.object({
  companyId: z.string().min(1, "Company ID requerido"),
  targetUserId: z.string().min(1, "Usuario requerido"),
  role: z.enum(ASSIGNABLE_ROLES),
});

export const RemoveMemberSchema = z.object({
  companyId: z.string().min(1, "Company ID requerido"),
  targetUserId: z.string().min(1, "Usuario requerido"),
});

export type AddMemberInput = z.infer<typeof AddMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;
export type RemoveMemberInput = z.infer<typeof RemoveMemberSchema>;
