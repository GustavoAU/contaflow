// src/modules/bank-reconciliation/schemas/bank-account.schema.ts
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";

export const CreateBankAccountSchema = z.object({
  companyId: z.string().min(1),
  accountId: z.string().min(1, { error: "Debes seleccionar una cuenta contable" }),
  name: z.string().min(1, { error: "Nombre requerido" }).max(100).trim(),
  bankName: z.string().min(1, { error: "Nombre del banco requerido" }).max(100).trim(),
  currency: z.enum(SUPPORTED_CURRENCIES).default("VES"),
  createdBy: z.string().min(1),
});

export type CreateBankAccountInput = z.infer<typeof CreateBankAccountSchema>;
