// src/modules/vendors/schemas/vendor.schemas.ts
import { z } from "zod";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";

export const CONTACT_CATEGORIES = ["LEAD", "REGULAR", "VIP"] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

const categoryField = z
  .enum(["LEAD", "REGULAR", "VIP"])
  .optional()
  .default("REGULAR");

const rifField = z
  .string()
  .trim()
  .regex(VEN_RIF_REGEX, "RIF inválido (ej: J-12345678-9)")
  .optional()
  .or(z.literal("").transform(() => undefined));

const codeField = z
  .string()
  .trim()
  .max(30, "Máximo 30 caracteres")
  .optional()
  .or(z.literal("").transform(() => undefined));

const groupIdField = z.string().cuid().optional().or(z.literal("").transform(() => undefined));

export const CreateVendorSchema = z.object({
  name:                 z.string().trim().min(1, "Nombre requerido").max(200),
  rif:                  rifField,
  email:                z.string().trim().email("Email inválido").optional().or(z.literal("").transform(() => undefined)),
  phone:                z.string().trim().max(50).optional().or(z.literal("").transform(() => undefined)),
  address:              z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  isSpecialContributor: z.boolean().optional().default(false),
  code:                 codeField,
  groupId:              groupIdField,
  notes:                z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
  category:             categoryField,
});

export const UpdateVendorSchema = CreateVendorSchema.partial();

export const CreateCustomerSchema = z.object({
  name:     z.string().trim().min(1, "Nombre requerido").max(200),
  rif:      rifField,
  email:    z.string().trim().email("Email inválido").optional().or(z.literal("").transform(() => undefined)),
  phone:    z.string().trim().max(50).optional().or(z.literal("").transform(() => undefined)),
  address:  z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  code:     codeField,
  groupId:  groupIdField,
  notes:    z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
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
