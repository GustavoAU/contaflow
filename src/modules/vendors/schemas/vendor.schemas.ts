// src/modules/vendors/schemas/vendor.schemas.ts
import { z } from "zod";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";
import { zOptionalText, zEmptyAsNull } from "@/lib/zod-helpers";

export const CONTACT_CATEGORIES = ["LEAD", "REGULAR", "VIP"] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

const categoryField = z
  .enum(["LEAD", "REGULAR", "VIP"])
  .optional()
  .default("REGULAR");

// "" → null: limpia la columna en updates y evita P2002 por "" en @@unique([companyId, rif])
const rifField = zEmptyAsNull(z.string().trim().regex(VEN_RIF_REGEX, "RIF inválido (ej: J-12345678-9)"));

const codeField = zOptionalText(30, "Máximo 30 caracteres");

const groupIdField = zEmptyAsNull(z.string().cuid());

export const CreateVendorSchema = z.object({
  name:                 z.string().trim().min(1, "Nombre requerido").max(200),
  rif:                  rifField,
  email:                zEmptyAsNull(z.string().trim().email("Email inválido")),
  phone:                zOptionalText(50),
  address:              zOptionalText(500),
  isSpecialContributor: z.boolean().optional().default(false),
  code:                 codeField,
  groupId:              groupIdField,
  notes:                zOptionalText(2000),
  category:             categoryField,
});

export const UpdateVendorSchema = CreateVendorSchema.partial();

export const CreateCustomerSchema = z.object({
  name:     z.string().trim().min(1, "Nombre requerido").max(200),
  rif:      rifField,
  email:    zEmptyAsNull(z.string().trim().email("Email inválido")),
  phone:    zOptionalText(50),
  address:  zOptionalText(500),
  code:     codeField,
  groupId:  groupIdField,
  notes:    zOptionalText(2000),
  category: categoryField,
});

export const ContactNoteSchema = z.object({
  content: z.string().trim().min(1, "Contenido requerido").max(2000),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export const CreateContactGroupSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(100),
});

export type CreateVendorInput       = z.input<typeof CreateVendorSchema>;
export type UpdateVendorInput       = z.input<typeof UpdateVendorSchema>;
export type CreateCustomerInput     = z.input<typeof CreateCustomerSchema>;
export type UpdateCustomerInput     = z.input<typeof UpdateCustomerSchema>;
export type CreateContactGroupInput = z.input<typeof CreateContactGroupSchema>;
export type ContactNoteInput        = z.infer<typeof ContactNoteSchema>;
