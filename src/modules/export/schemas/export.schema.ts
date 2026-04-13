import { z } from "zod";

const MAX_RANGE_DAYS = 366;

export const CreateExportJobSchema = z
  .object({
    companyId: z.string().min(1, { error: "La empresa es requerida" }),
    dateFrom: z.coerce.date({ error: "Fecha de inicio inválida" }),
    dateTo: z.coerce.date({ error: "Fecha de fin inválida" }),
  })
  .refine((d) => d.dateTo >= d.dateFrom, {
    error: "La fecha de fin debe ser igual o posterior a la de inicio",
  })
  .refine(
    (d) => {
      const diffMs = d.dateTo.getTime() - d.dateFrom.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= MAX_RANGE_DAYS;
    },
    { error: `El rango máximo es ${MAX_RANGE_DAYS} días` }
  );

export type CreateExportJobInput = z.infer<typeof CreateExportJobSchema>;
