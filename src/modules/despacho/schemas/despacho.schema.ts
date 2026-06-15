// ADR-034: Fase Despacho — schemas Zod para validación client + server
import { z } from "zod/v4";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";

export const AddManagedClientSchema = z.object({
  companyId: z.string().min(1),
  rif: z
    .string()
    .min(1, "El RIF es obligatorio")
    .regex(VEN_RIF_REGEX, "RIF inválido — formato: J-12345678-9"),
  clientName: z.string().min(2, "Nombre mínimo 2 caracteres").max(200),
  ciiu: z.string().max(10).optional(),
  notes: z.string().max(500).optional(),
});

export const ArchiveManagedClientSchema = z.object({
  companyId: z.string().min(1),
  managedClientId: z.string().min(1),
});

export const ListManagedClientsSchema = z.object({
  companyId: z.string().min(1),
  includeArchived: z.boolean().optional().default(false),
});

export type AddManagedClientInput = z.infer<typeof AddManagedClientSchema>;
