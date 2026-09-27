// src/modules/vendors/schemas/partner.schemas.ts
// ADR-054: Partner es el tercero mínimo para socio/accionista (sin modelo previo en el
// sistema — Customer/Vendor/Employee ya existían). RIF reusa VEN_RIF_REGEX (misma fuente
// única que CreateVendorSchema/CreateCustomerSchema) — no se inventa una validación distinta.
import { z } from "zod";
import { VEN_RIF_REGEX } from "@/lib/fiscal-validators";
import { zEmptyAsNull, zOptionalText } from "@/lib/zod-helpers";

// "" → null: limpia la columna en updates y evita P2002 por "" en @@unique([companyId, rif])
const rifField = zEmptyAsNull(z.string().trim().regex(VEN_RIF_REGEX, "RIF inválido (ej: J-12345678-9)"));

export const CreatePartnerSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido (mínimo 2 caracteres)").max(200),
  rif: rifField,
  notes: zOptionalText(2000),
});

export const UpdatePartnerSchema = CreatePartnerSchema.partial();

export type CreatePartnerInput = z.input<typeof CreatePartnerSchema>;
export type UpdatePartnerInput = z.input<typeof UpdatePartnerSchema>;
