import { z } from "zod";

const MAX_RANGE_DAYS = 366;

// Cuando allHistory=true el rango de fechas es ignorado por ExportService.
// Se usa una ventana de 10 años para satisfacer el schema del job (dateFrom/dateTo en DB).
export const CreateExportJobSchema = z
  .object({
    companyId: z.string().min(1, { error: "La empresa es requerida" }),
    allHistory: z.boolean().optional().default(false),
    dateFrom: z.coerce.date({ error: "Fecha de inicio inválida" }).optional(),
    dateTo: z.coerce.date({ error: "Fecha de fin inválida" }).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.allHistory) return; // sin validación de rango
    if (!d.dateFrom) {
      ctx.addIssue({ code: "custom", message: "Fecha de inicio requerida", path: ["dateFrom"] });
      return;
    }
    if (!d.dateTo) {
      ctx.addIssue({ code: "custom", message: "Fecha de fin requerida", path: ["dateTo"] });
      return;
    }
    if (d.dateTo < d.dateFrom) {
      ctx.addIssue({ code: "custom", message: "La fecha de fin debe ser igual o posterior a la de inicio", path: ["dateTo"] });
      return;
    }
    const diffDays = (d.dateTo.getTime() - d.dateFrom.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: "custom",
        message: `El rango máximo es ${MAX_RANGE_DAYS} días. Para más, usa "Todo el historial".`,
        path: ["dateTo"],
      });
    }
  });

export type CreateExportJobInput = z.infer<typeof CreateExportJobSchema>;
