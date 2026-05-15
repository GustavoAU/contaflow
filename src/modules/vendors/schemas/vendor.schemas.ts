// src/modules/vendors/schemas/vendor.schemas.ts
import { z } from "zod";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";

const rifField = z
  .string()
  .trim()
  .regex(VEN_RIF_REGEX, "RIF inválido (ej: J-12345678-9)")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const CreateVendorSchema = z.object({
  name:                 z.string().trim().min(1, "Nombre requerido").max(200),
  rif:                  rifField,
  email:                z.string().trim().email("Email inválido").optional().or(z.literal("").transform(() => undefined)),
  phone:                z.string().trim().max(50).optional().or(z.literal("").transform(() => undefined)),
  address:              z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  isSpecialContributor: z.boolean().optional().default(false),
});

export const UpdateVendorSchema = CreateVendorSchema.partial();

export const CreateCustomerSchema = z.object({
  name:    z.string().trim().min(1, "Nombre requerido").max(200),
  rif:     rifField,
  email:   z.string().trim().email("Email inválido").optional().or(z.literal("").transform(() => undefined)),
  phone:   z.string().trim().max(50).optional().or(z.literal("").transform(() => undefined)),
  address: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export type CreateVendorInput   = z.input<typeof CreateVendorSchema>;
export type UpdateVendorInput   = z.input<typeof UpdateVendorSchema>;
export type CreateCustomerInput = z.input<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof UpdateCustomerSchema>;
